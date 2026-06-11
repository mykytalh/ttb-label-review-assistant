# Prompt tuning — hallucination avoidance and eval-driven iteration

How the vision extraction prompt was tuned under project constraints. Accuracy
numbers, dataset design, and harness scoring are in [`EVALUATION.md`](EVALUATION.md).
This doc covers **why** prompt changes were made, **what** changed, and **how**
each batch eval informed the next edit.

Live implementation: [`src/lib/extractor.ts`](../src/lib/extractor.ts) (`SYSTEM_PROMPT`,
`EXTRACTION_SCHEMA`).

---

## Project requirements that shaped the prompt

From stakeholder context and prototype scope:

| Requirement | Prompt consequence |
|---|---|
| ~5s response (Sarah) | Single vision call; Haiku 4.5 default; `max_tokens: 768` |
| Government warning is verbatim federal text (27 CFR 16.21) | Transcription-only role; no model-emitted pass/fail |
| Agents photograph labels at angles, with glare (Jenny) | Geometry hints; rotate/curve/can-edge guidance in system prompt |
| False pass is worse than manual review | `null` over guess; `warningLegible` gate downstream |
| Batch cost at scale | Cached system prompt; no retry-until-pass loop |
| No fine-tuning pipeline in prototype | Prompt + schema + coercion only |

**Invariant:** the model transcribes; TypeScript validates. Compliance verdicts never
come from the LLM.

---

## Constraints on iteration

