/**
 * Shared domain types for the alcohol label-review assistant.
 *
 * The vocabulary here mirrors how a compliance agent thinks about a review:
 * an *application* states what the producer claims, the *label* is what the
 * artwork actually shows, and a *review* compares the two field-by-field.
 */

/**
 * Beverage type drives which fields are mandatory. The clearest example: federal law
 * requires an alcohol-content statement on distilled spirits always, but allows
 * it to be optional within a tolerance band for many wines and malt beverages.
 *
 * The three concrete classes mirror the federal categories the spec calls out (beer,
 * wine, distilled spirits). "auto" (the default) lets the tool infer the type from
 * the label and use that for the ABV rules — avoiding a stale default the agent
 * forgot to change; if the agent picks a concrete type, we cross-check it against
 * the label. "other" is NOT an agent choice — it's only ever the AI's detection
 * for a product outside the three classes (a hard seltzer, canned cocktail);
 * Auto surfaces it and the ABV rule treats it cautiously. The dropdown offers
 * only SELECTABLE_BEVERAGE_TYPES.
 */
export type BeverageType = "auto" | "spirits" | "wine" | "beer" | "other";

/** What the agent can actually choose — Auto plus the spec's three classes.
 *  "other" is excluded: Auto already detects seltzers/cocktails for them. */
export const SELECTABLE_BEVERAGE_TYPES: BeverageType[] = ["auto", "spirits", "wine", "beer"];

export const BEVERAGE_LABELS: Record<BeverageType, string> = {
  auto: "Auto (detect from label)",
  spirits: "Distilled spirits",
  wine: "Wine",
  beer: "Beer / malt beverage",
  other: "Other",
};

/** The fields an agent verifies for compliance. Order here is the order shown in the UI. */
export type FieldKey =
  | "brandName"
  | "beverageType"
  | "classType"
  | "alcoholContent"
  | "netContents"
  | "producer"
  | "originCountry"
  | "governmentWarning";

/** Human-facing labels for each field. */
export const FIELD_LABELS: Record<FieldKey, string> = {
  brandName: "Brand name",
  beverageType: "Beverage type",
  classType: "Class / type designation",
  alcoholContent: "Alcohol content",
  netContents: "Net contents",
  producer: "Bottler / producer name & address",
  originCountry: "Country of origin",
  governmentWarning: "Government health warning",
};

/**
 * The application data an agent types in (or that COLA would supply). Every field
 * is optional: the single-review UI asks for a brand to compare against, but the
 * batch screen has no application at all — it just reads each label and checks it
 * against the universal rules. A missing field is read off the label, never failed.
 */
export interface ApplicationData {
  brandName?: string;
  beverageType: BeverageType;
  classType?: string;
  alcoholContent?: string;
  netContents?: string;
  producer?: string;
  /** For imports. Optional; only validated when the agent provides it. */
  originCountry?: string;
}

/**
 * What the AI extracted from the label image. Every field is nullable: the
 * model returns null when a field genuinely isn't on the label, which is itself
 * a finding (e.g. a missing government warning = automatic FAIL).
 */
export interface ExtractedLabel {
  brandName: string | null;
  /** The product class the model read from the label (spirits/wine/beer/other),
   *  or null if it couldn't tell. More reliable than keyword-guessing from text. */
  beverageType: "spirits" | "wine" | "beer" | "other" | null;
  classType: string | null;
  alcoholContent: string | null;
  netContents: string | null;
  producer: string | null;
  originCountry: string | null;
  governmentWarning: string | null;
  /**
   * Whether the government warning was FULLY legible in the photo. Critical
   * anti-hallucination signal: vision models will "helpfully" reconstruct the
   * standard warning from memory when it's partly obscured. If this is false, we
   * must NOT pass the warning as verbatim — the agent has to verify by eye — even
   * if the (possibly reconstructed) text happens to match.
   */
  warningLegible: boolean;
  /**
   * Model's read on image quality (glare/skew/blur). Surfaced to the agent so a
   * "looks fine but extraction was hard" case can be flagged rather than trusted
   * blindly — addresses the "photographed at a weird angle" concern.
   */
  imageQuality: "good" | "fair" | "poor";
  /** Any free-text caveat from the extractor (e.g. "bottom-right corner cut off"). */
  notes?: string;
}

/**
 * Per-field outcome.
 *  - pass: matches / compliant
 *  - warn: a genuine soft finding — close-but-not-identical, confirm by eye
 *  - fail: mismatch, missing-but-required, or non-compliant
 *  - na:   nothing to check — the field wasn't in the application and wasn't on
 *          the label. Neither good nor bad; shown quietly, never as an alarm.
 */
export type Verdict = "pass" | "warn" | "fail" | "na";

/**
 * One independent sub-check within a field. Used by the government warning,
 * which the regulation breaks into separate requirements (present, verbatim
 * wording, all-caps heading) — surfacing each lets an agent see exactly which
 * part is wrong (for example, a title-case heading).
 */
export interface SubCheck {
  label: string;
  verdict: Verdict;
}

/** Result of validating one field. */
export interface FieldResult {
  field: FieldKey;
  verdict: Verdict;
  /** What the agent entered / the application claimed (null if not provided). */
  expected: string | null;
  /** What we read off the label (null if absent). */
  found: string | null;
  /** One-line, plain-English explanation an agent can act on. */
  message: string;
  /** Optional per-requirement breakdown (currently only the government warning). */
  subChecks?: SubCheck[];
}

/** The full review of one label against one application. */
export interface ReviewResult {
  /** Worst verdict across all fields — the headline status. */
  overall: Verdict;
  fields: FieldResult[];
  imageQuality: ExtractedLabel["imageQuality"];
  notes?: string;
  /** Round-trip time for the extraction call, ms. Surfaced to honor the 5s budget. */
  elapsedMs?: number;
}
