/** Tests for the validation engine. Covers fuzzy matching and strict warning rules. */
import { describe, it, expect } from "vitest";
import { validate } from "./validate";
import { GOVERNMENT_WARNING } from "./warning";
import { ApplicationData, ExtractedLabel } from "./types";

/** Build a fully-compliant label, then override fields per test. */
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

const app: ApplicationData = {
  brandName: "Old Tom Distillery",
  beverageType: "spirits",
  classType: "Kentucky Straight Bourbon Whiskey",
  alcoholContent: "45% Alc./Vol. (90 Proof)",
  netContents: "750 mL",
  producer: "Old Tom Distillery, Bardstown, KY",
};

/** Minimal application with just the fields a test cares about (type defaults to spirits). */
function appWith(overrides: Partial<ApplicationData>): ApplicationData {
  return { beverageType: "spirits", ...overrides };
}

const verdictOf = (r: ReturnType<typeof validate>, field: string) =>
  r.fields.find((f) => f.field === field)!.verdict;

describe("happy path", () => {
  it("passes a fully compliant label", () => {
    const r = validate(app, label());
    expect(r.overall).toBe("pass");
  });
});

describe("brand name — fuzzy identity", () => {
  it("treats STONE'S THROW vs Stone's Throw as a pass", () => {
    const r = validate(appWith({ brandName: "STONE'S THROW" }), label({ brandName: "Stone's Throw", classType: null, alcoholContent: null, netContents: null, producer: null }));
    expect(verdictOf(r, "brandName")).toBe("pass");
  });

  it("ignores trailing/leading whitespace and case", () => {
    const r = validate(appWith({ brandName: "  old tom DISTILLERY " }), label());
    expect(verdictOf(r, "brandName")).toBe("pass");
  });

  it("warns (not fails) on a likely typo", () => {
    const r = validate(appWith({ brandName: "Old Tom Distillerie" }), label());
    expect(verdictOf(r, "brandName")).toBe("warn");
  });

  it("fails on a genuinely different brand", () => {
    const r = validate(appWith({ brandName: "Wild Turkey" }), label());
    expect(verdictOf(r, "brandName")).toBe("fail");
  });

  it("fails when the brand is missing from the label", () => {
    const r = validate(appWith({ brandName: "Old Tom Distillery" }), label({ brandName: null }));
    expect(verdictOf(r, "brandName")).toBe("fail");
  });
});

describe("alcohol content — numeric + proof consistency", () => {
  it("matches equal ABV regardless of formatting", () => {
    const r = validate(appWith({ brandName: app.brandName, alcoholContent: "45%" }), label({ alcoholContent: "45.0% ALC/VOL" }));
    expect(verdictOf(r, "alcoholContent")).toBe("pass");
  });

  it("matches a bare application number against a formatted label ABV", () => {
    // Agents type just "10.5" in the application; the label reads "10.5% ALC/VOL".
    // These are the same ABV and must pass (regression: used to fail as a mismatch).
    const r = validate(appWith({ brandName: app.brandName, alcoholContent: "10.5" }), label({ alcoholContent: "10.5% ALC/VOL" }));
    expect(verdictOf(r, "alcoholContent")).toBe("pass");
  });

  it("reads an ABV stated without a % sign next to an ABV cue", () => {
    const r = validate(appWith({ brandName: app.brandName, alcoholContent: "12" }), label({ alcoholContent: "ALC 12 BY VOL" }));
    expect(verdictOf(r, "alcoholContent")).toBe("pass");
  });

  it("still fails a real difference even with bare numbers", () => {
    const r = validate(appWith({ brandName: app.brandName, alcoholContent: "10.5" }), label({ alcoholContent: "40% ALC/VOL" }));
    expect(verdictOf(r, "alcoholContent")).toBe("fail");
  });

  it("fails on a real ABV difference", () => {
    const r = validate(appWith({ brandName: app.brandName, alcoholContent: "40%" }), label({ alcoholContent: "45% Alc./Vol." }));
    expect(verdictOf(r, "alcoholContent")).toBe("fail");
  });

  it("warns when proof is inconsistent with ABV", () => {
    const r = validate(appWith({ brandName: app.brandName, alcoholContent: "45%" }), label({ alcoholContent: "45% Alc./Vol. (80 Proof)" }));
    expect(verdictOf(r, "alcoholContent")).toBe("warn");
  });
});

