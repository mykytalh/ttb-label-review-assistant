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
- **Alcohol content** — TTB tolerances by type: spirits ±0.3% (5.66); wine ±1%/±1.5%
  by band + range support (4.36); beer ±0.3% when stated (7.65); table/light wine
  may omit ABV at ≤14%.
- **Net contents** — normalized volumes (`750 mL` = `750ml`); required on label in batch mode.
- **Producer address** — name + address heuristic (ZIP, US state, or country token).
- **Country of origin** — whole-word match when application provides it; import heuristic
  (`imported by`, `product of`, etc.) requires origin in batch, warns in single review.
- **Government warning** — present, correct heading, verbatim body (OCR noise only); 27 CFR 16.21.

Pure synchronous `validate()` — unit tests, no I/O.

## TTB coverage matrix

| Element | CFR basis | Single review | Batch (label-only) | Limits |
|---------|-----------|---------------|--------------------|--------|
| Brand name | Parts 4, 5, 7 | Compare if entered | **Fail if missing** | Fuzzy match only; no COLA brand registry |
| Class / type | Parts 4, 5, 7 | Compare if entered | **Fail if missing** | Presence + fuzzy; no standard-of-identity rules |
| Alcohol content | **4.36**, **5.66**, **7.65** | TTB tolerance compare | Spirits **fail** if missing; wine **fail** if fortified/>14% cues; wine **warn** otherwise | Bold/type-size not verified; tax-class overlap not checked |
| Net contents | Parts 4, 5, 7 | Compare if entered | **Fail if missing** | Volume math only; no type-size minimums |
| Bottler / producer | Parts 4, 5, 7 | Compare if entered | **Fail if missing; warn if no address** | Heuristic address; not full street validation |
| Country of origin | Parts 4, 5, 7 (imports) | Compare if entered | **Fail if import cues and missing** | Import inferred from label text |
| Government warning | **27 CFR 16.21** | Always strict | Always strict | Bold and type-size not verified from text |

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
brand, class, net contents, and producer must be present; producer address is
heuristic-checked; import cues require country of origin; ABV by detected type;
full government-warning check. Full application-to-label matching is single-label
mode (or future COLA integration).

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

On-prem extractor · tamper-evident audit log · type-size with calibrated geometry ·
**COLA registry cross-check** — the public COLA registry (or a licensed feed of it,
e.g. COLA Cloud) is the authoritative record of approved labels; in production the
extracted brand/class/ABV should be verified against the applicant's approved COLA,
and the registry's labeled images are the natural source for growing the eval set
beyond 88 hand-labeled photos. Skipped here for cost and because the prototype's
bottleneck was eval-label quality, not data volume.
