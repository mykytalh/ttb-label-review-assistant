"use client";

import { useState, useRef, useCallback } from "react";
import { ApplicationData, ReviewResult } from "@/lib/types";
import {
  fileToBase64,
  prepareImageFromDataUrl,
  postReview,
  ACCEPTED_IMAGE_TYPES,
  isAcceptedImageType,
} from "@/lib/client";
import ApplicationForm, { emptyApplication } from "./ApplicationForm";
import ReviewResults from "./ReviewResults";
import ImageEditor from "./ImageEditor";
import PrintReport from "./PrintReport";
import { UploadIcon } from "./Icon";

/**
 * Single-label review: application form + photo upload with edit tools
 * (rotate/crop/zoom), then the field-by-field result below. The image sent for
 * review is exactly the edited image the agent sees, and each run gets a
 * reference ID + timestamp for the printable record.
 */
export default function SingleReview() {
  const [app, setApp] = useState<ApplicationData>(emptyApplication());
  const [file, setFile] = useState<File | null>(null);
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  // The edited image (rotated/cropped in the ImageEditor); this is what we send.
  // Starts equal to dataUrl; the editor reports changes via onEdited.
  const [editedUrl, setEditedUrl] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ReviewResult | null>(null);
  // The exact (rotated, downscaled) image we sent — shown in the result so the
  // label there matches what the agent straightened and what the AI actually read.
  const [resultImageUrl, setResultImageUrl] = useState<string | null>(null);
  // Display-only review ID and timestamp; not persisted.
  const [reviewRef, setReviewRef] = useState<{ id: string; at: string } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const pickFile = useCallback(async (f: File) => {
    setError(null);
    if (!isAcceptedImageType(f.type)) {
      setFile(null);
      setDataUrl(null);
      setEditedUrl(null);
      setError("That file type isn't supported. Choose a PNG, JPEG, or WebP photo.");
      return;
    }
    try {
      const { dataUrl } = await fileToBase64(f);
      setFile(f);
      setResult(null);
      setDataUrl(dataUrl);
      setEditedUrl(dataUrl);
    } catch (e) {
      setFile(null);
      setDataUrl(null);
      setEditedUrl(null);
      setError(e instanceof Error ? e.message : "Could not read that file.");
    }
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      const f = e.dataTransfer.files?.[0];
      if (f) pickFile(f);
    },
    [pickFile],
  );

  const canSubmit = (app.brandName ?? "").trim().length > 0 && !!file && !busy;

  const onSubmit = async () => {
    if (!file || !editedUrl) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const { base64, mediaType, dataUrl: sentUrl } = await prepareImageFromDataUrl(editedUrl);
      const r = await postReview(app, base64, mediaType);
      const now = new Date();
      setReviewRef({
        // Reference built from the date + a short random suffix — looks like a
        // case ID for the result record; not stored anywhere.
        id: `LR-${now.getFullYear()}-${String(Math.floor(Math.random() * 1e6)).padStart(6, "0")}`,
        at: now.toLocaleString(),
      });
      setResultImageUrl(sentUrl);
      setResult(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };

  /** Start over — clear everything back to the empty input form. */
  const reviewAnother = () => {
    setApp(emptyApplication());
    setFile(null);
    setDataUrl(null);
    setEditedUrl(null);
    setResultImageUrl(null);
    setResult(null);
    setReviewRef(null);
    setError(null);
  };

  // The hidden file input, shared across layouts.
  const fileInput = (
    <input
      id="label-photo-file"
      ref={inputRef}
      type="file"
      accept={ACCEPTED_IMAGE_TYPES}
      className="visually-hidden"
      onChange={(e) => {
        const f = e.target.files?.[0];
        if (f) pickFile(f);
        e.target.value = "";
      }}
    />
  );

  // ---- RESULT MODE: full-width, image left + verdicts right ----
  if (result && !busy) {
    return (
      <div className="result-view">
        <div className="result-bar no-print">
          <div className="result-bar-info">
            <strong>{app.brandName || file?.name}</strong>
            <span className="result-bar-meta">
              {reviewRef ? `${reviewRef.id} · ` : ""}
              {file?.name}
              {reviewRef ? ` · ${reviewRef.at}` : ""}
            </span>
          </div>
          <div className="result-bar-actions">
            <button className="btn secondary" onClick={() => window.print()}>
              Print
            </button>
            <button className="btn compact" onClick={reviewAnother}>
              Review another
            </button>
          </div>
        </div>

        <section className="card screen-only" aria-live="polite" aria-label="Result">
          <ReviewResults result={result} imageUrl={resultImageUrl ?? dataUrl ?? undefined} />
        </section>

        {/* Formal record, shown only when printing. */}
        <PrintReport
          app={app}
          result={result}
          fileName={file?.name}
          reviewRef={reviewRef}
          imageUrl={resultImageUrl ?? dataUrl ?? undefined}
        />
        {fileInput}
      </div>
    );
  }

  // ---- INPUT MODE: calm, centered, minimal ----
  return (
    <div className="single-flow">
      {/* One calm, centered card: just what's needed to run a review. */}
      <section className="card" aria-label="Label and application details">
        {/* Photo first: it's the one thing every review needs, and most agents
            arrive holding the image — fields are the cross-check, not the start. */}
        <div className="field">
          <label htmlFor="label-photo-file">Label photo</label>
          {dataUrl ? (
            // Once a photo is chosen, the area becomes an editor — NOT a giant
            // click-to-upload target (whose click handler would otherwise swallow
            // the crop/tool buttons inside it).
            <div className="preview">
              <ImageEditor
                src={dataUrl}
                alt="Selected label preview"
                fileName={file?.name}
                onEdited={setEditedUrl}
                onReplace={() => inputRef.current?.click()}
                onRemove={() => {
                  setFile(null);
                  setDataUrl(null);
                  setEditedUrl(null);
                }}
              />
              {/* Desktop needs no caption — the tool buttons are labeled. The
                  phone hint stays: it explains why zoom/crop are absent there. */}
              <p className="rotate-hint rotate-hint--compact">
                Use <strong>Rotate</strong> if the photo is sideways. Zoom and crop
                are available on a larger screen.
              </p>
            </div>
          ) : (
            <div
              id="label-upload"
              className={`dropzone${dragging ? " drag" : ""}`}
              role="button"
              tabIndex={0}
              onClick={() => inputRef.current?.click()}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  inputRef.current?.click();
                }
              }}
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
              aria-label="Upload a label image"
            >
              <div className="icon" aria-hidden="true">
                <UploadIcon />
              </div>
              <p>
                <strong>Click to choose a photo</strong> or drag it here
              </p>
              <p className="dropzone-hint">PNG, JPEG, or WebP. Phone photos are fine.</p>
            </div>
          )}
        </div>


        <ApplicationForm value={app} onChange={setApp} />

        <button className="btn" onClick={onSubmit} disabled={!canSubmit}>
          {busy ? (
            <>
              <span className="spinner" aria-hidden="true" />
              Reviewing…
            </>
          ) : (
            "Check this label"
          )}
        </button>

        <div aria-live="polite">
          {error && (
            <div className="error-banner" role="alert" style={{ marginTop: 16 }}>
              {error}
            </div>
          )}
        </div>
      </section>

      {fileInput}
    </div>
  );
}
