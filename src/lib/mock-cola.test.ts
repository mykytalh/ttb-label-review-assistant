import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MOCK_APPLICATIONS, toApplicationData } from "./mock-cola";
import { SELECTABLE_BEVERAGE_TYPES } from "./types";

describe("mock COLA records", () => {
  it("has at least four pending applications (brief minimum)", () => {
    expect(MOCK_APPLICATIONS.length).toBeGreaterThanOrEqual(4);
  });

  it("every record has a unique id and the core fields a queue row needs", () => {
    const ids = new Set<string>();
    for (const a of MOCK_APPLICATIONS) {
      expect(a.id).toMatch(/^COLA-\d{4}-\d{3}$/);
      expect(ids.has(a.id)).toBe(false);
      ids.add(a.id);
      expect(a.brandName.length).toBeGreaterThan(0);
      expect(a.applicantName.length).toBeGreaterThan(0);
      expect(["auto", "spirits", "wine", "beer", "other"]).toContain(a.beverageType);
    }
  });

  it("every committed label image exists on disk", () => {
    for (const a of MOCK_APPLICATIONS) {
      expect(a.labelImage.startsWith("/mock-labels/")).toBe(true);
      const path = join(process.cwd(), "public", a.labelImage);
      expect(existsSync(path), `${a.id} image missing: ${a.labelImage}`).toBe(true);
    }
  });

  it("the queue exercises every recommendation outcome", () => {
    const expected = new Set(MOCK_APPLICATIONS.map((a) => a.expected));
    expect(expected).toContain("Ready for Approval");
    expect(expected).toContain("Needs Agent Review");
    expect(expected).toContain("Likely Rejection");
  });

  it("toApplicationData forwards the claimed fields the validator checks", () => {
    const app = toApplicationData(MOCK_APPLICATIONS[0]);
    expect(app.brandName).toBe(MOCK_APPLICATIONS[0].brandName);
    expect(SELECTABLE_BEVERAGE_TYPES).toContain(app.beverageType);
  });
});
