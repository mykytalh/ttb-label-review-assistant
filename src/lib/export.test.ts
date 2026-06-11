import { describe, it, expect } from "vitest";
import { csvCell, batchResultsToCsv, singleResultToText } from "./export";
import { ReviewResult } from "./types";

function fullResult(overall: ReviewResult["overall"]): ReviewResult {
  return {
    overall,
    imageQuality: "fair",
    notes: "Slight glare on lower panel.",
    fields: [
      {
        field: "brandName",
        verdict: "pass",
        expected: null,
        found: "FLYBIRD",
        message: "Not provided in application; label shows \"FLYBIRD\".",
      },
      {
        field: "beverageType",
        verdict: "pass",
        expected: "Auto",
        found: "Other",
        message: 'Detected as "other".',
      },
      {
        field: "classType",
        verdict: "pass",
        expected: null,
        found: "Baja Lime Margarita",
        message: "Not provided in application; label shows \"Baja Lime Margarita\".",
      },
      {
        field: "alcoholContent",
        verdict: overall === "warn" ? "warn" : "na",
        expected: null,
        found: null,
        message: "Not provided and not detected.",
      },
      {
        field: "netContents",
        verdict: "na",
        expected: null,
        found: null,
        message: "Not provided in the application and not detected on the label.",
      },
      {
        field: "producer",
        verdict: "pass",
        expected: null,
        found: "IMPORTED & BOTTLED BY SEBASTIAN NEXT EPISODIO",
        message: "Not provided in application; label shows producer.",
      },
      {
        field: "originCountry",
        verdict: "na",
        expected: null,
        found: "Product of Mexico",
        message: "Not checked — no origin in the application.",
      },
      {
        field: "governmentWarning",
        verdict: overall === "fail" ? "fail" : "pass",
        expected: null,
        found: "GOVERNMENT WARNING: (1) ACCORDING TO THE SURGEON GENERAL...",
        message: overall === "fail" ? "Warning text is not verbatim." : "Warning is verbatim.",
        subChecks: [
          { label: "Warning present", verdict: "pass" },
          { label: "Verbatim wording", verdict: overall === "fail" ? "fail" : "pass" },
          { label: '"GOVERNMENT WARNING:" in all caps', verdict: "pass" },
        ],
      },
    ],
  } as ReviewResult;
}

function parseCsv(csv: string): string[][] {
  return csv.split("\r\n").map((line) => {
    const cells: string[] = [];
    let cur = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQuotes) {
        if (ch === '"') {
          if (line[i + 1] === '"') {
            cur += '"';
            i++;
          } else {
            inQuotes = false;
          }
        } else {
          cur += ch;
        }
      } else if (ch === '"') {
        inQuotes = true;
      } else if (ch === ",") {
        cells.push(cur);
        cur = "";
      } else {
        cur += ch;
      }
    }
    cells.push(cur);
    return cells;
  });
}

describe("csvCell", () => {
  it("leaves plain values unquoted", () => {
    expect(csvCell("Old Tom")).toBe("Old Tom");
  });
  it("quotes and escapes values with commas, quotes, or newlines", () => {
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell("line1\nline2")).toBe('"line1\nline2"');
  });
});

describe("batchResultsToCsv", () => {
  const reviewedAt = new Date("2026-06-10T22:30:00");

  it("exports AI extraction fields matching the UI (null when absent)", () => {
    const csv = batchResultsToCsv(
      [{ labelNumber: 1, fileName: "flybird.jpg", status: "complete", result: fullResult("pass") }],
      { exportedAt: reviewedAt },
    );
    const [header, row] = parseCsv(csv);
    expect(header).toContain("imageQuality");
    expect(header).toContain("brandName");
    expect(header).toContain("governmentWarning");
    expect(header).toContain("needsAttention");

    const brandIdx = header.indexOf("brandName");
    const abvIdx = header.indexOf("alcoholContent");
    const qualityIdx = header.indexOf("imageQuality");
    const attentionIdx = header.indexOf("needsAttention");

    expect(row[1]).toBe("flybird.jpg");
    expect(row[qualityIdx]).toBe("FAIR");
    expect(row[brandIdx]).toBe("FLYBIRD");
    expect(row[abvIdx]).toBe("null");
    expect(row[attentionIdx]).toBe("");
  });

  it("fills needsAttention only for fail/review fields", () => {
    const csv = batchResultsToCsv(
      [{ labelNumber: 1, fileName: "a.png", status: "complete", result: fullResult("fail") }],
      { exportedAt: reviewedAt },
    );
    const [header, row] = parseCsv(csv);
    const attentionIdx = header.indexOf("needsAttention");
    expect(row[attentionIdx]).toContain("Government health warning [FAIL]");
    expect(row[attentionIdx]).toContain("Verbatim wording (Fail)");
  });

  it("includes warn items in needsAttention", () => {
    const csv = batchResultsToCsv(
      [{ labelNumber: 1, fileName: "a.png", status: "complete", result: fullResult("warn") }],
      { exportedAt: reviewedAt },
    );
    const [header, row] = parseCsv(csv);
    const attentionIdx = header.indexOf("needsAttention");
    expect(row[attentionIdx]).toContain("Alcohol content [REVIEW]");
  });

  it("includes error rows", () => {
    const csv = batchResultsToCsv([
      {
        labelNumber: 2,
        fileName: "bad.png",
        status: "error",
        error: "Still busy after retrying",
      },
    ]);
    const [header, row] = parseCsv(csv);
    expect(row[header.indexOf("error")]).toBe("Still busy after retrying");
  });

  it("escapes a filename containing a comma", () => {
    const csv = batchResultsToCsv([
      { labelNumber: 1, fileName: "lot,42.png", status: "complete", result: fullResult("pass") },
    ]);
    expect(csv).toContain('"lot,42.png"');
  });
});

describe("singleResultToText", () => {
  it("includes the verdict, file, timestamp, and a non-determination disclaimer", () => {
    const txt = singleResultToText("a.png", fullResult("warn"), "2024-01-01 10:00");
    expect(txt).toContain("Overall:        WARN");
    expect(txt).toContain("a.png");
    expect(txt).toContain("2024-01-01 10:00");
    expect(txt.toLowerCase()).toContain("does not constitute a final compliance determination");
  });
});
