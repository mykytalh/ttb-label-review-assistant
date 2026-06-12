/**
 * Evaluation harness for the extract → validate pipeline.
 *
 * Runs each photo N times against hand-labeled ground truth and reports accuracy,
 * detection reach, and run-to-run consistency.
 *
 * Usage:  node eval/run.mjs [--runs N]
 *           [--only tuning-set.json|IMG_1.jpg,IMG_2.jpg]  fixed named subset
 *           [--misses eval/results.json]                  photos any signal got wrong in a prior FULL run
 *           [--sample N --seed S]                         deterministic random subset
 *           [--out eval/results.tuning.json]              output path
 * Images:  https://drive.google.com/drive/folders/1hCq_woq7IwyrOwbi_9XLHeSUsduSUxjN?usp=sharing
 * Requires: npm run dev and ANTHROPIC_API_KEY in the environment.
 *
 * Subset runs (--only/--misses/--sample) are TUNING runs: they print a banner,
 * default their output to eval/results.tuning.json, and record per-run extracted
 * text for miss triage. Headline numbers come only from full no-subset runs.
 *
 * Output: per-photo table and a results JSON with aggregates, latency, and an
 * estimated spend.
 */
import sharp from "sharp";
import fs from "fs";
import path from "path";

const args = process.argv.slice(2);
const flagValue = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const RUNS = Number(flagValue("--runs")) || (args.includes("--runs") ? 3 : 1);
const API = process.env.EVAL_API || "http://localhost:3000/api/review";
const ONLY = flagValue("--only");
const MISSES = flagValue("--misses");
const SAMPLE = args.includes("--sample") ? Number(flagValue("--sample")) : 0;
const SEED = Number(flagValue("--seed")) || 42;
if (SAMPLE && (ONLY || MISSES)) {
  console.error("--sample is mutually exclusive with --only/--misses (a random subset and a named subset can't both apply).");
  process.exit(1);
}
const TUNING = Boolean(ONLY || MISSES || SAMPLE);
const OUT = flagValue("--out") || (TUNING ? "eval/results.tuning.json" : "eval/results.json");

// Rough per-call spend, documented so the printed estimate is auditable:
// image at <=1024px ~ up to 1,400 tokens ((w*h)/750), system prompt + schema +
// user text ~ 1,100, output ~ 350 of the 768 cap. Haiku 4.5 at $1/MTok in,
// $5/MTok out => ~$0.0042/call. No cache discount applies: the prompt prefix is
// far below Haiku's 4096-token caching minimum. /api/review does not return
// token usage, so this is a static estimate, not a measurement.
const EST_COST_PER_CALL = 0.0042;

// The evaluation set: 88 cropped, label-only retail bottle/can photos, each
// hand-labeled by viewing it directly. The GT file declares its own image dir.
const GROUND_TRUTH = "eval/ground-truth-clean.json";

// Build the {file, dir, truth} work list. Photos whose file is missing are
// skipped (so the harness never errors on a partially-synced sample folder).
let items = [];
{
  const data = JSON.parse(fs.readFileSync(GROUND_TRUTH, "utf8"));
  const dir = data.dir || "public/samples/alcohol";
  for (const l of data.labels) {
    if (fs.existsSync(path.join(dir, l.file))) items.push({ file: l.file, dir, truth: l });
  }
}
const FULL_COUNT = items.length;

/** Deterministic PRNG so --sample subsets are replayable from the seed alone. */
function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Apply subset selection. A name that isn't in the ground truth is a hard
// error, not a silent skip — a typo'd tuning set must never score as "ran".
if (ONLY || MISSES) {
  const names = new Set();
  if (ONLY) {
    if (ONLY.endsWith(".json")) {
      const j = JSON.parse(fs.readFileSync(ONLY, "utf8"));
      for (const f of Array.isArray(j) ? j : j.files) names.add(f);
    } else {
      for (const f of ONLY.split(",")) names.add(f.trim());
    }
  }
  if (MISSES) {
    // Set-construction tool: every photo where any signal disagreed with truth
    // in a prior FULL run. Don't feed it a tuning output — fixed photos would
    // drop out of the set and could regress unnoticed on the next iteration.
    const j = JSON.parse(fs.readFileSync(MISSES, "utf8"));
    for (const p of j.perPhoto || []) {
      if (Object.values(p.scored || {}).some((s) => s.pred !== s.truth)) names.add(p.file);
    }
  }
  const known = new Set(items.map((i) => i.file));
  const unknown = [...names].filter((n) => !known.has(n));
  if (unknown.length) {
    console.error(`Subset names not found in ground truth: ${unknown.join(", ")}`);
    process.exit(1);
  }
  items = items.filter((i) => names.has(i.file));
}
if (SAMPLE) {
  const rand = mulberry32(SEED);
  const pool = [...items].sort((a, b) => a.file.localeCompare(b.file));
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  items = pool.slice(0, SAMPLE).sort((a, b) => a.file.localeCompare(b.file));
}

/**
 * Run one photo through the pipeline once; return {json, wallMs}. A 429 from
 * the dev server's per-IP limiter gets one Retry-After-honoring retry so a
 * brief burst doesn't poison a whole scored run.
 */
