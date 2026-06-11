/**
 * Evaluation harness for the extract → validate pipeline.
 *
 * Runs each photo N times against hand-labeled ground truth and reports accuracy,
 * detection reach, and run-to-run consistency.
 *
 * Usage:  node eval/run.mjs [--runs N] [--dir public/samples/alcohol]
 * Images:  https://drive.google.com/drive/folders/1hCq_woq7IwyrOwbi_9XLHeSUsduSUxjN?usp=sharing
 * Requires: npm run dev and ANTHROPIC_API_KEY in the environment.
 *
 * Output: per-photo table and eval/results.json aggregates.
 */
import sharp from "sharp";
import fs from "fs";
import path from "path";

const args = process.argv.slice(2);
const RUNS = Number(args[args.indexOf("--runs") + 1]) || (args.includes("--runs") ? 3 : 1);
const API = process.env.EVAL_API || "http://localhost:3000/api/review";

// The evaluation set: 88 cropped, label-only retail bottle/can photos, each
// hand-labeled by viewing it directly. The GT file declares its own image dir.
const GROUND_TRUTH = "eval/ground-truth-clean.json";

// Build the {file, dir, truth} work list. Photos whose file is missing are
// skipped (so the harness never errors on a partially-synced sample folder).
const items = [];
{
  const data = JSON.parse(fs.readFileSync(GROUND_TRUTH, "utf8"));
  const dir = data.dir || "public/samples/alcohol";
  for (const l of data.labels) {
    if (fs.existsSync(path.join(dir, l.file))) items.push({ file: l.file, dir, truth: l });
  }
}

/** Run one photo through the pipeline once; return the parsed ReviewResult. */
async function reviewOnce(file, dir) {
  const buf = await sharp(path.join(dir, file))
    .rotate()
    .resize(1024, 1024, { fit: "inside" })
    .jpeg({ quality: 82 })
    .toBuffer();
  const res = await fetch(API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      application: { brandName: "Eval", beverageType: "other" },
      imageBase64: buf.toString("base64"),
      mediaType: "image/jpeg",
    }),
  });
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    throw new Error(`HTTP ${res.status}: ${e.error || "?"}`);
  }
  return res.json();
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
  const abvRead = (f("alcoholContent").found ?? null) != null;
  return { warningRead, warningRecognizedFederal, abvRead, warnVerdict: warn.verdict, quality: r.imageQuality };
}

const fmt = (n, d = 0) => (n * 100).toFixed(d) + "%";

(async () => {
  console.log(`Evaluating ${items.length} photos × ${RUNS} run(s) against ground truth…\n`);

  const perPhoto = [];
  for (const { file, dir, truth: t } of items) {
    const runs = [];
    for (let i = 0; i < RUNS; i++) {
      try {
        runs.push(signalsFromResult(await reviewOnce(file, dir)));
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

    perPhoto.push({ file, difficulty: t.photoDifficulty, brand: t.brand, runs: ok.length, errors: runs.length - ok.length, scored, quality: ok[0]?.quality });
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

  const dead = perPhoto.filter((p) => p.allErrored);
  if (dead.length) {
    console.log(`\n⚠️  ${dead.length} photo(s) failed on ALL runs and were EXCLUDED from scoring (likely the dev server went down): ${dead.map((p) => p.file).join(", ")}`);
    console.log("    Re-run after confirming the server is healthy — these numbers are over the photos that actually ran.");
  }

  fs.writeFileSync("eval/results.json", JSON.stringify({ runs: RUNS, count: items.length, scored: items.length - dead.length, perPhoto, agg }, null, 2) + "\n");
  console.log("\nWrote eval/results.json");
})().catch((e) => {
  console.error("EVAL FAILED:", e.message);
  process.exit(1);
});
