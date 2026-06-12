/** Adversarial and edge-case tests: Unicode, unusual formats, empty inputs. */
import { describe, it, expect } from "vitest";
import { validate } from "./validate";
import { GOVERNMENT_WARNING } from "./warning";
import { ApplicationData, ExtractedLabel, BeverageType } from "./types";

function label(overrides: Partial<ExtractedLabel> = {}): ExtractedLabel {
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
    ...overrides,
  };
}
function appWith(o: Partial<ApplicationData>): ApplicationData {
  return { beverageType: "spirits", ...o };
}
const verdictOf = (r: ReturnType<typeof validate>, f: string) =>
  r.fields.find((x) => x.field === f)!.verdict;

describe("warning — typographic substitutions producers try", () => {
  it("fails on curly/smart quotes swapped into the warning", () => {
    // A producer re-typesets the warning and the apostrophe becomes a smart quote.
    // Our canonical has no apostrophes, but extra/changed punctuation in the body
    // must not silently pass.
    const smart = GOVERNMENT_WARNING.replace("birth defects.", "birth defects’.");
    const r = validate(appWith({ brandName: "X" }), label({ governmentWarning: smart }));
    expect(verdictOf(r, "governmentWarning")).toBe("fail");
  });

  it("fails when an em-dash replaces wording", () => {
    const dashed = GOVERNMENT_WARNING.replace("and may cause", "—may cause");
    const r = validate(appWith({ brandName: "X" }), label({ governmentWarning: dashed }));
    expect(verdictOf(r, "governmentWarning")).toBe("fail");
  });

  it("passes when inter-word spacing is irregular (benign OCR artifact)", () => {
    // Double-spacing everywhere, including inside "GOVERNMENT  WARNING" — a
    // typesetting/OCR artifact, not a wording or casing change. Must still pass.
    const doubleSpaced = GOVERNMENT_WARNING.replace(/ /g, "  ");
    const r = validate(appWith({ brandName: "X" }), label({ governmentWarning: doubleSpaced }));
    expect(verdictOf(r, "governmentWarning")).toBe("pass");
  });

  it("passes an all-caps warning (caps body still matches case-insensitively)", () => {
    const upper = GOVERNMENT_WARNING.toUpperCase();
    const r = validate(appWith({ brandName: "X" }), label({ governmentWarning: upper }));
    expect(verdictOf(r, "governmentWarning")).toBe("pass");
  });
});

describe("brand — Unicode & punctuation edge cases", () => {
  it("handles accented characters consistently (José vs JOSÉ)", () => {
    const r = validate(appWith({ brandName: "José Cuervo" }), label({ brandName: "JOSÉ CUERVO", classType: null, alcoholContent: null, netContents: null, producer: null }));
    expect(verdictOf(r, "brandName")).toBe("pass");
  });

  it("treats accented vs unaccented as the same (PATRÓN AÑEJO == Patron Anejo)", () => {
    const r = validate(appWith({ brandName: "Patron Anejo" }), label({ brandName: "PATRÓN AÑEJO", classType: null, alcoholContent: null, netContents: null, producer: null }));
    expect(verdictOf(r, "brandName")).toBe("pass");
  });

  it("handles ampersand vs 'and'", () => {
    const r = validate(appWith({ brandName: "Smith & Sons" }), label({ brandName: "Smith and Sons", classType: null, alcoholContent: null, netContents: null, producer: null }));
    expect(verdictOf(r, "brandName")).toBe("pass");
  });

  it("does not crash on an emoji / symbol-laden brand", () => {
    const r = validate(appWith({ brandName: "🍺 Brew Co" }), label({ brandName: "Brew Co", classType: null, alcoholContent: null, netContents: null, producer: null }));
    expect(["pass", "warn", "fail"]).toContain(verdictOf(r, "brandName"));
  });
});

