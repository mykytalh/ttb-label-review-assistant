/**
 * Renders one ReviewResult. Failures and reviews are expanded by default; passes
 * collapse into a compact checklist. Verdicts use icon, word, and color together.
 */
"use client";

import { useState } from "react";
import { FIELD_LABELS, FieldResult, ReviewResult } from "@/lib/types";
import { VERDICT_LABEL } from "@/lib/client";
import { VerdictIcon } from "./Icon";
import ImageEditor from "./ImageEditor";
import type { Verdict } from "@/lib/types";

function CountChip({
  verdict,
  count,
  label,
}: {
  verdict: Verdict;
  count: number;
  label: string;
}) {
  return (
    <span className={`count-chip v-${verdict}`}>
      <span className="count-chip-icon" aria-hidden="true">
        <VerdictIcon verdict={verdict} size={12} />
      </span>
      {count} {label}
    </span>
  );
}

const OVERALL_TEXT = {
  pass: "All checks passed",
  warn: "Needs review",
  fail: "Problems found",
  na: "Nothing to check",
} as const;

/** A single expanded field result (used for failures/reviews, and passes once expanded). */
function FieldCard({ f }: { f: FieldResult }) {
  return (
    <div className={`field-result v-${f.verdict}`}>
      <div className="fr-head">
        <span className="fr-name">{FIELD_LABELS[f.field]}</span>
        <span className={`pill v-${f.verdict}`}>
          <span className="pill-icon" aria-hidden="true">
            <VerdictIcon verdict={f.verdict} size={12} />
          </span>
          {VERDICT_LABEL[f.verdict]}
        </span>
      </div>
      <p className="fr-msg">{f.message}</p>
      {f.subChecks && f.subChecks.length > 0 && (
        <ul className="fr-subchecks">
          {f.subChecks.map((s) => (
            <li key={s.label} className={`subcheck v-${s.verdict}`}>
              <span className="subcheck-icon" aria-hidden="true">
                <VerdictIcon verdict={s.verdict} size={12} />
              </span>
              {s.label}
            </li>
          ))}
        </ul>
      )}
      {(f.expected !== null || f.found !== null) && (
        <dl className="fr-compare">
          <dt>Application</dt>
          <dd>{f.expected ?? "—"}</dd>
          <dt>On label</dt>
          <dd>{f.found ?? "—"}</dd>
        </dl>
      )}
    </div>
  );
}

