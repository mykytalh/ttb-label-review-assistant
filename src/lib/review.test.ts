/**
 * Integration tests for the review orchestration and the client's error mapping —
 * the two seams between the (network/browser) edges and the pure validation core.
 *
 *  - reviewLabel(): extract → validate → stamp elapsedMs. Exercised with a mock
 *    LabelExtractor (the injectable seam) so the orchestration is verified without
 *    a live model call. This is the path every single + batch review runs through.
 *  - postReview(): turns HTTP responses into the plain-English ReviewError the UI
 *    (especially the batch worker's rate-limit backoff) depends on. Exercised with
 *    a mocked fetch.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { reviewLabel } from "./review";
import { postReview, ReviewError } from "./client";
import { LabelExtractor } from "./extractor";
import { ExtractedLabel, ApplicationData } from "./types";
import { GOVERNMENT_WARNING } from "./warning";

/** A fully-legible, fully-compliant extracted label. */
function compliantLabel(over: Partial<ExtractedLabel> = {}): ExtractedLabel {
  return {
    brandName: "Old Tom Distillery",
    beverageType: null,
    classType: "Kentucky Straight Bourbon Whiskey",
    alcoholContent: "45% Alc./Vol. (90 Proof)",
    netContents: "750 mL",
    producer: "Old Tom Distillery, Bardstown, KY",
    originCountry: null,
    governmentWarning: GOVERNMENT_WARNING,
    warningLegible: true,
    imageQuality: "good",
    ...over,
  };
}

/** A LabelExtractor stub that returns a fixed label (or throws). */
function stubExtractor(label: ExtractedLabel | (() => never)): LabelExtractor {
  return {
    extract: vi.fn(async () =>
      typeof label === "function" ? label() : label,
    ),
  };
}

const spiritsApp: ApplicationData = { brandName: "Old Tom Distillery", beverageType: "spirits" };

describe("reviewLabel — orchestration", () => {
  it("extracts then validates, and a compliant label passes overall", async () => {
    const extractor = stubExtractor(compliantLabel());
    const result = await reviewLabel(spiritsApp, "deadbeef", "image/jpeg", false, extractor);

    expect(extractor.extract).toHaveBeenCalledWith("deadbeef", "image/jpeg");
    expect(result.overall).toBe("pass");
    // The government-warning field specifically must pass on a legible verbatim warning.
    expect(result.fields.find((f) => f.field === "governmentWarning")?.verdict).toBe("pass");
  });

  it("fails overall when the mandatory warning is missing", async () => {
    const result = await reviewLabel(
      spiritsApp,
      "x",
      "image/jpeg",
      false,
      stubExtractor(compliantLabel({ governmentWarning: null })),
    );
    expect(result.overall).toBe("fail");
  });

  it("stamps elapsedMs", async () => {
    const result = await reviewLabel(spiritsApp, "x", "image/jpeg", false, stubExtractor(compliantLabel()));
    expect(typeof result.elapsedMs).toBe("number");
    expect(result.elapsedMs).toBeGreaterThanOrEqual(0);
  });

  it("propagates an extractor failure (route maps it to a status)", async () => {
    const boom = stubExtractor(() => {
      throw new Error("upstream exploded");
    });
    await expect(reviewLabel(spiritsApp, "x", "image/jpeg", false, boom)).rejects.toThrow("upstream exploded");
  });

  describe("label-only (batch) mode", () => {
    const noApp: ApplicationData = { beverageType: "auto" };

    it("passes a compliant label with no application (reads + checks the label)", async () => {
      const r = await reviewLabel(noApp, "x", "image/jpeg", true, stubExtractor(compliantLabel({ beverageType: "spirits" })));
      expect(r.overall).toBe("pass");
      // Brand is read off the label, not failed for being absent from the application.
      expect(r.fields.find((f) => f.field === "brandName")?.verdict).toBe("pass");
    });

    it("FAILS a label missing a required element (no brand on the label)", async () => {
      const r = await reviewLabel(
        noApp,
        "x",
        "image/jpeg",
        true,
        stubExtractor(compliantLabel({ brandName: null, beverageType: "spirits" })),
      );
      expect(r.fields.find((f) => f.field === "brandName")?.verdict).toBe("fail");
      expect(r.overall).toBe("fail");
    });

    it("does NOT fail an absent brand in single-review mode (nothing to check)", async () => {
      // Same null brand, but labelOnly=false → na, not fail (single review gates
      // on the agent entering a brand client-side anyway).
      const r = await reviewLabel(noApp, "x", "image/jpeg", false, stubExtractor(compliantLabel({ brandName: null, beverageType: "spirits" })));
      expect(r.fields.find((f) => f.field === "brandName")?.verdict).not.toBe("fail");
    });
  });
});

describe("postReview — HTTP error mapping", () => {
  afterEach(() => vi.restoreAllMocks());

  const mockFetch = (status: number, body: unknown, headers: Record<string, string> = {}) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: status >= 200 && status < 300,
        status,
        headers: { get: (k: string) => headers[k] ?? null },
        json: async () => body,
      })),
    );
  };

  it("returns the ReviewResult on 200", async () => {
    mockFetch(200, { overall: "pass", fields: [], imageQuality: "good" });
    const r = await postReview(spiritsApp, "x", "image/jpeg");
    expect(r.overall).toBe("pass");
  });

  it("rejects a 200 with an incomplete result shape", async () => {
    mockFetch(200, { overall: "pass", fields: [] });
    const err = await postReview(spiritsApp, "x", "image/jpeg").catch((e) => e);
    expect(err).toBeInstanceOf(ReviewError);
    expect(err.message).toMatch(/incomplete result/i);
  });

  it("maps 429 to a ReviewError carrying status + Retry-After", async () => {
    mockFetch(429, { error: "Too many requests." }, { "Retry-After": "7" });
    const err = await postReview(spiritsApp, "x", "image/jpeg").catch((e) => e);
    expect(err).toBeInstanceOf(ReviewError);
    expect(err.status).toBe(429);
    expect(err.retryAfterSeconds).toBe(7);
    expect(err.message).toContain("7s"); // surfaced to the agent
  });

  it("maps 413 to a friendly too-large message", async () => {
    mockFetch(413, { error: "Image too large." });
    const err = await postReview(spiritsApp, "x", "image/jpeg").catch((e) => e);
    expect(err).toBeInstanceOf(ReviewError);
    expect(err.status).toBe(413);
    expect(err.message).toMatch(/too large/i);
  });

  it("maps 503 to the configuration/admin message", async () => {
    mockFetch(503, { error: "Not configured." });
    const err = await postReview(spiritsApp, "x", "image/jpeg").catch((e) => e);
    expect(err.status).toBe(503);
    expect(err.message).toMatch(/Not configured|administrator/i);
  });

  it("handles an unreadable (non-JSON) response without leaking internals", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 502,
        headers: { get: () => null },
        json: async () => {
          throw new Error("invalid json");
        },
      })),
    );
    const err = await postReview(spiritsApp, "x", "image/jpeg").catch((e) => e);
    expect(err).toBeInstanceOf(ReviewError);
    expect(err.message).toMatch(/unreadable|try again/i);
  });
});
