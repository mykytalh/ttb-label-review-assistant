/**
 * Tests for server-side request validation. These prove the endpoint rejects
 * malformed, oversized, and unsupported input before it reaches the paid model.
 */
import { describe, it, expect } from "vitest";
import { validateReviewRequest, MAX_IMAGE_BYTES } from "./request-validation";

// A real (1×1 transparent) PNG, base64-encoded — passes the magic-byte sniff.
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

describe("validateReviewRequest — happy path", () => {
  it("accepts a well-formed request", () => {
    const r = validateReviewRequest(goodBody());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.application.brandName).toBe("Old Tom");
      expect(r.value.mediaType).toBe("image/png");
    }
  });

  it("normalizes an unknown beverage type to 'auto'", () => {
    const r = validateReviewRequest(
      goodBody({ application: { brandName: "X", beverageType: "cider" } }),
    );
    expect(r.ok && r.value.application.beverageType).toBe("auto");
  });

  it("trims and length-caps free-text fields", () => {
    const long = "a".repeat(1000);
    const r = validateReviewRequest(
      goodBody({ application: { brandName: "  Brand  ", beverageType: "wine", producer: long } }),
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.application.brandName).toBe("Brand");
      expect(r.value.application.producer!.length).toBeLessThanOrEqual(500);
    }
  });
});

describe("validateReviewRequest — rejections", () => {
  it("rejects a non-object body", () => {
    const r = validateReviewRequest("nope");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(400);
  });

  it("accepts a brandless request (the batch label-only screen)", () => {
    // Brand is required by the single-review UI (client-side gate), but the API
    // allows none: the batch screen sends no application and just reads + checks
    // each label against the universal rules. Brand isn't failed when absent.
    const r = validateReviewRequest(goodBody({ application: { beverageType: "spirits" } }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.application.brandName).toBeUndefined();
  });

  it("rejects an unsupported media type with 415", () => {
    const r = validateReviewRequest(goodBody({ mediaType: "image/svg+xml" }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(415);
  });

  it("rejects non-base64 image data", () => {
    const r = validateReviewRequest(goodBody({ imageBase64: "!!!not base64!!!" }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(400);
  });

  it("rejects an oversized image with 413", () => {
    // Build a base64 string that decodes to just over the cap.
    const overCapChars = Math.ceil(((MAX_IMAGE_BYTES + 1024) * 4) / 3);
    const huge = "A".repeat(overCapChars);
    const r = validateReviewRequest(goodBody({ imageBase64: huge }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(413);
  });

  it("rejects a missing image", () => {
    const r = validateReviewRequest(goodBody({ imageBase64: "" }));
    expect(r.ok).toBe(false);
  });

  it("rejects valid base64 that is not actually an image (magic-byte sniff)", () => {
    // "hello world..." is valid base64 and within size, but not an image — it
    // must not reach the paid model just because the media type was forged.
    const notAnImage = btoa("hello world this is plainly not an image file");
    const r = validateReviewRequest(goodBody({ imageBase64: notAnImage }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(400);
  });

  it("rejects a missing application object", () => {
    const r = validateReviewRequest(goodBody({ application: null }));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status).toBe(400);
      expect(r.error).toMatch(/application/i);
    }
  });

  it("accepts a GIF signature (supported server-side)", () => {
    // GIF89a magic → base64 "R0lGOD"...
    const gif = "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
    const r = validateReviewRequest(goodBody({ imageBase64: gif, mediaType: "image/gif" }));
    expect(r.ok).toBe(true);
  });

  it("accepts a real JPEG signature", () => {
    // JPEG magic FF D8 FF E0 ... → base64 starts with "/9j/4". Confirm a non-PNG
    // image still passes (we accept any supported image signature).
    const jpeg = "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAEBAQ==";
    const r = validateReviewRequest(goodBody({ imageBase64: jpeg, mediaType: "image/jpeg" }));
    expect(r.ok).toBe(true);
  });
});
