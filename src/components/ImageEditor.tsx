"use client";

/**
 * Image editor for label photos: rotate, crop, zoom, and hover magnifier.
 * Rotate and crop are destructive (baked via canvas and sent to the model).
 * Zoom and magnifier are view-only. Magnifier is disabled under prefers-reduced-motion.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  RotateIcon,
  ZoomInIcon,
  ZoomOutIcon,
  MagnifyIcon,
  CropIcon,
  ResetIcon,
  UploadIcon,
} from "./Icon";

type Rect = { x: number; y: number; w: number; h: number };

/** Zoom/crop/magnify need mouse drag or hover — hide them on phone-sized viewports. */
function useCompactImageTools() {
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 768px)");
    const apply = () => setCompact(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);
  return compact;
}

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => setReduced(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);
  return reduced;
}

/** Render `src` rotated by `deg` (0/90/180/270) to a new JPEG data URL. */
function rotateDataUrl(src: string, deg: 90 | 180 | 270): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const swap = deg === 90 || deg === 270;
      const canvas = document.createElement("canvas");
      canvas.width = swap ? img.height : img.width;
      canvas.height = swap ? img.width : img.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return reject(new Error("no ctx"));
      ctx.translate(canvas.width / 2, canvas.height / 2);
      ctx.rotate((deg * Math.PI) / 180);
      ctx.drawImage(img, -img.width / 2, -img.height / 2);
      resolve(canvas.toDataURL("image/jpeg", 0.92));
    };
    img.onerror = () => reject(new Error("load failed"));
    img.src = src;
  });
}

/** Crop `src` to a rect expressed in FRACTIONS (0–1) of the natural image. */
function cropDataUrl(src: string, frac: Rect): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const sx = Math.round(frac.x * img.width);
      const sy = Math.round(frac.y * img.height);
      const sw = Math.max(1, Math.round(frac.w * img.width));
      const sh = Math.max(1, Math.round(frac.h * img.height));
      const canvas = document.createElement("canvas");
      canvas.width = sw;
      canvas.height = sh;
      const ctx = canvas.getContext("2d");
      if (!ctx) return reject(new Error("no ctx"));
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
      resolve(canvas.toDataURL("image/jpeg", 0.92));
    };
    img.onerror = () => reject(new Error("load failed"));
    img.src = src;
  });
}

