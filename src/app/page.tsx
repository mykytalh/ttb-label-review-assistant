"use client";

/**
 * Review Queue — the console home and the agent's worklist.
 *
 * A real case queue: every row is a pending mock COLA application (real brand,
 * applicant, submitted date, attached label). The agent searches/filters/sorts,
 * then opens one to review. Status reflects the *workflow* — "Pending review"
 * until the agent records a disposition — not the verdict, which is only known
 * after running verification on the review screen.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { postReview } from "@/lib/client";
import { overallRecommendation } from "@/lib/review-status";
import { FIELD_LABELS } from "@/lib/types";
import type { ColaApplication } from "@/lib/mock-cola";
import { decisionLabel, getDecisions, setDecision, storeResult, type Decision, type DecisionType } from "@/lib/decisions";

type StatusFilter = "all" | "pending" | "approved" | "rejected" | "needs_info";
type SortKey = "submittedAt" | "brandName" | "priority";

const BATCH_CONCURRENCY = 2;

/** Fetch a committed label image and base64-encode it for /api/review. */
async function imageToBase64(url: string): Promise<string> {
  const res = await fetch(url);
  const bytes = new Uint8Array(await res.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

const DECISION_LABEL: Record<DecisionType, string> = {
  approved: "Approved",
  rejected: "Rejected",
  needs_info: "Needs info",
};

// Short type labels + a soft color per beverage class, so the column scans by hue.
const TYPE_SHORT: Record<string, string> = { wine: "Wine", spirits: "Spirits", beer: "Beer", other: "Other", auto: "Other" };
const DECISION_PILL: Record<DecisionType, string> = {
  approved: "pill--ready",
  rejected: "pill--rejection",
  needs_info: "pill--review",
};

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso + "T00:00:00");
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export default function ReviewQueuePage() {
  const router = useRouter();
  const [apps, setApps] = useState<ColaApplication[] | null>(null);
  const [decisions, setDecisions] = useState<Record<string, Decision>>({});
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<StatusFilter>("pending");
  const [sortKey, setSortKey] = useState<SortKey>("submittedAt");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  // A bottom-right stack of transient toasts — one per batch disposition (and
  // for a single decision recorded on the review screen). Each self-dismisses.
  const toastSeq = useRef(0);
  const [toasts, setToasts] = useState<{ key: number; message: string; tone: "ok" | "err" | "info" }[]>([]);
  const pushToast = useCallback((message: string, tone: "ok" | "err" | "info") => {
    const key = (toastSeq.current += 1);
    setToasts((t) => [...t, { key, message, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.key !== key)), 4000);
  }, []);
  const toneFor = (d: DecisionType): "ok" | "err" | "info" => (d === "approved" ? "ok" : d === "rejected" ? "err" : "info");

  // Bulk verification, run right from the queue via row selection. Results land
  // in the queue itself (status pills update) — no separate panel.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [batchRunning, setBatchRunning] = useState(false);
  const [batchProgress, setBatchProgress] = useState({ done: 0, total: 0 });

  // A decision recorded on the review screen redirects here with ?actioned — show
  // a confirmation toast, then clean the URL so a refresh doesn't repeat it.
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const id = p.get("actioned");
    const as = p.get("as") as DecisionType | null;
    if (id && as && DECISION_LABEL[as]) {
      pushToast(`${id} marked ${DECISION_LABEL[as]}`, toneFor(as));
      window.history.replaceState(null, "", "/");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let active = true;
    setDecisions(getDecisions()); // decisions persist client-side (localStorage)
    fetch("/api/applications")
      .then((r) => r.json())
      .then((data) => {
        if (active) setApps(data.applications);
      })
      .catch(() => active && setError("Could not load the review queue."));
    return () => {
      active = false;
    };
  }, []);

  const decisionFor = (id: string): DecisionType | null => decisions[id]?.decision ?? null;

  const filtered = useMemo(() => {
    if (!apps) return [];
    const q = query.trim().toLowerCase();
    let rows = apps.filter((a) => {
      if (q && !`${a.id} ${a.brandName} ${a.applicantName} ${a.productName ?? ""}`.toLowerCase().includes(q)) return false;
      const d = decisionFor(a.id);
      if (status === "all") return true;
      if (status === "pending") return d === null;
      return d === status;
    });
    const dir = sortDir === "asc" ? 1 : -1;
    rows = [...rows].sort((a, b) => {
      if (sortKey === "priority") {
        const rank = (x: ColaApplication) => (x.priority === "high" ? 1 : 0);
        return (rank(a) - rank(b)) * dir;
      }
      const av = (a[sortKey] ?? "") as string;
      const bv = (b[sortKey] ?? "") as string;
      return av.localeCompare(bv) * dir;
    });
    return rows;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apps, decisions, query, status, sortKey, sortDir]);

  // Short queue — show everything in one scrollable list (no pagination).
  const rows = filtered;

  const stats = useMemo(() => {
    const total = apps?.length ?? 0;
    const decided = Object.keys(decisions).length;
    const high = apps?.filter((a) => a.priority === "high" && !decisionFor(a.id)).length ?? 0;
    return { total, pending: total - decided, decided, high };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apps, decisions]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir(key === "brandName" ? "asc" : "desc");
    }
  };
  const caret = (key: SortKey) => (sortKey === key ? <span className="sort-caret">{sortDir === "asc" ? "▲" : "▼"}</span> : null);

  // --- Selection + bulk verification ---
  const toggleSelect = (id: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const allSelected = rows.length > 0 && rows.every((a) => selected.has(a.id));
  const toggleSelectAll = () =>
    setSelected((s) => {
      const next = new Set(s);
      if (allSelected) rows.forEach((a) => next.delete(a.id));
      else rows.forEach((a) => next.add(a.id));
      return next;
    });
  const clearSelection = () => setSelected(new Set());

  async function runBatch() {
    if (!apps) return;
    const targets = apps.filter((a) => selected.has(a.id));
    if (targets.length === 0) return;
    setBatchRunning(true);
    setBatchProgress({ done: 0, total: targets.length });
    const counts = { approved: 0, rejected: 0, needs_info: 0, error: 0 };
    let cursor = 0;
    const worker = async () => {
      while (cursor < targets.length) {
        const app = targets[cursor++];
        try {
          const b64 = await imageToBase64(app.labelImage);
          const result = await postReview(
            { brandName: app.brandName, beverageType: app.beverageType, classType: app.classType, alcoholContent: app.alcoholContent, netContents: app.netContents, originCountry: app.originCountry },
            b64,
            "image/jpeg",
          );
          // Auto-dispose from the recommendation: clear → approve, failing →
          // reject, anything ambiguous → flag for a human. Recorded as a batch
          // decision with an AI-derived note; persisted so re-opening shows why.
          const rec = overallRecommendation(result);
          let dt: DecisionType;
          let note: string;
          if (rec.key === "ready") {
            dt = "approved";
            note = "Auto-approved via batch — all checked fields matched the label.";
          } else if (rec.key === "rejection") {
            const probs = result.fields.filter((f) => f.verdict === "fail").map((f) => FIELD_LABELS[f.field]).join(", ");
            dt = "rejected";
            note = `Auto-rejected via batch — ${probs || "a required element is missing or conflicts"}.`;
          } else {
            const probs = result.fields.filter((f) => f.verdict === "warn").map((f) => FIELD_LABELS[f.field]).join(", ");
            dt = "needs_info";
            note = `Flagged by batch for a human check — ${probs || "verify by eye"}.`;
          }
          setDecision(app.id, dt, note, "batch");
          storeResult(app.id, result);
          counts[dt]++;
          // Pop a toast for this one the moment it's dispositioned.
          pushToast(`${app.brandName} · ${decisionLabel(dt, "batch")}`, toneFor(dt));
        } catch {
          counts.error++;
          pushToast(`${app.brandName} · Failed`, "err");
        }
        // Reflect each disposition the moment it lands — the row updates live and
        // (on the Pending view) drops out as the stack clears, until done.
        setDecisions(getDecisions());
        setBatchProgress((p) => ({ ...p, done: p.done + 1 }));
      }
    };
    await Promise.all(Array.from({ length: Math.min(BATCH_CONCURRENCY, targets.length) }, worker));
    setBatchRunning(false);
    setSelected(new Set());
    // Capstone summary once the whole batch is done.
    const parts: string[] = [];
    if (counts.approved) parts.push(`${counts.approved} approved`);
    if (counts.needs_info) parts.push(`${counts.needs_info} flagged`);
    if (counts.rejected) parts.push(`${counts.rejected} rejected`);
    if (counts.error) parts.push(`${counts.error} failed`);
    pushToast(`Done · ${targets.length} processed (${parts.join(", ")})`, "info");
  }

  return (
    <div>
      <header className="page-head">
        <div className="page-head-row">
          <div>
            <h1 className="page-title">Review Queue</h1>
            <p className="page-sub">
              Pending alcohol label applications awaiting compliance review. Select an application to verify its label
              against the submitted data.
            </p>
          </div>
        </div>
      </header>

      <div className="stat-strip">
        <div className="stat-card">
          <span className="stat-icon stat-icon--blue" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2 2 7l10 5 10-5-10-5z" /><path d="M2 17l10 5 10-5" /><path d="M2 12l10 5 10-5" /></svg>
          </span>
          <div className="stat-body"><span className="stat-label">Applications</span><span className="stat-num">{stats.total}</span></div>
        </div>
        <div className="stat-card">
          <span className="stat-icon stat-icon--slate" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
          </span>
          <div className="stat-body"><span className="stat-label">Pending review</span><span className="stat-num">{stats.pending}</span></div>
        </div>
        <div className="stat-card">
          <span className="stat-icon stat-icon--red" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 21V4h13l-2.5 4 2.5 4H4" /></svg>
          </span>
          <div className="stat-body"><span className="stat-label">High priority</span><span className="stat-num">{stats.high}</span></div>
        </div>
        <div className="stat-card">
          <span className="stat-icon stat-icon--green" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M8 12l3 3 5-6" /></svg>
          </span>
          <div className="stat-body"><span className="stat-label">Actioned</span><span className="stat-num">{stats.decided}</span></div>
        </div>
      </div>

      <div className="queue-toolbar">
        <div className="queue-search">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
          <input
            type="search"
            placeholder="Search brand, applicant, or ID…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search the review queue"
          />
        </div>
        <div className="seg" role="group" aria-label="Filter by status">
          {([["all", "All"], ["pending", "Pending"], ["approved", "Approved"], ["rejected", "Rejected"], ["needs_info", "Needs info"]] as [StatusFilter, string][]).map(
            ([key, label]) => (
              <button key={key} className={`seg-${key}${status === key ? " is-active" : ""}`} onClick={() => setStatus(key)} aria-pressed={status === key}>
                {label}
              </button>
            ),
          )}
        </div>
      </div>

      {error && <div className="console-empty">{error}</div>}
      {!apps && !error && (
        <div className="worklist-wrap" aria-busy="true" aria-label="Loading queue">
          {Array.from({ length: 8 }).map((_, i) => (
            <div className="skel-row" key={i}>
              <span className="skeleton skel-line" style={{ width: "30%" }} />
              <span className="skeleton skel-pill" />
            </div>
          ))}
        </div>
      )}

      {apps && (
        <>
          <div className="worklist-wrap">
            <table className="worklist">
              <thead>
                <tr>
                  <th className="col-check"><input type="checkbox" checked={allSelected} onChange={toggleSelectAll} aria-label="Select all" /></th>
                  <th className="col-num">#</th>
                  <th className="col-sortable" onClick={() => toggleSort("brandName")}>Application {caret("brandName")}</th>
                  <th>Type</th>
                  <th>ABV</th>
                  <th>Applicant</th>
                  <th className="col-sortable" onClick={() => toggleSort("submittedAt")}>Submitted {caret("submittedAt")}</th>
                  <th className="col-sortable" onClick={() => toggleSort("priority")}>Priority {caret("priority")}</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((a, i) => {
                  const d = decisionFor(a.id);
                  return (
                    <tr key={a.id} className={selected.has(a.id) ? "is-selected" : ""} onClick={() => router.push(`/review/${a.id}`)}>
                      <td className="col-check" onClick={(e) => { e.stopPropagation(); if ((e.target as HTMLElement).tagName !== "INPUT") toggleSelect(a.id); }}>
                        <input type="checkbox" checked={selected.has(a.id)} onChange={() => toggleSelect(a.id)} onClick={(e) => e.stopPropagation()} aria-label={`Select ${a.brandName}`} />
                      </td>
                      <td className="col-num">{i + 1}</td>
                      <td>
                        <div className="worklist-brand">
                          <Link href={`/review/${a.id}`} onClick={(e) => e.stopPropagation()}>{a.brandName}</Link>
                        </div>
                        <div className="worklist-sub">
                          <span className="worklist-id">{a.id}</span>
                          {a.productName ? ` · ${a.productName}` : ""}
                        </div>
                      </td>
                      <td><span className={`type-badge type-${a.beverageType}`}>{TYPE_SHORT[a.beverageType] ?? "Other"}</span></td>
                      <td>{a.alcoholContent ?? "—"}</td>
                      <td className="worklist-applicant">{a.applicantName}</td>
                      <td>{formatDate(a.submittedAt)}</td>
                      <td>{a.priority === "high" ? <span className="priority-flag">● High</span> : <span className="prio-normal">—</span>}</td>
                      <td>
                        {d ? (
                          <span className={`pill ${DECISION_PILL[d]}`}>{decisionLabel(d, decisions[a.id]?.source ?? "agent")}</span>
                        ) : (
                          <span className="pill pill--pending">Pending review</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {rows.length === 0 && (
                  <tr><td colSpan={9}><div className="console-empty">No applications match your filters.</div></td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* Floating bulk-action bar — appears when rows are selected. Results land
          back in the queue (the rows update), so there's no separate panel. */}
      {selected.size > 0 && (
        <div className="selection-bar" role="region" aria-label="Bulk actions">
          <span className="selection-count">
            {batchRunning ? `Processing ${batchProgress.done}/${batchProgress.total}…` : `${selected.size} selected`}
          </span>
          <button className="btn-verify selection-verify" onClick={runBatch} disabled={batchRunning}>
            {batchRunning ? (<><span className="spinner" aria-hidden="true" /> Processing…</>) : "Verify & auto-dispose"}
          </button>
          <button className="link-btn selection-clear" onClick={clearSelection} disabled={batchRunning}>Clear</button>
        </div>
      )}

      {/* Toast stack — one per disposition, bottom-right, self-dismissing. */}
      {toasts.length > 0 && (
        <div className="toast-stack" aria-live="polite">
          {toasts.map((t) => (
            <div key={t.key} className={`toast toast--${t.tone}`}>
              <span className="toast-dot" aria-hidden="true" />
              {t.message}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