describe("beverage type cross-check", () => {
  it("warns when the selected type conflicts with the label (spirits selected, label is a wine)", () => {
    const r = validate(
      appWith({ brandName: "X", beverageType: "spirits" }),
      label({ classType: "Cabernet Sauvignon", brandName: "X" }),
    );
    expect(verdictOf(r, "beverageType")).toBe("warn");
  });

  it("passes when the selected type matches the label", () => {
    const r = validate(
      appWith({ brandName: "X", beverageType: "wine" }),
      label({ classType: "Pinot Noir", brandName: "X" }),
    );
    expect(verdictOf(r, "beverageType")).toBe("pass");
  });

  it("stays silent (na) when the type can't be inferred from the label", () => {
    const r = validate(
      appWith({ brandName: "X", beverageType: "spirits" }),
      label({ classType: null, brandName: "Acme" }),
    );
    expect(verdictOf(r, "beverageType")).toBe("na");
  });

  it("auto: reports the detected type (pass, informational)", () => {
    const r = validate(
      appWith({ brandName: "X", beverageType: "auto" }),
      label({ classType: "Pinot Noir", brandName: "X" }),
    );
    expect(verdictOf(r, "beverageType")).toBe("pass");
  });

  it("auto: a wine detected from the label makes a missing ABV a warn (not a spirits fail)", () => {
    // Auto mode: missing ABV on wine must not fail like spirits — but a bare
    // "Chardonnay" with no ABV and no table/light designation is short of
    // 27 CFR 4.36, so it warns instead of passing silently.
    const r = validate(
      appWith({ brandName: "X", beverageType: "auto", alcoholContent: undefined }),
      label({ classType: "Chardonnay", alcoholContent: null, brandName: "X" }),
    );
    expect(verdictOf(r, "alcoholContent")).toBe("warn");
  });

  it("does not hard-fail a type mismatch (warn, never fail)", () => {
    const r = validate(
      appWith({ brandName: "X", beverageType: "beer" }),
      label({ classType: "Vodka", brandName: "X" }),
    );
    expect(verdictOf(r, "beverageType")).not.toBe("fail");
  });

  it("does NOT read a colour word in the brand as a wine type (White Claw ≠ white wine)", () => {
    // Regression: "white" in the brand used to match the wine keywords. Inference
    // is class/type only now, and "Hard Seltzer" isn't one of the three classes.
    const r = validate(
      appWith({ brandName: "White Claw", beverageType: "auto" }),
      label({ brandName: "White Claw", classType: "Hard Seltzer" }),
    );
    expect(verdictOf(r, "beverageType")).toBe("na"); // not confidently detected
  });

  it("uses the AI's beverageType when present (more reliable than keywords)", () => {
    // Label class text is ambiguous, but the model read it as wine.
    const r = validate(
      appWith({ brandName: "X", beverageType: "auto" }),
      label({ classType: "Reserve Selection", beverageType: "wine", brandName: "X" }),
    );
    expect(verdictOf(r, "beverageType")).toBe("pass");
  });

  it("detects 'other' (hard seltzer) from the AI and doesn't force a spirits-style ABV fail", () => {
    const r = validate(
      appWith({ brandName: "White Claw", beverageType: "auto", alcoholContent: undefined }),
      label({ brandName: "White Claw", classType: "Hard Seltzer", beverageType: "other", alcoholContent: null }),
    );
    expect(verdictOf(r, "beverageType")).toBe("pass"); // detected as "other"
    // "other" neither forces nor exempts ABV → asks the agent to confirm, not a fail.
    expect(verdictOf(r, "alcoholContent")).not.toBe("fail");
  });

  it("falls back to keyword inference when the AI returned no type", () => {
    const r = validate(
      appWith({ brandName: "X", beverageType: "auto" }),
      label({ classType: "Cabernet Sauvignon", beverageType: null, brandName: "X" }),
    );
    expect(verdictOf(r, "beverageType")).toBe("pass");
  });

  it("stays 'not checked' when there's no class/type to infer from", () => {
    const r = validate(
      appWith({ brandName: "Curious Beasts", beverageType: "auto" }),
      label({ brandName: "Curious Beasts", classType: null }),
    );
    expect(verdictOf(r, "beverageType")).toBe("na");
  });
});