export default function ReviewResults({
  result,
  imageUrl,
}: {
  result: ReviewResult;
  imageUrl?: string;
}) {
  const [showPasses, setShowPasses] = useState(false);
  const [showExtract, setShowExtract] = useState(false);

  // Group fields by verdict: attention needed (fail/warn), pass, and not checked (na).
  const fails = result.fields.filter((f) => f.verdict === "fail");
  const reviews = result.fields.filter((f) => f.verdict === "warn");
  const attention = result.fields.filter((f) => f.verdict === "fail" || f.verdict === "warn");
  const passes = result.fields.filter((f) => f.verdict === "pass");
  const notChecked = result.fields.filter((f) => f.verdict === "na");

  // Raw extraction readout — what the model read, as instrument data. Lives
  // under the photo when there is one (read the label, read the extraction,
  // compare by eye in one column); falls back into the body otherwise.
  const aiExtract = (
    <div className="ai-extract">
      <button
        type="button"
        className="ai-extract-toggle"
        aria-expanded={showExtract}
        onClick={() => setShowExtract((s) => !s)}
      >
        <span className="ai-extract-label">AI EXTRACTION</span>
        <span className="ai-extract-quality">
          IMAGE QUALITY: {result.imageQuality.toUpperCase()}
        </span>
        <span aria-hidden="true">{showExtract ? "▲" : "▼"}</span>
      </button>
      {showExtract && (
        <>
          <dl className="ai-extract-body">
            {result.fields.map((f) => (
              <div key={f.field} className="ai-extract-row">
                <dt>{FIELD_LABELS[f.field]}</dt>
                <dd>{f.found ?? "null"}</dd>
              </div>
            ))}
          </dl>
          <p className="ai-extract-note">
            AI-assisted extraction and compliance verification
          </p>
        </>
      )}
    </div>
  );

  return (
    <div className={imageUrl ? "result-with-image" : undefined}>
      {imageUrl && (
        <div className="result-image">
          <ImageEditor src={imageUrl} alt="The label that was reviewed" viewOnly />
          {aiExtract}
        </div>
      )}

      <div className="result-body">
        {/* Headline verdict and field summary */}
        <div className={`overall v-${result.overall}`} role="status">
          <div>
            <div className="overall-headline">{OVERALL_TEXT[result.overall]}</div>
            <div className="scorecard">
              {fails.length > 0 && (
                <CountChip verdict="fail" count={fails.length} label="failed" />
              )}
              {reviews.length > 0 && (
                <CountChip verdict="warn" count={reviews.length} label="to review" />
              )}
              {passes.length > 0 && (
                <CountChip verdict="pass" count={passes.length} label="verified" />
              )}
              {notChecked.length > 0 && (
                <CountChip verdict="na" count={notChecked.length} label="not checked" />
              )}
            </div>
          </div>
        </div>

        {/* The tool advises; the person decides. Make the advisory nature explicit
            on screen (the printed report carries the same note) so a confident
            green "all checks passed" is never mistaken for an official decision. */}
        <p className="advisory-note">
          AI-assisted review — confirm by eye before making a decision.
        </p>

        {result.imageQuality === "poor" && (
          <div className="quality-alert" role="alert">
            <strong>
              <span className="quality-alert-icon" aria-hidden="true">⚠</span>
              This photo was hard to read.
            </strong>{" "}
            The results below may be
            unreliable{result.notes ? ` — ${result.notes}` : ""}. Retake the photo
            (better lighting, straight-on, no glare) and review again before
            relying on this.
          </div>
        )}
        {result.imageQuality === "fair" && (
          <p className="meta">
            Photo quality was <strong>fair</strong>
            {/* No period after a note that already ends in one or an ellipsis. */}
            {result.notes ? ` — ${result.notes}${/[.!?…]$/.test(result.notes) ? "" : "."}` : "."} Double-check
            anything that looks off.
          </p>
        )}

        {/* Field detail scrolls within the viewport so the headline verdict and
            label image stay in view on a long result. */}
        <div className="result-scroll">
          {/* Things that need a human lead — expanded, because that's the work. */}
          {attention.length > 0 && (
            <div className="result-issues">
              {attention.map((f) => (
                <FieldCard key={f.field} f={f} />
              ))}
            </div>
          )}

          {/* Verified fields recede into a compact checklist, expandable on demand. */}
          {passes.length > 0 && (
            <div className="result-passes">
              <button
                type="button"
                className="passes-toggle"
                aria-expanded={showPasses}
                onClick={() => setShowPasses((s) => !s)}
              >
                <span className="passes-toggle-icon" aria-hidden="true">
                  <VerdictIcon verdict="pass" size={12} />
                </span>
                <span className="passes-toggle-label">
                  {passes.length} field{passes.length === 1 ? "" : "s"} verified
                </span>
                <span className="passes-caret" aria-hidden="true">
                  {showPasses ? "▲" : "▼"}
                </span>
              </button>

              {showPasses ? (
                <div className="passes-expanded">
                  {passes.map((f) => (
                    <FieldCard key={f.field} f={f} />
                  ))}
                </div>
              ) : (
                <ul className="passes-list">
                  {passes.map((f) => (
                    <li key={f.field}>{FIELD_LABELS[f.field]}</li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {/* Not-checked: neither in the application nor on the label. A quiet,
              neutral footnote — not an alarm, not a pass. */}
          {notChecked.length > 0 && (
            <p className="result-notchecked">
              Not checked: {notChecked.map((f) => FIELD_LABELS[f.field]).join(", ")}.
            </p>
          )}
        </div>

        {!imageUrl && aiExtract}

        {typeof result.elapsedMs === "number" && (
          <p className="result-elapsed">
            ANALYZED IN {(result.elapsedMs / 1000).toFixed(1)}s
          </p>
        )}
      </div>
    </div>
  );
}
