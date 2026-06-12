/**
 * Pure helpers for the extracted-label shape — separated from the network-bound
 * extractor so the "don't trust the model" guard is plain, dependency-free, and
 * unit-tested in isolation. coerceExtractedLabel normalizes whatever JSON the
 * model emitted: missing keys and wrong types degrade to null/defaults, sentinel
 * phrases ("not visible") become null instead of label text, notes are scrubbed
 * of field-name leakage and capped at a sentence boundary.
 */
import { ExtractedLabel } from "./types";

type Quality = ExtractedLabel["imageQuality"];

/**
 * Coerce parsed model JSON into a valid ExtractedLabel. Normalizes missing keys,
 * wrong types, and unexpected enum values before validation.
 *
 * Sentinel phrases ("not visible", "illegible", etc.) are mapped to null so they
 * are not validated as label text.
 */
const ILLEGIBLE_SENTINELS = [
  "not clearly visible",
  "not visible",
  "not legible",
  "illegible",
  "not readable",
  "unreadable",
  "obscured",
  "cannot read",
  "could not read",
  "not shown",
  "not provided",
  "unknown",
  "n/a",
  "none",
  "--",
];

function isSentinel(s: string): boolean {
  const t = s.trim().toLowerCase().replace(/[.\s]+$/, "");
  return ILLEGIBLE_SENTINELS.includes(t) || /^not (clearly )?(visible|legible|shown|readable)\b/.test(t);
}

/**
 * Tidy the model's free-text note for display to an agent: drop any sentence
 * that leaks an internal field name (e.g. "warningLegible set to false…"),
 * collapse whitespace, trim stray trailing punctuation, and cap the length so a
 * verbose model can't dump a paragraph into a one-line advisory.
 */
const NOTE_MAX = 160;
function cleanNote(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const kept = v
    .split(/(?<=[.!?])\s+/)
    // Drop sentences that leak internal field names OR catalogue non-compliance
    // label features the agent doesn't care about (barcodes, QR/UPC codes).
    .filter((s) => !/warninglegible|imagequality|null\b|json|schema|field|bar\s?code|qr code|upc/i.test(s))
    .join(" ");
  let t = kept.replace(/\s+/g, " ").trim().replace(/[.\s]+$/, "");
  if (!t) return undefined;
  if (t.length > NOTE_MAX) {
    // Cut at a sentence boundary when one fits, so the note never ends
    // mid-list ("net contents, alcohol content, and…"). Only when the first
    // sentence alone exceeds the cap, fall back to a word cut — and tidy any
    // dangling connector or comma before the ellipsis.
    const head = t.slice(0, NOTE_MAX);
    const lastSentenceEnd = head.lastIndexOf(". ");
    if (lastSentenceEnd > 40) {
      t = head.slice(0, lastSentenceEnd);
    } else {
      t = head.replace(/\s+\S*$/, "").replace(/[,;:\s]+(?:and|or)?$/i, "") + "…";
    }
  }
  return t;
}

export function coerceExtractedLabel(raw: unknown): ExtractedLabel {
  const o = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  // A field value is real only if it's a non-empty string that isn't a model
  // "I couldn't read this" sentinel.
  const str = (v: unknown): string | null =>
    typeof v === "string" && v.trim().length > 0 && !isSentinel(v) ? v : null;
  const quality: Quality =
    o.imageQuality === "good" || o.imageQuality === "fair" || o.imageQuality === "poor"
      ? o.imageQuality
      : "fair"; // unknown → treat cautiously, not optimistically

  const governmentWarning = str(o.governmentWarning);
  // Legible only if the model explicitly said so AND we actually have warning
  // text. Default to NOT legible — fail closed, never assume.
  const warningLegible = o.warningLegible === true && governmentWarning !== null;

  // Only accept one of the four valid categories; anything else (or absent) → null.
  const beverageType =
    o.beverageType === "spirits" ||
    o.beverageType === "wine" ||
    o.beverageType === "beer" ||
    o.beverageType === "other"
      ? o.beverageType
      : null;

  return {
    brandName: str(o.brandName),
    beverageType,
    classType: str(o.classType),
    alcoholContent: str(o.alcoholContent),
    netContents: str(o.netContents),
    producer: str(o.producer),
    originCountry: str(o.originCountry),
    governmentWarning,
    warningLegible,
    imageQuality: quality,
    notes: cleanNote(str(o.notes)),
  };
}
