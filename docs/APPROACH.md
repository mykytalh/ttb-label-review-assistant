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
| ~5s per label | One vision call, tight `max_tokens`, client downscale, Haiku 4.5; extraction preloads in the background on photo upload, so the submitted single review is typically instant |
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
| Net contents | Parts 4, 5, 7 | Compare if entered | **Fail if missing** | Volume math only; no type-size minimums. Extraction reports the container total, not Serving Facts sizes; a crop showing only the serving panel falls to verify-by-eye |
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

## Tools used

Next.js 15 (React 19, TypeScript 5) · Anthropic SDK with Claude Haiku 4.5
(vision + structured JSON; `LABEL_MODEL` swaps in Opus 4.8) · Vitest +
V8 coverage · ESLint · GitHub Actions CI · Vercel hosting · sharp (eval-harness
image preparation only) · Node 18+.

## Assumptions made

Where the brief left gaps, these were filled deliberately:

- **Application data arrives by keystroke.** No COLA feed exists for a standalone
  prototype, so the agent types what the application says — and because the AI
  reads the label side anyway, every field beyond brand name is optional input.
- **One photo may not show the whole container.** Absence from the photo is not
  absence from the label: missing mandatory elements *warn* in single review
  (check the other panel) and *fail* in batch, where the image stands in for the
  full artwork.
- **The 5-second target is a hard requirement, not a preference** — the prior
  vendor died at 30–40s. This drove the model choice (measured p50 3.3s) over a
  slower, marginally stronger extractor.
- **The federal warning is the current 27 CFR 16.21 text**, compared verbatim;
  bold weight cannot be verified from extracted text, so it is an advisory
  sub-check rather than a silent pass.
- **Labels are English-language, standard market formats** (mL/L/fl oz volumes,
  % ABV / proof statements). Exotic formats fall to the warn path, not silent
  misreads.
- **Prototype security posture per the IT interview**: no authentication, no
  retention, public demo deployment with a server-side API key. A production
  deployment would add FedRAMP-aligned hosting, audit logging, and SSO.
- **The demo batch cap (10) bounds API spend only** — the architecture
  (queue + concurrency + retry + CSV) is built for the stated 200–300 drops.
- **Retail bottle photos are a fair stand-in** for submitted label artwork when
  evaluating extraction accuracy — they are strictly harder (glare, curvature,
  angles) than flat artwork files.

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
