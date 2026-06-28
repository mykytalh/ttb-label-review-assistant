/** Tests for agent-decision + result persistence (localStorage-backed). */
import { describe, it, expect, beforeEach } from "vitest";
import {
  setDecision,
  getDecision,
  getDecisions,
  decisionLabel,
  storeResult,
  getStoredResult,
} from "./decisions";
import type { ReviewResult } from "./types";

// jsdom isn't installed, so shim window + an in-memory localStorage so the
// SSR guard in decisions.ts passes and reads/writes hit our store.
function mockStorage(): Storage {
  const store = new Map<string, string>();
  return {
    getItem: (k) => (store.has(k) ? store.get(k)! : null),
    setItem: (k, v) => void store.set(k, String(v)),
    removeItem: (k) => void store.delete(k),
    clear: () => store.clear(),
    key: (i) => [...store.keys()][i] ?? null,
    get length() { return store.size; },
  } as Storage;
}

beforeEach(() => {
  Object.defineProperty(globalThis, "window", { value: globalThis, configurable: true });
  Object.defineProperty(globalThis, "localStorage", { value: mockStorage(), configurable: true });
});

describe("decisions persistence", () => {
  it("records and reads back a decision", () => {
    setDecision("COLA-1", "approved", "looks good", "agent");
    const d = getDecision("COLA-1");
    expect(d?.decision).toBe("approved");
    expect(d?.note).toBe("looks good");
    expect(d?.source).toBe("agent");
    expect(d?.decidedAt).toBeTruthy();
  });

  it("overwrites an existing decision", () => {
    setDecision("COLA-1", "approved", undefined, "batch");
    setDecision("COLA-1", "rejected", "ABV off", "agent");
    expect(getDecision("COLA-1")?.decision).toBe("rejected");
  });

  it("trims a blank note to undefined", () => {
    setDecision("COLA-1", "needs_info", "   ", "agent");
    expect(getDecision("COLA-1")?.note).toBeUndefined();
  });

  it("getDecisions returns every entry", () => {
    setDecision("a", "approved", undefined, "batch");
    setDecision("b", "rejected", undefined, "batch");
    expect(Object.keys(getDecisions())).toHaveLength(2);
  });

  it("is empty for unknown ids", () => {
    expect(getDecision("nope")).toBeUndefined();
    expect(getDecisions()).toEqual({});
  });

  it("survives corrupted JSON in storage", () => {
    localStorage.setItem("cola-decisions-v1", "{not valid json");
    expect(getDecisions()).toEqual({});
  });
});

describe("decisionLabel", () => {
  it("agent decisions read plainly", () => {
    expect(decisionLabel("approved", "agent")).toBe("Approved");
    expect(decisionLabel("rejected", "agent")).toBe("Rejected");
    expect(decisionLabel("needs_info", "agent")).toBe("Needs info");
  });

  it("batch decisions read as Auto-…", () => {
    expect(decisionLabel("approved", "batch")).toBe("Auto-approved");
    expect(decisionLabel("rejected", "batch")).toBe("Auto-rejected");
    expect(decisionLabel("needs_info", "batch")).toBe("Auto-flagged");
  });
});

describe("stored results", () => {
  const result: ReviewResult = { overall: "pass", fields: [], imageQuality: "good" };

  it("stores and retrieves a verification result", () => {
    storeResult("COLA-1", result);
    expect(getStoredResult("COLA-1")?.overall).toBe("pass");
  });

  it("returns undefined for an unstored id", () => {
    expect(getStoredResult("none")).toBeUndefined();
  });
});
