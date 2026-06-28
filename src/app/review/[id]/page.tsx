"use client";

/**
 * Application Review — the heart of the console.
 *
 * The agent opens a pending application, sees the attached label with the pulled
 * application data beneath it, and runs AI verification with one click. The
 * recommended disposition sits up top with the action buttons; the field-by-field
 * results sit beside the label. Recording a decision returns the agent to the
 * queue. The AI extracts; the code judges; the human decides.
 */
import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { postReview, ReviewError } from "@/lib/client";
import { fieldDisplayStatus, overallRecommendation, DISPLAY_STATUS_LABELS } from "@/lib/review-status";
import { BEVERAGE_LABELS, FIELD_LABELS, ReviewResult } from "@/lib/types";
import type { ColaApplication } from "@/lib/mock-cola";
import { decisionLabel, getDecision, setDecision, getStoredResult, storeResult, type Decision, type DecisionSource, type DecisionType } from "@/lib/decisions";

/** Fetch a committed label image and base64-encode it for /api/review. */
async function imageToBase64(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error("Label image could not be loaded.");
  const bytes = new Uint8Array(await res.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

const DECISIONS: { key: DecisionType; label: string; cls: string }[] = [
  { key: "approved", label: "Approve", cls: "btn-decision--approve" },
  { key: "needs_info", label: "Request info", cls: "btn-decision--info" },
  { key: "rejected", label: "Reject", cls: "btn-decision--reject" },
];


function decisionPill(d: DecisionType, source: DecisionSource) {
  const cls = d === "approved" ? "pill--ready" : d === "rejected" ? "pill--rejection" : "pill--review";
  return <span className={`pill ${cls}`}>{decisionLabel(d, source)}</span>;
}

function decisionIcon(key: "ready" | "review" | "rejection") {
  if (key === "ready")
    return <svg viewBox="0 0 24 24" fill="none" stroke="var(--success-dark)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><path d="M8 12l3 3 5-6" /></svg>;
  if (key === "review")
    return <svg viewBox="0 0 24 24" fill="none" stroke="var(--warning-dark)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2l10 18H2z" /><line x1="12" y1="9" x2="12" y2="14" /><circle cx="12" cy="17.5" r="0.6" fill="var(--warning-dark)" /></svg>;
  return <svg viewBox="0 0 24 24" fill="none" stroke="var(--error-dark)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" /></svg>;
}

export default function ReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();

  const [app, setApp] = useState<ColaApplication | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [result, setResult] = useState<ReviewResult | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [verifyError, setVerifyError] = useState<string | null>(null);

  const [decision, setDecisionRec] = useState<Decision | null>(null);
  const [note, setNote] = useState("");
  const [savingDecision, setSavingDecision] = useState<DecisionType | null>(null);

  const [showAppData, setShowAppData] = useState(false);
  const [lightbox, setLightbox] = useState(false);

  useEffect(() => {
    let active = true;
    setApp(null);
    // Decision + prior verification persist client-side (localStorage), so an
    // actioned application reopens to its findings — no forced re-run.
    const existing = getDecision(id);
    setDecisionRec(existing ?? null);
    setNote(existing?.note ?? "");
    setResult(getStoredResult(id) ?? null);
    fetch(`/api/applications/${id}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("not found"))))
      .then((data) => {
        if (active) setApp(data.application);
      })
      .catch(() => active && setLoadError("Application not found."));
    return () => {
      active = false;
    };
  }, [id]);

  useEffect(() => {
    if (!lightbox) return;
    const prev = document.activeElement as HTMLElement | null;
    (document.querySelector(".lightbox-close") as HTMLElement | null)?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setLightbox(false);
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("keydown", onKey); prev?.focus?.(); };
  }, [lightbox]);

  const runVerification = useCallback(async () => {
    if (!app || verifying) return; // ignore a second trigger while one is in flight
    setVerifying(true);
    setVerifyError(null);
    try {
      const base64 = await imageToBase64(app.labelImage);
      const review = await postReview(
        {
          brandName: app.brandName,
          beverageType: app.beverageType,
          classType: app.classType,
          alcoholContent: app.alcoholContent,
          netContents: app.netContents,
          originCountry: app.originCountry,
        },
        base64,
        "image/jpeg",
      );
      setResult(review);
      storeResult(id, review); // persist so re-opening shows the findings
    } catch (e) {
      setVerifyError(e instanceof ReviewError ? e.message : "Verification failed. Please try again.");
    } finally {
      setVerifying(false);
    }
  }, [app, id, verifying]);

  function record(d: DecisionType) {
    setSavingDecision(d);
    setDecision(id, d, note, "agent"); // persist to localStorage
    router.push(`/?actioned=${id}&as=${d}`);
  }

  if (loadError) {
    return (
      <div>
        <p className="breadcrumb"><Link href="/"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6" /></svg>Label Approvals</Link></p>
        <div className="console-empty">{loadError}</div>
      </div>
    );
  }
  if (!app) {
    return <div className="console-loading"><span className="spinner" aria-hidden="true" /> Loading application…</div>;
  }

  const rec = result ? overallRecommendation(result) : null;
  const appRows: [string, string | undefined][] = [
    ["Brand name", app.brandName],
    ["Beverage type", BEVERAGE_LABELS[app.beverageType]],
    ["Class / type", app.classType],
    ["Alcohol content", app.alcoholContent],
    ["Net contents", app.netContents],
    ["Country of origin", app.originCountry],
    ["Applicant", app.applicantName],
  ];

  return (
    <div className="review-page">
      <p className="breadcrumb"><Link href="/"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6" /></svg>Label Approvals</Link></p>

      <header className="review-head">
        <div className="review-head-id">
          <h1 className="review-title">{app.brandName}</h1>
          <span className="review-meta">
            <span className="worklist-id">{app.id}</span> · {app.applicantName}
            {app.priority === "high" && <> · <span className="priority-flag">● High priority</span></>}
          </span>
        </div>
        {decision ? decisionPill(decision.decision, decision.source) : <span className="pill pill--pending">Pending review</span>}
      </header>

      {/* Decision up top: recommendation + the agent's action, once verified. */}
      {result && rec && (
        <section className={`verdict-strip verdict-strip--${rec.key}`} aria-live="polite">
          <div className="verdict-row">
            <span className="decision-icon" aria-hidden="true">{decisionIcon(rec.key)}</span>
            <div className="verdict-text">
              <p className="decision-title">{rec.title}</p>
              <p className="decision-desc">{rec.description}</p>
            </div>
            <div className="verdict-buttons">
              {DECISIONS.map((d) => (
                <button
                  key={d.key}
                  className={`btn-decision ${d.cls}${decision?.decision === d.key ? " is-set" : ""}`}
                  onClick={() => record(d.key)}
                  disabled={savingDecision !== null}
                >
                  {savingDecision === d.key ? "Saving…" : d.label}
                </button>
              ))}
            </div>
          </div>
          <input
            className="decision-note-inline"
            placeholder="Add a note (optional)…"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={500}
            aria-label="Decision note"
          />
        </section>
      )}

      <div className="review-grid">
        {/* Left: label artwork + the pulled application data */}
        <div className="review-col">
          <section className="review-pane">
            <div className="review-pane-head">
              <span>Submitted label</span>
              <span className="worklist-id">{app.ttbId}</span>
            </div>
            <figure className="review-label-figure">
              <button type="button" className="label-zoom-btn" onClick={() => setLightbox(true)} aria-label="Zoom label image">
                <Image src={app.labelImage} alt={`Label for ${app.brandName}`} width={560} height={560} style={{ width: "auto", height: "auto" }} unoptimized />
                <span className="label-zoom-hint" aria-hidden="true">⤢ Click to zoom</span>
              </button>
            </figure>
          </section>

          {/* The application's claim — collapsible, under the label. After
              verification the field results carry the comparison, so this can be
              tucked away, but it stays available. */}
          <details className="side-panel" open={showAppData} onToggle={(e) => setShowAppData((e.target as HTMLDetailsElement).open)}>
            <summary>Application data</summary>
            <div className="raw-grid">
              {appRows.map(([k, v]) => (
                <div className="raw-row" key={k}>
                  <span className="raw-key">{k}</span>
                  <span className="raw-val">{v || <em>Not specified</em>}</span>
                </div>
              ))}
            </div>
          </details>

        </div>

        {/* Right: the verification action, then results */}
        <div className="review-col">
          {!result && (
            <section className="review-pane verify-pane">
              <div className="verify-cta">
                <p className="verify-lead">Run AI verification to read the label and cross-check every field against the application.</p>
                <button className="btn-verify" onClick={runVerification} disabled={verifying}>
                  {verifying ? (<><span className="spinner" aria-hidden="true" /> Reading label…</>) : "Run AI Verification"}
                </button>
                {verifyError && <p className="verify-hint" style={{ color: "var(--error-dark)" }}>{verifyError}</p>}
              </div>
            </section>
          )}

          {result && (
            <section className="review-pane" aria-live="polite">
              <div className="review-pane-head">
                <span>Field verification</span>
                <button className="btn-rerun" onClick={() => { setResult(null); runVerification(); }} disabled={verifying} aria-label="Re-run verification">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" /><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" /></svg>
                  Re-run
                </button>
              </div>
              {(() => {
                const dss = result.fields.map(fieldDisplayStatus);
                const attention = dss.filter((s) => s === "needs_review" || s === "mismatch" || s === "missing").length;
                const verified = dss.filter((s) => s === "match" || s === "acceptable_variation" || s === "present").length;
                const notChecked = dss.filter((s) => s === "not_checked").length;
                return (
                  <div className="ft-summary">
                    {attention > 0 && <span className="ft-sum ft-sum--warn">{attention} need{attention === 1 ? "s" : ""} attention</span>}
                    {verified > 0 && <span className="ft-sum ft-sum--ok">{verified} verified</span>}
                    {notChecked > 0 && <span className="ft-sum ft-sum--muted">{notChecked} not checked</span>}
                  </div>
                );
              })()}
              <ul className="results-list">
                {result.fields.map((f) => {
                  const ds = fieldDisplayStatus(f);
                  const flagged = ds === "needs_review" || ds === "mismatch" || ds === "missing";
                  if (flagged) {
                    // Only here do both values matter — show the comparison + guidance.
                    return (
                      <li key={f.field} className={`result-row result-flagged result-flagged--${ds}`}>
                        <div className="result-top">
                          <span className="result-field">{FIELD_LABELS[f.field]}</span>
                          <span className={`pill pill--${ds}`}>{DISPLAY_STATUS_LABELS[ds]}</span>
                        </div>
                        <p className="result-msg">{f.message}</p>
                        <div className="result-compare">
                          <div className="result-cmp"><span className="result-cmp-k">Application</span><span className="result-cmp-v">{f.expected ?? "—"}</span></div>
                          <div className="result-cmp"><span className="result-cmp-k">On label</span><span className="result-cmp-v" title={f.found ?? undefined}>{f.found ?? "—"}</span></div>
                        </div>
                      </li>
                    );
                  }
                  // Verified / not-checked: one quiet line, no duplicated values.
                  const note =
                    ds === "acceptable_variation" ? `${f.expected} → ${f.found}`
                    : ds === "not_checked" ? "Not provided / not on label"
                    : f.found ?? "";
                  return (
                    <li key={f.field} className="result-row">
                      <span className="result-field">{FIELD_LABELS[f.field]}</span>
                      <span className="result-note" title={note}>{note}</span>
                      <span className={`pill pill--${ds}`}>{DISPLAY_STATUS_LABELS[ds]}</span>
                    </li>
                  );
                })}
              </ul>
              {result.elapsedMs != null && (
                <p className="ft-elapsed">Verified in {(result.elapsedMs / 1000).toFixed(1)}s</p>
              )}
            </section>
          )}
        </div>
      </div>

      {lightbox && (
        <div className="lightbox" role="dialog" aria-modal="true" aria-label={`${app.brandName} label, enlarged`} onClick={() => setLightbox(false)}>
          <button className="lightbox-close" aria-label="Close" onClick={() => setLightbox(false)}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg></button>
          {/* eslint-disable-next-line @next/next/no-img-element -- full-res zoom, sizing is intrinsic */}
          <img src={app.labelImage} alt={`Label for ${app.brandName}, enlarged`} className="lightbox-img" onClick={(e) => e.stopPropagation()} />
        </div>
      )}
    </div>
  );
}
