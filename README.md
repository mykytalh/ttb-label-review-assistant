# Label Review Assistant

An **agent-side review console** for alcohol beverage label applications — a proof
of concept for the U.S. Alcohol and Tobacco Tax and Trade Bureau (TTB)
Certificate of Label Approval (COLA) workflow.

A compliance agent opens a queue of pending applications, picks one (its data and
label artwork are already attached — nothing is typed by hand), runs AI
verification, and gets a field-by-field result with an overall recommendation,
then records a disposition. Built around the realities of the review floor:
median verification in ~3.6 seconds (the prior vendor's 30–40s killed adoption),
an interface for a workforce with widely varying tech comfort, and verdicts that
assist agent judgment rather than replace it.

> **A simulation, not a live integration.** Pending COLA applications aren't
> public data with an API, so the queue is simulated with mock records drawn from
> the free public COLA Cloud sample pack — real brands and submitted label
> artwork across wine, spirits, and beer. The data layer sits behind a swappable
> `ColaSource` interface; a production build would drop in a live registry adapter
> without the rest of the app changing.

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

### Review queue (primary workflow)

The home screen (**Label Approvals**) is a worklist of pending applications.
Search by brand, applicant, or ID; filter by status; sort by date or priority.

- **Open one** → the pulled application data and its submitted label sit side by
  side. Click **Run AI Verification**: the label is read and every mandatory
  element is cross-checked against the application. Each field resolves to one of
  five statuses — **Matched · Acceptable variation · Needs review · Mismatched ·
  Missing** — which roll up into **Ready for Approval**, **Needs Agent Review**,
  or **Likely Rejection**. Record a disposition (approve / request info / reject);
  it persists and shows on the queue.

- **Or act in bulk** → select rows (or the select-all box) and **Auto-review**.
  Each label is verified in parallel and auto-dispositioned — clean → approved,
  failing → rejected, ambiguous → flagged for a human — with live per-row
  progress (cancellable mid-run). A summary then routes you straight to the
  exceptions, so a 300-application run becomes "go review these ~40."

### Custom Test Mode (secondary)

Check an arbitrary label that isn't in the queue — upload a photo, optionally
enter the application fields to cross-check, and verify. This is a testing tool;
the day-to-day workflow is the queue above.

## Architecture

```
queue (mock COLA) ─▶ application + label image ─▶ /api/review
                                                     │
                       LabelExtractor (Claude vision, structured JSON)
                                                     │
                            validate() (pure TypeScript)
                                                     │
                  ReviewResult ─▶ 5-status display + recommendation ─▶ UI
```

Extraction and validation are separate layers: **the model only transcribes;
every compliance verdict is computed in code.** Per-field strictness matches the
regulation — fuzzy matching for identity fields, numeric tolerances for
quantities, byte-strict comparison for the government warning (27 CFR 16.21). The
five-status display and the overall recommendation are pure derivations of the
engine's verdicts (`review-status.ts`). Agent dispositions and verification
results persist in the browser (localStorage) — right-sized for a single-agent
prototype; production would use a server-side, tamper-evident audit log.

```
src/app/          queue (page.tsx) · review/[id] · custom · about · api/{applications,review,extract}
src/components/    ConsoleShell · SingleReview · ReviewResults · ImageEditor
src/lib/           validate · extractor · review-status · decisions · cola-store · mock-cola · …
scripts/           gen-mock-cola.mjs — build-time mock-data + label-image generator
eval/              ground truth, scored results, harness, tuning subset
docs/              APPROACH · EVALUATION · PROMPT_TUNING · SECURITY
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
[`docs/EVALUATION.md`](docs/EVALUATION.md) for the evaluation design, the audit
trail, and instructions to reproduce the numbers.

## Tech

Next.js 15 · React 19 · TypeScript · Claude Haiku 4.5 (vision + structured
outputs; `LABEL_MODEL` swaps in Opus 4.8) · Vitest · GitHub Actions CI · Vercel.
