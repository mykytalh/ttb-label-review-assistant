"use client";

/**
 * Label Approvals — the console home and the agent's worklist.
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
import { autoDisposition } from "@/lib/review-status";
import type { ColaApplication } from "@/lib/mock-cola";
import { decisionLabel, getDecisions, queueStats, setDecision, storeResult, type Decision, type DecisionType } from "@/lib/decisions";

type StatusFilter = "all" | "pending" | "actioned" | "approved" | "rejected" | "needs_info" | "high";
type SortKey = "submittedAt" | "brandName" | "priority";

const BATCH_CONCURRENCY = 2;

/** Fetch a committed label image and base64-encode it for /api/review. */
async function imageToBase64(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error("Label image could not be loaded.");
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
  const [searchOpen, setSearchOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const summaryRef = useRef<HTMLDivElement>(null);
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
  const batchAbort = useRef<AbortController | null>(null);
  // Rows currently being verified in the running batch — drives the per-row
  // spinner so the agent watches the work move down the list.
  const [verifyingIds, setVerifyingIds] = useState<Set<string>>(new Set());
  // End-of-run summary dialog — the triage hand-off: jump straight to the
  // exceptions (flagged / rejections) rather than re-reading the whole list.
  const [summary, setSummary] = useState<{ total: number; approved: number; needs_info: number; rejected: number; error: number } | null>(null);
  // IDs touched by the most recent run — marked in the list so the agent can see
  // which rows the last batch produced after the summary routes them to a filter.
  const [lastBatchIds, setLastBatchIds] = useState<Set<string>>(new Set());
  // The recent-batch rows are only highlighted once the agent enters a tab FROM
  // the summary dialog — not on the current view, and cleared on manual nav.
  const [highlightRecent, setHighlightRecent] = useState(false);

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
      .catch(() => active && setError("Could not load applications."));
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
      if (status === "high") return d === null && a.priority === "high";
      if (status === "pending") return d === null;
      if (status === "actioned") return d !== null;
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

  const rows = filtered;
  // Selection acts only on what's visible — a row hidden by search or a filter
  // is never silently included in the selected count or a bulk Auto-review.
  const selectedVisible = useMemo(() => rows.filter((a) => selected.has(a.id)), [rows, selected]);

  const stats = useMemo(() => queueStats(apps ?? [], decisions), [apps, decisions]);

  // Per-filter counts shown on the filter pills.
  const filterCounts = useMemo(() => {
    const c = { all: apps?.length ?? 0, pending: 0, approved: 0, rejected: 0, needs_info: 0 };
    for (const a of apps ?? []) {
      const d = decisions[a.id]?.decision;
      if (d) c[d]++; else c.pending++;
    }
    return c;
  }, [apps, decisions]);

  // Persist the view (filter / search / sort) and restore it on return, so going
  // back from a review lands where you left off — not on the default filter.
  const viewLoaded = useRef(false);
  useEffect(() => {
    const saved = sessionStorage.getItem("queue-view");
    if (saved) {
      try {
        const v = JSON.parse(saved);
        if (v.status) setStatus(v.status);
        if (typeof v.query === "string") setQuery(v.query);
        if (v.sortKey === "submittedAt" || v.sortKey === "brandName" || v.sortKey === "priority") setSortKey(v.sortKey);
        if (v.sortDir) setSortDir(v.sortDir);
        if (typeof v.highlightRecent === "boolean") setHighlightRecent(v.highlightRecent);
        if (Array.isArray(v.lastBatchIds)) setLastBatchIds(new Set(v.lastBatchIds));
      } catch { /* ignore malformed */ }
    }
  }, []);
  useEffect(() => {
    if (!viewLoaded.current) { viewLoaded.current = true; return; }
    sessionStorage.setItem("queue-view", JSON.stringify({ status, query, sortKey, sortDir, highlightRecent, lastBatchIds: [...lastBatchIds] }));
  }, [status, query, sortKey, sortDir, highlightRecent, lastBatchIds]);

  // Summary dialog a11y: move focus into it, close on Escape, restore focus out.
  useEffect(() => {
    if (!summary) return;
    const prev = document.activeElement as HTMLElement | null;
    summaryRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setSummary(null); };
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("keydown", onKey); prev?.focus?.(); };
  }, [summary]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir(key === "brandName" ? "asc" : "desc");
    }
  };
  const caret = (key: SortKey) =>
    sortKey === key ? (
      <svg className="sort-caret" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d={sortDir === "asc" ? "M6 15l6-6 6 6" : "M6 9l6 6 6-6"} />
      </svg>
    ) : null;
  // Props for a sortable column header — clickable, keyboard-operable, and
  // announced via aria-sort (so screen readers and keyboard users get parity).
  const sortable = (key: SortKey) => ({
    className: "col-sortable",
    role: "button" as const,
    tabIndex: 0,
    "aria-sort": (sortKey === key ? (sortDir === "asc" ? "ascending" : "descending") : "none") as "ascending" | "descending" | "none",
    onClick: () => toggleSort(key),
    onKeyDown: (e: React.KeyboardEvent) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleSort(key); } },
  });

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
    // Selected rows when the agent picked some; otherwise the whole pending set
    // (the default "review everything that needs it" action, intuitive at scale).
    const targets = selectedVisible.length > 0 ? selectedVisible : apps.filter((a) => !decisionFor(a.id));
    if (targets.length === 0) return;
    const ac = new AbortController();
    batchAbort.current = ac;
    setBatchRunning(true);
    setLastBatchIds(new Set());
    setHighlightRecent(false);
    setBatchProgress({ done: 0, total: targets.length });
    const counts = { approved: 0, rejected: 0, needs_info: 0, error: 0 };
    const doneIds: string[] = [];
    let cursor = 0;
    const worker = async () => {
      while (cursor < targets.length && !ac.signal.aborted) {
        const app = targets[cursor++];
        setVerifyingIds((s) => new Set(s).add(app.id));
        try {
          const b64 = await imageToBase64(app.labelImage);
          const result = await postReview(
            { brandName: app.brandName, beverageType: app.beverageType, classType: app.classType, alcoholContent: app.alcoholContent, netContents: app.netContents, originCountry: app.originCountry },
            b64,
            "image/jpeg",
            ac.signal,
          );
          // Auto-dispose from the recommendation (pure helper, unit-tested):
          // clear → approve, failing → reject, ambiguous → flag for a human.
          const { decision: dt, note } = autoDisposition(result);
          setDecision(app.id, dt, note, "batch");
          storeResult(app.id, result);
          counts[dt]++;
          doneIds.push(app.id);
          // Pop a toast for this one the moment it's dispositioned.
          pushToast(`${app.brandName} · ${decisionLabel(dt, "batch")}`, toneFor(dt));
        } catch {
          // Ignore aborts (the agent cancelled); only count genuine failures.
          if (!ac.signal.aborted) {
            counts.error++;
            pushToast(`${app.brandName} · Failed`, "err");
          }
        }
        // Reflect each disposition the moment it lands — the row updates live and
        // (on the Pending view) drops out as the stack clears, until done.
        setVerifyingIds((s) => { const n = new Set(s); n.delete(app.id); return n; });
        setDecisions(getDecisions());
        if (!ac.signal.aborted) setBatchProgress((p) => ({ ...p, done: p.done + 1 }));
      }
    };
    await Promise.all(Array.from({ length: Math.min(BATCH_CONCURRENCY, targets.length) }, worker));
    batchAbort.current = null;
    setBatchRunning(false);
    setVerifyingIds(new Set());
    setSelected(new Set());
    setDecisions(getDecisions());
    if (ac.signal.aborted) {
      // Cancelled mid-run: mark whatever finished, skip the summary dialog.
      setLastBatchIds(new Set(doneIds));
      setHighlightRecent(doneIds.length > 0);
      pushToast(`Auto-review cancelled — ${doneIds.length} reviewed`, "info");
      return;
    }
    // Mark these rows as "from the last run" + hand off to the summary dialog.
    setLastBatchIds(new Set(targets.map((t) => t.id)));
    setHighlightRecent(true); // marks persist (across nav) until the next batch
    setSummary({ total: targets.length, approved: counts.approved, needs_info: counts.needs_info, rejected: counts.rejected, error: counts.error });
  }

  const cancelBatch = () => batchAbort.current?.abort();

  // Jump from the summary dialog to a filtered view. Recent-batch marks persist
  // across all navigation until the next batch runs, so they're not cleared here.
  const goToFilter = (s: StatusFilter) => { setStatus(s); setSummary(null); };
  // Switching tabs/stat cards scopes selection to the new view — no ghost
  // selections from a tab you can no longer see.
  const selectFilter = (s: StatusFilter) => { setStatus(s); setSelected(new Set()); };

  return (
    <div className="queue-page">
      <header className="page-head">
        <div className="page-head-row">
          <div>
            <h1 className="page-title">Label Approvals</h1>
            <p className="page-sub">
              Pending alcohol label applications awaiting compliance review. Select one or more to verify their labels
              against the submitted data.
            </p>
          </div>
        </div>
      </header>

      <div className="stat-strip">
        <button type="button" className={`stat-card${status === "all" ? " is-active" : ""}`} onClick={() => selectFilter("all")} aria-pressed={status === "all"} title="Show all applications">
          <span className="stat-icon stat-icon--blue" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2 2 7l10 5 10-5-10-5z" /><path d="M2 17l10 5 10-5" /><path d="M2 12l10 5 10-5" /></svg>
          </span>
          <div className="stat-body"><span className="stat-label">Applications</span><span className="stat-num">{stats.total}</span></div>
        </button>
        <button type="button" className={`stat-card${status === "pending" ? " is-active" : ""}`} onClick={() => selectFilter("pending")} aria-pressed={status === "pending"} title="Show pending applications">
          <span className="stat-icon stat-icon--slate" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
          </span>
          <div className="stat-body"><span className="stat-label">Pending review</span><span className="stat-num">{stats.pending}</span></div>
        </button>
        <button type="button" className={`stat-card${status === "high" ? " is-active" : ""}`} onClick={() => selectFilter("high")} aria-pressed={status === "high"} title="Show high-priority pending applications">
          <span className="stat-icon stat-icon--red" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 21V4h13l-2.5 4 2.5 4H4" /></svg>
          </span>
          <div className="stat-body"><span className="stat-label">High priority</span><span className="stat-num">{stats.high}</span></div>
        </button>
        <button type="button" className={`stat-card${status === "actioned" ? " is-active" : ""}`} onClick={() => selectFilter("actioned")} aria-pressed={status === "actioned"} title="Show actioned applications">
          <span className="stat-icon stat-icon--green" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M8 12l3 3 5-6" /></svg>
          </span>
          <div className="stat-body"><span className="stat-label">Actioned</span><span className="stat-num">{stats.decided}</span></div>
        </button>
      </div>

      <div className="queue-controls">
      <div className="queue-toolbar">
        <div className="toolbar-zone">
          <div className={`search-field${searchOpen || query ? " is-open" : ""}`}>
            <button type="button" className="search-icon" onClick={() => { setSearchOpen(true); searchRef.current?.focus(); }} aria-label="Search" aria-expanded={searchOpen || !!query}>
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
            </button>
            <input
              ref={searchRef}
              type="search"
              placeholder="Search brand, applicant, or ID…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onBlur={() => { if (!query) setSearchOpen(false); }}
              aria-label="Search applications"
              tabIndex={searchOpen || query ? 0 : -1}
            />
          </div>
        </div>
        <div className="filter-pills" role="group" aria-label="Filter by status">
          {([["all", "All"], ["pending", "Pending"], ["approved", "Approved"], ["rejected", "Rejected"], ["needs_info", "Needs info"]] as [StatusFilter, string][]).map(
            ([key, label]) => (
              <button key={key} className={`filter-pill filter-pill--${key}${status === key ? " is-active" : ""}`} onClick={() => selectFilter(key)} aria-pressed={status === key}>
                {label}
                <span className="filter-pill-count">{filterCounts[key as keyof typeof filterCounts]}</span>
              </button>
            ),
          )}
        </div>
        <div className="toolbar-zone toolbar-zone--right">
          {batchRunning ? (
            <div className="bar-action">
              <span className="bar-progress"><span className="spinner" aria-hidden="true" /> Verifying {batchProgress.done}/{batchProgress.total}</span>
              <button className="bar-cancel" type="button" onClick={cancelBatch}>Cancel</button>
            </div>
          ) : selectedVisible.length > 0 ? (
            <div className="bar-action">
              <button className="link-btn bar-clear" type="button" onClick={clearSelection}>Clear</button>
              <button className="btn-verify bar-verify" type="button" onClick={runBatch}>Auto-review ({selectedVisible.length})</button>
            </div>
          ) : null}
        </div>
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
                  <th {...sortable("brandName")}>Application {caret("brandName")}</th>
                  <th>Type</th>
                  <th>ABV</th>
                  <th>Applicant</th>
                  <th {...sortable("submittedAt")}>Submitted {caret("submittedAt")}</th>
                  <th {...sortable("priority")}>Priority {caret("priority")}</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((a, i) => {
                  const d = decisionFor(a.id);
                  return (
                    <tr key={a.id} className={[selected.has(a.id) && "is-selected", verifyingIds.has(a.id) && "is-verifying", highlightRecent && lastBatchIds.has(a.id) && !verifyingIds.has(a.id) && d && `is-recent is-recent--${d}`].filter(Boolean).join(" ")} onClick={() => router.push(`/review/${a.id}`)}>
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
                        {verifyingIds.has(a.id) ? (
                          <span className="row-verifying"><span className="spinner spinner--sm" aria-hidden="true" /> Verifying…</span>
                        ) : d ? (
                          <span className={`pill pill--in ${DECISION_PILL[d]}`}>{decisionLabel(d, decisions[a.id]?.source ?? "agent")}</span>
                        ) : (
                          <span className="pill pill--pending">Pending review</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {filtered.length === 0 && (
                  <tr><td colSpan={9}><div className="console-empty">{apps.length === 0 ? "No applications in the queue yet." : "No applications match your filters."}</div></td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* Toast stack — one per disposition, top-right, self-dismissing. */}
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

      {/* End-of-run summary — the triage hand-off. Routes straight to the
          exceptions so a 300-app run becomes "go review these 40". */}
      {summary && (
        <div className="summary-scrim" role="dialog" aria-modal="true" aria-labelledby="summary-title" onClick={() => setSummary(null)}>
          <div className="summary-card" ref={summaryRef} tabIndex={-1} onClick={(e) => e.stopPropagation()}>
            <span className="summary-check" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
            </span>
            <h2 id="summary-title" className="summary-title">Auto-review complete</h2>
            <p className="summary-sub">{summary.total} application{summary.total === 1 ? "" : "s"} reviewed{summary.error > 0 ? ` · ${summary.error} couldn’t be processed` : ""}</p>

            <div className="summary-stats">
              <button type="button" className="summary-stat summary-stat--ok" onClick={() => goToFilter("approved")} disabled={summary.approved === 0}>
                <span className="summary-stat-num">{summary.approved}</span><span className="summary-stat-label">Approved</span>
              </button>
              <button type="button" className="summary-stat summary-stat--warn" onClick={() => goToFilter("needs_info")} disabled={summary.needs_info === 0}>
                <span className="summary-stat-num">{summary.needs_info}</span><span className="summary-stat-label">Need review</span>
              </button>
              <button type="button" className="summary-stat summary-stat--err" onClick={() => goToFilter("rejected")} disabled={summary.rejected === 0}>
                <span className="summary-stat-num">{summary.rejected}</span><span className="summary-stat-label">Likely rejection</span>
              </button>
            </div>

            <p className="summary-prompt">{summary.needs_info + summary.rejected > 0 ? "Select a group to review those applications." : "Everything looks clean — nothing needs a closer look."}</p>
            <button className="link-btn summary-dismiss" onClick={() => setSummary(null)}>Done</button>
          </div>
        </div>
      )}
    </div>
  );
}
