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
  VERDICT_ICON,
  VERDICT_LABEL,
} from "@/lib/client";
import { batchResultsToCsv } from "@/lib/export";
import ReviewResults from "./ReviewResults";
import { StackIcon } from "./Icon";

/**
 * Batch upload: read each label in full and check required on-label elements
 * (brand, class, ABV by type, government warning). Concurrency is capped;
 * results stream in as each finishes.
 */

type RowStatus = "pending" | "running" | "done" | "error";

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
const MAX_BATCH = 5;
const DEFAULT_BACKOFF_MS = 5_000;
const MAX_RL_RETRIES = 2;

export default function BatchReview() {
  const [rows, setRows] = useState<BatchRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<number | null>(null);
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
      const take = images.slice(0, room);
      const parts: string[] = [];
      if (skipped > 0) {
        parts.push(
          `${skipped} file${skipped === 1 ? "" : "s"} skipped — only PNG, JPEG, and WebP are supported.`,
        );
      }
      if (take.length < images.length) {
        parts.push(
          `Added ${take.length} of ${images.length} — batches are limited to ${MAX_BATCH} labels in this demo.`,
        );
      }
      setNotice(parts.length > 0 ? parts.join(" ") : null);
      const added = take.map((file) => {
        const thumbUrl = URL.createObjectURL(file);
        urls.current.add(thumbUrl);
        return { id: nextId.current++, file, thumbUrl, status: "pending" as RowStatus };
      });
      setRows((prev) => [...prev, ...added]);
    },
    [rows.length],
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

  const clearAll = () => {
    abortRef.current?.abort();
    for (const u of urls.current) URL.revokeObjectURL(u);
    urls.current.clear();
    setRows([]);
    setExpanded(null);
    setNotice(null);
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

  return (
    <div className="batch-flow">
      <section className="card" aria-label="Batch upload">
        <h2>Upload label photos</h2>
        <p className="meta batch-intro">
          Add multiple label images at once. Each photo is read in full — required
          fields, government warning, and alcohol content by detected beverage type.
        </p>
        <p className="batch-cost-note" role="note">
          Each label uses one API call. This demo limits batches to{" "}
          <strong>{MAX_BATCH} labels</strong> so you can try the workflow without a
          large bill. A production deployment would raise that cap.
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
        <section className="card" aria-label="Batch queue">
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
            <div className="batch-summary">
              <span className="summary-chip v-pass">
                {VERDICT_ICON.pass} {counts.pass} passed
              </span>
              <span className="summary-chip v-warn">
                {VERDICT_ICON.warn} {counts.warn} to review
              </span>
              <span className="summary-chip v-fail">
                {VERDICT_ICON.fail} {counts.fail} failed
              </span>
            </div>
          )}

          <ul className="batch-list">
            {rows.map((r) => (
              <BatchCard
                key={r.id}
                row={r}
                expanded={expanded === r.id}
                onToggle={() => setExpanded(expanded === r.id ? null : r.id)}
              />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

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
  onToggle,
}: {
  row: BatchRow;
  expanded: boolean;
  onToggle: () => void;
}) {
  const tally = row.result ? fieldTally(row.result) : null;

  return (
    <li className={`batch-card batch-card--${row.status}`}>
      <div className="batch-card-main">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="batch-card-thumb" src={row.thumbUrl} alt="" />
        <div className="batch-card-body">
          <div className="batch-card-name">{row.file.name}</div>
          <div className="batch-card-status">
            {row.status === "pending" && (
              <>
                <span className="status-dot dot-pending" />
                Waiting
              </>
            )}
            {row.status === "running" && (
              <>
                <span className="status-dot dot-running" />
                Reviewing…
              </>
            )}
            {row.status === "done" && row.result && (
              <span className={`pill v-${row.result.overall}`}>
                {VERDICT_ICON[row.result.overall]} {VERDICT_LABEL[row.result.overall]}
              </span>
            )}
            {row.status === "error" && (
              <span className="pill v-fail" title={row.error}>
                ✕ Error
              </span>
            )}
          </div>
          {tally && (
            <div className="batch-card-tally" aria-label={`${tally.pass} passed, ${tally.warn} to review, ${tally.fail} failed`}>
              <span className="v-pass">{tally.pass} passed</span>
              <span className="v-warn">{tally.warn} review</span>
              <span className="v-fail">{tally.fail} failed</span>
            </div>
          )}
        </div>
        {row.status === "done" && (
          <button className="btn secondary batch-card-details" onClick={onToggle}>
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
