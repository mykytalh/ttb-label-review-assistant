# Design approach

This document records the main design decisions, trade-offs, and known limitations
for the Label Review Assistant prototype.

## Stakeholder traceability

| Stakeholder need | Design decision | Where it lives |
|---|---|---|
| Sarah (agent) — fast, low-friction review | ~5s target, simple three-step flow, Haiku default, large verdicts | `SingleReview.tsx`, `extractor.ts` |
| Dave (manager) — batch throughput | Bounded queue, streaming results, CSV export mirroring the extraction panel | `BatchReview.tsx`, `export.ts` |
| Jenny (legal) — strict government warning | Verbatim body + `GOVERNMENT WARNING:` in all caps with required colon (27 CFR 16.21) | `validate.ts` → `matchWarning`, `warning.ts` |
| Marcus (IT) — key security, no retention | Server-side API key, in-memory processing, per-IP rate limit, sanitized errors | `route.ts`, `request-validation.ts`, `SECURITY.md` |

## Problem

Compliance agents review roughly 150,000 label applications per year. Most of the
work is field matching: confirming that brand name, alcohol content, net contents,
and the government warning on the label artwork match the application. The tool
automates that matching for a single label or a batch and returns a per-field
pass / review / fail verdict. It assists the agent; it does not replace judgment.

## Constraints that shaped the design

| Constraint | Response |
|---|---|
| Latency target of ~5 seconds per label | One vision call per label, tight `max_tokens`, client-side downscaling, Haiku 4.5 as the default model |
| Low technical comfort across the agent pool | Large type, high-contrast verdicts (icon + word + color), simple three-step flow, visible focus rings |
| Bulk uploads of 200–300 labels | Batch tab with bounded concurrency, streaming results, summary export |
| Production networks may block outbound ML APIs | `LabelExtractor` interface; cloud vision in the prototype, swappable on-prem OCR backend |
| No document retention in the prototype | Stateless processing; images held in memory only; API key server-side |
| Fuzzy identity fields vs strict warning text | Per-field matching rules (see below) |
| Imperfect label photos (glare, skew, poor lighting) | Vision model extraction; image-quality and legibility signals surfaced to the agent |
| Beverage-type-dependent rules | Type-aware ABV requirements; auto-detect from the label when the agent selects Auto |

## Per-field validation rules

Different fields use different matching strictness:

- **Brand, class, producer** — Normalize case, punctuation, and diacritics before
  comparing. Exact match after normalization → pass; close match → review; clear
  mismatch → fail. Producer matching also strips corporate suffixes; brand matching
  does not, because suffix words can distinguish a typo from a match.

- **Alcohol content** — Parse numeric ABV with tolerance. When proof is present,
  verify it is approximately 2× ABV. Whether a missing ABV fails depends on beverage
  type (required for spirits; softer for wine and beer).

- **Net contents** — Compare normalized volumes (for example, `750 mL` = `750ml`).

- **Country of origin** — Whole-word country match after stripping framing phrases
  (`Product of Scotland` = `Scotland`). Substring matching is avoided (`US` must not
  match `Russia`). When the application omits origin, the field is not checked.

- **Government warning** — Strict. Three checks: present, `GOVERNMENT WARNING:`
  in all caps, and verbatim body text (OCR whitespace and line-wrap noise only).
  Title case, paraphrase, or missing clauses fail.

The validator is a pure synchronous function with no I/O. Unit tests cover the
behavioral guarantees above, including fuzzy brand normalization and strict warning
checks.

Verdicts are **pass**, **review**, and **fail**. **Review** means the tool found a
soft finding that needs a quick human check.

## Architecture

```
image → LabelExtractor → ExtractedLabel → validate() → ReviewResult → UI
```

Extraction and validation are separate layers. The prototype ships a Claude vision
implementation behind `LabelExtractor`. A deployment that cannot reach external APIs
can provide an on-prem OCR implementation without changing the validator or UI.

```
            ┌──────────────────────┐
   image →  │  LabelExtractor      │  → ExtractedLabel → validate() → ReviewResult
            │  (interface)         │
            └──────────┬───────────┘
                       │
        ┌──────────────┴───────────────┐
        │                              │
  ClaudeExtractor              OnPremExtractor
  cloud vision                 on-prem OCR, no egress
```

