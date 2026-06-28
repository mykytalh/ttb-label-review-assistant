# Security and threat model

This document describes the prototype threat model, mitigations in place, and gaps
that would need to be closed for production.

## Trust boundaries

```
Browser (untrusted)  ──HTTPS──▶  Next.js server (trusted)  ──HTTPS──▶  Anthropic API
   user input,                     API key lives here only,             model call
   label image                     all input re-validated
```

The browser is untrusted. Client-side checks (image downscaling, field limits) are
convenience only; the server re-validates every constraint.

Two endpoints cross the boundary — `/api/review` (extract + validate) and
`/api/extract` (extraction only, used to preload while the agent types). Both
run the same input validation, the same error sanitization, and draw from the
same per-IP rate-limit bucket within a server instance. (The existing
single-instance caveat below applies — serverless deployment can give each
route its own instance, which is part of why production needs a shared store.)

## Threats and mitigations

| Threat | Mitigation |
|---|---|
| **API key exposure** | `ANTHROPIC_API_KEY` is read only in server-side code. It is not sent to the browser or bundled client-side. Supplied via environment variable; excluded from version control. |
| **Oversized or malicious upload** | Server validates media type (PNG/JPEG/WebP/GIF), base64 well-formedness, and decoded size cap (`MAX_IMAGE_BYTES`, 8 MB). Free-text fields are length-capped. See `src/lib/request-validation.ts`. |
| **Endpoint abuse** | Per-IP fixed-window rate limit (20 req/min) runs before the paid model call. See `src/lib/rate-limit.ts`. |
| **Prompt injection via label text** | The model transcribes printed text into a fixed JSON schema. Compliance verdicts are computed by `validate.ts`; the model cannot change verdict logic. |
| **Untrusted model output** | `coerceExtractedLabel` normalizes every field, maps illegible sentinels to `null`, and defaults unknown image quality to `fair`. |
| **Hung upstream** | Extraction has a 20 s per-request timeout; the route sets `maxDuration`. |
| **Clickjacking / MIME sniffing** | CSP, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Permissions-Policy`, HSTS. See `next.config.ts`. |
| **Information leakage in errors** | Client responses use generic messages; Anthropic upstream 4xx/5xx text is never forwarded. Details are logged server-side only. See `src/app/api/review/route.ts` and `route.test.ts`. |
| **Data retention** | The server is stateless: images and application data are processed in memory and never persisted server-side. Agent dispositions and verification results persist **client-side only** (browser `localStorage`, `decisions.ts`) — a right-sized choice for a single-agent prototype, and no PII leaves the browser. |

## Network egress (firewalled deployment)

TTB's network blocks outbound traffic to many domains — the prior scanning vendor's
ML endpoints were firewall-blocked and half its features silently failed (Marcus's
interview). This prototype is built so that concern is contained and answerable:

- **One outbound domain.** The running app makes exactly one kind of external call:
  `https://api.anthropic.com` for label *transcription*. Nothing else leaves the
  network — there is a single domain to allow-list (or repoint), not a fleet of
  vendor ML endpoints.
- **The dependency is isolated to transcription, never to judgment.** Only the
  *extract* step reaches out; every compliance verdict is computed in-process by
  `validate.ts`. The half that must be trustworthy and always-available already runs
  entirely inside the trust boundary, with no network at all.
- **The model call sits behind one swap seam.** `LabelExtractor`
  (`src/lib/extractor.ts`, factory at the foot of the file) is the only place the
  cloud is touched. A firewalled deployment swaps in an in-boundary backend — Azure
  OpenAI or a TTB-hosted vision model inside the existing Azure/FedRAMP boundary
  (Marcus's 2019 migration), or an on-prem OCR engine — without changing the
  validator, the API surface, or the UI. Deliberately documented, not built: a
  second backend is out of scope for a prototype (the brief's "working core over
  ambitious-but-incomplete").

So the production answer to "your firewall blocks cloud ML" is not a rewrite — it is
one allow-list entry, or one `LabelExtractor` swap to an in-boundary model. The
deterministic compliance logic never depended on the network to begin with.

## Out of scope for the prototype

- **Authentication and authorization** — production would sit behind agency SSO.
- **Distributed rate limiting** — in-memory limiter is single-instance only; production
  needs Redis or an edge policy.
- **Server-side audit trail** — dispositions persist only in the agent's browser
  (`localStorage`); production needs a tamper-evident, server-side review log.
- **Secrets management** — key is an environment variable; production would use a
  managed secret store with rotation.