async function reviewOnce(file, dir) {
  const buf = await sharp(path.join(dir, file))
    .rotate()
    .resize(1024, 1024, { fit: "inside" })
    .jpeg({ quality: 82 })
    .toBuffer();
  const post = () =>
    fetch(API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        application: { brandName: "Eval", beverageType: "other" },
        imageBase64: buf.toString("base64"),
        mediaType: "image/jpeg",
      }),
    });
  let t0 = performance.now();
  let res = await post();
  if (res.status === 429) {
    const wait = Math.min(Number(res.headers.get("retry-after")) || 5, 30);
    await new Promise((r) => setTimeout(r, wait * 1000));
    t0 = performance.now();
    res = await post();
  }
  const wallMs = performance.now() - t0;
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    throw new Error(`HTTP ${res.status}: ${e.error || "?"}`);
  }
  return { json: await res.json(), wallMs };
}

/** Derive the scored signals from one ReviewResult. */
function signalsFromResult(r) {
  const f = (k) => r.fields.find((x) => x.field === k);
  const warn = f("governmentWarning");
  // Tool's implicit "is alcohol / found a warning": warning verdict pass/warn means
  // it read a (federal) warning; fail-with-text-but-not-recognizable means it saw
  // a non-federal warning; fail-no-text means none found.
  const warningRead = warn.found != null && warn.found.trim().length > 0;
  const warningRecognizedFederal = warn.verdict === "pass" || warn.verdict === "warn";
  const abvText = f("alcoholContent").found ?? null;
  return {
    warningRead,
    warningRecognizedFederal,
    abvRead: abvText != null,
    warnVerdict: warn.verdict,
    quality: r.imageQuality,
    // Raw extracted text, kept only in tuning output: lets a miss be triaged
    // (real text the labeler didn't count vs an invented value) without re-running.
    abvText,
    warnText: warn.found ? String(warn.found).slice(0, 80) : null,
  };
}

const fmt = (n, d = 0) => (n * 100).toFixed(d) + "%";