## Model and extraction

Default model: **Claude Haiku 4.5** (`LABEL_MODEL` override for Opus 4.8). Client
downscale to 1024px, capped `max_tokens`, prompt caching for batch.

Accuracy results and audit findings: [`docs/EVALUATION.md`](EVALUATION.md)
(committed run: `eval/results.json`). Eval photos (88):
[Google Drive](https://drive.google.com/drive/folders/1hCq_woq7IwyrOwbi_9XLHeSUsduSUxjN?usp=sharing)
→ `public/samples/alcohol/` (gitignored). Prompt tuning:
[`docs/PROMPT_TUNING.md`](PROMPT_TUNING.md).

## Batch mode scope

In batch mode the agent uploads many labels but does not enter per-label application
data. The same extraction pass runs as single-label review — brand, class, ABV, net
contents, producer, origin, beverage type, and the government warning are all read
off the photo. Validation then checks **label completeness**: brand and class/type **fail if
missing** (`requireCore` in `validate.ts`); net contents and producer are read and
shown but not hard-failed when absent (placement varies by product). ABV is enforced
by detected beverage type, and the government warning gets the full strict check
(present, all-caps `GOVERNMENT WARNING:` with colon, verbatim text, legibility gate).
There is no application-to-label matching until a COLA integration supplies per-row
application records.

The prototype caps batches at **10 labels** because each photo is one paid API call.
The queue UI shows that limit and the per-label cost. Production would raise the cap
and run with agency-budgeted infrastructure.

Full application-to-label matching is available in single-label mode. A production
integration with COLA would supply per-label application records and run the full
match for each batch row.

## UI and accessibility

The UI follows USWDS visual standards (Public Sans, federal color tokens, spacing
scale) using lightweight custom components rather than the full `@uswds/uswds`
package.

Accessibility targets WCAG 2.1 AA and Section 508:

- Verdicts use icon, word, and color together.
- Text contrast meets AA.
- Full keyboard support with visible focus; tabs use `role="tab"` / `tabpanel`.
- Skip-to-content link on load.
- Results and batch progress use `aria-live` regions.
- Motion respects `prefers-reduced-motion`.

### Dark mode

Label review is screen-heavy, everyday work. Agents may spend hours comparing label
photos to application fields in a single session. A light-only UI is tiring for many
people over that kind of use, including users with light sensitivity who rely on
dark themes for daily tooling.

The app includes a header toggle for light and dark themes. On first visit the UI
follows the OS `prefers-color-scheme` setting; the user's choice is saved in
`localStorage`. Both themes keep AA contrast for text and verdict colors.

Text-size and high-contrast controls are not duplicated in-app; browser and OS zoom
and high-contrast modes are supported instead.

## Stack

- **Next.js + TypeScript on Vercel** — single codebase, server-side API routes for
  the Anthropic key.
- **Claude vision with structured outputs** — Haiku 4.5 default; JSON schema matches
  `ExtractedLabel`.
- **Vitest** — 148 unit tests; coverage thresholds on `src/lib/` (`vitest.config.ts`).
- **GitHub Actions** — `test` → `lint` → `build` on every push/PR (`.github/workflows/ci.yml`).

## Out of scope

- **Type-size / legibility minimums** — requires bounding-box geometry and container
  dimensions that a single uncalibrated photo cannot provide reliably.
- **Bold detection on the warning** — not reliably inferable from transcribed text.
- **Specialized fields** — sulfites, appellations, allergens, FD&C colors.
- **Prohibited or misleading claims analysis** — judgment-heavy; left to agents.
- **COLA integration** — standalone proof of concept.
- **Persistence, accounts, audit log** — conflicts with the prototype no-retention
  requirement.

## Production follow-ups

1. On-prem `LabelExtractor` implementation for firewalled networks.
2. Tamper-evident audit log of each review.
3. Type-size verification with calibrated image geometry.

The current architecture keeps validation logic isolated and tested so these can be
added without rewriting the core engine.
