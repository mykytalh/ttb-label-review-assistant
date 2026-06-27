/**
 * Presentation layer over the validator's verdicts.
 *
 * `validate()` computes four engine verdicts (pass/warn/fail/na) that drive the
 * compliance logic. The agent-facing review console speaks a richer, more
 * specific vocabulary for *why* a field landed where it did — match vs an
 * acceptable cosmetic variation, a value mismatch vs an outright missing element.
 * These are pure derivations of the existing `FieldResult`, so the engine and its
 * tests are untouched; this is the only place the five-way display status lives.
 */
import { FieldResult, ReviewResult, Verdict } from "./types";

/** The field-level status the console shows, one step finer than the verdict. */
export type DisplayStatus =
  | "match" // exact match
  | "acceptable_variation" // passes, but differs cosmetically (case, punctuation, formatting, within tolerance)
  | "present" // on the label, but the application didn't provide a value to compare against
  | "needs_review" // soft finding — confirm by eye
  | "mismatch" // a value conflict between application and label
  | "missing" // a required element absent from the label
  | "not_checked"; // nothing to compare

export const DISPLAY_STATUS_LABELS: Record<DisplayStatus, string> = {
  match: "Matched",
  acceptable_variation: "Acceptable variation",
  present: "On label",
  needs_review: "Needs review",
  mismatch: "Mismatched",
  missing: "Missing",
  not_checked: "Not checked",
};

/**
 * Map one field's verdict to the console's five-way status.
 *
 * A `pass` splits two ways: an exact, character-for-character agreement is a
 * "match"; any pass that required normalization (case/punctuation folding, an
 * ABV within tolerance, a volume unit difference) is an "acceptable variation" —
 * which is exactly the brand-casing/punctuation handling the brief asks to see.
 * A `fail` splits on whether the label had a value at all: nothing found means a
 * required element is "missing"; a value that conflicts is a "mismatch".
 */
export function fieldDisplayStatus(f: FieldResult): DisplayStatus {
  switch (f.verdict) {
    case "na":
      return "not_checked";
    case "warn":
      return "needs_review";
    case "fail":
      return f.found == null ? "missing" : "mismatch";
    case "pass": {
      // A verbatim government warning is a clean match (its `expected` is just a
      // placeholder label, so don't compare strings for it).
      if (f.field === "governmentWarning") return "match";
      if (f.expected != null && f.found != null) {
        // "Acceptable variation" means the regulatorily-meaningful case: an
        // alcohol content that *differs* from the application but passed within
        // the allowed tolerance band (a permitted variation). An ABV that's the
        // same value — just wrapped in label text like "ALC 14.5% BY VOL" — is a
        // match. Every other passing field is semantically equal (casing, label
        // formatting, "Product of Italy" vs "Italy"), so it's a match too: the
        // validator only passes a field when the two genuinely agree.
        if (f.field === "alcoholContent") {
          const num = (s: string) => {
            const m = s.match(/(\d+(?:\.\d+)?)/);
            return m ? parseFloat(m[1]) : null;
          };
          const a = num(f.expected);
          const b = num(f.found);
          if (a != null && b != null) return a === b ? "match" : "acceptable_variation";
        }
        return "match";
      }
      // No application value to compare — the field is simply present on the label.
      return f.found != null ? "present" : "not_checked";
    }
  }
}

/** The overall recommendation shown at the top of a completed review. */
export interface Recommendation {
  key: "ready" | "review" | "rejection";
  /** Verdict tone, reused by the UI for color/icon. */
  tone: Verdict;
  title: string;
  description: string;
}

/**
 * Roll the worst field verdict up into the agent's recommended disposition.
 * The tool is advisory — these are recommendations, not decisions: a clean
 * review is cleared for approval, any soft finding routes to a human, and any
 * hard failure is flagged as a likely rejection.
 */
export function overallRecommendation(result: ReviewResult): Recommendation {
  switch (result.overall) {
    case "pass":
      return {
        key: "ready",
        tone: "pass",
        title: "Ready for Approval",
        description: "Every checked field matches the label. No compliance issues detected.",
      };
    case "fail":
      return {
        key: "rejection",
        tone: "fail",
        title: "Likely Rejection",
        description: "One or more required elements are missing or conflict with the application.",
      };
    // Both a soft finding (warn) and an all-unchecked review route to a human.
    case "warn":
    case "na":
    default:
      return {
        key: "review",
        tone: result.overall === "na" ? "na" : "warn",
        title: "Needs Agent Review",
        description: "Some fields need a human check before this application can be cleared.",
      };
  }
}