| Limitation | Effect |
|---|---|
| **No labeled eval set initially** | Early tuning was subjective — hallucinations were obvious on ad hoc photos but not measurable |
| **88-photo hand-labeled set** (`eval/ground-truth-clean.json`) | First objective regression signal; replaces earlier mixed-quality batches. Images: [Google Drive](https://drive.google.com/drive/folders/1hCq_woq7IwyrOwbi_9XLHeSUsduSUxjN?usp=sharing) → `public/samples/alcohol/` (gitignored) |
| **API cost** | Full pass = 88 photos × 3 runs = **264 calls**; each prompt edit triggered a re-run |
| **Time** | ~6–8 eval batches over the tuning period; not enough runway for model fine-tuning or a larger corpus |
| **Small dataset** | Final metrics are reliable *on this set*; not a claim about all 150k annual applications |

Iteration loop (unchanged across batches):

```
node eval/run.mjs --runs 3
  → read per-photo misses in eval/results.json
  → classify: hallucination | under-transcription | (non-prompt: validator OCR)
  → edit SYSTEM_PROMPT and/or schema field descriptions
  → re-run batch
```

Validator and coercion changes accompanied prompt work but are documented in
EVALUATION where they moved scored metrics (e.g. OCR matcher 61% → 80% was
**not** a prompt change).

---

## Phase 0 — Before ground truth (severe hallucination)

With no labeled set and a minimal extraction prompt, failure modes were
qualitative but consistent:

1. **Warning reconstruction** — canonical federal text returned on front/marketing
   panels where no warning appeared in frame (see negative controls in
   EVALUATION: Modelo, Coors, Matua, Bota Box, Bar West…).
2. **Memory completion** — partial or glared warnings filled in to the full standard
   paragraph from model prior knowledge.
3. **Sentinel strings** — `"not visible"` / `"illegible"` as field values instead of
   JSON `null`, breaking downstream logic.
4. **No regression guard** — the same photo could look acceptable in the UI while
   failing negative controls.

Building `ground-truth-clean.json` and `eval/run.mjs` made prompt tuning
measurable. See EVALUATION for dataset composition and scoring definitions.

---

## Eval batches (~6–8 iterations)

Not every batch produced a headline metric jump. Several passes were smaller
wording or schema tweaks after inspecting `eval/results.json`. The batches below
are the ones that map cleanly to documented accuracy movement in EVALUATION.

| Batch | Problem observed | Prompt/schema change | Outcome (see EVALUATION) |
|---|---|---|---|
| **1–2** | Hallucinated warnings on negative controls; full text on partial frames | Anti-hallucination block in `SYSTEM_PROMPT`; `warningLegible` field + descriptions; `notes` limited to legibility | Negative controls stopped failing; safe **review** on marginal photos |
| **3–4** | Intermediate passes — `null` semantics, geometry/rotation wording, sentinel alignment with coercion | Refinements to rules 1–3 and schema `description` strings | Incremental stability; no separate saved aggregate |
| **5** | *(Not prompt)* OCR typography failed verbatim matcher | — | `warningFederal` strict **61% → 80%** via `matchWarning()` — EVALUATION §1 |
| **6–7** | Stable misses: body from `(1)` without `GOVERNMENT WARNING:` heading (Pabst, Charles Smith, Drambuie) | Rule 4 in system prompt; `governmentWarning` schema description requires heading when printed | `warningFederal` strict **80% → 87.5%**; reach **93.7%** — EVALUATION §2 |
| **8** | Residual curved-can / faint-print cases | No further prompt loosening — would reintroduce hallucination | Final numbers in EVALUATION; remaining misses are **safe** (verify by eye) |

We deliberately did **not** chase the last few percent by instructing the model to
complete illegible print. EVALUATION documents why: a confident wrong PASS is the
catastrophic failure mode for a compliance tool.

---

## Current system prompt structure

`SYSTEM_PROMPT` in `extractor.ts` has three layers:

### 1. Role

Transcription assistant for label compliance — verbatim fields, especially the
government warning. No compliance judgment in model output.

### 2. Anti-hallucination rules (critical block)

| Rule | Intent |
|---|---|
| **1. Legibility only** | `null` if unreadable; never `"not visible"` as a string value |
| **2. No memory completion** | Do not reconstruct the federal warning (or any field) from prior knowledge |
| **3. `warningLegible`** | `true` only when every warning word was read from the image; `false` when guessing would be required |
| **4. Heading capture** | Start at `GOVERNMENT WARNING` when printed; do not begin at `(1)` and skip the heading |

### 3. Geometry and quality

- Mentally rotate sideways/upside-down photos.
- Search vertical can edges for small warning text.
- Report `imageQuality` honestly; prefer `null` over reconstruction.

---

## Schema as secondary prompt

Structured JSON output uses field `description` strings as enforceable instructions.
Highest-leverage fields:

### `governmentWarning`

Transcribe only legible characters; include heading when present; partial
obscurity → partial text + `warningLegible: false`; none legible → `null`.

### `warningLegible`

Boolean contract tied to rule 3 — distinguishes imperfect photos from genuinely
unreadable words.

### `notes`

Legibility caveats only — prevents the model from dumping barcodes, slogans, or
marketing copy into a field that downstream code might treat as signal.

### Nullable strings everywhere else

`null` means not legibly visible — keeps extraction aligned with validator
expectations.

---

## Enforcement when the model drifts

Prompt alone is insufficient; these layers implement the same contract in code:

| Layer | File | Role |
|---|---|---|
| Sentinel coercion | `extracted-label.ts` | Map `"not visible"`, `"illegible"`, etc. → `null` |
| Fail-closed legibility | `extracted-label.ts` | `warningLegible` only when warning string exists |
| Legibility gate | `validate.ts` | Verbatim match + `warningLegible === false` → **review**, not pass |

Details: [`SECURITY.md`](SECURITY.md), `validate.adversarial.test.ts`.

---

## What we rejected

| Approach | Why |
|---|---|
| Fine-tune vision model | Labeling cost, time, reduced auditability |
| Embed full 27 CFR in prompt | Increases memory-completion of canonical warning |
| Fuzzy warning pass | Violates verbatim federal requirement |
| Retry until pass | Hides non-determinism; unbounded API cost |
| Model-emitted verdicts | Prompt injection via label text; verdicts must be code |
| Loosen extraction for last % | Reintroduces hallucination — see EVALUATION remaining misses |

---

## Model and cost

- **Default:** Claude Haiku 4.5 — meets latency target and keeps eval/batch cost down.
- **Override:** `LABEL_MODEL=claude-opus-4-8` for harder photos.
- All metrics cited here and in EVALUATION are on **Haiku**.

---

## Reproducing prompt regression (no full eval)

```bash
npm test    # coercion, matchWarning, adversarial OCR — no API key
```

Full scored run (requires API key + [sample photos](https://drive.google.com/drive/folders/1hCq_woq7IwyrOwbi_9XLHeSUsduSUxjN?usp=sharing) in `public/samples/alcohol/`):

```bash
npm run dev
node eval/run.mjs --runs 3
```

Last committed run: `eval/results.json`. See [`EVALUATION.md`](EVALUATION.md) for
interpretation of aggregates.
