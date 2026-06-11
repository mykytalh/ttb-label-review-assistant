/** Tests for shared client helpers used by the review UIs. */
import { describe, it, expect } from "vitest";
import { isAcceptedImageType } from "./client";

describe("isAcceptedImageType", () => {
  it("accepts PNG, JPEG, and WebP", () => {
    expect(isAcceptedImageType("image/png")).toBe(true);
    expect(isAcceptedImageType("image/jpeg")).toBe(true);
    expect(isAcceptedImageType("image/jpg")).toBe(true);
    expect(isAcceptedImageType("image/webp")).toBe(true);
  });

  it("rejects HEIC and other image/* types", () => {
    expect(isAcceptedImageType("image/heic")).toBe(false);
    expect(isAcceptedImageType("image/heif")).toBe(false);
    expect(isAcceptedImageType("image/gif")).toBe(false);
    expect(isAcceptedImageType("image/svg+xml")).toBe(false);
  });

  it("rejects empty or non-image types", () => {
    expect(isAcceptedImageType("")).toBe(false);
    expect(isAcceptedImageType("application/pdf")).toBe(false);
  });
});