describe("net contents", () => {
  it("normalizes 750 mL / 750ml / 750 ML", () => {
    const r = validate(appWith({ brandName: app.brandName, netContents: "750ml" }), label({ netContents: "750 ML" }));
    expect(verdictOf(r, "netContents")).toBe("pass");
  });

  it("matches equal volumes across units (750 mL = 0.75 L)", () => {
    const r = validate(appWith({ brandName: app.brandName, netContents: "0.75 L" }), label({ netContents: "750 mL" }));
    expect(verdictOf(r, "netContents")).toBe("pass");
  });

  it("matches 1 L = 1000 mL and 75 cL = 750 mL", () => {
    const a = validate(appWith({ brandName: app.brandName, netContents: "1 L" }), label({ netContents: "1000 mL" }));
    expect(verdictOf(a, "netContents")).toBe("pass");
    const b = validate(appWith({ brandName: app.brandName, netContents: "75 cL" }), label({ netContents: "750 mL" }));
    expect(verdictOf(b, "netContents")).toBe("pass");
  });

  it("matches a bare application number against a unit'd label (750 = 750 mL)", () => {
    const r = validate(appWith({ brandName: app.brandName, netContents: "750" }), label({ netContents: "750 mL" }));
    expect(verdictOf(r, "netContents")).toBe("pass");
  });

  it("fails a real volume difference (750 mL vs 1 L)", () => {
    const r = validate(appWith({ brandName: app.brandName, netContents: "750 mL" }), label({ netContents: "1 L" }));
    expect(verdictOf(r, "netContents")).toBe("fail");
  });
});

