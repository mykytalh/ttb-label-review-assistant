/**
 * Mock COLA application records — the agent's review queue.
 *
 * These simulate already-submitted label applications the way the real COLA
 * system would supply them: application metadata plus an attached label image.
 * The records are generated at build time from a free public sample of the TTB
 * COLA registry (see `scripts/gen-mock-cola.mjs`) and committed as static data —
 * the running app has no COLA dependency. A record maps directly onto the
 * engine's `ApplicationData`, so the existing extract→validate pipeline reviews
 * it unchanged.
 */
import seed from "../data/mock-cola.json";
import { ApplicationData, BeverageType } from "./types";

export type ApplicationStatus = "Pending Review" | "Needs Review" | "Ready" | "Reviewed";
export type Priority = "normal" | "high";

/** One pending application in the review queue. */
export interface ColaApplication {
  /** Friendly queue id, e.g. COLA-2026-001. */
  id: string;
  /** Authentic TTB COLA id from the source registry record. */
  ttbId: string;
  applicantName: string;
  // --- The application's claimed fields (cross-checked against the label). ---
  brandName: string;
  beverageType: BeverageType;
  classType?: string;
  alcoholContent?: string;
  netContents?: string;
  originCountry?: string;
  // --- Registry metadata, shown for context (not auto-validated). ---
  productName?: string | null;
  registryClass?: string | null;
  permitNumber?: string | null;
  sourceLabel?: string | null;
  status: ApplicationStatus;
  priority: Priority;
  submittedAt: string | null;
  /** Path to the attached label artwork under /public. */
  labelImage: string;
  /** Author's note on the intended scenario (for the demo/About page). */
  scenario?: string;
  /** The outcome this record was built to demonstrate. */
  expected?: string;
}

export const MOCK_APPLICATIONS = seed as ColaApplication[];

/**
 * Project a queue record onto the engine's application shape. Only the fields the
 * prototype cross-checks are forwarded; producer/address is shown as reference
 * metadata but not auto-graded here (its on-label form varies too much to assert
 * against a single committed image without manual confirmation).
 */
export function toApplicationData(app: ColaApplication): ApplicationData {
  return {
    brandName: app.brandName,
    beverageType: app.beverageType,
    classType: app.classType,
    alcoholContent: app.alcoholContent,
    netContents: app.netContents,
    originCountry: app.originCountry,
  };
}
