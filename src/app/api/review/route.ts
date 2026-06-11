/**
 * POST /api/review — review a single label.
 *
 * Request:  { application: ApplicationData, imageBase64: string, mediaType: string }
 * Response: ReviewResult  (or { error } with an appropriate status)
 *
 * Security controls:
 *   - Anthropic API key is server-side only.
 *   - Input validated server-side (see request-validation.ts).
 *   - Per-IP rate limit before the model call.
 *   - Images processed in memory; not persisted.
 *   - Errors return generic messages; details logged server-side.
 */
import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { reviewLabel } from "@/lib/review";
import { validateReviewRequest } from "@/lib/request-validation";
import { rateLimit, clientIp } from "@/lib/rate-limit";

// Allow the extraction call enough head-room; we still aim well under this.
export const maxDuration = 30;

// Per-IP limit: 20 reviews per minute. Generous for a single agent working a
// queue, restrictive enough to blunt abuse of a public, key-backed endpoint.
const RATE_LIMIT = 20;
const RATE_WINDOW_MS = 60_000;

export async function POST(req: NextRequest) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { error: "The review service is not configured. Contact your administrator." },
      { status: 503 },
    );
  }

  // Rate limit before doing any work (and before touching the paid API).
  const ip = clientIp(req.headers);
  const limit = rateLimit(ip, RATE_LIMIT, RATE_WINDOW_MS);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many requests. Please wait a moment and try again." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const validation = validateReviewRequest(body);
  if (!validation.ok) {
    return NextResponse.json({ error: validation.error }, { status: validation.status });
  }
  const { application, imageBase64, mediaType } = validation.value;
  // No brand means there's no application to compare against — it's the batch
  // label-only screen, which checks required elements are present on the label.
  const labelOnly = !application.brandName;

  try {
    const result = await reviewLabel(application, imageBase64, mediaType, labelOnly);
    return NextResponse.json(result);
  } catch (err) {
    console.error("Review failed:", err);

    // Map Anthropic SDK errors to meaningful status codes so the client can show
    // the right guidance (rate-limit vs. config vs. generic upstream failure).
    if (err instanceof Anthropic.RateLimitError) {
      return NextResponse.json({ error: "Rate limited." }, { status: 429 });
    }
    if (err instanceof Anthropic.AuthenticationError) {
      return NextResponse.json(
        { error: "The review service's API key is invalid. Contact your administrator." },
        { status: 503 },
      );
    }
    if (err instanceof Anthropic.APIError) {
      const message =
        typeof err.status === "number" && err.status >= 500
          ? "The AI service is temporarily unavailable. Please try again."
          : "The review could not be completed. Please try again.";
      return NextResponse.json({ error: message }, { status: 502 });
    }
    // Generic fallback — never leak internals to the client.
    return NextResponse.json(
      { error: "The review could not be completed. Please try again." },
      { status: 502 },
    );
  }
}