describe("government warning — strict", () => {
  it("passes the verbatim warning", () => {
    const r = validate(appWith({ brandName: app.brandName }), label());
    expect(verdictOf(r, "governmentWarning")).toBe("pass");
  });

  it("tolerates OCR line-break / whitespace differences", () => {
    const wrapped = GOVERNMENT_WARNING.replace(/ /g, (m, i) => (i % 40 === 0 ? "\n" : " "));
    const r = validate(appWith({ brandName: app.brandName }), label({ governmentWarning: wrapped }));
    expect(verdictOf(r, "governmentWarning")).toBe("pass");
  });

  it("FAILS when GOVERNMENT WARNING lacks a colon after the heading", () => {
    const noColon = GOVERNMENT_WARNING.replace("GOVERNMENT WARNING:", "GOVERNMENT WARNING");
    const r = validate(appWith({ brandName: app.brandName }), label({ governmentWarning: noColon }));
    expect(verdictOf(r, "governmentWarning")).toBe("fail");
    const msg = r.fields.find((f) => f.field === "governmentWarning")!.message.toLowerCase();
    expect(msg).toContain("colon");
  });

  it("FAILS when both heading and wording differ", () => {
    const bad = "Government Warning: This is not the federal statement at all.";
    const r = validate(appWith({ brandName: app.brandName }), label({ governmentWarning: bad }));
    expect(verdictOf(r, "governmentWarning")).toBe("fail");
    const msg = r.fields.find((f) => f.field === "governmentWarning")!.message;
    expect(msg).toContain("Both the heading capitalization and the wording differ");
  });

  it("FAILS when GOVERNMENT WARNING is title-case", () => {
    const titleCase = GOVERNMENT_WARNING.replace("GOVERNMENT WARNING:", "Government Warning:");
    const r = validate(appWith({ brandName: app.brandName }), label({ governmentWarning: titleCase }));
    expect(verdictOf(r, "governmentWarning")).toBe("fail");
  });

  it("fails when wording is paraphrased", () => {
    const paraphrased =
      "GOVERNMENT WARNING: (1) Pregnant women should avoid alcohol. (2) Alcohol impairs driving and may cause health problems.";
    const r = validate(appWith({ brandName: app.brandName }), label({ governmentWarning: paraphrased }));
    expect(verdictOf(r, "governmentWarning")).toBe("fail");
  });

  it("fails when the warning is missing entirely", () => {
    const r = validate(appWith({ brandName: app.brandName }), label({ governmentWarning: null }));
    expect(verdictOf(r, "governmentWarning")).toBe("fail");
  });

  it("frames a missing warning as a photo problem (not non-compliance) when the warning isn't in frame", () => {
    // The warning is usually on a back/side panel; a missing one most often means
    // it wasn't photographed, not that the product is non-compliant.
    const r = validate(appWith({ brandName: app.brandName }), label({ governmentWarning: null }));
    const msg = r.fields.find((f) => f.field === "governmentWarning")!.message.toLowerCase();
    expect(msg).toContain("in frame");
  });

  it("on a poor-quality photo, attributes a missing warning to legibility", () => {
    const r = validate(
      appWith({ brandName: app.brandName }),
      label({ governmentWarning: null, imageQuality: "poor" }),
    );
    const msg = r.fields.find((f) => f.field === "governmentWarning")!.message.toLowerCase();
    expect(msg).toContain("hard to read");
  });

  it("still passes when surrounding label text precedes the warning", () => {
    // Real labels print other text near the warning; the matcher should locate
    // the warning and judge it, not be thrown off by preceding copy.
    const withLead = "Please enjoy responsibly. " + GOVERNMENT_WARNING;
    const r = validate(appWith({ brandName: app.brandName }), label({ governmentWarning: withLead }));
    expect(verdictOf(r, "governmentWarning")).toBe("pass");
  });

  it("still passes when unrelated copy follows the complete warning", () => {
    // Real labels routinely print "Please recycle", a URL, or "Drink Responsibly"
    // right after the mandatory statement (e.g. Drambuie: "DRINK RESPONSIBLY.
    // GOVERNMENT WARNING: …"). 27 CFR 16.21 requires the warning to appear
    // verbatim — it does not forbid other text around it. As long as the full
    // federal statement is present intact, trailing copy must not fail the label.
    const withTrailer = GOVERNMENT_WARNING + " Drink responsibly and in moderation only.";
    const r = validate(appWith({ brandName: app.brandName }), label({ governmentWarning: withTrailer }));
    expect(verdictOf(r, "governmentWarning")).toBe("pass");
  });

  it("tolerates OCR punctuation/numeral noise but not word changes", () => {
    // The body must match word-for-word, but pure transcription artifacts the
    // model produces on small print — "[1]" for "(1)", a missing period after
    // "defects", a line-wrap hyphen — are not wording violations and must pass.
    const ocrNoise =
      "GOVERNMENT WARNING: [1] According to the Surgeon General, women should not " +
      "drink alcoholic beverages during pregnancy because of the risk of birth " +
      "defects [2] Consumption of alcoholic beverages impairs your ability to " +
      "drive a car or operate machinery, and may cause health problems.";
    const ok = validate(appWith({ brandName: app.brandName }), label({ governmentWarning: ocrNoise }));
    expect(verdictOf(ok, "governmentWarning")).toBe("pass");

    // But a real word substitution ("alcohol" for "alcoholic beverages") still fails.
    const wordChange = GOVERNMENT_WARNING.replace("Consumption of alcoholic beverages", "Consumption of alcohol");
    const bad = validate(appWith({ brandName: app.brandName }), label({ governmentWarning: wordChange }));
    expect(verdictOf(bad, "governmentWarning")).toBe("fail");
  });

  it("tolerates roman-numeral misreads of the list markers", () => {
    // Observed on a slanted bottle photo (eval IMG_6336): the label prints
    // "(1)"/"(2)" but the model transcribes the tiny numerals as "(i)"/"(ii)".
    // The words themselves are verbatim, so this is marker noise, not a
    // wording change — same class as "[1]" for "(1)".
    const roman = GOVERNMENT_WARNING.replace("(1)", "(i)").replace("(2)", "(ii)");
    const r = validate(appWith({ brandName: app.brandName }), label({ governmentWarning: roman }));
    expect(verdictOf(r, "governmentWarning")).toBe("pass");

    // The tolerance is markers-only: roman markers plus dropped words still fail.
    const romanMissingWords = roman.replace("during pregnancy ", "");
    const bad = validate(appWith({ brandName: app.brandName }), label({ governmentWarning: romanMissingWords }));
    expect(verdictOf(bad, "governmentWarning")).toBe("fail");
  });

  it("fails when a clause is dropped", () => {
    const oneClause =
      "GOVERNMENT WARNING: (1) According to the Surgeon General, women should not drink alcoholic beverages during pregnancy because of the risk of birth defects.";
    const r = validate(appWith({ brandName: app.brandName }), label({ governmentWarning: oneClause }));
    expect(verdictOf(r, "governmentWarning")).toBe("fail");
  });

  it("pinpoints the exact altered word in the fail message", () => {
    // "alcoholic beverages" → "alcohol": the message should name the diverging word
    // so the agent doesn't re-read the whole paragraph.
    const altered = GOVERNMENT_WARNING.replace(
      "women should not drink alcoholic beverages during",
      "women should not drink alcohol during",
    );
    const r = validate(appWith({ brandName: app.brandName }), label({ governmentWarning: altered }));
    const msg = r.fields.find((f) => f.field === "governmentWarning")!.message;
    expect(verdictOf(r, "governmentWarning")).toBe("fail");
    expect(msg).toContain("alcoholic"); // the expected word
    expect(msg).toContain("alcohol"); // what the label showed
    expect(msg.toLowerCase()).toContain("difference");
  });
});

