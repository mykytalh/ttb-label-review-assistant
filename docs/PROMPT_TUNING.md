# Prompt tuning (summary)

How the vision prompt was constrained and iterated. **Accuracy numbers and dataset
design:** [`EVALUATION.md`](EVALUATION.md). **Implementation:**
[`src/lib/extractor.ts`](../src/lib/extractor.ts).

## Invariant

The model **transcribes** into a fixed JSON schema. TypeScript **`validate()`** emits
every compliance verdict. The LLM never passes or fails a label.

## What shaped the prompt

| Constraint | Response |
|---|---|
| ~5s per label | One Haiku 4.5 call; `max_tokens: 768`; client downscale |
| Verbatim federal warning | Transcription only; `null` over guess; `warningLegible` gate |
| Angled / glared photos | Geometry hints in system prompt; honest `imageQuality` |
| Batch cost | Cached system prompt; no retry-until-pass |

## Iteration loop

```
node eval/run.mjs --runs 3 → inspect eval/results.json → edit prompt/schema → re-run
```

88 hand-labeled retail photos (`eval/ground-truth-clean.json`). Full pass = 264 API
calls. Images: [Google Drive](https://drive.google.com/drive/folders/1hCq_woq7IwyrOwbi_9XLHeSUsduSUxjN?usp=sharing) → `public/samples/alcohol/` (gitignored).

## Key changes (eval-driven)

| Phase | Problem | Fix | Outcome |
|---|---|---|---|
| Early | Warning hallucinated on front panels | Anti-hallucination rules; `warningLegible`; `null` semantics | Negative controls pass; marginal photos → review |
| Mid | OCR typography broke verbatim matcher | *(validator, not prompt)* `matchWarning()` | `warningFederal` 61% → 80% — see EVALUATION §1 |
| Late | Heading omitted (`(1)` without `GOVERNMENT WARNING:`) | Rule 4 + schema description | 80% → 87.5% strict / 93.7% reach — EVALUATION §2 |
| Final | Curved cans, faint print | No prompt loosening (reintroduces hallucination) | Remaining misses are **safe** — verify by eye |

We did **not** chase the last few percent by instructing the model to complete
illegible text. A confident wrong pass is the catastrophic failure mode.

## Prompt structure (current)

1. **Role** — transcription assistant; no compliance judgment.
2. **Anti-hallucination** — `null` if unreadable; no memory completion of federal
   warning; `warningLegible` only when every word was read; capture heading when
   printed.
3. **Geometry** — rotate mentally; search can edges; report quality honestly.

Schema field `description` strings reinforce the same contract (`governmentWarning`,
`warningLegible`, nullable strings elsewhere).

## Code enforcement (when the model drifts)

| Layer | File |
|---|---|
| Sentinel → `null` | `extracted-label.ts` |
| Legibility gate → review, not pass | `validate.ts` |
| Adversarial tests | `validate.adversarial.test.ts` |

## Rejected

Fine-tuning, fuzzy warning pass, model-emitted verdicts, retry-until-pass, embedding
full 27 CFR in the prompt.

## Reproduce

```bash
npm test    # no API key
npm run dev && node eval/run.mjs --runs 3   # full scored run
```

Committed run: `eval/results.json`.
