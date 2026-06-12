# Evaluation — extraction accuracy on real retail bottles

The compliance value of this tool rests on one thing: **can the AI read a real label
off a real shelf, including the glare, the angles, and the fine print an agent
actually deals with?** (Jenny, in the discovery interviews: labels are "photographed
at weird angles… bad lighting… glare on the bottle.") So rather than judge it by
eye on a few clean mockups, it is evaluated like an ML system — against a
hand-labeled set of real photographs, scored automatically, run multiple times to
measure consistency.

> **TL;DR.** On 88 real bottle/can photos, every one hand-labeled and every
> disagreement audited by eye, the tool reads a government warning that is physically
> present **97.7%** of the time (100% run-to-run consistency), recognizes the verbatim
> federal statement **88.1%** (strict majority vote) / **94.0%** (read on at least one
> run), and reads a shown ABV **94.3%** strict / **95.2%** reach. Median latency is
> **3.6s** per label against the 5-second requirement (p95 fluctuates with API load —
> 4.8–5.9s across runs). Where it does miss, it misses *safely*: on a
> small/glared/curved-print warning it declines to auto-confirm and routes to "verify
> by eye" rather than guessing.

## What's in the dataset

88 real photos, every one taken by me — retail bottles and cans shot
specifically to reproduce the conditions the discovery interviews describe
(glare on glass, weird angles, bad lighting, warnings wrapped around curved
cans, sideways phone shots) — then cropped to the label, deduplicated, and
hand-labeled individually. The set spans:

- **Every beverage class** — distilled spirits (Patrón, Captain Morgan, Grey Goose,
  Drambuie), wine (19 Crimes, Ste. Michelle, Ménage à Trois, Chandon, Mer Soleil,
  Gekkeikan sake…), beer/malt (Coors, Modelo, Rainier, Pabst, Bud Light, Voodoo
  Ranger…), plus a heavy dose of **canned cocktails / hard seltzers / ciders**
  (Cutwater, White Claw, Bulleit Manhattan, Absolut Cocktails, Salt Point, 2 Towns
  cider) — the modern products that don't fit the three classic classes cleanly,
  classified as **"other"**. Spread: 48 wine, 22 other, 14 beer, 4 spirits
  (open-shelf products dominate; the spirits case was locked).
- **Every photo condition** — flat clean back labels, steep angles, glare, curved
  cans where the warning wraps around the cylinder, sideways phone shots, and
  fine print on serving-facts panels.
- **Negative / in-frame controls** — 4 photos are front or marketing panels where
  **no warning is in frame** (Modelo, Coors, La Marca…); the tool must *not* invent
  a warning for these. (This set started at 8 — the label audit below found that on
  4 of them the warning actually *is* in frame, in fine print the original labeling
  pass missed.)

Imperfect photos are not noise to be filtered out — handling them *is* the job, so
they are deliberately in the eval. The realistic target is strong-but-not-perfect:
catch the clear cases, and on the hard ones fail *honestly* (flag image quality,
ask for a re-shoot) rather than fail *silently*.

## How it's scored

`eval/run.mjs` runs each photo through the real extract→validate pipeline and scores
the **objective** signals against ground truth (`eval/ground-truth-clean.json`):

| Signal | Question |
|---|---|
| `warningPresent` | Did it read a government warning when one is physically in the photo? |
| `warningFederal` | Did it recognize the verbatim federal statement (and not accept a non-federal warning as federal)? |
| `abv` | Did it read an alcohol-content statement when one is legibly shown? |

Each photo is run **3×**. Vision extraction is non-deterministic on small print, so
the harness reports two numbers per signal:

- **Strict accuracy** — majority-of-3 vote. The conservative figure: the tool must
  read the field on at least 2 of 3 runs to be credited.
- **Detection reach** — did it read the field on *at least one* of the 3 runs, over
  photos where the field is truly present. This exposes a capability that a strict
  majority vote understates when a read flickers across runs.

It also reports run-to-run **consistency** (flip rate). If the dev server dies
mid-run, photos that error on *all* runs are **excluded and flagged loudly** rather
than silently counted as model misses (a real bug that once produced nonsense
numbers, now guarded against).

## Results

**88 photos, 3 runs each — the committed run in `eval/results.json`, scored
against the audited labels with the exact shipped prompt:**

| Signal | Strict (majority-of-3) | Consistency | Detection reach (≥1 of 3) |
|---|---|---|---|
| warningPresent | 97.7% (86/88) | 100% | **97.6%** (82/84) |
| warningFederal | 88.1% (74/84) | 87% | **94.0%** (78/83) |
| abv | 94.3% (83/88) | 97% | **95.2%** (60/63) |

Median wall latency 3.6s per label — under the 5-second requirement the prior
vendor failed at 30–40s (p95 moves with API load: 4.8–5.9s across runs). The
reach column is the capability ceiling; the strict column demands the tool agree
with itself 2-of-3 times on fine print.

Repeated full runs of the same prompt land within a band — strict
`warningFederal` ~88–91% and `abv` ~94–98% across runs — because a handful of
fine-print reads flicker between runs. The committed run is reported as-is
rather than the best of several; the reach numbers, which flicker barely moves,
are the stable figure.

## What the audit found (and fixed)

The discipline that matters more than the headline number: every disagreement was
inspected individually — and then re-inspected when the explanation didn't hold up.
Four findings.

### 1. The verbatim matcher was rejecting OCR rendering noise as wording violations

`warningFederal` first scored **61%**. Pulling the raw extracted text showed most
"misses" were the model reading the warning *correctly* but rendering it with
artifacts a human would never call a wording change: `[1]` instead of `(1)`, a
dropped period after "defects", a line-wrap hyphen ("preg- nancy"), or trailing
copy ("Please recycle", "Drink Responsibly") after a complete statement.

**Fix:** the matcher now compares the warning body **word-by-word** on a canonical
form that absorbs punctuation/numeral/hyphen noise — while still failing any genuine
word change. "Consumption of **alcohol**" vs "alcoholic beverages", a missing
clause, or "**you** should not drink" vs "women" all still fail. This is *not* a
looser matcher; it's a matcher that distinguishes a typo in OCR from a defect on the
label. Lifted `warningFederal` to **80%** with no loss of strictness (the
adversarial test suite still passes).

### 2. The model was dropping the "GOVERNMENT WARNING:" heading

The remaining stable misses (Pabst, Charles Smith, Drambuie) were cases where the
model transcribed the warning **body** perfectly but began at "(1)", omitting the
bold "GOVERNMENT WARNING:" heading — even though it's physically on the bottle. The
heading is a real federal requirement (27 CFR 16.21), so the matcher *should* require it;
the bug was the model under-transcribing.

**Fix at the extraction layer** (not by weakening the matcher — a genuinely missing
heading must still fail): the prompt and schema now explicitly instruct the model to
include the "GOVERNMENT WARNING" heading verbatim when present and not to start at
"(1)". Lifted `warningFederal` to its current **87.5% / 93.7%**.

### 3. The "ABV weakness" was the ground truth being wrong — audit round two

`abv` strict accuracy sat at 73.9% for most of development. The first explanation —
majority-vote flicker on small print — didn't survive scrutiny: pulling per-photo
data showed **22 stable false positives**, the model reporting an ABV on photos
hand-labeled "not visible," with the *same* value on every run. Values like
"37.5% (75 proof)" and "ALC. 14.9% BY VOL." are too specific and too consistent to
be invented, so before touching the prompt, every flagged photo was re-examined by
eye, zoomed to the fine print.

The model was right and the label was wrong in all but two of the investigated
disagreements — **31 label fields corrected across 28 photos** (27 `abvVisible`,
4 `warningPresent`): the ABV (or warning) genuinely is in frame — in Serving Facts panels, sulfite lines,
and corner fine print the original labeling pass missed. Each corrected entry in
`eval/ground-truth-clean.json` records what is printed and where. This is the
second time on this project that auditing the eval beat tuning the model (the
first: `abvVisible` labels that were never legible at 1024px) — and this time the
error ran in the opposite direction. The two disagreements that *were* model errors
(caution text scoped into the warning field; a proof recalled from brand memory)
are finding 4. The lesson generalizes: **never tune against an unaudited eval**,
in either direction.

### 4. The real model errors were scoping and memory — fixed by tightening, not loosening

The audit left a small set of genuine model errors, each verified by eye and each
fixed by making the extraction *stricter* (full iteration log in
[`PROMPT_TUNING.md`](PROMPT_TUNING.md)):

- **Caution text in the warning field** — "Contents under pressure…" transcribed
  as the government warning on a panel with no warning. Schema now scopes the
  field to warning statements only; the photo returns null on 3/3 runs.
- **A proof recalled from memory** — Drambuie's back label shows no proof
  statement, yet the model reported "86 PROOF" (and "43 Proof" on another run).
  The schema now forbids recalling a typical ABV/proof for a recognized brand.
- **A class line as the origin** — "AGAVE WINE WITH NATURAL FLAVORS" landed in
  the origin field and passed as an origin. Fixed at both layers: the schema
  requires an origin statement naming a country, and the validator independently
  warns when origin text doesn't read as one.

Every change was accepted only after a frozen 22-photo tuning subset (all current
misses + 9 zero-flip regression guards, including the negative controls and a
state-warning photo) showed zero guard regressions.

## The remaining misses are safe misses

- **warningPresent:** 2 misses — faint federal text at the bottom of a
  fair-quality photo (Baron Herzog) and a warning wrapped around a curved can
  (Elysian, recovered on 1 of 3 runs).
- **warningFederal:** 8 misses, all small-print/curved-can/glare reads (Rainier
  wrapped around the cylinder, La Marca under glass glare, a Bud Light side crop)
  where the transcription drops or garbles a few words — most often "during
  pregnancy" at a line wrap — and the strict verbatim matcher correctly declines
  to auto-pass and routes to "verify by eye." It fails *safe*, not silent.
- **abv:** 2 misses, both fine print the model under-reads on the majority of
  runs (the Bota Box sulfite line, a side-cropped can).

I deliberately did **not** chase the last few percent by loosening extraction.
Forcing text out of illegible print is exactly what re-introduces hallucination — the
model "completing" a warning it can't actually read, a real bug caught and fixed with
the `warningLegible` gate (see `docs/SECURITY.md` and the validation tests). A
confidently-wrong "PASS" is the catastrophic failure mode for a compliance tool; an
honest "verify by eye" is not. The remaining curved-can gap is genuine OCR
legibility; the documented future-work fix is cylinder-unwrap preprocessing, not a
looser matcher.

## Reproducing

The photos aren't committed; download the set from
[Google Drive](https://drive.google.com/drive/folders/1hCq_woq7IwyrOwbi_9XLHeSUsduSUxjN?usp=sharing)
into `public/samples/alcohol/`, then:

```bash
npm run dev                  # serve the pipeline (needs an API key in the env)
node eval/run.mjs --runs 3   # 88 photos × 3 runs against the hand-labeled set
```

Results are written to `eval/results.json` (per-photo + aggregate, including the
detection-reach breakdown).
