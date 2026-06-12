"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { ApplicationData, ReviewResult, Verdict } from "@/lib/types";
import {
  prepareImage,
  postReview,
  downloadText,
  ReviewError,
  ACCEPTED_IMAGE_TYPES,
  isAcceptedImageType,
} from "@/lib/client";
import { batchResultsToCsv } from "@/lib/export";
import ReviewResults from "./ReviewResults";
import { StackIcon } from "./Icon";
import InfoTip from "./InfoTip";

/**
 * Batch upload: read each label in full and check required on-label elements
 * (brand, class, ABV by type, government warning). Concurrency is capped;
 * results stream in as each finishes.
 */

type RowStatus = "pending" | "running" | "done" | "error";
type BatchFilter = "all" | Verdict | "error";

interface BatchRow {
  id: number;
  file: File;
  thumbUrl: string;
  status: RowStatus;
  result?: ReviewResult;
  error?: string;
}

const CONCURRENCY = 2;
const BEVERAGE_DEFAULT = "auto" as const;
/** Prototype cap — each label is one paid API call. Production can raise this. */
const MAX_BATCH = 10;
/** Queue page size. Five cards fit a laptop viewport under the pinned toolbar. */
const PAGE_SIZE = 5;
const DEFAULT_BACKOFF_MS = 5_000;
const MAX_RL_RETRIES = 2;

/** Stable identity for a browser File (name alone is not enough). */
function fileKey(file: File): string {
  return `${file.name}|${file.size}|${file.lastModified}`;
}

