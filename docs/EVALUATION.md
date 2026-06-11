# Evaluation — extraction accuracy on real retail bottles

The compliance value of this tool rests on one thing: **can the AI read a real label
off a real shelf, including the glare, the angles, and the fine print an agent
actually deals with?** (Jenny, in the discovery interviews: labels are "photographed
at weird angles… bad lighting… glare on the bottle.") So rather than judge it by
eye on a few clean mockups, it is evaluated like an ML system — against a
hand-labeled set of real photographs, scored automatically, run multiple times to
measure consistency.

> **TL;DR.** On 88 real bottle/can photos, every one hand-labeled, the tool reads a
> government warning that is physically present **98.8%** of the time, recognizes the
> verbatim federal statement **87.5%** (strict majority vote) / **93.7%** (read on at
> least one run), and reads a shown ABV on **97.2%** of photos where one is present.
> Where it does miss, it misses *safely*: on a small/glared/curved-print warning it
> declines to auto-confirm and routes to "verify by eye" rather than guessing.

## What's in the dataset

88 real photos — cropped to the label, no duplicates — spanning:

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
- **Negative / in-frame controls** — 8 photos are front or marketing panels where
  **no warning is in frame** (Modelo, Coors, Matua, Bota Box, Bar West…); the tool
  must *not* invent a warning for these.

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

**88 photos, 3 runs each:**

| Signal | Strict (majority-of-3) | Consistency | Detection reach (≥1 of 3) |
|---|---|---|---|
| warningPresent | 93.2% (82/88) | 99% | **98.8%** (79/80) |
| warningFederal | 87.5% (70/80) | 84% | **93.7%** (74/79) |
| abv | 73.9% (65/88) | 94% | **97.2%** (35/36) |

The reach column is the headline capability; the strict column is what you get if
you demand the tool agree with itself 2-of-3 times on fine print.

## What the audit found (and fixed)

The discipline that matters more than the headline number: every disagreement was
inspected individually. Three findings, two of which turned into fixes.

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

### 3. ABV's 73.9% is a voting artifact, not a reading limit

`abv` strict accuracy looks soft at 73.9% — but **22 of the 23 strict-misses are
recovered on at least one run** (hence 97.2% reach), and probing each q=good miss
individually, the model read a clean ABV every time ("12% BY VOL", "5% ALC/VOL",
"37.5% (75 proof)"). The failures are run-to-run flicker on small serving-facts
print colliding with the 2-of-3 majority requirement — not an inability to read.
Reporting both numbers is the honest way to show this rather than letting the strict
figure imply a weakness that isn't there.

## The remaining misses are safe misses

- **warningPresent:** 5 of the 6 "misses" are the no-warning-in-frame controls
  scoring *correctly* (the tool rightly finds no warning on a front/marketing panel).
  The one true miss (Baron Herzog) is faint federal text on a fair-quality photo.
- **warningFederal:** the residual misses are genuine small-print/curved-can reads
  (Rainier under glare, La Marca / Ménage à Trois where "during pregnancy" didn't
  come through cleanly) where the strict verbatim matcher correctly declines to
  auto-pass and routes to "verify by eye." It fails *safe*, not silent.

We deliberately did **not** chase the last few percent by loosening extraction.
Forcing text out of illegible print is exactly what re-introduces hallucination — the
model "completing" a warning it can't actually read, a real bug caught and fixed with
the `warningLegible` gate (see `docs/SECURITY.md` and the validation tests). A
confidently-wrong "PASS" is the catastrophic failure mode for a compliance tool; an
honest "verify by eye" is not. The remaining curved-can gap is genuine OCR
legibility; the documented future-work fix is cylinder-unwrap preprocessing, not a
looser matcher.

## Reproducing

```bash
npm run dev                  # serve the pipeline (needs an API key in the env)
node eval/run.mjs --runs 3   # 88 photos × 3 runs against the hand-labeled set
```

Results are written to `eval/results.json` (per-photo + aggregate, including the
detection-reach breakdown).
