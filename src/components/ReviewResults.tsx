/**
 * Renders one ReviewResult. Failures and reviews are expanded by default; passes
 * collapse into a compact checklist. Verdicts use icon, word, and color together.
 */
"use client";

import { useState } from "react";
import { FIELD_LABELS, FieldResult, ReviewResult } from "@/lib/types";
import { VERDICT_ICON, VERDICT_LABEL } from "@/lib/client";
import ImageEditor from "./ImageEditor";

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
          {VERDICT_ICON[f.verdict]} {VERDICT_LABEL[f.verdict]}
        </span>
      </div>
      <p className="fr-msg">{f.message}</p>
      {f.subChecks && f.subChecks.length > 0 && (
        <ul className="fr-subchecks">
          {f.subChecks.map((s) => (
            <li key={s.label} className={`subcheck v-${s.verdict}`}>
              <span className="subcheck-icon" aria-hidden="true">
                {VERDICT_ICON[s.verdict]}
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

  return (
    <div className={imageUrl ? "result-with-image" : undefined}>
      {imageUrl && (
        <div className="result-image">
          <ImageEditor src={imageUrl} alt="The label that was reviewed" viewOnly />
        </div>
      )}

      <div className="result-body">
        {/* Headline verdict and field summary */}
        <div className={`overall v-${result.overall}`} role="status">
          <span className="badge-icon" aria-hidden="true">
            {VERDICT_ICON[result.overall]}
          </span>
          <div>
            <div>{OVERALL_TEXT[result.overall]}</div>
            <div className="scorecard">
              {fails.length > 0 && (
                <span className="count-chip v-fail">
                  {VERDICT_ICON.fail} {fails.length} failed
                </span>
              )}
              {reviews.length > 0 && (
                <span className="count-chip v-warn">
                  {VERDICT_ICON.warn} {reviews.length} to review
                </span>
              )}
              {passes.length > 0 && (
                <span className="count-chip v-pass">
                  {VERDICT_ICON.pass} {passes.length} verified
                </span>
              )}
              {notChecked.length > 0 && (
                <span className="count-chip v-na">
                  {VERDICT_ICON.na} {notChecked.length} not checked
                </span>
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
            <strong>⚠ This photo was hard to read.</strong> The results below may be
            unreliable{result.notes ? ` — ${result.notes}` : ""}. Retake the photo
            (better lighting, straight-on, no glare) and review again before
            relying on this.
          </div>
        )}
        {result.imageQuality === "fair" && (
          <p className="meta">
            Photo quality was <strong>fair</strong>
            {result.notes ? ` — ${result.notes}.` : "."} Double-check anything that
            looks off.
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
                <span className="passes-check" aria-hidden="true">✓</span>
                {passes.length} field{passes.length === 1 ? "" : "s"} verified
                <span className="passes-caret" aria-hidden="true">
                  {showPasses ? "▲" : "▼"}
                </span>
              </button>

              {showPasses ? (
                <div style={{ marginTop: 10 }}>
                  {passes.map((f) => (
                    <FieldCard key={f.field} f={f} />
                  ))}
                </div>
              ) : (
                <ul className="passes-list">
                  {passes.map((f) => (
                    <li key={f.field}>
                      <span aria-hidden="true">✓</span> {FIELD_LABELS[f.field]}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {/* Not-checked: neither in the application nor on the label. A quiet,
              neutral footnote — not an alarm, not a pass. */}
          {notChecked.length > 0 && (
            <p className="result-notchecked">
              Not checked (not in the application or on the label):{" "}
              {notChecked.map((f) => FIELD_LABELS[f.field]).join(", ")}.
            </p>
          )}
        </div>

        {/* AI extraction readout — what the model read off the label, as raw
            instrument data. Secondary to the verdicts, so it's collapsed. */}
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

        {typeof result.elapsedMs === "number" && (
          <p className="result-elapsed">
            ANALYZED IN {(result.elapsedMs / 1000).toFixed(1)}s
          </p>
        )}
      </div>
    </div>
  );
}
