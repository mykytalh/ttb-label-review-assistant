/**
 * Field-by-field validation of an extracted label against the application.
 *
 * Each field uses the matching strictness its compliance rule calls for: brand,
 * class, and producer match fuzzily (case/punctuation/possessive insensitive);
 * alcohol content matches numerically with a tolerance; the government warning
 * must be verbatim. Every field returns one of pass, warn, or fail. See
 * docs/APPROACH.md for the rationale behind the per-field rules.
 */
import {
  ApplicationData,
  BeverageType,
  BEVERAGE_LABELS,
  ExtractedLabel,
  FieldResult,
  FIELD_LABELS,
  ReviewResult,
  Verdict,
  FieldKey,
} from "./types";
import { WARNING_BODY_NORMALIZED } from "./warning";

/**
 * Strip diacritics so "PATRÓN AÑEJO" and "Patron Anejo" compare as equal. Labels
 * often style accents the application omits.
 */
function stripDiacritics(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

function norm(s: string): string {
  return stripDiacritics(s).toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Canonicalize the warning body into a word sequence for verbatim comparison.
 *
 * Absorbs OCR rendering noise that is not a wording change (list markers like
 * "(1)"/"[1]"/"1)"/"1.", sentence punctuation, line-wrap hyphens) while leaving
 * the words themselves intact, so a genuine wording change still fails.
 *
 * The federal text contains no hyphens, so any hyphen is a line-wrap artifact.
 * A rule can't distinguish a split word ("preg-nancy" -> "pregnancy") from a
 * stray hyphen between real words ("may- cause" -> "may cause"), so the caller
 * runs both interpretations and accepts either.
 */
function warningBodyWords(s: string, hyphen: "join" | "split" = "join"): string[] {
  const dehyphenated =
    hyphen === "join"
      ? s.replace(/-\s*/g, "") // "preg- nancy" -> "pregnancy"
      : s.replace(/-/g, " "); // "may- cause" -> "may cause"
  return stripDiacritics(dehyphenated)
    .toLowerCase()
    .replace(/[[(]\s*(\d)\s*[)\]]/g, " ($1) ") // (1), [1] -> (1)
    .replace(/(?:^|\s)(\d)[).]/g, " ($1) ") // "1)", "1." -> (1)
    .replace(/[.,;:]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
}

/** The canonical federal warning body as a word sequence, computed once. */
const WARNING_BODY_WORDS = warningBodyWords(WARNING_BODY_NORMALIZED);

/**
 * Locate where the found warning first diverges from the required text and
 * return a short pointer (expected vs. found word, with a little context) so the
 * agent doesn't re-read the whole paragraph. Returns null when it can't localize
 * the difference. Uses whichever hyphen interpretation matches furthest.
 */
function describeWarningDifference(afterPrefix: string): string | null {
  const variants = [warningBodyWords(afterPrefix, "join"), warningBodyWords(afterPrefix, "split")];
  // Use the variant that matches the most leading words (most charitable read).
  let best: string[] = variants[0];
  let bestMatch = -1;
  for (const v of variants) {
    let i = 0;
    while (i < v.length && i < WARNING_BODY_WORDS.length && v[i] === WARNING_BODY_WORDS[i]) i++;
    if (i > bestMatch) {
      bestMatch = i;
      best = v;
    }
  }
  const i = bestMatch;
  const context = WARNING_BODY_WORDS.slice(Math.max(0, i - 3), i).join(" ");
  const near = context ? ` (after “…${context}”)` : "";

  if (i >= WARNING_BODY_WORDS.length) {
    // All required words matched in order, so the found text is missing the
    // tail (too short) to have failed.
    return `the warning appears cut off or incomplete; the full required statement was not read`;
  }
  const expectedWord = WARNING_BODY_WORDS[i];
  const foundWord = best[i];
  if (foundWord === undefined) {
    return `the warning is missing words starting at “${expectedWord}”${near}`;
  }
  return `expected “${expectedWord}” but the label shows “${foundWord}”${near}`;
}

/**
 * Normalize a free-text identity field (brand, class, producer) for comparison.
 * Lossy; used only to decide pass/warn, never shown to the user.
 *
 * stripEntityWords removes corporate-suffix noise (Inc, LLC, Distillery). That
 * suits producer comparison ("Old Tom Distillery, LLC" is the same bottler as
 * "Old Tom Distillery") but not brand, where such a word may be the only thing
 * separating a typo from a match. Callers opt in: producer strips, brand/class
 * do not.
 */
function normLoose(s: string, stripEntityWords = false): string {
  let out = norm(s)
    .replace(/['’`]/g, "") // stone's -> stones
    .replace(/&/g, "and")
    .replace(/[.,/#!$%^*;:{}=\-_~()]/g, " ");
  if (stripEntityWords) {
    out = out
      // Regulatory lead-in the label prints before the name ("Distilled and
      // Bottled by Old Tom Distillery" names the same producer).
      .replace(
        /\b(distilled|produced|bottled|made|brewed|vinted|imported|manufactured|blended)\b/g,
        "",
      )
      .replace(/\b(and|by|for|the)\b/g, "")
      // Corporate-suffix noise.
      .replace(
        /\b(co|inc|llc|ltd|corp|company|distillery|distilleries|winery|wineries|brewery|breweries|brewing|vineyards?|cellars?)\b/g,
        "",
      );
  }
  return out.replace(/\s+/g, " ").trim();
}

/** Levenshtein distance, used to tell a typo from a genuinely different value. */
function editDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  let curr = new Array(n + 1).fill(0);
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}

/** Similarity in [0,1] based on edit distance over the longer string. */
function similarity(a: string, b: string): number {
  if (!a && !b) return 1;
  const longer = Math.max(a.length, b.length);
  if (longer === 0) return 1;
  return 1 - editDistance(a, b) / longer;
}

function result(
  field: FieldKey,
  verdict: Verdict,
  expected: string | null,
  found: string | null,
  message: string,
): FieldResult {
  return { field, verdict, expected, found, message };
}

/**
 * Fuzzy identity match for brand, class, and producer. Exact after loose
 * normalization passes; >= 0.85 similarity warns (likely a typo, confirm);
 * anything lower fails.
 */
function matchIdentity(
  field: FieldKey,
  label: string,
  expected: string | undefined,
  found: string | null,
  stripEntityWords = false,
  requirePresence = false,
): FieldResult {
  if (!expected) {
    // No application value to compare against.
    if (found) {
      return result(field, "pass", null, found, `Not provided in application; label shows "${found}".`);
    }
    // In the label-only screen (batch), a core required element missing from the
    // label is a compliance problem, so flag it. In single review (optional
    // field) there is nothing to check.
    const name = FIELD_LABELS[field].toLowerCase();
    return requirePresence
      ? result(field, "fail", null, null, `No ${name} found on the label — this is a required element. Check it's clearly shown and in frame.`)
      : result(field, "na", null, null, `Not provided in the application and not detected on the label.`);
  }
  if (!found) {
    const name = FIELD_LABELS[field].toLowerCase();
    return result(
      field,
      "fail",
      expected,
      null,
      `The ${name} “${expected}” from the application was not found on the label. ` +
        `Check it was entered correctly, and that the ${name} is clearly shown and in frame (it may be cut off or hard to read).`,
    );
  }

  const a = normLoose(expected, stripEntityWords);
  const b = normLoose(found, stripEntityWords);

  // If normalization left nothing comparable on either side (e.g. an all-symbol
  // value), fail instead of asserting a match: two empty strings would otherwise
  // compare equal and pass falsely.
  if (a === "" || b === "") {
    return result(
      field,
      "fail",
      expected,
      found,
      `Could not compare: "${found}" vs "${expected}" — one value has no readable text.`,
    );
  }

  if (a === b) {
    const exact = expected.trim() === found.trim();
    return result(
      field,
      "pass",
      expected,
      found,
      exact
        ? `Match.`
        : `Match (ignoring case/punctuation): "${found}" ≈ "${expected}".`,
    );
  }

  const sim = similarity(a, b);
  if (sim >= 0.85) {
    return result(
      field,
      "warn",
      expected,
      found,
      `Close but not identical — likely the same, please confirm. Label: "${found}", application: "${expected}".`,
    );
  }
  return result(
    field,
    "fail",
    expected,
    found,
    `Mismatch. Label shows "${found}", application says "${expected}".`,
  );
}

/** A parsed ABV is plausible only in 0-100; a year or proof value is not one. */
const isPlausibleAbv = (n: number) => Number.isFinite(n) && n >= 0 && n <= 100;

/**
 * Read an ABV percentage from a free-text alcohol-content string. Handles the
 * forms seen on labels and as an agent types them: "10.5% ALC/VOL",
 * "45% Alc./Vol. (90 Proof)", "ALC 12 BY VOL", "12.5 percent", "5-7% ALC/VOL"
 * (range, returns the midpoint), and a bare "10.5". Returns null when no
 * plausible (0-100) ABV is present. Proof is converted separately by the caller.
 */
function parsePercent(s: string): number | null {
  // A range like "5-7%" returns the midpoint, so a band compares sensibly
  // against a single application number.
  const range = s.match(/(\d+(?:\.\d+)?)\s*[-–—]\s*(\d+(?:\.\d+)?)\s*(?:%|percent|alc|abv|vol)/i);
  if (range) {
    const lo = parseFloat(range[1]);
    const hi = parseFloat(range[2]);
    const mid = (lo + hi) / 2;
    if (isPlausibleAbv(mid)) return mid;
  }

  // A number marked with "%" or the word "percent".
  const pct = s.match(/(\d+(?:\.\d+)?)\s*(?:%|percent)/i);
  if (pct && isPlausibleAbv(parseFloat(pct[1]))) return parseFloat(pct[1]);

  // A number adjacent to an ABV cue ("ALC 12 BY VOL"). Take the first plausible
  // candidate, so a stray year next to a cue ("Vintage 2021 ALC 13 VOL") yields
  // 13, not 2021 (the 0-100 bound rejects 2021).
  const cueRe = /(\d+(?:\.\d+)?)\s*(?:alc|abv|vol)|(?:alc|abv)[^\d]{0,6}(\d+(?:\.\d+)?)/gi;
  for (const m of s.matchAll(cueRe)) {
    const n = parseFloat(m[1] ?? m[2]);
    if (isPlausibleAbv(n)) return n;
  }

  // A lone number (the application field, where an agent just types "10.5").
  const bare = s.trim().match(/^(\d+(?:\.\d+)?)$/);
  if (bare && isPlausibleAbv(parseFloat(bare[1]))) return parseFloat(bare[1]);

  return null;
}

/** Parse a proof value, e.g. "(90 Proof)" -> 90. */
function parseProof(s: string): number | null {
  const m = s.match(/(\d+(?:\.\d+)?)\s*proof/i);
  return m ? parseFloat(m[1]) : null;
}

type AbvParse =
  | { kind: "single"; value: number }
  | { kind: "range"; lo: number; hi: number };

/** Parse a label/application ABV string into a single value or an allowed range. */
function parseAbvText(s: string): AbvParse | null {
  const range = s.match(
    /(\d+(?:\.\d+)?)\s*(?:%|percent)?\s*(?:to|[-–—])\s*(\d+(?:\.\d+)?)\s*(?:%|percent|alc|abv|vol)/i,
  );
  if (range) {
    const lo = parseFloat(range[1]);
    const hi = parseFloat(range[2]);
    if (isPlausibleAbv(lo) && isPlausibleAbv(hi) && lo <= hi) {
      return { kind: "range", lo, hi };
    }
  }

  const single = parsePercent(s);
  if (single !== null) return { kind: "single", value: single };

  const proof = parseProof(s);
  if (proof !== null && isPlausibleAbv(proof / 2)) {
    return { kind: "single", value: proof / 2 };
  }

  return null;
}

/** TTB labeling tolerances when comparing application vs label (27 CFR 4.36, 5.66, 7.65). */
function abvTolerance(beverageType: BeverageType, referencePct: number): number {
  switch (beverageType) {
    case "spirits":
      return 0.3;
    case "wine":
      return referencePct > 14 ? 1.0 : 1.5;
    case "beer":
      return 0.3;
    default:
      return 0.3;
  }
}

const TABLE_WINE_EXEMPT = /\b(table\s+wine|light\s+wine)\b/i;

/** Fortified / dessert wine classes that typically exceed 14% and must state ABV. */
const HIGH_ALCOHOL_WINE_CLASS =
  /\b(port|sherry|madeira|marsala|vermouth|dessert\s+wine|fortified|liqueur|angelica|muscatel)\b/i;

function isTableWineExempt(classType: string | null): boolean {
  return classType !== null && TABLE_WINE_EXEMPT.test(classType);
}

function suggestsHighAlcoholWine(classType: string | null): boolean {
  return classType !== null && HIGH_ALCOHOL_WINE_CLASS.test(classType);
}

/** Whether a parsed label ABV (single or range) exceeds the 14% wine threshold. */
function wineExceeds14Pct(parsed: AbvParse): boolean {
  return parsed.kind === "single" ? parsed.value > 14 : parsed.hi > 14;
}

function formatPct(n: number): string {
  return Number.isInteger(n) ? `${n}` : n.toFixed(1).replace(/\.0$/, "");
}

/**
 * Compare two parsed ABV values using the TTB tolerance for the beverage type.
 * Ranges are inclusive; a single value may fall inside the other's stated range.
 */
function abvValuesAgree(
  expected: AbvParse,
  found: AbvParse,
  beverageType: BeverageType,
): { ok: boolean; tolerance: number; note?: string } {
  if (expected.kind === "range" && found.kind === "range") {
    const ok = expected.lo === found.lo && expected.hi === found.hi;
    return { ok, tolerance: 0, note: ok ? undefined : "range endpoints differ" };
  }

  if (found.kind === "range" && expected.kind === "single") {
    const ok = expected.value >= found.lo && expected.value <= found.hi;
    return {
      ok,
      tolerance: 0,
      note: ok ? undefined : `application ${formatPct(expected.value)}% is outside label range ${formatPct(found.lo)}–${formatPct(found.hi)}%`,
    };
  }

  if (expected.kind === "range" && found.kind === "single") {
    const ok = found.value >= expected.lo && found.value <= expected.hi;
    return {
      ok,
      tolerance: 0,
      note: ok ? undefined : `label ${formatPct(found.value)}% is outside application range ${formatPct(expected.lo)}–${formatPct(expected.hi)}%`,
    };
  }

  const expVal = expected.kind === "single" ? expected.value : (expected.lo + expected.hi) / 2;
  const foundVal = found.kind === "single" ? found.value : (found.lo + found.hi) / 2;
  const ref = Math.max(expVal, foundVal);
  const tolerance = abvTolerance(beverageType, ref);
  const diff = Math.abs(expVal - foundVal);
  return {
    ok: diff <= tolerance,
    tolerance,
    note: diff <= tolerance ? undefined : `difference ${diff.toFixed(1)}% exceeds ±${tolerance}% TTB tolerance`,
  };
}

function cfrForAbvType(beverageType: BeverageType): string {
  switch (beverageType) {
    case "spirits":
      return "27 CFR 5.66";
    case "wine":
      return "27 CFR 4.36";
    case "beer":
      return "27 CFR 7.65";
    default:
      return "27 CFR Parts 4, 5, 7";
  }
}

/** Verdict when ABV is absent — type- and context-aware per TTB rules. */
function missingAbvResult(
  field: FieldKey,
  expected: string | undefined,
  label: ExtractedLabel,
  beverageType: BeverageType,
  labelOnly: boolean,
): FieldResult {
  const cfr = cfrForAbvType(beverageType);
  const classType = label.classType;

  if (beverageType === "spirits") {
    const msg = expected
      ? `Expected "${expected}" but no alcohol content found on the label — required for distilled spirits (${cfr}).`
      : `No alcohol content on the label. Distilled spirits must state alcohol content as % by volume (${cfr}).`;
    return result(field, "fail", expected ?? null, null, msg);
  }

  if (beverageType === "wine") {
    if (isTableWineExempt(classType)) {
      return result(
        field,
        "na",
        expected ?? null,
        null,
        `ABV not shown — permissible for table/light wine at or below 14% when that designation appears on the label (${cfr}(a)).`,
      );
    }
    if (suggestsHighAlcoholWine(classType)) {
      const msg = expected
        ? `Application states "${expected}" but no ABV on the label — wine over 14% must state alcohol content (${cfr}(a)).`
        : `No ABV on the label. Fortified/dessert wines over 14% must state alcohol content (${cfr}(a)).`;
      return result(field, labelOnly ? "fail" : "warn", expected ?? null, null, msg);
    }
    const msg = expected
      ? `Application states "${expected}" but no ABV on the label — required if over 14%; at or below 14% may be omitted only with "table wine" or "light wine" on the label (${cfr}(a)).`
      : labelOnly
        ? `No ABV on the label. Required if over 14% ABV; at or below 14% may be omitted only when "table wine" or "light wine" appears on the label (${cfr}(a)).`
        : `Not shown — wine at or below 14% may omit ABV when labeled as table/light wine (${cfr}(a)).`;
    return result(field, labelOnly ? "warn" : "na", expected ?? null, null, msg);
  }

  if (beverageType === "beer") {
    const msg = expected
      ? `Application states "${expected}" but no ABV on the label — malt beverages may omit alcohol content at the federal level unless state law requires it (${cfr}(a)).`
      : `Not shown — malt beverages may omit alcohol content at the federal level (${cfr}(a)).`;
    return result(field, "na", expected ?? null, null, msg);
  }

  const msg = expected
    ? `Application states "${expected}" but none found on the label — confirm whether this product type requires it.`
    : `Not provided and not detected. Confirm whether this beverage type requires alcohol content.`;
  return result(field, "warn", expected ?? null, null, msg);
}

/**
 * Match alcohol content using TTB type-specific rules and tolerances, with a
 * proof-vs-ABV consistency check (US proof = 2 × ABV).
 *
 * Spirits: mandatory, ±0.3% (27 CFR 5.66). Wine: mandatory over 14%; optional
 * at or below 14% with table/light wine designation; ±1% or ±1.5% by band, or
 * stated range (27 CFR 4.36). Beer: optional federally; ±0.3% when stated
 * (27 CFR 7.65).
 */
function matchAbv(
  expected: string | undefined,
  found: string | null,
  beverageType: BeverageType,
  label: ExtractedLabel,
  labelOnly: boolean,
): FieldResult {
  const field: FieldKey = "alcoholContent";
  const cfr = cfrForAbvType(beverageType);

  if (!found) {
    return missingAbvResult(field, expected, label, beverageType, labelOnly);
  }

  if (!expected) {
    const foundParsed = parseAbvText(found);
    if (beverageType === "wine" && foundParsed && wineExceeds14Pct(foundParsed)) {
      return result(
        field,
        "pass",
        null,
        found,
        `Label shows ${found} — required for wine over 14% ABV (${cfr}(a)).`,
      );
    }
    if (beverageType === "spirits") {
      return result(
        field,
        "pass",
        null,
        found,
        `Label shows ${found} — required for distilled spirits (${cfr}).`,
      );
    }
    return result(field, "pass", null, found, `Not provided in application; label shows "${found}".`);
  }

  const expParsed = parseAbvText(expected);
  const foundParsed = parseAbvText(found);

  if (expParsed && foundParsed) {
    const { ok, tolerance, note } = abvValuesAgree(expParsed, foundParsed, beverageType);
    const foundVal =
      foundParsed.kind === "single"
        ? foundParsed.value
        : `${formatPct(foundParsed.lo)}–${formatPct(foundParsed.hi)}`;

    if (ok) {
      const proof = parseProof(found);
      const foundSingle = foundParsed.kind === "single" ? foundParsed.value : null;
      if (proof !== null && foundSingle !== null && Math.abs(proof - foundSingle * 2) > 0.5) {
        return result(
          field,
          "warn",
          expected,
          found,
          `ABV matches within TTB tolerance (±${tolerance}% per ${cfr}), but stated proof (${proof}) is inconsistent — proof should be ≈ ${(foundSingle * 2).toFixed(0)}.`,
        );
      }

      if (foundParsed.kind === "range" && beverageType === "wine") {
        const span = foundParsed.hi - foundParsed.lo;
        const maxSpan = foundParsed.hi > 14 ? 2 : 3;
        if (span > maxSpan + 0.01) {
          return result(
            field,
            "warn",
            expected,
            found,
            `Values align, but the stated range spans ${span.toFixed(1)}% — TTB allows at most ${maxSpan}% for this wine band (${cfr}(b)(2)).`,
          );
        }
      }

      const tolNote =
        tolerance > 0 ? ` (within ±${tolerance}% TTB tolerance, ${cfr})` : "";
      return result(field, "pass", expected, found, `Match (${foundVal}%${tolNote}).`);
    }

    return result(
      field,
      "fail",
      expected,
      found,
      `Alcohol content differs: label shows ${foundVal}% vs application ${expected}. ${note ?? ""}`.trim(),
    );
  }

  return matchIdentity(field, "alcoholContent", expected, found);
}

/**
 * Parse a net-contents quantity into milliliters so equal volumes written
 * differently compare equal ("750 mL" = "0.75 L" = "75 cL"). A bare number is
 * read as mL, the unit an agent usually types. Returns null if no quantity
 * parses. Handles mL, cL, dL, L, US fl oz, pint, quart, and gallon.
 */
const ML_PER_UNIT: Record<string, number> = {
  ml: 1,
  cl: 10,
  dl: 100,
  l: 1000,
  litre: 1000,
  litres: 1000,
  liter: 1000,
  liters: 1000,
  floz: 29.5735,
  oz: 29.5735,
  pt: 473.176,
  pint: 473.176,
  pints: 473.176,
  qt: 946.353,
  quart: 946.353,
  quarts: 946.353,
  gal: 3785.41,
  gallon: 3785.41,
  gallons: 3785.41,
};

function parseVolumeMl(s: string): number | null {
  const t = norm(s);
  // Capture the number and whatever unit token follows it, so an unrecognized
  // unit is detected rather than silently ignored.
  const m = t.match(/(\d+(?:\.\d+)?)\s*(fl\.?\s*oz|[a-z]+)?/);
  if (!m) return null;
  const qty = parseFloat(m[1]);
  if (!Number.isFinite(qty)) return null;
  const raw = (m[2] || "").replace(/\.|\s/g, "");
  if (raw === "") return qty; // bare number: an agent typed mL
  const factor = ML_PER_UNIT[raw];
  // Unrecognized unit ("widgets", a stray word): return null so the caller falls
  // back to a string compare rather than comparing it as if it were mL.
  return factor === undefined ? null : qty * factor;
}

/**
 * Net contents. Compares by *volume*, not by string, so equal amounts written
 * with different units or spacing match ("750 mL" = "0.75 L" = bare "750"). Falls
 * back to a string compare only when neither side yields a parseable quantity.
 */
/** US state abbreviations and common country names seen on bottler statements. */
const US_STATE_ABBREV =
  /\b(AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC)\b/;

const US_STATE_NAME =
  /\b(alabama|alaska|arizona|arkansas|california|colorado|connecticut|delaware|florida|georgia|hawaii|idaho|illinois|indiana|iowa|kansas|kentucky|louisiana|maine|maryland|massachusetts|michigan|minnesota|mississippi|missouri|montana|nebraska|nevada|new\s+hampshire|new\s+jersey|new\s+mexico|new\s+york|north\s+carolina|north\s+dakota|ohio|oklahoma|oregon|pennsylvania|rhode\s+island|south\s+carolina|south\s+dakota|tennessee|texas|utah|vermont|virginia|washington|west\s+virginia|wisconsin|wyoming)\b/i;

const FOREIGN_COUNTRY =
  /\b(france|italy|scotland|ireland|mexico|canada|japan|germany|spain|australia|new\s+zealand|united\s+kingdom|england|wales|portugal|chile|argentina|south\s+africa|netherlands|belgium|sweden|norway|denmark|finland|austria|switzerland|hungary|greece|turkey|india|china|korea|taiwan|thailand|brazil|peru|colombia)\b/i;

const DOMESTIC_ORIGIN = /\b(usa|u\.?\s?s\.?a?\.?|united\s+states(\s+of\s+america)?|america)\b/i;

/**
 * Heuristic: does a bottler/producer string include a recognizable address?
 * TTB requires name and address on the label (27 CFR Parts 4, 5, 7). We look for
 * a US ZIP, state, or a foreign country — not full street-level parsing.
 */
function hasProducerAddress(s: string): boolean {
  if (/\b\d{5}(?:-\d{4})?\b/.test(s)) return true;
  if (US_STATE_ABBREV.test(s) || US_STATE_NAME.test(s)) return true;
  if (FOREIGN_COUNTRY.test(s)) return true;
  return false;
}

/**
 * Does the extracted label text suggest an imported product? Used to require
 * country of origin when the application omits it (batch) or to warn in single review.
 */
function suggestsImport(label: ExtractedLabel): boolean {
  const parts = [label.producer, label.classType, label.originCountry, label.brandName].filter(
    Boolean,
  ) as string[];
  const text = parts.join(" ");

  if (/\b(imported\s+by|imported\s+from|sole\s+(?:distributor|importer)|imported\s+and)\b/i.test(text)) {
    return true;
  }

  const productOf = text.match(/\bproduct\s+of\s+([^.,;]+)/i);
  if (productOf && !DOMESTIC_ORIGIN.test(productOf[1])) return true;

  const madeIn = text.match(/\b(?:distilled|bottled|produced|made|vinted)\s+in\s+([^.,;]+)/i);
  if (madeIn && !DOMESTIC_ORIGIN.test(madeIn[1])) return true;

  if (label.originCountry && !DOMESTIC_ORIGIN.test(label.originCountry)) return true;

  return false;
}

function matchNetContents(
  expected: string | undefined,
  found: string | null,
  requirePresence = false,
): FieldResult {
  const field: FieldKey = "netContents";
  if (!expected) {
    if (found) {
      return result(field, "pass", null, found, `Not provided; label shows "${found}".`);
    }
    return requirePresence
      ? result(
          field,
          "fail",
          null,
          null,
          `No net contents found on the label — required on all alcohol beverages (27 CFR Parts 4, 5, 7). Check the fill volume is clearly shown and in frame.`,
        )
      : result(field, "na", null, null, `Not provided in the application and not detected on the label.`);
  }
  if (!found) {
    return result(field, "fail", expected, null, `Expected "${expected}" but no net contents found on the label.`);
  }

  const expMl = parseVolumeMl(expected);
  const foundMl = parseVolumeMl(found);
  if (expMl !== null && foundMl !== null) {
    // Tiny epsilon for float rounding (0.75 L → 750 mL); not a tolerance band —
    // net contents must match exactly, so anything beyond rounding fails.
    if (Math.abs(expMl - foundMl) < 0.5) {
      return result(field, "pass", expected, found, `Match (${found}).`);
    }
    return result(
      field,
      "fail",
      expected,
      found,
      `Net contents differ: label "${found}" (${foundMl} mL) vs application "${expected}" (${expMl} mL).`,
    );
  }

  // Couldn't read a volume on one side — compare as normalized text.
  const canon = (s: string) => norm(s).replace(/\s+/g, "");
  if (canon(expected) === canon(found)) {
    return result(field, "pass", expected, found, `Match (${found}).`);
  }
  return result(field, "fail", expected, found, `Net contents differ: label "${found}" vs application "${expected}".`);
}

/**
 * Country of origin (imports). Labels phrase this as "Product of X" / "Distilled
 * in X" / "Imported from X", while the application usually just names the country.
 * We strip that framing down to the country itself and compare on WHOLE WORDS —
 * not substrings. Substring matching was a false-pass hazard: "US" is a substring
 * of "Russia", and "Mexico" of "New Mexico". After stripping, the remaining
 * country tokens must match as a set, so "Scotland" == "Product of Scotland" but
 * "US" != "Russia" and "Mexico" != "New Mexico, USA".
 */
/**
 * Bottler / producer. Fuzzy identity match plus an address heuristic — TTB
 * requires both name and address on the label.
 */
function matchProducer(
  expected: string | undefined,
  found: string | null,
  requirePresence: boolean,
): FieldResult {
  const base = matchIdentity("producer", "producer", expected, found, true, requirePresence);

  if (!found) return base;

  if (!hasProducerAddress(found)) {
    const addressNote =
      `Producer name found but no recognizable address on the label. TTB requires bottler name and address (27 CFR Parts 4, 5, 7).`;
    if (base.verdict === "pass") {
      return result("producer", "warn", expected ?? null, found, addressNote);
    }
    if (base.verdict === "warn") {
      return result(
        "producer",
        "warn",
        expected ?? null,
        found,
        `${base.message} ${addressNote}`,
      );
    }
    if (requirePresence) {
      return result("producer", "warn", expected ?? null, found, addressNote);
    }
  }

  return base;
}

function matchOrigin(
  expected: string | undefined,
  found: string | null,
  label: ExtractedLabel,
  labelOnly: boolean,
): FieldResult {
  const field: FieldKey = "originCountry";
  if (!expected) {
    const imported = suggestsImport(label);

    if (found) {
      return imported || labelOnly
        ? result(field, "pass", null, found, `Label shows country of origin: "${found}".`)
        : result(field, "na", null, found, `Not checked — no origin in the application; label shows "${found}".`);
    }

    if (imported && labelOnly) {
      return result(
        field,
        "fail",
        null,
        null,
        `Label appears to be an imported product but no country of origin was found — required for imports (27 CFR Parts 4, 5, 7).`,
      );
    }
    if (imported) {
      return result(
        field,
        "warn",
        null,
        null,
        `Label suggests an import but no country of origin was detected — verify origin is declared on the label.`,
      );
    }
    return result(field, "na", null, null, `Not checked — only required for imported products.`);
  }
  if (!found) {
    return result(field, "fail", expected, null, `Application lists origin "${expected}" but the label shows no country of origin.`);
  }
  // Strip regulatory framing, drop punctuation, and collapse the common US
  // synonyms (the most frequent origin) to one token so "USA" == "United States".
  const tokens = (s: string): string[] =>
    norm(s)
      .replace(/[.,]/g, " ")
      .replace(/\b(usa|us|u s a|u s|united states|united states of america|america)\b/g, "us")
      .replace(/\b(product|produce|distilled|bottled|made|imported|of|in|from|the)\b/g, " ")
      .split(/\s+/)
      .filter(Boolean);
  const e = tokens(expected);
  const f = tokens(found);
  const sameSet = e.length > 0 && e.length === f.length && [...e].sort().join(" ") === [...f].sort().join(" ");
  if (sameSet) {
    return result(field, "pass", expected, found, `Origin matches (label: "${found}").`);
  }
  return result(field, "fail", expected, found, `Country of origin differs: label "${found}" vs application "${expected}".`);
}

/**
 * Government warning — the strict one.
 *
 * Three independent checks, because each maps to a real way producers fail:
 *   1. presence   — is there a warning at all?            (missing -> FAIL)
 *   2. prefix case — is "GOVERNMENT WARNING:" ALL CAPS?    (title-case -> FAIL)
 *   3. wording    — is the body verbatim (ignoring spacing/linebreaks)?
 *
 * Bold cannot be verified from extracted text; we note it as an advisory rather
 * than pass/fail on it.
 */
function matchWarning(
  found: string | null,
  imageQuality: ExtractedLabel["imageQuality"],
  warningLegible: boolean,
): FieldResult {
  const field: FieldKey = "governmentWarning";

  /** Attach the per-requirement breakdown to a warning FieldResult. */
  const withSubs = (
    r: FieldResult,
    present: Verdict,
    wording: Verdict,
    caps: Verdict,
  ): FieldResult => ({
    ...r,
    subChecks: [
      { label: "Warning present", verdict: present },
      { label: "Verbatim wording", verdict: wording },
      { label: '"GOVERNMENT WARNING:" in all caps', verdict: caps },
    ],
  });

  if (!found || norm(found).length === 0) {
    // Distinguish a *photo* problem from a *label* problem: if we couldn't read
    // the warning, it may simply not be in frame (it's usually on the back/side
    // panel) — don't assert the product is non-compliant.
    const msg =
      imageQuality === "poor"
        ? `No government warning found — but the photo was hard to read. Make sure the panel with the warning is clearly in frame, then review again.`
        : `No government warning found in this image. The warning is mandatory on all alcohol beverages and is usually on the back or side panel — make sure that panel is in frame.`;
    return withSubs(
      result(field, "fail", "Mandatory government warning", null, msg),
      "fail",
      "na",
      "na",
    );
  }

  const raw = found.trim();
  // Locate the heading allowing any internal whitespace ("GOVERNMENT  WARNING"),
  // so benign OCR/typesetting spacing doesn't hide an otherwise-valid warning.
  const headingRe = /government\s+warning/i;
  const match = raw.match(headingRe);

  if (!match || match.index === undefined) {
    return withSubs(
      result(field, "fail", "Mandatory government warning", found, `Text was found but it does not contain a recognizable "GOVERNMENT WARNING" statement.`),
      "fail",
      "na",
      "na",
    );
  }
  const idx = match.index;

  // Check the prefix is ALL CAPS exactly as required — compared on a
  // whitespace-collapsed copy so spacing doesn't affect the case judgment.
  const prefixOnLabel = raw.slice(idx, idx + match[0].length);
  const prefixCapsOk = prefixOnLabel.replace(/\s+/g, " ") === "GOVERNMENT WARNING";
  const colonOk = /^\s*:/.test(raw.slice(idx + match[0].length));
  const headingOk = prefixCapsOk && colonOk;

  // Compare the body wording (everything after the heading + colon),
  // normalized for spacing/case so OCR line-wraps don't matter, but words exact.
  const afterPrefix = raw.slice(idx).replace(/government\s+warning\s*:?/i, "");
  // Compare word-by-word on a canonicalized body so OCR rendering noise
  // (punctuation, "(1)" vs "[1]" vs "1)", line-wrap hyphens) doesn't masquerade
  // as a wording violation — but any genuine word change still fails. The
  // warning is often followed by unrelated copy ("Please recycle", a web URL),
  // so we compare against the *leading* N words, not the whole tail.
  // Try both hyphen interpretations (join a split word vs split a stray hyphen);
  // accept if either reconstruction matches the federal text verbatim. A genuine
  // wording change matches neither, so this doesn't weaken the check.
  const matchesVerbatim = (words: string[]) =>
    words.length >= WARNING_BODY_WORDS.length &&
    WARNING_BODY_WORDS.every((w, i) => words[i] === w);
  const wordingOk =
    matchesVerbatim(warningBodyWords(afterPrefix, "join")) ||
    matchesVerbatim(warningBodyWords(afterPrefix, "split"));

  const capsV: Verdict = headingOk ? "pass" : "fail";
  const wordingV: Verdict = wordingOk ? "pass" : "fail";

  if (headingOk && wordingOk) {
    // Anti-hallucination gate: a verbatim "match" is only trustworthy if the
    // model actually read the whole warning. If it flagged the warning as not
    // fully legible, the text may have been reconstructed from memory — we must
    // NOT auto-pass it. Downgrade to a human check.
    if (!warningLegible) {
      return withSubs(
        result(
          field,
          "warn",
          "Verbatim federal warning",
          found,
          `The warning was only partially legible in this photo, so it could not be automatically confirmed — verify the full wording and that "GOVERNMENT WARNING:" is bold by eye, or retake the photo.`,
        ),
        "pass",
        "warn",
        "warn",
      );
    }
    return withSubs(
      result(field, "pass", "Verbatim federal warning", found, `Present and verbatim. (Confirm by eye that "GOVERNMENT WARNING:" is bold — bold can't be verified from text alone.)`),
      "pass",
      "pass",
      "pass",
    );
  }

  if (prefixCapsOk && !colonOk && wordingOk) {
    return withSubs(
      result(
        field,
        "fail",
        "Verbatim federal warning",
        found,
        `Wording is correct and the heading is capitalized, but a colon is required immediately after "GOVERNMENT WARNING" (27 CFR 16.21).`,
      ),
      "pass",
      wordingV,
      capsV,
    );
  }

  if (!prefixCapsOk && wordingOk) {
    return withSubs(
      result(
        field,
        "fail",
        "Verbatim federal warning",
        found,
        `Wording is correct, but "${prefixOnLabel}" is not in all capital letters — federal law requires "GOVERNMENT WARNING:" in caps and bold (27 CFR 16.21).`,
      ),
      "pass",
      wordingV,
      capsV,
    );
  }

  // Point the agent at exactly where the wording diverges, so they don't have to
  // re-read the whole paragraph to find the one altered word.
  const diff = describeWarningDifference(afterPrefix);
  const diffNote = diff ? ` Difference: ${diff}.` : "";

  if (headingOk && !wordingOk) {
    return withSubs(
      result(
        field,
        "fail",
        "Verbatim federal warning",
        found,
        `The "GOVERNMENT WARNING:" heading is present, but the wording does not match the required text verbatim.${diffNote}`,
      ),
      "pass",
      wordingV,
      capsV,
    );
  }

  return withSubs(
    result(
      field,
      "fail",
      "Verbatim federal warning",
      found,
      `Both the heading capitalization and the wording differ from the required statement.${diffNote}`,
    ),
    "pass",
    wordingV,
    capsV,
  );
}

/** The worst verdict wins for the overall headline. */
function worst(verdicts: Verdict[]): Verdict {
  if (verdicts.includes("fail")) return "fail";
  if (verdicts.includes("warn")) return "warn";
  return "pass";
}

/** A detected beverage class (the four valid categories, or null = undetermined). */
type DetectedType = "wine" | "spirits" | "beer" | "other" | null;

/** Keyword fallback over class/type when the model returns no type. Omits bare
 *  color words (white, red) that appear in brand names and caused false matches. */
const TYPE_KEYWORDS: Record<"wine" | "spirits" | "beer", RegExp> = {
  wine: /\b(wine|ros[eé]|blanc|cabernet|merlot|chardonnay|sauvignon|pinot|syrah|shiraz|zinfandel|riesling|moscato|prosecco|champagne|vermouth|sake|lambrusco|sangiovese|malbec|pinot\s+grigio)\b/i,
  spirits: /\b(whisky|whiskey|bourbon|scotch|vodka|rum|gin|tequila|mezcal|brandy|cognac|liqueur|schnapps|distilled)\b/i,
  beer: /\b(beer|lager|ale|ipa|pilsner|stout|porter|malt\s+beverage|hefeweizen|saison)\b/i,
};

/**
 * Determine the label's beverage type. Prefers the model's own read
 * (`label.beverageType`) — the vision model judges the whole label and is more
 * accurate than text matching. Falls back to a keyword scan of the class/type
 * designation when the model returned null, and to null when neither is sure.
 */
export function inferType(label: ExtractedLabel): DetectedType {
  if (label.beverageType) return label.beverageType; // model's read wins

  // Fallback: keyword scan of the class/type text only (brand is too noisy).
  const hay = label.classType ?? "";
  if (!hay.trim()) return null;
  const hits = (Object.keys(TYPE_KEYWORDS) as Array<"wine" | "spirits" | "beer">).filter((t) =>
    TYPE_KEYWORDS[t].test(hay),
  );
  // Only confident when exactly ONE type matches — overlapping or no cues → null
  // (e.g. "Hard Seltzer" matches nothing here, so it stays "not detected", which
  // is correct — a seltzer/FMB isn't one of the three classic classes).
  return hits.length === 1 ? hits[0] : null;
}

function matchBeverageType(selected: BeverageType, label: ExtractedLabel): FieldResult {
  const field: FieldKey = "beverageType";
  const human = BEVERAGE_LABELS[selected];
  const inferred = inferType(label);

  // Auto: the tool reports what it detected, informational (not a cross-check
  // against an agent's claim — there is none to check).
  if (selected === "auto") {
    if (!inferred) {
      return result(field, "na", "Auto", label.classType, `Could not confidently detect the beverage type from the label.`);
    }
    const detected = BEVERAGE_LABELS[inferred];
    const msg =
      inferred === "other"
        ? `Detected as "other" — not one of the three classic classes (e.g. a seltzer or canned cocktail).`
        : `Detected from the label: ${detected.toLowerCase()}.`;
    return result(field, "pass", "Auto", detected, msg);
  }
  // (The agent can only pick Auto or a concrete class — "other" is never a
  // selection, only the AI's own detection — so we fall straight to the
  // concrete-type cross-check below.)
  if (!inferred) {
    return result(field, "na", human, label.classType, `Selected "${human}". Could not confirm the type from the label.`);
  }
  if (inferred === selected) {
    return result(field, "pass", human, BEVERAGE_LABELS[inferred], `Selected type matches the label (${BEVERAGE_LABELS[inferred]}).`);
  }
  return result(
    field,
    "warn",
    human,
    BEVERAGE_LABELS[inferred],
    `The selected beverage type ("${human}") may not match the label, which looks like ${BEVERAGE_LABELS[inferred].toLowerCase()}. Confirm the type is correct.`,
  );
}

export function validate(
  app: ApplicationData,
  label: ExtractedLabel,
  opts: { labelOnly?: boolean } = {},
): ReviewResult {
  // On "auto", resolve the type from the label for the ABV rules; if it can't be
  // inferred, fall back to "other" (cautious — neither forces nor exempts ABV).
  const abvType: BeverageType =
    app.beverageType === "auto" ? inferType(label) ?? "other" : app.beverageType;

  // Label-only screen (batch): no application to compare against — check that
  // universal on-label elements are present (brand, class, net contents, producer,
  // import origin when applicable). ABV and the warning already fail-when-required.
  const requireCore = opts.labelOnly === true;

  const fields: FieldResult[] = [
    matchIdentity("brandName", "brandName", app.brandName, label.brandName, false, requireCore),
    matchBeverageType(app.beverageType, label),
    matchIdentity("classType", "classType", app.classType, label.classType, false, requireCore),
    matchAbv(app.alcoholContent, label.alcoholContent, abvType, label, requireCore),
    matchNetContents(app.netContents, label.netContents, requireCore),
    matchProducer(app.producer, label.producer, requireCore),
    matchOrigin(app.originCountry, label.originCountry, label, requireCore),
    matchWarning(label.governmentWarning, label.imageQuality, label.warningLegible),
  ];

  return {
    overall: worst(fields.map((f) => f.verdict)),
    fields,
    imageQuality: label.imageQuality,
    notes: label.notes,
  };
}
