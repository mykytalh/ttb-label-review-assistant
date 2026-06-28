# Design approach

Brief record of design decisions, trade-offs, and limitations for the Label Review
Assistant prototype.

## Stakeholder traceability

| Stakeholder need | Design decision | Where it lives |
|---|---|---|
| Sarah — fast, low-friction review | ~5s target; application data + label preloaded from the queue (no typing); one-click verify; large verdicts | `page.tsx`, `review/[id]`, `extractor.ts` |
| Dave — batch throughput | Multi-select **Auto-review** with live per-row progress + cancel; auto-disposition; a summary routes to the exceptions | `page.tsx`, `review-status.ts` |
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
| Bulk review (200–300 in production) | Select rows (or select-all) → Auto-review, concurrency-bounded + cancellable, then a triage summary; same per-label call underneath |
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
queue (mock COLA) → application + label → LabelExtractor → validate() → ReviewResult → 5-status + recommendation → UI
```

Extraction and validation are separate. Prototype uses Claude vision; production
could plug on-prem OCR without changing the validator or UI. The queue is
simulated with mock records behind a swappable `ColaSource` interface (a live
COLA registry adapter would drop in unchanged); the five-status display and
overall recommendation are pure derivations of the engine verdicts
(`review-status.ts`). Agent dispositions and results persist in the browser
(`decisions.ts`, localStorage) — production would use a server-side audit log.

**Model:** Haiku 4.5 default (`LABEL_MODEL` for Opus). **Accuracy:**
[`EVALUATION.md`](EVALUATION.md) + `eval/results.json`. **Prompt:**
[`PROMPT_TUNING.md`](PROMPT_TUNING.md).

## Bulk auto-review

Selecting rows (or select-all) runs the same per-label verification across the
set — concurrency-bounded and cancellable, with live per-row progress. Each
result is auto-dispositioned from its recommendation — clean → approved, failing
→ rejected, ambiguous → flagged for a human (`autoDisposition` in
`review-status.ts`) — and an end-of-run summary routes the agent straight to the
exceptions. Because each queue row already carries application data, this is full
application-to-label matching, not label-only. (The engine still supports a
label-only mode for Custom Test Mode uploads with no application fields.)

## UI and accessibility

Modern light-blue / slate design tokens (Inter), a persistent collapsed sidebar,
and a contextual selection bar for bulk actions. WCAG 2.1 AA / Section 508:
status uses icon + word + color; keyboard-operable rows (via per-row link),
sortable headers, filter pills, and dialogs (Escape + focus management); skip
link; `aria-live` for results; `prefers-reduced-motion` honored.

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
- **Bulk Auto-review is concurrency-bounded (2 parallel workers), not item-capped**
  — it runs over the whole selected set; the architecture (queue + bounded
  concurrency + cancellation + per-IP rate limit) is built for the stated
  200–300 drops while keeping API spend and load predictable. The demo queue ships
  20 representative records (every result status); a 300-drop run is the same code
  path — at ~3.6s/label and 2 workers that's ~9 min unattended, auto-dispositioned,
  with the summary routing the agent only to the exceptions. `BATCH_CONCURRENCY`
  (`page.tsx`) is a single tunable; production raises it behind a shared rate-limit
  store (see SECURITY.md).
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
