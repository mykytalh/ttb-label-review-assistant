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
run the same input validation, the same error sanitization, and spend from the
**same per-IP rate-limit bucket**, so the pair cannot be used to double an
abuser's request volume.

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
| **Data retention** | Stateless: images and application data are processed in memory and not persisted between requests. |

## Out of scope for the prototype

- **Authentication and authorization** — production would sit behind agency SSO.
- **Distributed rate limiting** — in-memory limiter is single-instance only; production
  needs Redis or an edge policy.
- **Audit logging** — production needs a tamper-evident review trail, which requires
  persistence not included in the prototype.
- **Secrets management** — key is an environment variable; production would use a
  managed secret store with rotation.
