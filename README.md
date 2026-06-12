# Label Review Assistant

AI-assisted alcohol label extraction and compliance verification. An agent
enters application details, uploads a label photo, and receives per-field
**pass / review / fail** verdicts in a few seconds — single label or batch (up to
10 per run in this prototype).

The tool assists review; it does not replace agent judgment.

**Live demo:** https://ttb-label-review-assistant.vercel.app/

## Documentation

| Doc | Read if… |
| --- | --- |
| [`docs/APPROACH.md`](docs/APPROACH.md) | **Start here** — brief design, trade-offs, architecture |
| [`docs/EVALUATION.md`](docs/EVALUATION.md) | Accuracy evidence (88 real photos, harness, committed results) |
| [`docs/PROMPT_TUNING.md`](docs/PROMPT_TUNING.md) | Prompt constraints and iteration summary |
| [`docs/SECURITY.md`](docs/SECURITY.md) | Threat model |

**Submitting?** Live app: [ttb-label-review-assistant.vercel.app](https://ttb-label-review-assistant.vercel.app/).
Grant reviewers access to the private GitHub repo (or make it public for the review window).

## Setup

**Prerequisites:** Node 18+ · [Anthropic API key](https://console.anthropic.com/)

```bash
npm install
cp .env.example .env.local   # set ANTHROPIC_API_KEY
npm run dev                  # http://localhost:3000
```

```bash
npm test              # 148 unit tests (no API key)
npm run test:coverage
npm run lint
npm run build
```

### Sample label images (88 photos)

Photos are **not** in the repository (`public/samples/alcohol/` is gitignored).
Download the evaluation set from
[Google Drive](https://drive.google.com/drive/folders/1hCq_woq7IwyrOwbi_9XLHeSUsduSUxjN?usp=sharing)
into `public/samples/alcohol/` for local review, batch upload, or the eval harness.

Committed artifacts: `eval/ground-truth-clean.json` (labels),
`eval/results.json` (last scored run, 88 × 3), `eval/run.mjs` (harness),
`eval/tuning-set.json` (frozen prompt-tuning subset — see
[`docs/PROMPT_TUNING.md`](docs/PROMPT_TUNING.md)).

Optional accuracy re-run: [`docs/EVALUATION.md`](docs/EVALUATION.md) (dev server +
API key + sample photos above).

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
