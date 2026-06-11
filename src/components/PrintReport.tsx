/**
 * Print-only compliance record. Hidden on screen; revealed in @media print so
 * window.print() produces a structured worksheet instead of the interactive UI.
 */
import { ApplicationData, FIELD_LABELS, ReviewResult, FieldKey } from "@/lib/types";
import { VERDICT_LABEL } from "@/lib/client";

const OVERALL_TEXT: Record<string, string> = {
  pass: "PASS — all checked items meet requirements",
  warn: "NEEDS REVIEW — verify flagged items by eye",
  fail: "FAIL — one or more items do not meet requirements",
  na: "NOT DETERMINED — nothing could be checked",
};

const BEVERAGE_TEXT: Record<string, string> = {
  spirits: "Distilled spirits",
  wine: "Wine",
  beer: "Beer / malt beverage",
  other: "Other",
};

export default function PrintReport({
  app,
  result,
  fileName,
  reviewRef,
  imageUrl,
}: {
  app: ApplicationData;
  result: ReviewResult;
  fileName?: string;
  reviewRef: { id: string; at: string } | null;
  imageUrl?: string;
}) {
  const fieldFor = (k: FieldKey) => result.fields.find((f) => f.field === k);
  // Stable, human order for the record.
  const order: FieldKey[] = [
    "brandName",
    "beverageType",
    "classType",
    "alcoholContent",
    "netContents",
    "producer",
    "originCountry",
    "governmentWarning",
  ];
  const rows = order.map(fieldFor).filter(Boolean) as ReviewResult["fields"];

  // For the metadata block, show the *determined* beverage type. On "auto" that's
  // what was detected from the label (the field result's `found`), not the raw
  // "Auto" selection — so the record states an actual type, e.g. "Wine (auto-detected)".
  const btField = fieldFor("beverageType");
  const beverageDisplay =
    app.beverageType === "auto"
      ? btField?.found
        ? `${btField.found} (auto-detected)`
        : "Auto (not detected)"
      : BEVERAGE_TEXT[app.beverageType] || app.beverageType;

  return (
    <div className="print-report" aria-hidden="true">
      <header className="pr-head">
        <div>
          <h1>Alcohol Label Compliance Review</h1>
          <p className="pr-sub">Review record</p>
        </div>
        <div className="pr-ref">
          {reviewRef && (
            <>
              <div>
                <span className="pr-k">Reference</span>
                <span className="pr-v">{reviewRef.id}</span>
              </div>
              <div>
                <span className="pr-k">Date / time</span>
                <span className="pr-v">{reviewRef.at}</span>
              </div>
            </>
          )}
        </div>
      </header>

      <section className="pr-meta">
        <div>
          <span className="pr-k">Brand</span>
          <span className="pr-v">{app.brandName || "—"}</span>
        </div>
        <div>
          <span className="pr-k">Beverage type</span>
          <span className="pr-v">{beverageDisplay}</span>
        </div>
        <div>
          <span className="pr-k">Source image</span>
          <span className="pr-v">{fileName || "—"}</span>
        </div>
        <div>
          <span className="pr-k">Image quality</span>
          <span className="pr-v">{result.imageQuality}</span>
        </div>
      </section>

      <section className="pr-determination">
        <span className="pr-k">Overall determination</span>
        <strong>{OVERALL_TEXT[result.overall]}</strong>
      </section>

      <table className="pr-table">
        <thead>
          <tr>
            <th>Field</th>
            <th>Application</th>
            <th>On label</th>
            <th>Result</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((f) => (
            <tr key={f.field}>
              <td className="pr-field">{FIELD_LABELS[f.field]}</td>
              <td>{f.expected ?? "—"}</td>
              <td>{f.found ?? "—"}</td>
              <td className="pr-verdict">{VERDICT_LABEL[f.verdict]}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Per-field explanation — the "why" behind each verdict. */}
      <section className="pr-findings">
        <span className="pr-k">Findings</span>
        <ul>
          {rows.map((f) => (
            <li key={f.field}>
              <strong>{FIELD_LABELS[f.field]}</strong> — {VERDICT_LABEL[f.verdict]}: {f.message}
            </li>
          ))}
        </ul>
      </section>

      {/* Per-requirement breakdown for the government warning, if present. */}
      {rows.some((f) => f.subChecks?.length) && (
        <section className="pr-subchecks">
          {rows
            .filter((f) => f.subChecks?.length)
            .map((f) => (
              <div key={f.field}>
                <span className="pr-k">{FIELD_LABELS[f.field]} — detail</span>
                <ul>
                  {f.subChecks!.map((s) => (
                    <li key={s.label}>
                      {s.label}: {VERDICT_LABEL[s.verdict]}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
        </section>
      )}

      {(result.imageQuality !== "good" || result.notes) && (
        <section className="pr-notes">
          <span className="pr-k">Reviewer notes</span>
          <p>
            Image quality was reported as <strong>{result.imageQuality}</strong>
            {result.notes ? ` — ${result.notes}` : ""}. Items marked “Review” could
            not be auto-confirmed and should be checked by eye.
          </p>
        </section>
      )}

      {/* Raw AI extraction — exactly what the model read off the label, the source
          data behind every finding above. The government warning is shown in full. */}
      <section className="pr-extract">
        <span className="pr-k">AI extraction (raw, read from the label)</span>
        <dl>
          {order.map((k) => {
            const f = fieldFor(k);
            return (
              <div key={k} className="pr-extract-row">
                <dt>{FIELD_LABELS[k]}</dt>
                <dd>{f?.found ?? "— (not detected)"}</dd>
              </div>
            );
          })}
        </dl>
      </section>

      {imageUrl && (
        <section className="pr-image">
          <span className="pr-k">Reviewed label</span>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={imageUrl} alt="" />
        </section>
      )}

      <section className="pr-signoff">
        <div className="pr-sign-line">
          <span>Reviewing agent (print name)</span>
          <span>Signature</span>
          <span>Date</span>
        </div>
        <p className="pr-disclaimer">
          This is an AI-assisted preliminary review generated by the Label Review
          Assistant (prototype). It is not an official determination and must be
          confirmed by a compliance agent. No image or data from this review is
          retained by the tool.
        </p>
      </section>
    </div>
  );
}
