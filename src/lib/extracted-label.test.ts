/**
 * Tests for coerceExtractedLabel — the guard that normalizes the model's output
 * rather than trusting it. Proves a malformed/partial/hostile response degrades
 * safely into a valid ExtractedLabel instead of propagating bad values into the
 * validator.
 */
import { describe, it, expect } from "vitest";
import { coerceExtractedLabel } from "./extracted-label";

describe("coerceExtractedLabel", () => {
  it("passes through a well-formed object", () => {
    const r = coerceExtractedLabel({
      brandName: "Old Tom",
      classType: "Bourbon",
      alcoholContent: "45%",
      netContents: "750 mL",
      producer: "Old Tom Distillery",
      originCountry: null,
      governmentWarning: "GOVERNMENT WARNING: ...",
      imageQuality: "good",
      notes: null,
    });
    expect(r.brandName).toBe("Old Tom");
    expect(r.imageQuality).toBe("good");
    expect(r.notes).toBeUndefined();
  });

  it("defaults missing fields to null, not undefined", () => {
    const r = coerceExtractedLabel({ brandName: "X" });
    expect(r.classType).toBeNull();
    expect(r.governmentWarning).toBeNull();
  });

  it("coerces a non-object (e.g. null, array, string) to an all-null label", () => {
    for (const bad of [null, undefined, "oops", 42, []]) {
      const r = coerceExtractedLabel(bad);
      expect(r.brandName).toBeNull();
      expect(r.imageQuality).toBe("fair"); // cautious default
    }
  });

  it("treats an unknown imageQuality value as 'fair' (cautious, not optimistic)", () => {
    expect(coerceExtractedLabel({ imageQuality: "perfect" }).imageQuality).toBe("fair");
    expect(coerceExtractedLabel({ imageQuality: 5 }).imageQuality).toBe("fair");
  });

  it("accepts only valid beverageType categories, else null", () => {
    expect(coerceExtractedLabel({ beverageType: "wine" }).beverageType).toBe("wine");
    expect(coerceExtractedLabel({ beverageType: "other" }).beverageType).toBe("other");
    expect(coerceExtractedLabel({ beverageType: "cider" }).beverageType).toBeNull();
    expect(coerceExtractedLabel({ beverageType: 7 }).beverageType).toBeNull();
    expect(coerceExtractedLabel({}).beverageType).toBeNull();
  });

  it("rejects wrong-typed fields rather than passing them through", () => {
    const r = coerceExtractedLabel({ brandName: 123, governmentWarning: { x: 1 } });
    expect(r.brandName).toBeNull();
    expect(r.governmentWarning).toBeNull();
  });

  it("treats empty/whitespace strings as null", () => {
    const r = coerceExtractedLabel({ brandName: "   ", classType: "" });
    expect(r.brandName).toBeNull();
    expect(r.classType).toBeNull();
  });

  it("treats 'I couldn't read this' sentinel values as null, not real text", () => {
    // The model sometimes writes a description into a field instead of returning
    // null. These must not be validated as if they were label text.
    for (const sentinel of [
      "Not clearly visible in image",
      "not visible",
      "illegible",
      "N/A",
      "unknown",
    ]) {
      expect(coerceExtractedLabel({ alcoholContent: sentinel }).alcoholContent).toBeNull();
    }
    // A real value that merely contains a normal word is kept.
    expect(coerceExtractedLabel({ alcoholContent: "40% Alc./Vol." }).alcoholContent).toBe("40% Alc./Vol.");
  });

  it("defaults warningLegible to false (fail-closed) unless explicitly true with text", () => {
    expect(coerceExtractedLabel({}).warningLegible).toBe(false);
    expect(coerceExtractedLabel({ warningLegible: true }).warningLegible).toBe(false); // no text → not legible
    expect(
      coerceExtractedLabel({ warningLegible: true, governmentWarning: "GOVERNMENT WARNING: ..." }).warningLegible,
    ).toBe(true);
    expect(
      coerceExtractedLabel({ warningLegible: false, governmentWarning: "GOVERNMENT WARNING: ..." }).warningLegible,
    ).toBe(false);
  });

  it("scrubs non-compliance clutter (barcodes) from notes, keeping the legibility caveat", () => {
    const r = coerceExtractedLabel({
      notes: "ABV not legible on lower label. Barcode visible: 8129951.",
    });
    expect(r.notes).toContain("ABV not legible");
    expect(r.notes?.toLowerCase()).not.toContain("barcode");
    expect(r.notes).not.toContain("8129951");
  });
});