describe("beverage type changes ABV requirements", () => {
  it("FAILS missing ABV for spirits", () => {
    const r = validate(appWith({ brandName: app.brandName, beverageType: "spirits" }), label({ alcoholContent: null }));
    expect(verdictOf(r, "alcoholContent")).toBe("fail");
  });

  it("warns on missing ABV for wine without a table/light designation", () => {
    // Wine may omit ABV only when "table wine"/"light wine" appears on the
    // label (27 CFR 4.36(a)); with no designation the omission needs eyes.
    const r = validate(appWith({ brandName: app.brandName, beverageType: "wine" }), label({ alcoholContent: null }));
    expect(verdictOf(r, "alcoholContent")).toBe("warn");
  });

  it("only marks missing ABV as not-checked for beer", () => {
    const r = validate(appWith({ brandName: app.brandName, beverageType: "beer" }), label({ alcoholContent: null }));
    expect(verdictOf(r, "alcoholContent")).toBe("na");
  });

  it("allows table wine to omit ABV", () => {
    const r = validate(
      appWith({ brandName: "X", beverageType: "wine" }),
      label({ classType: "California Table Wine", alcoholContent: null }),
    );
    expect(verdictOf(r, "alcoholContent")).toBe("na");
  });

  it("WARNs in batch when wine omits ABV without a table/light designation", () => {
    const r = validate(
      appWith({ brandName: undefined, beverageType: "auto" }),
      label({ classType: "Chardonnay", beverageType: "wine", alcoholContent: null }),
      { labelOnly: true },
    );
    expect(verdictOf(r, "alcoholContent")).toBe("warn");
  });

  it("FAILS in batch when fortified wine omits ABV", () => {
    const r = validate(
      appWith({ brandName: undefined, beverageType: "auto" }),
      label({ classType: "Ruby Port", beverageType: "wine", alcoholContent: null }),
      { labelOnly: true },
    );
    expect(verdictOf(r, "alcoholContent")).toBe("fail");
  });
});

describe("ABV — TTB tolerances by beverage type", () => {
  it("spirits: passes within ±0.3% (27 CFR 5.66)", () => {
    const r = validate(
      appWith({ brandName: "X", beverageType: "spirits", alcoholContent: "40%" }),
      label({ alcoholContent: "40.2% Alc./Vol." }),
    );
    expect(verdictOf(r, "alcoholContent")).toBe("pass");
  });

  it("spirits: fails outside ±0.3%", () => {
    const r = validate(
      appWith({ brandName: "X", beverageType: "spirits", alcoholContent: "40%" }),
      label({ alcoholContent: "40.5% Alc./Vol." }),
    );
    expect(verdictOf(r, "alcoholContent")).toBe("fail");
  });

  it("wine ≤14%: passes within ±1.5%", () => {
    const r = validate(
      appWith({ brandName: "X", beverageType: "wine", alcoholContent: "12%" }),
      label({ alcoholContent: "13.4% Alc./Vol." }),
    );
    expect(verdictOf(r, "alcoholContent")).toBe("pass");
  });

  it("wine >14%: passes within ±1%", () => {
    const r = validate(
      appWith({ brandName: "X", beverageType: "wine", alcoholContent: "15%" }),
      label({ alcoholContent: "15.9% Alc./Vol." }),
    );
    expect(verdictOf(r, "alcoholContent")).toBe("pass");
  });

  it("wine >14%: fails outside ±1%", () => {
    const r = validate(
      appWith({ brandName: "X", beverageType: "wine", alcoholContent: "15%" }),
      label({ alcoholContent: "16.2% Alc./Vol." }),
    );
    expect(verdictOf(r, "alcoholContent")).toBe("fail");
  });

  it("beer: passes within ±0.3% when stated (27 CFR 7.65)", () => {
    const r = validate(
      appWith({ brandName: "X", beverageType: "beer", alcoholContent: "5.0%" }),
      label({ alcoholContent: "5.2% Alc./Vol." }),
    );
    expect(verdictOf(r, "alcoholContent")).toBe("pass");
  });

  it("matches application value inside a label range", () => {
    const r = validate(
      appWith({ brandName: "X", beverageType: "wine", alcoholContent: "13%" }),
      label({ alcoholContent: "12% to 14% Alc./Vol." }),
    );
    expect(verdictOf(r, "alcoholContent")).toBe("pass");
  });

  it("fails when application value is outside a label range", () => {
    const r = validate(
      appWith({ brandName: "X", beverageType: "wine", alcoholContent: "15%" }),
      label({ alcoholContent: "12% to 14% Alc./Vol." }),
    );
    expect(verdictOf(r, "alcoholContent")).toBe("fail");
  });
});

