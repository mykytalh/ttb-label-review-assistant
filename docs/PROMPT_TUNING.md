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

Late iterations used a cheaper, stricter protocol so changes are judged against a
replayable subset instead of eyeballed full runs:

1. **Audit before tuning.** Every disagreement is triaged first (the harness records
   the raw extracted text on subset runs) — a "miss" can be a model error, a matcher
   gap, *or a wrong ground-truth label*, and only one of those is fixed with a prompt.
2. **Frozen tuning subset** (`eval/tuning-set.json`, 22 photos): every current
   `warningFederal` miss + watch photos + nine zero-flip regression guards (easy pass,
   no-warning-in-frame negative control, state warning that must NOT match federal,
   sideways ×2, curved can, Serving-Facts can, fine-print ABV, ABV-correctly-null).
   Replayed identically each iteration: `--only eval/tuning-set.json --runs 3`.
3. **One change per iteration** (a prompt clause or one schema description). Accept
   only if: zero guard regressions, net improvement on the targeted signal, flips not
   worse. Reject → revert verbatim. A regression on a negative control rejects the
   change regardless of wins — hallucination is the catastrophic direction.
4. Headline numbers come **only** from full no-subset runs (the harness brands subset
   output as tuning and refuses to write it over `results.json`).

## Key changes (eval-driven)

| Phase | Problem | Fix | Outcome |
|---|---|---|---|
| Early | Warning hallucinated on front panels | Anti-hallucination rules; `warningLegible`; `null` semantics | Negative controls pass; marginal photos → review |
| Mid | OCR typography broke verbatim matcher | *(validator, not prompt)* `matchWarning()` | `warningFederal` 61% → 80% — see EVALUATION §1 |
| Late | Heading omitted (`(1)` without `GOVERNMENT WARNING:`) | Rule 4 + schema description | 80% → 87.5% strict / 93.7% reach — EVALUATION §2 |
| Audit 2 | Stable "false positives" — ABV/warning read where GT said none | *(ground truth, not prompt)* — visual re-inspection showed the model was right in all but two cases; **31 label fields corrected across 28 photos** | EVALUATION §3 — second time an audit beat tuning |
| Iter 1 | "during pregnancy" dropped at line wraps (3 labels); `(i)`/`(ii)` numeral misread (1 label) | Rule 5: one continuous pass, stop at last readable word + `warningLegible=false` — never bridge a gap from memory; *(matcher)* roman-numeral marker tolerance | Accepted: 0 of 9 guards regressed; numeral case fixed deterministically (unit-tested); subset flips 5→3 |
| Iter 2 | "Contents under pressure" caution transcribed into the warning field | Schema scope: warning statements only — pressure cautions / sulfites / slogans → `null` | Accepted: the one true hallucination-direction behavior eliminated (3/3 runs clean); 0 guards regressed; subset `warningFederal` 12→14 |
| Iter 3 | Class line ("AGAVE WINE WITH NATURAL FLAVORS") routed into the origin field and passing as an origin (user-reported) | Schema scope: `originCountry` must name a country; *(validator)* a found origin must read as one or it warns | Accepted: 0 guards regressed; the margarita now extracts "Product of Mexico" |
| Iter 4 | Proof invented from brand memory — Drambuie back label shows no proof, model reported "86 PROOF" on 2 of 3 runs | Schema clause: never recall a typical ABV/proof for a recognized brand — read it or return `null` | Accepted: target photo `null` 3/3; the one apparent guard regression was a 27th wrong ground-truth label (Serving Facts prints "20.5% (41 proof)"), verified by eye and corrected |
| Iter 5 | Serving-size confusion — a 750 mL bottle's "Serving size: 150 mL" reported as net contents (user-reported) | Schema scope: net contents = container TOTAL, never the Serving Facts size; *(validator)* clean-multiple mismatches (5 × 150 = 750) name the serving-size suspicion in the fail message | Accepted: 0 of 9 guards regressed; the bug photo reads 750 mL |
| Final | Curved cans, faint print | No prompt loosening (reintroduces hallucination) | Remaining misses are **safe** — verify by eye |

We did **not** chase the last few percent by instructing the model to complete
illegible text. A confident wrong pass is the catastrophic failure mode. Two
deliberate omissions from Iter 1: the prompt does **not** name the commonly-dropped
phrase ("during pregnancy") — telling the model what *should* be there is a
memory-completion vector on labels that genuinely lack it — and the persistent
curved-can/faint-print misses were left alone after the line-wrap rule plateaued,
rather than escalating to wording that invites reconstruction.

## Prompt structure (current)

1. **Role** — transcription assistant; no compliance judgment.
2. **Anti-hallucination** — `null` if unreadable; no memory completion of federal
   warning; `warningLegible` only when every word was read; capture heading when
   printed; transcribe in one continuous pass and stop at the last readable word.
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
