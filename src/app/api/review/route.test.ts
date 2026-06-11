/**
 * Route-handler tests — configuration, validation, error sanitization, and
 * label-only wiring. The extractor is mocked so no API credits are spent.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { POST } from "./route";
import { reviewLabel } from "@/lib/review";
import { rateLimit } from "@/lib/rate-limit";

vi.mock("@/lib/review", () => ({
  reviewLabel: vi.fn(),
}));

vi.mock("@/lib/rate-limit", () => ({
  rateLimit: vi.fn(() => ({ allowed: true, retryAfterSeconds: 0 })),
  clientIp: vi.fn(() => "127.0.0.1"),
}));

const reviewLabelMock = vi.mocked(reviewLabel);
const rateLimitMock = vi.mocked(rateLimit);

const TINY_PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

function goodBody(overrides: Record<string, unknown> = {}) {
  return {
    application: { brandName: "Old Tom", beverageType: "spirits" },
    imageBase64: TINY_PNG_B64,
    mediaType: "image/png",
    ...overrides,
  };
}

function post(body: unknown) {
  return POST(
    new NextRequest("http://localhost/api/review", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

describe("POST /api/review", () => {
  const origKey = process.env.ANTHROPIC_API_KEY;

  beforeEach(() => {
    process.env.ANTHROPIC_API_KEY = "sk-test";
    reviewLabelMock.mockReset();
    rateLimitMock.mockReturnValue({ allowed: true, retryAfterSeconds: 0 });
  });

  afterEach(() => {
    process.env.ANTHROPIC_API_KEY = origKey;
  });

  it("returns 503 when the API key is missing", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const res = await post(goodBody());
    expect(res.status).toBe(503);
    const json = await res.json();
    expect(json.error).toContain("not configured");
  });

  it("returns 429 when rate limited", async () => {
    rateLimitMock.mockReturnValueOnce({ allowed: false, retryAfterSeconds: 12 });
    const res = await post(goodBody());
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("12");
  });

  it("returns 400 for invalid JSON", async () => {
    const res = await POST(
      new NextRequest("http://localhost/api/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "not-json",
      }),
    );
    expect(res.status).toBe(400);
  });

  it("returns 415 for an unsupported media type", async () => {
    const res = await post(goodBody({ mediaType: "image/svg+xml" }));
    expect(res.status).toBe(415);
  });

  it("passes labelOnly when the application has no brand", async () => {
    reviewLabelMock.mockResolvedValueOnce({
      overall: "pass",
      fields: [],
      imageQuality: "good",
    });
    const res = await post(goodBody({ application: { beverageType: "auto" } }));
    expect(res.status).toBe(200);
    expect(reviewLabelMock).toHaveBeenCalledWith(
      expect.objectContaining({ brandName: undefined }),
      TINY_PNG_B64,
      "image/png",
      true,
    );
  });

  it("does not leak Anthropic 4xx details to the client", async () => {
    reviewLabelMock.mockRejectedValueOnce(
      new Anthropic.APIError(400, undefined, "sensitive upstream detail", undefined),
    );
    const res = await post(goodBody());
    expect(res.status).toBe(502);
    const json = await res.json();
    expect(json.error).not.toContain("sensitive");
    expect(json.error).toBe("The review could not be completed. Please try again.");
  });

  it("returns a generic message for Anthropic 5xx errors", async () => {
    reviewLabelMock.mockRejectedValueOnce(
      new Anthropic.APIError(503, undefined, "upstream outage", undefined),
    );
    const res = await post(goodBody());
    expect(res.status).toBe(502);
    const json = await res.json();
    expect(json.error).toBe("The AI service is temporarily unavailable. Please try again.");
  });
});