(async () => {
  if (TUNING) {
    const how = ONLY ? `--only ${ONLY}` : MISSES ? `--misses ${MISSES}` : `--sample ${SAMPLE} --seed ${SEED}`;
    console.log(`⚠ TUNING SUBSET RUN (${items.length} of ${FULL_COUNT} photos, ${how}) — NOT headline numbers.\n`);
  }
  console.log(`Evaluating ${items.length} photos × ${RUNS} run(s) against ground truth…\n`);

  const perPhoto = [];
  const wallTimes = [];
  for (const { file, dir, truth: t } of items) {
    const runs = [];
    for (let i = 0; i < RUNS; i++) {
      try {
        const { json, wallMs } = await reviewOnce(file, dir);
        wallTimes.push(wallMs);
        runs.push(signalsFromResult(json));
      } catch (e) {
        runs.push({ error: e.message });
      }
    }
    const ok = runs.filter((r) => !r.error);
    // If EVERY run errored (e.g. the dev server died mid-eval), we have no signal
    // for this photo — scoring it would silently count an infrastructure failure
    // as a model miss and pollute the reach denominator. Skip it and flag loudly.
    if (ok.length === 0) {
      perPhoto.push({ file, difficulty: t.photoDifficulty, brand: t.brand, runs: 0, errors: runs.length, scored: {}, quality: "?", allErrored: true });
      continue;
    }
    // majority vote across runs for accuracy; track flip-rate for consistency
    const vote = (key) => ok.filter((r) => r[key]).length >= Math.ceil(ok.length / 2);
    // "any run" = did the model read this on at least one run? For positive-
    // detection signals (warning/ABV physically present) this is the true reach:
    // small print is read non-deterministically, so majority-of-3 understates a
    // capability that "any run" exposes. Only meaningful for truth=true cases.
    const anyRun = (key) => ok.some((r) => r[key]);
    const flips = (key) => {
      const vals = ok.map((r) => !!r[key]);
      return vals.some((v) => v !== vals[0]) ? 1 : 0;
    };

    // Score each objective signal we have ground truth for.
    const scored = {};
    // warning present (physically) → tool should have read warning text
    if (typeof t.warningPresent === "boolean") {
      scored.warningPresent = { truth: t.warningPresent, pred: vote("warningRead"), any: anyRun("warningRead"), flip: flips("warningRead") };
    }
    // warning federal recognition (only when a federal warning is physically present)
    if (t.warningPresent && t.warningIsFederal === true) {
      scored.warningFederal = { truth: true, pred: vote("warningRecognizedFederal"), any: anyRun("warningRecognizedFederal"), flip: flips("warningRecognizedFederal") };
    }
    // state/non-federal warning must NOT be recognized as federal
    if (t.warningPresent && t.warningIsFederal === false) {
      scored.warningFederal = { truth: false, pred: vote("warningRecognizedFederal"), any: anyRun("warningRecognizedFederal"), flip: flips("warningRecognizedFederal") };
    }
    if (typeof t.abvVisible === "boolean") {
      scored.abv = { truth: t.abvVisible, pred: vote("abvRead"), any: anyRun("abvRead"), flip: flips("abvRead") };
    }

    const entry = { file, difficulty: t.photoDifficulty, brand: t.brand, runs: ok.length, errors: runs.length - ok.length, scored, quality: ok[0]?.quality };
    if (TUNING) entry.reads = ok.map((r) => ({ abv: r.abvText, warn: r.warnText }));
    perPhoto.push(entry);
  }

  // ---- Aggregate ----
  const metrics = ["warningPresent", "warningFederal", "abv"];
  const agg = {};
  // anyCorrect/anyTotal: among photos where the signal is truly present (truth=true),
  // how often did at least one run detect it? A recall ceiling that strips out the
  // majority-vote penalty on non-deterministic small-print reads.
  for (const m of metrics) agg[m] = { correct: 0, total: 0, flips: 0, flipTotal: 0, anyCorrect: 0, anyTotal: 0 };
  for (const p of perPhoto) {
    for (const m of metrics) {
      const s = p.scored[m];
      if (!s) continue;
      agg[m].total++;
      if (s.pred === s.truth) agg[m].correct++;
      if (RUNS > 1) { agg[m].flipTotal++; agg[m].flips += s.flip; }
      if (RUNS > 1 && s.truth === true) { agg[m].anyTotal++; if (s.any) agg[m].anyCorrect++; }
    }
  }

  console.log("PER-PHOTO (✓ = matched ground truth):");
  for (const p of perPhoto) {
    const cells = metrics
      .map((m) => {
        const s = p.scored[m];
        if (!s) return `${m}:—`;
        const mark = s.pred === s.truth ? "✓" : "✗";
        return `${m}:${mark}`;
      })
      .join("  ");
    const err = p.errors ? ` [${p.errors} err]` : "";
    console.log(`  ${(p.brand || "?").padEnd(22)} ${(p.difficulty || "").padEnd(8)} q=${(p.quality||"?").padEnd(5)} ${cells}${err}`);
  }

  console.log("\nAGGREGATE ACCURACY (strict majority-of-N vote):");
  for (const m of metrics) {
    const a = agg[m];
    if (!a.total) continue;
    const consistency = a.flipTotal ? `, consistency ${fmt(1 - a.flips / a.flipTotal)} (${a.flips}/${a.flipTotal} flipped across runs)` : "";
    console.log(`  ${m.padEnd(16)} ${fmt(a.correct / a.total, 1)}  (${a.correct}/${a.total})${consistency}`);
  }

  if (RUNS > 1) {
    console.log("\nDETECTION REACH (read on ≥1 of N runs, on photos where the signal is truly present):");
    for (const m of metrics) {
      const a = agg[m];
      if (!a.anyTotal) continue;
      console.log(`  ${m.padEnd(16)} ${fmt(a.anyCorrect / a.anyTotal, 1)}  (${a.anyCorrect}/${a.anyTotal})`);
    }
  }

  if (wallTimes.length) {
    const sorted = [...wallTimes].sort((a, b) => a - b);
    const pct = (p) => Math.round(sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]);
    const estCost = wallTimes.length * EST_COST_PER_CALL;
    console.log(`\nLATENCY (wall, per call): p50 ${pct(50)}ms, p95 ${pct(95)}ms over ${wallTimes.length} calls`);
    console.log(`EST. SPEND: ${wallTimes.length} calls × ~$${EST_COST_PER_CALL} ≈ $${estCost.toFixed(2)} (static estimate; usage not returned by /api/review)`);
  }

  const dead = perPhoto.filter((p) => p.allErrored);
  if (dead.length) {
    console.log(`\n⚠️  ${dead.length} photo(s) failed on ALL runs and were EXCLUDED from scoring (likely the dev server went down): ${dead.map((p) => p.file).join(", ")}`);
    console.log("    Re-run after confirming the server is healthy — these numbers are over the photos that actually ran.");
  }

  if (TUNING) console.log(`\n⚠ Reminder: tuning subset (${items.length}/${FULL_COUNT}) — not headline numbers.`);

  const sortedWall = [...wallTimes].sort((a, b) => a - b);
  const wallPct = (p) => (sortedWall.length ? Math.round(sortedWall[Math.min(sortedWall.length - 1, Math.floor((p / 100) * sortedWall.length))]) : null);
  const output = {
    mode: TUNING ? "tuning" : "full",
    subset: TUNING
      ? { only: ONLY || null, missesFrom: MISSES || null, sample: SAMPLE || null, seed: SAMPLE ? SEED : null, files: items.map((i) => i.file) }
      : null,
    runs: RUNS,
    count: items.length,
    scored: items.length - dead.length,
    latency: { p50Ms: wallPct(50), p95Ms: wallPct(95), calls: wallTimes.length },
    estCostUSD: Number((wallTimes.length * EST_COST_PER_CALL).toFixed(2)),
    perPhoto,
    agg,
  };
  fs.writeFileSync(OUT, JSON.stringify(output, null, 2) + "\n");
  console.log(`\nWrote ${OUT}`);
})().catch((e) => {
  console.error("EVAL FAILED:", e.message);
  process.exit(1);
});