describe("producer — ignores regulatory lead-in phrases", () => {
  it("matches 'Distilled and Bottled by X' against 'X'", () => {
    const r = validate(
      appWith({ brandName: app.brandName, producer: "Old Tom Distillery, Bardstown, KY" }),
      label({ producer: "Distilled and Bottled by Old Tom Distillery, Bardstown, KY" }),
    );
    expect(verdictOf(r, "producer")).toBe("pass");
  });

  it("still fails a genuinely different producer", () => {
    const r = validate(
      appWith({ brandName: app.brandName, producer: "Old Tom Distillery, Bardstown, KY" }),
      label({ producer: "Bottled by Wild Turkey Distilling, Lawrenceburg, KY" }),
    );
    expect(verdictOf(r, "producer")).toBe("fail");
  });
});

describe("country of origin (imports)", () => {
  it("passes a matching origin", () => {
    const r = validate(appWith({ brandName: app.brandName, originCountry: "Scotland" }), label({ originCountry: "Product of Scotland" }));
    expect(verdictOf(r, "originCountry")).toBe("pass");
  });

  it("fails a mismatched origin", () => {
    const r = validate(appWith({ brandName: app.brandName, originCountry: "Scotland" }), label({ originCountry: "Product of Ireland" }));
    expect(verdictOf(r, "originCountry")).toBe("fail");
  });

  describe("a found origin must actually read as one (no pass on mere presence)", () => {
    // Real bug: the extractor routed the class line "AGAVE WINE WITH NATURAL
    // FLAVORS" into the origin field on an imported margarita, and the field
    // passed as "label shows country of origin". Presence is not a declaration.
    it("WARNS when junk origin text meets an imported-looking label", () => {
      // "Imported & bottled by …" makes this an import; the origin field holding
      // a class line instead of a country is then worth a human look.
      const r = validate(
        appWith({ brandName: app.brandName }),
        label({
          originCountry: "AGAVE WINE WITH NATURAL FLAVORS",
          producer: "Imported & bottled by Sebastiani Next Episode, Napa, California",
        }),
      );
      expect(verdictOf(r, "originCountry")).toBe("warn");
    });

    it("stays quiet (na) on domestic appellation text in the origin field", () => {
      // "California Rosé Wine" / "2022 Washington State" are appellations, not
      // origin claims — origin is only required for imports, so flagging every
      // domestic label for review would be noise.
      const rose = validate(appWith({ brandName: app.brandName }), label({ originCountry: "California Rosé Wine" }));
      expect(verdictOf(rose, "originCountry")).toBe("na");

      const wa = validate(appWith({ brandName: app.brandName }), label({ originCountry: "2022 Washington State" }));
      expect(verdictOf(wa, "originCountry")).toBe("na");
    });

    it("does not read domestic appellation origin text as an import cue in batch", () => {
      const r = validate({ beverageType: "wine" }, label({ originCountry: "California Rosé Wine" }), { labelOnly: true });
      expect(["na", "pass"]).toContain(verdictOf(r, "originCountry"));
    });

    it("still passes a real origin statement, diacritics included ('Hecho en México')", () => {
      const r = validate(appWith({ brandName: app.brandName }), label({ originCountry: "Hecho en México" }));
      expect(["pass", "na"]).toContain(verdictOf(r, "originCountry"));
    });

    it("accepts 'Product of …' framing for a country outside the known list", () => {
      const r = validate({ beverageType: "other" }, label({ originCountry: "Product of Fiji" }), { labelOnly: true });
      expect(verdictOf(r, "originCountry")).toBe("pass");
    });
  });
});