export default function ImageEditor({
  src,
  alt,
  fileName,
  onEdited,
  onReplace,
  onRemove,
  viewOnly = false,
}: {
  /** The original image data URL. */
  src: string;
  alt: string;
  /** Shown as a corner chip on the stage so the agent knows which photo this is. */
  fileName?: string;
  /** Called whenever the edited (rotated/cropped) image changes; null = back to original. */
  onEdited?: (dataUrl: string) => void;
  /** Swap the photo (opens the file picker). Shown as a corner control on the image. */
  onReplace?: () => void;
  /** Clear the photo. Shown as a corner control on the image. */
  onRemove?: () => void;
  /** View-only (result view): show zoom + magnify, hide the destructive rotate/crop/reset. */
  viewOnly?: boolean;
}) {
  // The current edited image (after rotate/crop); falls back to the original.
  const [edited, setEdited] = useState<string>(src);
  const [zoom, setZoom] = useState(1);
  const [magnify, setMagnify] = useState(false);
  const [cropping, setCropping] = useState(false);
  const [busy, setBusy] = useState(false);
  const [toolError, setToolError] = useState<string | null>(null);
  const compact = useCompactImageTools();
  const reducedMotion = usePrefersReducedMotion();

  // Reset everything if the source image changes (new upload).
  useEffect(() => {
    setEdited(src);
    setZoom(1);
    setMagnify(false);
    setCropping(false);
  }, [src]);

  // Drop view-only zoom/crop state when the layout switches to the phone toolbar.
  useEffect(() => {
    if (!compact) return;
    setZoom(1);
    setMagnify(false);
    setCropping(false);
  }, [compact]);

  useEffect(() => {
    if (reducedMotion) setMagnify(false);
  }, [reducedMotion]);

  const apply = useCallback(
    (next: string) => {
      setEdited(next);
      onEdited?.(next);
    },
    [onEdited],
  );

  const doRotate = async () => {
    setToolError(null);
    setBusy(true);
    try {
      apply(await rotateDataUrl(edited, 90));
    } catch {
      setToolError("Could not rotate the image. Try choosing the photo again.");
    } finally {
      setBusy(false);
    }
  };

  const resetAll = () => {
    setZoom(1);
    setMagnify(false);
    setCropping(false);
    apply(src);
  };

  const isEdited = edited !== src || (!compact && zoom !== 1);
  const showAdvancedTools = !compact;
  const showToolbar = showAdvancedTools || !viewOnly;

  return (
    <div
      className={`img-editor${viewOnly ? " img-editor--view-only" : ""}${compact ? " img-editor--compact" : ""}`}
    >
      <ImageStage
        src={edited}
        alt={alt}
        fileName={fileName}
        zoom={zoom}
        magnify={magnify && !cropping}
        cropping={cropping}
        onReplace={!viewOnly ? onReplace : undefined}
        onRemove={!viewOnly ? onRemove : undefined}
        onCropCommit={async (frac) => {
          setToolError(null);
          setBusy(true);
          try {
            apply(await cropDataUrl(edited, frac));
          } catch {
            setToolError("Could not crop the image. Try again or choose a different photo.");
          } finally {
            setBusy(false);
            setCropping(false);
          }
        }}
        onCropCancel={() => setCropping(false)}
      />

      {showToolbar && (
        <div className="img-tools" role="toolbar" aria-label="Image tools">
          {!viewOnly && (
            <button type="button" className="tool-btn" onClick={doRotate} disabled={busy || cropping} title="Rotate 90°">
              <RotateIcon />
              <span>Rotate</span>
            </button>
          )}
          {showAdvancedTools && (
            <>
              <button
                type="button"
                className="tool-btn"
                onClick={() => {
                  setMagnify(false); // zoom and the hover-lens are two ways to enlarge; don't combine
                  setZoom((z) => Math.min(3, +(z + 0.25).toFixed(2)));
                }}
                disabled={cropping || zoom >= 3}
                title="Zoom in"
              >
                <ZoomInIcon />
                <span>Zoom in</span>
              </button>
              <button
                type="button"
                className="tool-btn"
                onClick={() => setZoom((z) => Math.max(1, +(z - 0.25).toFixed(2)))}
                disabled={cropping || zoom <= 1}
                title="Zoom out"
              >
                <ZoomOutIcon />
                <span>Zoom out</span>
              </button>
              <button
                type="button"
                className={`tool-btn${magnify ? " active" : ""}`}
                aria-pressed={magnify}
                onClick={() =>
                  setMagnify((m) => {
                    if (!m) setZoom(1); // turning the lens on clears any zoom so the math stays correct
                    return !m;
                  })
                }
                disabled={cropping || reducedMotion}
                title={
                  reducedMotion
                    ? "Magnifier is unavailable when reduced motion is enabled"
                    : "Magnifier — hover the image to enlarge"
                }
              >
                <MagnifyIcon />
                <span>Magnify</span>
              </button>
              {!viewOnly && (
                <button
                  type="button"
                  className={`tool-btn${cropping ? " active" : ""}`}
                  aria-pressed={cropping}
                  onClick={() => {
                    setMagnify(false);
                    setZoom(1); // crop maps to the fitted image; clear any zoom/pan first
                    setCropping((c) => !c);
                  }}
                  disabled={busy}
                  title="Crop — drag a box on the image, then Apply"
                >
                  <CropIcon />
                  <span>{cropping ? "Cancel crop" : "Crop"}</span>
                </button>
              )}
            </>
          )}
          {!viewOnly && isEdited && (
            <button type="button" className="tool-btn" onClick={resetAll} disabled={busy} title="Reset to original">
              <ResetIcon />
              <span>Reset</span>
            </button>
          )}
        </div>
      )}
      {toolError && (
        <p className="img-tool-error" role="alert">
          {toolError}
        </p>
      )}
    </div>
  );
}

