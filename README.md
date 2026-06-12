# Label Review Assistant

AI-assisted alcohol label extraction and compliance verification. An agent
enters application details, uploads a label photo, and receives per-field
**pass / review / fail** verdicts in a few seconds — single label or batch.
The demo caps batches at 10 to bound API spend; the queue architecture
(concurrency, retry, filtering, paging, CSV export) is built for the 200–300
label drops importers actually submit.

The tool assists review; it does not replace agent judgment. Every design
decision traces to a stakeholder need from the discovery interviews — see the
traceability table at the top of [`docs/APPROACH.md`](docs/APPROACH.md).

**Live demo:** https://ttb-label-review-assistant.vercel.app/

## Documentation

| Doc | Read if… |
| --- | --- |
| [`docs/APPROACH.md`](docs/APPROACH.md) | **Start here** — brief design, trade-offs, architecture |
| [`docs/EVALUATION.md`](docs/EVALUATION.md) | Accuracy evidence (88 real photos, harness, committed results) |
| [`docs/PROMPT_TUNING.md`](docs/PROMPT_TUNING.md) | Prompt constraints and iteration summary |
| [`docs/SECURITY.md`](docs/SECURITY.md) | Threat model |

## Setup

**Prerequisites:** Node 18+ · [Anthropic API key](https://console.anthropic.com/)

```bash
npm install
cp .env.example .env.local   # set ANTHROPIC_API_KEY
npm run dev                  # http://localhost:3000
```

```bash
npm test              # unit tests — no API key required
npm run test:coverage
npm run lint
npm run build
```

### Evaluation photo set

The accuracy numbers are measured against 88 photos I took of retail bottles
and cans, shot deliberately under the conditions the discovery interviews call
out — glare, odd angles, bad lighting, curved cans, fine print — and
hand-labeled individually. The photos themselves aren't committed (real product
imagery); the ground truth, harness, scored results, and frozen tuning subset
are, under `eval/`. To reproduce the numbers or load the samples locally, see
[`docs/EVALUATION.md`](docs/EVALUATION.md) § Reproducing.

## Usage

**One label:** enter application details (brand required) → upload photo → **Check
this label**.

**Batch:** **Batch upload** tab → add up to 10 photos → **Review all** → filter
results or open **Details** per row. No per-label application form; see
[`docs/APPROACH.md`](docs/APPROACH.md) for batch validation scope. In-app help:
header **How to use**.

## Pipeline

```
photo → LabelExtractor → ExtractedLabel → validate() → ReviewResult → UI
```

Extraction (Claude vision, structured JSON) and validation (pure TypeScript) are
separate layers. Details: [`docs/APPROACH.md`](docs/APPROACH.md),
[`docs/PROMPT_TUNING.md`](docs/PROMPT_TUNING.md).

## Project layout

```
src/app/          page, API route (route.ts, route.test.ts)
src/components/   UI (SingleReview, BatchReview, ReviewResults, ImageEditor, …)
src/lib/          validate.ts, extractor.ts, extracted-label.ts, export.ts, …
eval/             ground-truth-clean.json, results.json, run.mjs
docs/             APPROACH · EVALUATION · PROMPT_TUNING · SECURITY
.github/workflows/ci.yml
```

## Tech

Next.js 15 · React 19 · TypeScript · Claude Haiku 4.5 / Opus 4.8 · Vitest ·
GitHub Actions CI · deployed on Vercel (see live demo above).
