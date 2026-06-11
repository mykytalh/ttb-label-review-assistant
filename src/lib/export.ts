/** CSV and plain-text export for single and batch review results. */
import { FIELD_LABELS, FieldKey, FieldResult, ReviewResult, Verdict } from "./types";

const VERDICT_EXPORT: Record<Verdict, string> = {
  pass: "Pass",
  warn: "Review",
  fail: "Fail",
  na: "Not checked",
};

/** Same field order as the AI EXTRACTION panel in the UI. */
const EXTRACT_FIELDS: FieldKey[] = [
  "brandName",
  "beverageType",
  "classType",
  "alcoholContent",
  "netContents",
  "producer",
  "originCountry",
  "governmentWarning",
];

/** One row of a batch export. */
export interface BatchExportRow {
  labelNumber: number;
  fileName: string;
  status: "complete" | "error";
  result?: ReviewResult;
  error?: string;
}

export interface BatchExportOptions {
  exportedAt?: Date;
}

/** RFC-4180-safe CSV cell: quote if it contains comma, quote, or newline. */
export function csvCell(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function formatDate(date: Date): string {
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function verdictText(v: Verdict | undefined): string {
  return v ? VERDICT_EXPORT[v] : "";
}

function fieldMap(fields: FieldResult[]) {
  return new Map(fields.map((f) => [f.field, f]));
}

/** Mirrors the UI: found value or the literal string "null". */
function extractValue(byField: Map<FieldKey, FieldResult>, key: FieldKey): string {
  return byField.get(key)?.found ?? "null";
}

/** Fail and review items only — empty when everything passed. */
function needsAttention(fields: FieldResult[]): string {
  const problems = fields.filter((f) => f.verdict === "fail" || f.verdict === "warn");
  if (problems.length === 0) return "";

  return problems
    .map((f) => {
      const tag = f.verdict === "fail" ? "FAIL" : "REVIEW";
      let line = `${FIELD_LABELS[f.field]} [${tag}]: ${f.message}`;
      if (f.subChecks?.some((s) => s.verdict === "fail" || s.verdict === "warn")) {
        const subs = f.subChecks
          .filter((s) => s.verdict === "fail" || s.verdict === "warn")
          .map((s) => `${s.label} (${verdictText(s.verdict)})`)
          .join("; ");
        line += ` (${subs})`;
      }
      return line;
    })
    .join(" | ");
}

/**
 * Batch CSV aligned with the AI EXTRACTION readout: file, date, image quality,
 * every extracted field (null when absent), then fail/review notes only.
 */
export function batchResultsToCsv(
  rows: BatchExportRow[],
  options: BatchExportOptions = {},
): string {
  const reviewed = formatDate(options.exportedAt ?? new Date());
  const header = [
    "#",
    "File",
    "Reviewed",
    "Overall",
    "imageQuality",
    ...EXTRACT_FIELDS,
    "extractorNotes",
    "needsAttention",
    "error",
  ];

  const lines = [header.map(csvCell).join(",")];
  const emptyExtract = EXTRACT_FIELDS.map(() => "");

  for (const row of rows) {
    if (row.status === "error") {
      lines.push(
        [
          String(row.labelNumber),
          row.fileName,
          reviewed,
          "",
          "",
          ...emptyExtract,
          "",
          "",
          row.error ?? "Review failed",
        ]
          .map(csvCell)
          .join(","),
      );
      continue;
    }

    const result = row.result;
    if (!result) continue;

    const byField = fieldMap(result.fields);

    lines.push(
      [
        String(row.labelNumber),
        row.fileName,
        reviewed,
        verdictText(result.overall),
        result.imageQuality.toUpperCase(),
        ...EXTRACT_FIELDS.map((key) => extractValue(byField, key)),
        result.notes ?? "",
        needsAttention(result.fields),
        "",
      ]
        .map(csvCell)
        .join(","),
    );
  }

  return lines.join("\r\n");
}

/**
 * Plain-text summary of a single review — for printing or saving to the file.
 * Deterministic and human-readable.
 */
export function singleResultToText(
  fileName: string,
  result: ReviewResult,
  timestamp: string,
): string {
  const lines: string[] = [];
  lines.push("ALCOHOL LABEL REVIEW — RESULT SUMMARY");
  lines.push("=".repeat(40));
  lines.push(`File:           ${fileName}`);
  lines.push(`Reviewed:       ${timestamp}`);
  lines.push(`Overall:        ${result.overall.toUpperCase()}`);
  lines.push(`Image quality:  ${result.imageQuality}`);
  if (result.notes) lines.push(`Notes:          ${result.notes}`);
  lines.push("");
  lines.push("FIELD RESULTS");
  lines.push("-".repeat(40));
  for (const f of result.fields) {
    lines.push(`[${f.verdict.toUpperCase().padEnd(4)}] ${FIELD_LABELS[f.field]}`);
    lines.push(`       ${f.message}`);
    if (f.expected !== null || f.found !== null) {
      lines.push(`       Application: ${f.expected ?? "—"}`);
      lines.push(`       On label:    ${f.found ?? "—"}`);
    }
  }
  lines.push("");
  lines.push(
    "This is an AI-assisted screening to support an agent's review. It does not " +
      "constitute a final compliance determination.",
  );
  return lines.join("\n");
}
