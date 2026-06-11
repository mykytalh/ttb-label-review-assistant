# Design approach

Brief record of design decisions, trade-offs, and limitations for the Label Review
Assistant prototype.

## Stakeholder traceability

| Stakeholder need | Design decision | Where it lives |
|---|---|---|
| Sarah — fast, low-friction review | ~5s target, three-step flow, Haiku default, large verdicts | `SingleReview.tsx`, `extractor.ts` |
| Dave — batch throughput | Bounded queue (10 cap in demo), streaming results, CSV export | `BatchReview.tsx`, `export.ts` |
| Jenny — strict government warning | Verbatim body + `GOVERNMENT WARNING:` all caps with colon (27 CFR 16.21) | `validate.ts`, `warning.ts` |
| Marcus — key security, no retention | Server-side API key, in-memory processing, rate limit, sanitized errors | `route.ts`, `SECURITY.md` |

## Problem

Agents review ~150k label applications/year. Most work is field matching — brand,
ABV, net contents, government warning vs the application. The tool automates that
for one label or a batch and returns per-field **pass / review / fail**. Advisory
only; it does not replace judgment.

## Constraints → responses

| Constraint | Response |
|---|---|
| ~5s per label | One vision call, tight `max_tokens`, client downscale, Haiku 4.5 |
| Low tech comfort | Large type, icon+word+color verdicts, in-app help, focus rings |
| Bulk uploads (200–300 in production) | Batch tab, concurrency 2, export; demo caps at 10 (one API call each) |
| Firewalled networks | `LabelExtractor` interface — swappable on-prem OCR |
| No retention | Stateless; images in memory only |
| Fuzzy identity vs strict warning | Per-field rules below |
| Bad photos | Quality/legibility signals; fail-closed on unreadable warnings |

## Validation rules

- **Brand, class, producer** — normalize case/punctuation; close typo → review.
- **Alcohol content** — numeric ABV + proof check; required for spirits, softer for wine/beer.
- **Net contents** — normalized volumes (`750 mL` = `750ml`).
- **Country of origin** — whole-word match; not checked when application omits it.
- **Government warning** — present, correct heading, verbatim body (OCR noise only).

Pure synchronous `validate()` — 148 unit tests, no I/O.

## Architecture

```
image → LabelExtractor → ExtractedLabel → validate() → ReviewResult → UI
```

Extraction and validation are separate. Prototype uses Claude vision; production
could plug on-prem OCR without changing the validator or UI.

**Model:** Haiku 4.5 default (`LABEL_MODEL` for Opus). **Accuracy:**
[`EVALUATION.md`](EVALUATION.md) + `eval/results.json`. **Prompt:**
[`PROMPT_TUNING.md`](PROMPT_TUNING.md).

## Batch mode

No per-label application form. Reads each label and checks **on-artwork requirements**:
brand/class fail if missing; ABV by detected type; full government-warning check.
Net contents and producer captured when visible, not hard-failed when absent. Full
application-to-label matching is single-label mode (or future COLA integration).

## UI and accessibility

USWDS-inspired tokens and spacing. WCAG 2.1 AA / Section 508: verdicts use icon +
word + color; keyboard tabs; skip link; `aria-live` for results; `prefers-reduced-motion`.
Light/dark toggle (OS default on first visit, saved in `localStorage`).

## Stack

Next.js + TypeScript (Vercel) · Claude vision + structured JSON · Vitest · GitHub
Actions CI.

## Out of scope

Type-size minimums, bold detection, sulfites/appellations, claim analysis, COLA
integration, persistence/audit log.

## Production follow-ups

On-prem extractor · tamper-evident audit log · type-size with calibrated geometry.
