/**
 * POST /api/extract — extraction only, for speculative preloading.
 *
 * The single-label screen fires this in the background the moment a photo is
 * ready, so the model reads the label while the agent is still typing. Submit
 * then validates client-side against the returned ExtractedLabel (validate()
 * is pure TypeScript) and the result appears instantly. If this call fails or
 * the photo changes, the client falls back to the classic /api/review path —
 * this endpoint is an accelerator, never a dependency.
 *
 * Request:  { imageBase64: string, mediaType: string }
 * Response: { label: ExtractedLabel, elapsedMs: number }  (or { error })
 *
 * Same security posture as /api/review: server-side key, server-side input
 * validation, and the SAME per-IP rate-limit bucket — preload and review
 * spend from one 20/min budget, so the pair can't double an abuser's volume.
 */
import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { getExtractor } from "@/lib/extractor";
import { validateReviewRequest } from "@/lib/request-validation";
import { rateLimit, clientIp } from "@/lib/rate-limit";

export const maxDuration = 30;

const RATE_LIMIT = 20;
const RATE_WINDOW_MS = 60_000;

export async function POST(req: NextRequest) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { error: "The review service is not configured. Contact your administrator." },
      { status: 503 },
    );
  }

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

  // Reuse the review validator wholesale (image checks, size caps, base64,
  // magic bytes) by supplying the minimal application it expects — this
  // endpoint takes no application data.
  const payload = typeof body === "object" && body !== null ? body : {};
  const validation = validateReviewRequest({
    application: { beverageType: "auto" },
    ...payload,
  });
  if (!validation.ok) {
    return NextResponse.json({ error: validation.error }, { status: validation.status });
  }
  const { imageBase64, mediaType } = validation.value;

  try {
    const start = Date.now();
    const label = await getExtractor().extract(imageBase64, mediaType);
    return NextResponse.json({ label, elapsedMs: Date.now() - start });
  } catch (err) {
    console.error("Extract failed:", err);
    if (err instanceof Anthropic.RateLimitError) {
      return NextResponse.json({ error: "Rate limited." }, { status: 429 });
    }
    if (err instanceof Anthropic.AuthenticationError) {
      return NextResponse.json(
        { error: "The review service's API key is invalid. Contact your administrator." },
        { status: 503 },
      );
    }
    // Generic for everything else — the client treats any failure as
    // "no preload" and falls back to /api/review.
    return NextResponse.json(
      { error: "The extraction could not be completed." },
      { status: 502 },
    );
  }
}
