import { describe, expect, it } from "vitest";
import { fieldDisplayStatus, overallRecommendation } from "./review-status";
import { FieldResult, ReviewResult, Verdict } from "./types";

function field(verdict: Verdict, expected: string | null, found: string | null, key: FieldResult["field"] = "brandName"): FieldResult {
  return { field: key, verdict, expected, found, message: "" };
}

function review(overall: Verdict): ReviewResult {
  return { overall, fields: [], imageQuality: "good" };
}

describe("fieldDisplayStatus", () => {
  it("an exact pass is a match", () => {
    expect(fieldDisplayStatus(field("pass", "Old Tom Distillery", "Old Tom Distillery"))).toBe("match");
  });

  it("case/punctuation/format-only differences are a match, not a variation", () => {
    expect(fieldDisplayStatus(field("pass", "Stone's Throw", "STONE'S THROW"))).toBe("match");
    expect(fieldDisplayStatus(field("pass", "750 mL", "750 ML"))).toBe("match");
    expect(fieldDisplayStatus(field("pass", "Italy", "Product of Italy", "originCountry"))).toBe("match");
  });

  it("an ABV that matches in value (despite label wrapping) is a match", () => {
    expect(fieldDisplayStatus(field("pass", "14.5%", "ALC 14.5% BY VOL", "alcoholContent"))).toBe("match");
  });

  it("an ABV within tolerance but a different value is an acceptable variation", () => {
    expect(fieldDisplayStatus(field("pass", "13.5%", "ALC 14% BY VOL", "alcoholContent"))).toBe("acceptable_variation");
  });

  it("a verbatim government warning is a match (even with a placeholder expected)", () => {
    expect(fieldDisplayStatus(field("pass", "Verbatim federal warning", "GOVERNMENT WARNING: ...", "governmentWarning"))).toBe("match");
  });

  it("a field on the label the application didn't provide is 'present', not a match", () => {
    expect(fieldDisplayStatus(field("pass", null, "Kentucky Straight Bourbon", "classType"))).toBe("present");
  });

  it("a warn is a needs-review", () => {
    expect(fieldDisplayStatus(field("warn", "Ellie Rosi", "Ellie Rosé"))).toBe("needs_review");
  });

  it("a fail with a conflicting value is a mismatch", () => {
    expect(fieldDisplayStatus(field("fail", "45%", "50.5%"))).toBe("mismatch");
  });

  it("a fail with nothing on the label is missing", () => {
    expect(fieldDisplayStatus(field("fail", "x", null))).toBe("missing");
    expect(fieldDisplayStatus(field("fail", null, null))).toBe("missing");
  });

  it("an na is not-checked", () => {
    expect(fieldDisplayStatus(field("na", null, null))).toBe("not_checked");
  });
});

describe("overallRecommendation", () => {
  it("all-pass clears for approval", () => {
    const r = overallRecommendation(review("pass"));
    expect(r.key).toBe("ready");
    expect(r.title).toBe("Ready for Approval");
  });

  it("a soft finding routes to a human", () => {
    expect(overallRecommendation(review("warn")).key).toBe("review");
  });

  it("a hard failure is a likely rejection", () => {
    const r = overallRecommendation(review("fail"));
    expect(r.key).toBe("rejection");
    expect(r.tone).toBe("fail");
  });

  it("an all-unchecked review still routes to a human rather than auto-clearing", () => {
    expect(overallRecommendation(review("na")).key).toBe("review");
  });
});
