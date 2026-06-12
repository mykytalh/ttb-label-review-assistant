/**
 * Route-handler tests for the speculative-extraction endpoint — configuration,
 * validation reuse, rate limiting, error sanitization, and the response shape
 * the preload client depends on. The extractor is mocked; no credits spent.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "./route";
import { getExtractor } from "@/lib/extractor";
import { rateLimit } from "@/lib/rate-limit";

vi.mock("@/lib/extractor", () => ({
  getExtractor: vi.fn(),
}));

vi.mock("@/lib/rate-limit", () => ({
  rateLimit: vi.fn(() => ({ allowed: true, remaining: 19, retryAfterSeconds: 0 })),
  clientIp: vi.fn(() => "127.0.0.1"),
}));

const getExtractorMock = vi.mocked(getExtractor);
const rateLimitMock = vi.mocked(rateLimit);

const TINY_PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

const LABEL = {
  brandName: "Old Tom Distillery",
  beverageType: "spirits",
  classType: null,
  alcoholContent: null,
  netContents: null,
  producer: null,
  originCountry: null,
  governmentWarning: null,
  warningLegible: false,
  imageQuality: "good",
  notes: null,
};

function post(body: unknown) {
  return POST(
    new NextRequest("http://localhost/api/extract", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

describe("POST /api/extract", () => {
  const origKey = process.env.ANTHROPIC_API_KEY;

  beforeEach(() => {
    process.env.ANTHROPIC_API_KEY = "sk-test";
    getExtractorMock.mockReset();
    getExtractorMock.mockReturnValue({ extract: vi.fn().mockResolvedValue(LABEL) });
    rateLimitMock.mockReturnValue({ allowed: true, remaining: 19, retryAfterSeconds: 0 });
  });

  afterEach(() => {
    process.env.ANTHROPIC_API_KEY = origKey;
  });

  it("returns 503 when the API key is missing", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const res = await post({ imageBase64: TINY_PNG_B64, mediaType: "image/png" });
    expect(res.status).toBe(503);
  });

  it("returns 429 with Retry-After when rate limited", async () => {
    rateLimitMock.mockReturnValueOnce({ allowed: false, remaining: 0, retryAfterSeconds: 7 });
    const res = await post({ imageBase64: TINY_PNG_B64, mediaType: "image/png" });
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("7");
  });

  it("rejects a non-image payload via the shared validator", async () => {
    const res = await post({ imageBase64: "bm90IGFuIGltYWdl", mediaType: "image/png" });
    expect(res.status).toBe(400);
  });

  it("rejects a disallowed media type with 415", async () => {
    const res = await post({ imageBase64: TINY_PNG_B64, mediaType: "image/svg+xml" });
    expect(res.status).toBe(415);
  });

  it("returns the extracted label and an elapsed time", async () => {
    const res = await post({ imageBase64: TINY_PNG_B64, mediaType: "image/png" });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.label.brandName).toBe("Old Tom Distillery");
    expect(typeof json.elapsedMs).toBe("number");
  });

  it("returns a generic 502 on upstream failure — no internals leaked", async () => {
    getExtractorMock.mockReturnValue({
      extract: vi.fn().mockRejectedValue(new Error("socket hang up: internal-host:4433")),
    });
    const res = await post({ imageBase64: TINY_PNG_B64, mediaType: "image/png" });
    expect(res.status).toBe(502);
    const json = await res.json();
    expect(json.error).not.toContain("internal-host");
  });
});