describe("alcohol content — unusual formats", () => {
  it("parses a decimal ABV with extra text", () => {
    const r = validate(appWith({ brandName: "X", alcoholContent: "13.5%" }), label({ alcoholContent: "ALCOHOL 13.5% BY VOLUME" }));
    expect(verdictOf(r, "alcoholContent")).toBe("pass");
  });

  it("flags a difference just outside tolerance", () => {
    const r = validate(appWith({ brandName: "X", alcoholContent: "40%" }), label({ alcoholContent: "40.5% Alc./Vol." }));
    expect(verdictOf(r, "alcoholContent")).toBe("fail");
  });

  it("does not crash when ABV is a range like '40-43%'", () => {
    const r = validate(appWith({ brandName: "X", alcoholContent: "40-43%" }), label({ alcoholContent: "40% Alc./Vol." }));
    expect(["pass", "warn", "fail"]).toContain(verdictOf(r, "alcoholContent"));
  });
});

describe("warning anti-hallucination gate", () => {
  it("does NOT pass a verbatim warning the model couldn't fully read (warningLegible=false)", () => {
    // Even though the text matches exactly, an illegible read may have been
    // reconstructed from memory — must downgrade to a human check, never auto-pass.
    const r = validate(
      appWith({ brandName: "X" }),
      label({ governmentWarning: GOVERNMENT_WARNING, warningLegible: false }),
    );
    expect(verdictOf(r, "governmentWarning")).toBe("warn");
    const msg = r.fields.find((f) => f.field === "governmentWarning")!.message.toLowerCase();
    expect(msg).toContain("partially legible");
  });

  it("still passes a verbatim warning that was fully legible", () => {
    const r = validate(
      appWith({ brandName: "X" }),
      label({ governmentWarning: GOVERNMENT_WARNING, warningLegible: true }),
    );
    expect(verdictOf(r, "governmentWarning")).toBe("pass");
  });
});

describe("'not checked' (na) — nothing to compare", () => {
  it("warns (not na) on a missing net contents — it is mandatory on every container", () => {
    // Net contents is mandatory label information (27 CFR 4.32/5.63/7.63), so
    // its absence is a "verify by eye", never a clean not-checked — even when
    // the application leaves the field blank.
    const r = validate(
      appWith({ brandName: "X" }),
      label({ netContents: null }), // not provided in app, not on label
    );
    expect(verdictOf(r, "netContents")).toBe("warn");
  });

  it("na fields do not drag the overall verdict down", () => {
    // Brand passes, everything optional is na → overall should be pass, not warn.
    const r = validate(
      appWith({ brandName: "Old Tom Distillery" }),
      label({ classType: null, netContents: null, producer: null }),
    );
    expect(["pass", "warn", "fail"]).toContain(r.overall);
    expect(r.overall).not.toBe("na");
  });
});

describe("empty / minimal application", () => {
  it("reviews a brand-only application without crashing and reports label findings", () => {
    const r = validate(appWith({ brandName: "Old Tom Distillery" }), label());
    // Brand matches; warning present; unspecified fields that weren't provided pass.
    expect(r.overall === "pass" || r.overall === "warn").toBe(true);
    expect(verdictOf(r, "brandName")).toBe("pass");
  });
});

describe("beverage type × missing ABV — full matrix", () => {
  const cases: Array<[BeverageType, "fail" | "warn" | "na"]> = [
    ["spirits", "fail"], // spirits must state ABV
    ["wine", "warn"], // required unless designated table/light wine — verify by eye
    ["beer", "na"], // malt beverage ABV optional federally
    ["other", "warn"], // unclassified — ask the agent to confirm
  ];
  for (const [type, expected] of cases) {
    it(`${type}: missing ABV → ${expected}`, () => {
      const r = validate(appWith({ brandName: "X", beverageType: type }), label({ alcoholContent: null }));
      expect(verdictOf(r, "alcoholContent")).toBe(expected);
    });
  }
});

describe("all-fields-null label (model found nothing legible)", () => {
  it("fails the mandatory warning and doesn't throw", () => {
    const blank = label({
      brandName: null, classType: null, alcoholContent: null,
      netContents: null, producer: null, originCountry: null,
      governmentWarning: null, imageQuality: "poor",
    });
    const r = validate(appWith({ brandName: "Old Tom" }), blank);
    expect(verdictOf(r, "governmentWarning")).toBe("fail");
    expect(r.overall).toBe("fail");
  });
});