export default function BatchReview() {
  const [rows, setRows] = useState<BatchRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [filter, setFilter] = useState<BatchFilter>("all");
  const [page, setPage] = useState(0);
  const queueRef = useRef<HTMLElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const nextId = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const urls = useRef<Set<string>>(new Set());

  useEffect(() => {
    const minted = urls.current;
    return () => {
      abortRef.current?.abort();
      for (const u of minted) URL.revokeObjectURL(u);
    };
  }, []);

  const addFiles = useCallback(
    (files: FileList) => {
      const all = Array.from(files);
      const images = all.filter((f) => isAcceptedImageType(f.type));

      if (all.length > 0 && images.length === 0) {
        setNotice("Those files weren’t supported. Choose PNG, JPEG, or WebP photos.");
        return;
      }

      const skipped = all.length - images.length;

      const room = MAX_BATCH - rows.length;
      if (room <= 0) {
        setNotice(`This batch is full (${MAX_BATCH} labels). Run or clear it before adding more.`);
        return;
      }

      const existingKeys = new Set(rows.map((r) => fileKey(r.file)));
      const unique: File[] = [];
      let dupCount = 0;
      for (const file of images) {
        const key = fileKey(file);
        if (existingKeys.has(key)) {
          dupCount++;
          continue;
        }
        existingKeys.add(key);
        unique.push(file);
      }

      const take = unique.slice(0, room);
      const parts: string[] = [];
      if (skipped > 0) {
        parts.push(
          `${skipped} file${skipped === 1 ? "" : "s"} skipped — only PNG, JPEG, and WebP are supported.`,
        );
      }
      if (dupCount > 0) {
        parts.push(
          `${dupCount} duplicate${dupCount === 1 ? "" : "s"} skipped — already in the batch.`,
        );
      }
      if (take.length < unique.length) {
        parts.push(
          `Added ${take.length} of ${unique.length} — batches are limited to ${MAX_BATCH} labels in this demo.`,
        );
      }
      if (take.length === 0) {
        setNotice(parts.length > 0 ? parts.join(" ") : null);
        return;
      }
      setNotice(parts.length > 0 ? parts.join(" ") : null);
      const added = take.map((file) => {
        const thumbUrl = URL.createObjectURL(file);
        urls.current.add(thumbUrl);
        return { id: nextId.current++, file, thumbUrl, status: "pending" as RowStatus };
      });
      setRows((prev) => [...prev, ...added]);
    },
    [rows],
  );

  const update = (id: number, patch: Partial<BatchRow>) =>
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  const runAll = async () => {
    const controller = new AbortController();
    abortRef.current = controller;
    setBusy(true);
    setNotice(null);
    const queue = rows.filter((r) => r.status === "pending" || r.status === "error").map((r) => r.id);

    let cursor = 0;
    const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

    const worker = async () => {
      while (cursor < queue.length && !controller.signal.aborted) {
        const id = queue[cursor++];
        const row = rows.find((r) => r.id === id);
        if (!row) continue;
        update(id, { status: "running", error: undefined });
        try {
          const { base64, mediaType } = await prepareImage(row.file);
          if (controller.signal.aborted) return;
          const app: ApplicationData = { beverageType: BEVERAGE_DEFAULT };
          let result: ReviewResult | null = null;
          for (let attempt = 0; attempt <= MAX_RL_RETRIES; attempt++) {
            try {
              result = await postReview(app, base64, mediaType, controller.signal);
              break;
            } catch (e) {
              if (e instanceof ReviewError && e.status === 429 && attempt < MAX_RL_RETRIES) {
                const wait = (e.retryAfterSeconds ?? DEFAULT_BACKOFF_MS / 1000) * 1000;
                await sleep(wait);
                if (controller.signal.aborted) return;
                continue;
              }
              if (e instanceof ReviewError && e.status === 429) {
                throw new Error("Still busy after retrying — run this label again in a minute.");
              }
              throw e;
            }
          }
          if (result) update(id, { status: "done", result });
        } catch (e) {
          if (controller.signal.aborted || (e instanceof DOMException && e.name === "AbortError")) {
            return;
          }
          update(id, { status: "error", error: e instanceof Error ? e.message : "Failed" });
        }
      }
    };

    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    if (controller.signal.aborted) {
      setRows((prev) => prev.map((r) => (r.status === "running" ? { ...r, status: "pending" } : r)));
    }
    abortRef.current = null;
    setBusy(false);
  };

  const stop = () => abortRef.current?.abort();

  const removeRow = useCallback((id: number) => {
    setRows((prev) => {
      const row = prev.find((r) => r.id === id);
      if (!row || row.status !== "pending") return prev;
      URL.revokeObjectURL(row.thumbUrl);
      urls.current.delete(row.thumbUrl);
      return prev.filter((r) => r.id !== id);
    });
    setExpanded((e) => (e === id ? null : e));
  }, []);

  const clearAll = () => {
    abortRef.current?.abort();
    for (const u of urls.current) URL.revokeObjectURL(u);
    urls.current.clear();
    setRows([]);
    setExpanded(null);
    setNotice(null);
    setFilter("all");
    setPage(0);
  };

  const downloadCsv = () => {
    const exportedAt = new Date();
    const exportRows = rows
      .filter((r) => r.status === "done" || r.status === "error")
      .map((r, i) => ({
        labelNumber: i + 1,
        fileName: r.file.name,
        status: r.status === "done" ? ("complete" as const) : ("error" as const),
        result: r.result,
        error: r.error,
      }));
    const stamp = exportedAt.toISOString().slice(0, 10);
    downloadText(
      `label-review-batch-${stamp}.csv`,
      batchResultsToCsv(exportRows, { exportedAt }),
      "text/csv",
    );
  };

  const counts = rows.reduce(
    (acc, r) => {
      if (r.result) acc[r.result.overall]++;
      return acc;
    },
    { pass: 0, warn: 0, fail: 0, na: 0 } as Record<Verdict, number>,
  );
  const doneCount = rows.filter((r) => r.status === "done").length;
  const errorCount = rows.filter((r) => r.status === "error").length;
  const pendingCount = rows.filter((r) => r.status === "pending" || r.status === "running").length;

  const visibleRows = rows.filter((r) => {
    if (filter === "all") return true;
    if (filter === "error") return r.status === "error";
    return r.status === "done" && r.result?.overall === filter;
  });

  // Pages of 5 keep the queue workable at production volume — importers dump
  // 200–300 labels at once, and a flat list at that size is unusable. The page
  // is clamped so removals/filters never strand the view past the end.
  const pageCount = Math.max(1, Math.ceil(visibleRows.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const pagedRows = visibleRows.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);

  const applyFilter = (f: BatchFilter) => {
    setFilter(f);
    setPage(0);
    setExpanded(null);
  };

  const goToPage = (p: number) => {
    setPage(Math.max(0, Math.min(pageCount - 1, p)));
    setExpanded(null);
    // Land at the top of the queue so the new page starts in view under the
    // pinned toolbar (scroll-margin on the section clears the sticky bars).
    queueRef.current?.scrollIntoView({ block: "start" });
  };

  return (
    <div className="batch-flow">
      <section className="card" aria-label="Batch upload">
        <div className="batch-heading-row">
          <h2>Upload label photos</h2>
          <BatchInfoTip />
        </div>
        <p className="meta batch-intro">
          Screen a stack of labels without entering an application for each one.
          Upload the photos, press <strong>Review all</strong>, and results stream
          in as each finishes.
        </p>
        <div
          className="dropzone"
          role="button"
          tabIndex={0}
          onClick={() => inputRef.current?.click()}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              inputRef.current?.click();
            }
          }}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            if (e.dataTransfer.files) addFiles(e.dataTransfer.files);
          }}
          aria-label="Upload label images"
        >
          <div className="icon" aria-hidden="true">
            <StackIcon />
          </div>
          <p>
            <strong>Click to choose photos</strong> or drag them here
          </p>
          <p className="dropzone-hint">
            PNG, JPEG, or WebP · up to {MAX_BATCH} per batch · {rows.length}/{MAX_BATCH} added
          </p>
          <label htmlFor="batch-photo-file" className="visually-hidden">
            Choose label photos
          </label>
          <input
            id="batch-photo-file"
            ref={inputRef}
            type="file"
            accept={ACCEPTED_IMAGE_TYPES}
            multiple
            className="visually-hidden"
            onChange={(e) => {
              if (e.target.files) addFiles(e.target.files);
              e.target.value = "";
            }}
          />
        </div>
        {notice && (
          <p className="meta batch-notice" role="status">
            {notice}
          </p>
        )}
      </section>

      {rows.length > 0 && (
        <section className="card batch-queue" aria-label="Batch queue" ref={queueRef}>
          {/* Toolbar + filter chips pin below the masthead while scrolling the
              queue, so Stop/Download/filters stay reachable on a long batch. */}
          <div className="batch-sticky">
          <div className="batch-toolbar">
            <div className="batch-toolbar-head">
              <h2>
                {rows.length} label{rows.length === 1 ? "" : "s"} queued
              </h2>
              {busy ? (
                <p className="meta batch-progress">
                  <span className="spinner" aria-hidden="true" /> Reviewing {doneCount} of{" "}
                  {rows.length}…
                </p>
              ) : doneCount > 0 ? (
                <p className="meta batch-progress">
                  {doneCount} complete
                  {pendingCount > 0 ? ` · ${pendingCount} waiting` : ""}
                  {errorCount > 0 ? ` · ${errorCount} failed` : ""}
                </p>
              ) : (
                <p className="meta batch-progress">Ready to review</p>
              )}
            </div>
            <div className="batch-toolbar-actions">
              {doneCount > 0 && (
                <button className="btn secondary" onClick={downloadCsv} disabled={busy}>
                  Download CSV
                </button>
              )}
              <button className="btn secondary" onClick={clearAll} disabled={busy}>
                Clear
              </button>
              {busy ? (
                <button className="btn compact" onClick={stop}>
                  Stop
                </button>
              ) : (
                <button className="btn compact" onClick={runAll}>
                  {errorCount > 0 && doneCount > 0 ? `Retry ${errorCount} failed` : "Review all"}
                </button>
              )}
            </div>
          </div>

          <div aria-live="polite" className="visually-hidden">
            {busy
              ? `Reviewing label ${doneCount} of ${rows.length}.`
              : doneCount > 0
                ? `Batch complete. ${counts.pass} passed, ${counts.warn} to review, ${counts.fail} failed.`
                : ""}
          </div>

          {doneCount > 0 && (
            <div className="batch-summary" role="group" aria-label="Filter results">
              <FilterChip
                active={filter === "all"}
                onClick={() => applyFilter("all")}
                label="All"
                count={rows.filter((r) => r.status === "done" || r.status === "error").length}
              />
              {counts.pass > 0 && (
                <FilterChip
                  active={filter === "pass"}
                  onClick={() => applyFilter("pass")}
                  label="Passed"
                  count={counts.pass}
                  verdict="pass"
                />
              )}
              {counts.warn > 0 && (
                <FilterChip
                  active={filter === "warn"}
                  onClick={() => applyFilter("warn")}
                  label="Needs review"
                  count={counts.warn}
                  verdict="warn"
                />
              )}
              {counts.fail > 0 && (
                <FilterChip
                  active={filter === "fail"}
                  onClick={() => applyFilter("fail")}
                  label="Failed"
                  count={counts.fail}
                  verdict="fail"
                />
              )}
              {errorCount > 0 && (
                <FilterChip
                  active={filter === "error"}
                  onClick={() => applyFilter("error")}
                  label="Errors"
                  count={errorCount}
                  verdict="fail"
                />
              )}
            </div>
          )}
          </div>

          {filter !== "all" && visibleRows.length === 0 && (
            <p className="meta batch-filter-empty">No labels match this filter.</p>
          )}

          <ul className="batch-list">
            {pagedRows.map((r) => (
              <BatchCard
                key={r.id}
                row={r}
                expanded={expanded === r.id}
                busy={busy}
                onToggle={() => setExpanded(expanded === r.id ? null : r.id)}
                onRemove={() => removeRow(r.id)}
              />
            ))}
          </ul>

          {visibleRows.length > PAGE_SIZE && (
            <nav className="batch-pager" aria-label="Queue pages">
              <button
                type="button"
                className="btn secondary compact"
                onClick={() => goToPage(safePage - 1)}
                disabled={safePage === 0}
                aria-label="Previous page"
              >
                <span aria-hidden="true">‹</span> Prev
              </button>
              {/* Plain words, not a bare "1/2" — the audience reads "Page 1
                  of 2" instantly, and the filter chips already carry counts. */}
              <span className="batch-pager-status" aria-live="polite">
                Page {safePage + 1} of {pageCount}
              </span>
              <button
                type="button"
                className="btn secondary compact"
                onClick={() => goToPage(safePage + 1)}
                disabled={safePage >= pageCount - 1}
                aria-label="Next page"
              >
                Next <span aria-hidden="true">›</span>
              </button>
            </nav>
          )}
        </section>
      )}
    </div>
  );
}