/** The image surface: handles zoom (scale-to-view), the loupe, and crop-select. */
function ImageStage({
  src,
  alt,
  fileName,
  zoom,
  magnify,
  cropping,
  onReplace,
  onRemove,
  onCropCommit,
  onCropCancel,
}: {
  src: string;
  alt: string;
  fileName?: string;
  zoom: number;
  magnify: boolean;
  cropping: boolean;
  onReplace?: () => void;
  onRemove?: () => void;
  onCropCommit: (frac: Rect) => void;
  onCropCancel: () => void;
}) {
  const imgRef = useRef<HTMLImageElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [lens, setLens] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  // Crop selection, in pixels relative to the IMAGE box.
  const [sel, setSel] = useState<Rect | null>(null);
  // The image's offset within the container, captured at drag start, so the box
  // (drawn in container coords) lines up with the image-relative selection.
  const cropOff = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const dragStart = useRef<{ x: number; y: number } | null>(null);
  // Pan offset (px) for navigating a zoomed-in image by dragging it.
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const panStart = useRef<{ mx: number; my: number; px: number; py: number } | null>(null);
  const [grabbing, setGrabbing] = useState(false);
  const LENS = 170;
  const LENS_ZOOM = 2.5;

  // Reset the pan whenever we return to fit (zoom 1) so the image re-centers.
  useEffect(() => {
    if (zoom <= 1) setPan({ x: 0, y: 0 });
  }, [zoom]);

  const canPan = zoom > 1 && !cropping && !magnify;

  // Crop coordinates are measured against the IMAGE's rendered rect (so the
  // fractions map to the real pixels), but the crop box is drawn inside the
  // magnifier container — so we also track the image's offset within it to keep
  // the dashed box exactly under the cursor even if the image is letterboxed.
  const rel = (e: { clientX: number; clientY: number }) => {
    const img = imgRef.current!;
    const box = boxRef.current!;
    const ir = img.getBoundingClientRect();
    const br = box.getBoundingClientRect();
    return {
      x: e.clientX - ir.left, // relative to the image
      y: e.clientY - ir.top,
      w: ir.width,
      h: ir.height,
      offX: ir.left - br.left, // image offset within the container
      offY: ir.top - br.top,
    };
  };

  // Pointer-based drag for both crop-select and pan. Pointer capture keeps the
  // events flowing even when the cursor leaves the element, so a drag is never
  // lost and pointerup always fires to finalize — the previous mouse-event
  // version dropped the gesture when the cursor left the box.
  const onPointerDown = (e: React.PointerEvent) => {
    if (canPan) {
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      panStart.current = { mx: e.clientX, my: e.clientY, px: pan.x, py: pan.y };
      setGrabbing(true);
      return;
    }
    if (!cropping) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = rel(e);
    cropOff.current = { x: p.offX, y: p.offY };
    dragStart.current = { x: p.x, y: p.y };
    setSel({ x: p.x, y: p.y, w: 0, h: 0 });
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (canPan && panStart.current) {
      const dx = e.clientX - panStart.current.mx;
      const dy = e.clientY - panStart.current.my;
      const img = imgRef.current;
      const limX = img ? (img.width * (zoom - 1)) / 2 + 40 : 400;
      const limY = img ? (img.height * (zoom - 1)) / 2 + 40 : 400;
      setPan({
        x: Math.max(-limX, Math.min(limX, panStart.current.px + dx)),
        y: Math.max(-limY, Math.min(limY, panStart.current.py + dy)),
      });
      return;
    }
    if (cropping && dragStart.current) {
      const p = rel(e);
      const x = Math.max(0, Math.min(dragStart.current.x, p.x));
      const y = Math.max(0, Math.min(dragStart.current.y, p.y));
      const w = Math.min(p.w, Math.abs(p.x - dragStart.current.x));
      const h = Math.min(p.h, Math.abs(p.y - dragStart.current.y));
      setSel({ x, y, w, h });
      return;
    }
    if (!magnify) return;
    const p = rel(e);
    if (p.x < 0 || p.y < 0 || p.x > p.w || p.y > p.h) {
      setLens(null);
      return;
    }
    setLens(p);
  };

  const onPointerUp = () => {
    dragStart.current = null;
    panStart.current = null;
    setGrabbing(false);
  };

  const commitCrop = () => {
    const img = imgRef.current;
    if (!img || !sel || sel.w < 8 || sel.h < 8) {
      onCropCancel();
      setSel(null);
      return;
    }
    const r = img.getBoundingClientRect();
    onCropCommit({ x: sel.x / r.width, y: sel.y / r.height, w: sel.w / r.width, h: sel.h / r.height });
    setSel(null);
  };

  return (
    <>
    <div className="img-stage">
      {fileName && !cropping && (
        <span className="img-stage-name" title={fileName}>
          {fileName}
        </span>
      )}
      <div
        ref={boxRef}
        className={`magnifier${magnify ? " active" : ""}${cropping ? " cropping" : ""}${canPan ? " pannable" : ""}${grabbing ? " grabbing" : ""}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onMouseLeave={() => setLens(null)}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          ref={imgRef}
          src={src}
          alt={alt}
          draggable={false}
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            transformOrigin: "center center",
          }}
        />

        {magnify && lens && !cropping && (
          <span
            aria-hidden="true"
            className="magnifier-lens"
            style={{
              width: LENS,
              height: LENS,
              left: lens.x - LENS / 2,
              top: lens.y - LENS / 2,
              backgroundImage: `url(${src})`,
              backgroundRepeat: "no-repeat",
              backgroundSize: `${lens.w * LENS_ZOOM}px ${lens.h * LENS_ZOOM}px`,
              backgroundPosition: `${-(lens.x * LENS_ZOOM - LENS / 2)}px ${-(lens.y * LENS_ZOOM - LENS / 2)}px`,
            }}
          />
        )}

        {cropping && sel && (
          <span
            className="crop-box"
            style={{
              left: sel.x + cropOff.current.x,
              top: sel.y + cropOff.current.y,
              width: sel.w,
              height: sel.h,
            }}
          />
        )}
      </div>

      {/* File actions, as corner controls on the image (hidden while cropping). */}
      {!cropping && onReplace && (
        <button type="button" className="img-corner top-right" onClick={onReplace} title="Replace photo">
          <UploadIcon size={15} /> Replace
        </button>
      )}
      {!cropping && onRemove && (
        <button type="button" className="img-corner bottom-right" onClick={onRemove} title="Remove photo">
          <span aria-hidden="true">✕</span> Remove
        </button>
      )}
    </div>

      {cropping && (
        <div className="crop-bar">
          <span className="crop-hint">
            {sel && sel.w > 8 && sel.h > 8
              ? "Selection ready — Apply crop to keep just this area."
              : "Drag a box over the part you want to keep."}
          </span>
          <button
            type="button"
            className="btn secondary"
            onClick={commitCrop}
            disabled={!sel || sel.w < 8 || sel.h < 8}
          >
            Apply crop
          </button>
          <button
            type="button"
            className="btn secondary"
            onClick={() => {
              setSel(null);
              onCropCancel();
            }}
          >
            Cancel
          </button>
        </div>
      )}
    </>
  );
}
