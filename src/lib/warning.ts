/**
 * Government health warning constants per 27 CFR 16.21 (Alcoholic Beverage
 * Labeling Act of 1988). The warning must appear word-for-word on every alcohol
 * label, with "GOVERNMENT WARNING:" in capital letters and bold.
 */

/** The mandatory warning, exactly as required by 27 CFR 16.21. Do not "fix" this. */
export const GOVERNMENT_WARNING =
  "GOVERNMENT WARNING: (1) According to the Surgeon General, women should not " +
  "drink alcoholic beverages during pregnancy because of the risk of birth " +
  "defects. (2) Consumption of alcoholic beverages impairs your ability to " +
  "drive a car or operate machinery, and may cause health problems.";

/** The all-caps prefix that must lead the warning and be bold on the label. */
export const WARNING_PREFIX = "GOVERNMENT WARNING:";

/**
 * The warning body with the prefix stripped, lowercased and whitespace-collapsed.
 * Used to compare wording independent of case/spacing so OCR line-wrapping doesn't
 * cause false rejections — while the prefix is still checked for ALL CAPS separately.
 */
export const WARNING_BODY_NORMALIZED = GOVERNMENT_WARNING.slice(
  WARNING_PREFIX.length,
)
  .toLowerCase()
  .replace(/\s+/g, " ")
  .trim();