function BatchInfoTip() {
  return (
    <InfoTip panelId="batch-info-panel" label="How batch review works">
        <p>
          <strong>How batch differs from single review:</strong> there is no
          application form here. The AI reads each label photo and checks what
          federal rules require <em>on the artwork itself</em>.
        </p>
        <ul>
          <li>
            <strong>Brand name</strong> and <strong>class / type</strong> must be
            present on the label
          </li>
          <li>
            <strong>Alcohol content</strong> — required for spirits; required for
            wine over 14% or fortified types; optional for table/light wine at or
            below 14% (detected beverage type sets the rule)
          </li>
          <li>
            <strong>Government warning</strong> — heading, all-caps{" "}
            <strong>GOVERNMENT WARNING:</strong>, and verbatim wording
          </li>
          <li>
            <strong>Net contents</strong> and <strong>bottler / producer</strong>{" "}
            (name and address) must be present on the label
          </li>
          <li>
            <strong>Country of origin</strong> is required when the label indicates
            an import
          </li>
        </ul>
    </InfoTip>
  );
}

function FilterChip({
  active,
  onClick,
  label,
  count,
  verdict,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count: number;
  verdict?: Verdict;
}) {
  return (
    <button
      type="button"
      className={`summary-chip filter-chip${active ? " filter-chip--active" : ""}${verdict ? ` v-${verdict}` : ""}`}
      aria-pressed={active}
      onClick={onClick}
    >
      <span className="filter-chip-label">{label}</span>
      <span className="filter-chip-count">{count}</span>
    </button>
  );
}

