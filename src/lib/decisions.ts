/**
 * Agent decisions — persisted in the browser (localStorage).
 *
 * A real deployment would persist these server-side behind an audit log; for a
 * single-agent prototype, localStorage is the right-sized choice: decisions
 * survive refreshes and work on a static/serverless deploy with no backend
 * state. Each decision records whether it was made by the agent by hand or
 * applied automatically by a batch run, plus an optional note.
 */
import type { ReviewResult } from "./types";

/** A disposition an agent (or a batch run) can apply to an application. */
export type DecisionType = "approved" | "rejected" | "needs_info";
/** Whether a disposition was made by the agent by hand or applied by a batch run. */
export type DecisionSource = "agent" | "batch";

/** A recorded disposition: the call, an optional note, who made it, and when. */
export interface Decision {
  decision: DecisionType;
  note?: string;
  decidedAt: string;
  source: DecisionSource;
}

const KEY = "cola-decisions-v1";

function readAll(): Record<string, Decision> {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(localStorage.getItem(KEY) || "{}");
  } catch {
    return {};
  }
}

function writeAll(all: Record<string, Decision>): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    /* storage unavailable (private mode) — decisions simply won't persist */
  }
}

/** Human label for a disposition — batch decisions read as "Auto-…". */
export function decisionLabel(decision: DecisionType, source: DecisionSource): string {
  if (source === "batch") {
    return decision === "approved" ? "Auto-approved" : decision === "rejected" ? "Auto-rejected" : "Auto-flagged";
  }
  return decision === "approved" ? "Approved" : decision === "rejected" ? "Rejected" : "Needs info";
}

/** Every stored disposition, keyed by application id. */
export function getDecisions(): Record<string, Decision> {
  return readAll();
}

/** The stored disposition for one application, or undefined if none. */
export function getDecision(id: string): Decision | undefined {
  return readAll()[id];
}

/** Record (or overwrite) a disposition and return the stored entry. */
export function setDecision(id: string, decision: DecisionType, note: string | undefined, source: DecisionSource): Decision {
  const all = readAll();
  const entry: Decision = { decision, note: note?.trim() || undefined, decidedAt: new Date().toISOString(), source };
  all[id] = entry;
  writeAll(all);
  return entry;
}

/** Queue tallies for the worklist header. */
export interface QueueStats {
  total: number;
  decided: number;
  pending: number;
  high: number;
}

/**
 * Derive the queue counts from the *current* applications and the stored
 * decisions. Only decisions for applications still in the queue are counted as
 * decided — a stored decision for an id no longer present (e.g. a record removed
 * since it was actioned) is ignored, so `pending` can never go negative.
 */
export function queueStats(
  apps: ReadonlyArray<{ id: string; priority?: string }>,
  decisions: Record<string, Decision>,
): QueueStats {
  const total = apps.length;
  const decided = apps.filter((a) => decisions[a.id]?.decision).length;
  const high = apps.filter((a) => a.priority === "high" && !decisions[a.id]?.decision).length;
  return { total, decided, pending: total - decided, high };
}

// --- Verification results ---
// Persisted alongside decisions so re-opening an actioned application shows its
// prior findings (no forced re-run). Same right-sized localStorage rationale.

const RESULTS_KEY = "cola-results-v1";

function readResults(): Record<string, ReviewResult> {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(localStorage.getItem(RESULTS_KEY) || "{}");
  } catch {
    return {};
  }
}

/** The cached verification result for one application, if it has been reviewed. */
export function getStoredResult(id: string): ReviewResult | undefined {
  return readResults()[id];
}

/** Cache a verification result so re-opening the application shows it without a re-run. */
export function storeResult(id: string, result: ReviewResult): void {
  try {
    const all = readResults();
    all[id] = result;
    localStorage.setItem(RESULTS_KEY, JSON.stringify(all));
  } catch {
    /* storage unavailable */
  }
}