describe("overall verdict aggregation", () => {
  it("is fail if any field fails", () => {
    const r = validate(app, label({ governmentWarning: null }));
    expect(r.overall).toBe("fail");
  });

  it("is warn if the worst field is a warn", () => {
    const r = validate({ ...app, brandName: "Old Tom Distillerie" }, label());
    expect(r.overall).toBe("warn");
  });
});

/** Regression tests for false-pass and false-fail cases found during review. */
describe("edge cases — regressions", () => {
  describe("net contents must compare by volume, not string", () => {
    it("FAILS an unknown/garbage unit instead of silently treating it as mL (no false pass)", () => {
      // "750" (→750 mL) vs "750 gallon" must NOT pass as equal.
      const r = validate(appWith({ brandName: "X", netContents: "750" }), label({ netContents: "750 gallon" }));
      expect(verdictOf(r, "netContents")).toBe("fail");
    });
    it("converts US units: 1 pint ≈ 473 mL", () => {
      const r = validate(appWith({ brandName: "X", netContents: "1 pint" }), label({ netContents: "473 mL" }));
      expect(verdictOf(r, "netContents")).toBe("pass");
    });
  });

  describe("origin compares whole countries, not substrings", () => {
    it("does NOT pass 'US' against 'Product of Russia' (no false pass)", () => {
      const r = validate(appWith({ brandName: "X", originCountry: "US" }), label({ originCountry: "Product of Russia" }));
      expect(verdictOf(r, "originCountry")).toBe("fail");
    });
    it("does NOT pass 'Mexico' against 'New Mexico, USA' (no false pass)", () => {
      const r = validate(appWith({ brandName: "X", originCountry: "Mexico" }), label({ originCountry: "New Mexico, USA" }));
      expect(verdictOf(r, "originCountry")).toBe("fail");
    });
    it("still matches the legitimate framing: 'Scotland' vs 'Product of Scotland'", () => {
      const r = validate(appWith({ brandName: "X", originCountry: "Scotland" }), label({ originCountry: "Product of Scotland" }));
      expect(verdictOf(r, "originCountry")).toBe("pass");
    });
    it("treats US synonyms as equal: 'USA' vs 'United States'", () => {
      const r = validate(appWith({ brandName: "X", originCountry: "USA" }), label({ originCountry: "United States" }));
      expect(verdictOf(r, "originCountry")).toBe("pass");
    });
  });

  describe("identity must not match two empty-after-normalization values", () => {
    it("does NOT pass '---' against '!!!' (both normalize to empty — no false pass)", () => {
      const r = validate(appWith({ brandName: "---" }), label({ brandName: "!!!" }));
      expect(verdictOf(r, "brandName")).toBe("fail");
    });
  });

  describe("ABV parsing robustness", () => {
    it("converts proof-only labels: spirits app '45' vs label '90 Proof'", () => {
      const r = validate(appWith({ brandName: "X", beverageType: "spirits", alcoholContent: "45" }), label({ alcoholContent: "90 Proof" }));
      expect(verdictOf(r, "alcoholContent")).toBe("pass");
    });
    it("ignores a stray year next to a cue: '13' vs 'Vintage 2021 ALC 13 VOL'", () => {
      const r = validate(appWith({ brandName: "X", alcoholContent: "13" }), label({ alcoholContent: "Vintage 2021 ALC 13 VOL" }));
      expect(verdictOf(r, "alcoholContent")).toBe("pass");
    });
    it("reads a range to its midpoint: '6' vs '5-7% ALC/VOL'", () => {
      const r = validate(appWith({ brandName: "X", alcoholContent: "6" }), label({ alcoholContent: "5-7% ALC/VOL" }));
      expect(verdictOf(r, "alcoholContent")).toBe("pass");
    });
    it("reads the word 'percent': '12.5 percent' vs '12.5% ABV'", () => {
      const r = validate(appWith({ brandName: "X", alcoholContent: "12.5 percent" }), label({ alcoholContent: "12.5% ABV" }));
      expect(verdictOf(r, "alcoholContent")).toBe("pass");
    });
  });

  describe("label-only (batch) mode", () => {
    const batchApp = appWith({ brandName: undefined, classType: undefined });

    it("FAILS when brand is missing on the label", () => {
      const r = validate(batchApp, label({ brandName: null }), { labelOnly: true });
      expect(verdictOf(r, "brandName")).toBe("fail");
    });

    it("does not fail when brand is missing in single-review mode", () => {
      const r = validate(batchApp, label({ brandName: null }), { labelOnly: false });
      expect(verdictOf(r, "brandName")).toBe("na");
    });

    it("FAILS when class is missing on the label", () => {
      const r = validate(batchApp, label({ classType: null }), { labelOnly: true });
      expect(verdictOf(r, "classType")).toBe("fail");
    });

    it("still runs the strict government-warning check", () => {
      const r = validate(batchApp, label({ governmentWarning: null }), { labelOnly: true });
      expect(verdictOf(r, "governmentWarning")).toBe("fail");
    });

    it("FAILS when net contents are missing on the label", () => {
      const r = validate(batchApp, label({ netContents: null }), { labelOnly: true });
      expect(verdictOf(r, "netContents")).toBe("fail");
    });

    it("FAILS when producer is missing on the label", () => {
      const r = validate(batchApp, label({ producer: null }), { labelOnly: true });
      expect(verdictOf(r, "producer")).toBe("fail");
    });

    it("WARNs when producer has no recognizable address", () => {
      const r = validate(batchApp, label({ producer: "Old Tom Distillery" }), { labelOnly: true });
      expect(verdictOf(r, "producer")).toBe("warn");
    });

    it("FAILS when an import shows no country of origin", () => {
      const r = validate(
        batchApp,
        label({ producer: "Imported by Euro Spirits LLC, New York, NY", originCountry: null }),
        { labelOnly: true },
      );
      expect(verdictOf(r, "originCountry")).toBe("fail");
    });

    it("passes origin when import is declared on the label", () => {
      const r = validate(
        batchApp,
        label({ producer: "Imported by Euro Spirits LLC", originCountry: "Product of France" }),
        { labelOnly: true },
      );
      expect(verdictOf(r, "originCountry")).toBe("pass");
    });
  });

  describe("producer — address heuristic", () => {
    it("warns when a matching producer omits an address", () => {
      const r = validate(
        appWith({ brandName: app.brandName, producer: "Old Tom Distillery" }),
        label({ producer: "Old Tom Distillery" }),
      );
      expect(verdictOf(r, "producer")).toBe("warn");
    });
  });

  describe("origin — import detection without application value", () => {
    it("warns in single review when the label suggests an import", () => {
      const r = validate(
        appWith({ brandName: "X" }),
        label({ producer: "Imported by Global Wines Inc., San Francisco, CA", originCountry: null }),
      );
      expect(verdictOf(r, "originCountry")).toBe("warn");
    });

    it("stays not-checked for a domestic label with no origin", () => {
      const r = validate(
        appWith({ brandName: "X" }),
        label({ producer: "Distilled and Bottled by Old Tom Distillery, Bardstown, KY", originCountry: null }),
      );
      expect(verdictOf(r, "originCountry")).toBe("na");
    });
  });

  describe("government warning de-hyphenation tries both join and split", () => {
    it("joins a line-wrapped word: 'preg-nancy' still matches verbatim", () => {
      const w = GOVERNMENT_WARNING.replace("pregnancy", "preg-nancy");
      const r = validate(appWith({ brandName: "X" }), label({ governmentWarning: w }));
      expect(verdictOf(r, "governmentWarning")).toBe("pass");
    });
    it("splits a stray hyphen between real words: 'your- ability' still matches", () => {
      const w = GOVERNMENT_WARNING.replace("your ability", "your- ability");
      const r = validate(appWith({ brandName: "X" }), label({ governmentWarning: w }));
      expect(verdictOf(r, "governmentWarning")).toBe("pass");
    });
  });
});