/** Per-verdict field counts for one result, shown as the batch row's tally chips. */
function fieldTally(result: ReviewResult) {
  const c = { pass: 0, warn: 0, fail: 0 };
  for (const f of result.fields) {
    if (f.verdict === "pass") c.pass++;
    else if (f.verdict === "warn") c.warn++;
    else if (f.verdict === "fail") c.fail++;
  }
  return c;
}

function BatchCard({
  row,
  expanded,
  busy,
  onToggle,
  onRemove,
}: {
  row: BatchRow;
  expanded: boolean;
  busy: boolean;
  onToggle: () => void;
  onRemove: () => void;
}) {
  const tally = row.result ? fieldTally(row.result) : null;
  const cardRef = useRef<HTMLLIElement>(null);

  // Opening Details aligns the card under the sticky toolbar (scroll-margin in
  // CSS) so the expanded result starts in view instead of below the fold.
  useEffect(() => {
    if (expanded) cardRef.current?.scrollIntoView({ block: "start" });
  }, [expanded]);

  return (
    <li ref={cardRef} className={`batch-card batch-card--${row.status}`}>
      <div className="batch-card-main">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="batch-card-thumb" src={row.thumbUrl} alt="" />
        <div className="batch-card-body">
          <div className="batch-card-name">{row.file.name}</div>
          {(row.status === "pending" || row.status === "running") && (
            <div className="batch-card-status">
              {row.status === "pending" ? (
                <>
                  <span className="status-dot dot-pending" />
                  Waiting
                </>
              ) : (
                <>
                  <span className="status-dot dot-running" />
                  Reviewing…
                </>
              )}
            </div>
          )}
          {tally && (
            <div
              className="batch-card-tally"
              aria-label={`${tally.pass} passed, ${tally.warn} to review, ${tally.fail} failed`}
            >
              {tally.pass > 0 && <span className="v-pass">{tally.pass} passed</span>}
              {tally.warn > 0 && <span className="v-warn">{tally.warn} review</span>}
              {tally.fail > 0 && <span className="v-fail">{tally.fail} failed</span>}
            </div>
          )}
        </div>
        {row.status === "pending" && (
          <button
            type="button"
            className="btn secondary batch-card-remove"
            onClick={onRemove}
            disabled={busy}
            aria-label={`Remove ${row.file.name}`}
          >
            Remove
          </button>
        )}
        {row.status === "done" && (
          <button type="button" className="btn secondary batch-card-details" onClick={onToggle}>
            {expanded ? "Hide" : "Details"}
          </button>
        )}
      </div>
      {expanded && row.result && (
        <div className="batch-card-detail">
          <ReviewResults result={row.result} imageUrl={row.thumbUrl} />
        </div>
      )}
      {row.status === "error" && row.error && (
        <div className="batch-card-error">
          <div className="error-banner">{row.error}</div>
        </div>
      )}
    </li>
  );
}
