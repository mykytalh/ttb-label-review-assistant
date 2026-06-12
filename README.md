# Label Review Assistant

AI-assisted compliance review for alcohol beverage labels. The tool reads a
label photo, extracts the regulated fields — brand name, class/type, alcohol
content, net contents, bottler/producer, country of origin, and the government
health warning — and verifies each against TTB requirements, returning
per-field **pass / review / fail** verdicts in seconds.

It is built around the realities of the review floor: median response in
~3.6 seconds (the prior vendor's 30–40s killed adoption), an interface designed
for a workforce with widely varying tech comfort, and verdicts that assist
agent judgment rather than replace it.

**Live demo:** https://ttb-label-review-assistant.vercel.app/

## Getting started

**Prerequisites:** Node 18+ · [Anthropic API key](https://console.anthropic.com/)

```bash
npm install
cp .env.example .env.local   # set ANTHROPIC_API_KEY
npm run dev                  # http://localhost:3000
```

```bash
npm test                     # unit tests — no API key required
npm run test:coverage
npm run lint
npm run build
```

## Usage

**Single label.** Upload a photo and enter the brand name — that's the whole
required input. The AI reads everything off the label itself; beverage type
defaults to auto-detect, and the optional application fields (class/type, ABV,
net contents, producer, origin) exist only to cross-check the label against
what the application claims. Extraction starts in the background the moment
the photo lands, so by the time the brand name is typed the verdict is usually
instant. Results are summary-first: failures and reviews
open with expected-vs-found detail, verified fields collapse into a checklist,
and the raw AI extraction sits under the photo for verify-by-eye. Every review
can be printed as a structured record.

**Batch.** Drop in label photos (capped at 10 in this demo to bound API spend;
the queue — concurrency, retry, filtering, paging, CSV export — is designed for
the 200–300 label drops importers actually submit), press **Review all**, and
results stream in. No typing: batch mode checks the universal on-label
requirements directly. Filter by verdict, open per-row details, download the
CSV.

In-app guidance lives behind **How to use** in the header.

## Architecture

```
photo → LabelExtractor → ExtractedLabel → validate() → ReviewResult → UI
```

Extraction (Claude vision, structured JSON, behind a swappable interface) and
validation (pure, synchronous TypeScript) are separate layers: the model only
transcribes; every compliance verdict is computed in code. Per-field strictness
matches the regulation — fuzzy matching for identity fields, numeric tolerances
for quantities, byte-strict comparison for the government warning.

```
src/app/          page, API route
src/components/   UI (SingleReview, BatchReview, ReviewResults, ImageEditor, …)
src/lib/          validate.ts, extractor.ts, extracted-label.ts, export.ts, …
eval/             ground truth, scored results, harness, tuning subset
docs/             APPROACH · EVALUATION · PROMPT_TUNING · SECURITY
.github/workflows/ci.yml
```

## Documentation

| Doc | Read if… |
| --- | --- |
| [`docs/APPROACH.md`](docs/APPROACH.md) | **Start here** — design decisions, trade-offs, assumptions, stakeholder traceability |
| [`docs/EVALUATION.md`](docs/EVALUATION.md) | Accuracy evidence — hand-labeled 88-photo evaluation, methodology, committed results |
| [`docs/PROMPT_TUNING.md`](docs/PROMPT_TUNING.md) | Prompt constraints and the iteration log |
| [`docs/SECURITY.md`](docs/SECURITY.md) | Threat model and prototype security posture |

Accuracy is measured, not asserted — see
[`docs/EVALUATION.md`](docs/EVALUATION.md) for the evaluation design, the
audit trail, and instructions to reproduce the numbers.

## Tech

Next.js 15 · React 19 · TypeScript · Claude Haiku 4.5 (vision + structured
outputs; `LABEL_MODEL` swaps in Opus 4.8) · Vitest · GitHub Actions CI ·
Vercel.
