/**
 * Small client-side helpers shared by the single and batch UIs.
 */
import { ApplicationData, ReviewResult, Verdict } from "./types";

/** Read a File into raw base64 (no data: prefix) plus its media type. */
export function fileToBase64(
  file: File,
): Promise<{ base64: string; mediaType: string; dataUrl: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const base64 = dataUrl.split(",")[1] ?? "";
      resolve({ base64, mediaType: file.type || "image/jpeg", dataUrl });
    };
    reader.onerror = () => reject(new Error("Could not read the image file."));
    reader.readAsDataURL(file);
  });
}

/** Longest edge (px) sent to the model. 1024px keeps label text legible while
 *  reducing upload size and latency. */
const MAX_EDGE = 1024;
const JPEG_QUALITY = 0.82;

/**
 * Downscale an already-edited image (rotation/crop baked in by the editor),
 * supplied as a data URL, to the upload size. Returns base64 JPEG + the data URL
 * actually sent. Falls back to the input data URL if the canvas pipeline isn't
 * available. Used for the single-review path where the agent may have edited the
 * image; the sent image is exactly what they see.
 */
export async function prepareImageFromDataUrl(
  dataUrl: string,
): Promise<{ base64: string; mediaType: string; dataUrl: string }> {
  try {
    const img = await loadImage(dataUrl);
    const scale = Math.min(1, MAX_EDGE / Math.max(img.width, img.height));
    if (scale >= 1) {
      // Already small enough — send as-is.
      return { base64: dataUrl.split(",")[1] ?? "", mediaType: "image/jpeg", dataUrl };
    }
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) return { base64: dataUrl.split(",")[1] ?? "", mediaType: "image/jpeg", dataUrl };
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const out = canvas.toDataURL("image/jpeg", JPEG_QUALITY);
    return { base64: out.split(",")[1] ?? "", mediaType: "image/jpeg", dataUrl: out };
  } catch {
    return { base64: dataUrl.split(",")[1] ?? "", mediaType: "image/jpeg", dataUrl };
  }
}

/** Promise wrapper around HTMLImageElement load for a data URL. */
function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("image load failed"));
    img.src = src;
  });
}

/** A failed review carries the HTTP status and any Retry-After so the batch UI
 *  can back off intelligently on rate limits instead of hammering the endpoint. */
export class ReviewError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = "ReviewError";
  }
}

/**
 * Call the review API for one label. Throws a ReviewError with a clean message on
 * failure. Pass an AbortSignal to cancel an in-flight request (batch stop/clear).
 */
export async function postReview(
  application: ApplicationData,
  base64: string,
  mediaType: string,
  signal?: AbortSignal,
): Promise<ReviewResult> {
  let res: Response;
  try {
    res = await fetch("/api/review", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ application, imageBase64: base64, mediaType }),
      signal,
    });
  } catch (e) {
    // A deliberate abort (batch Stop/Clear) is rethrown unchanged so callers can
    // recognize it; any other throw is a network failure ("Failed to fetch"),
    // which we translate to plain guidance instead of a scary browser message.
    if (e instanceof DOMException && e.name === "AbortError") throw e;
    throw new ReviewError(
      "Couldn’t reach the review service. Check your connection and try again.",
      0,
    );
  }
  let data: { error?: string } & Partial<ReviewResult>;
  try {
    data = await res.json();
  } catch {
    throw new ReviewError(
      "The server returned an unreadable response. Please try again.",
      res.status,
    );
  }
  if (!res.ok) {
    const retryAfter = Number(res.headers.get("Retry-After")) || undefined;
    // Map the common cases to plain-English guidance for a non-technical agent.
    if (res.status === 429) {
      const wait = retryAfter ? ` in ${retryAfter}s` : " in a few seconds";
      throw new ReviewError(`The service is busy. It will retry${wait}.`, 429, retryAfter);
    }
    if (res.status === 503) {
      throw new ReviewError(
        data?.error || "The review service isn't configured. Contact your administrator.",
        503,
      );
    }
    if (res.status === 413) {
      throw new ReviewError("That image is too large. Try a smaller photo.", 413);
    }
    throw new ReviewError(
      data?.error || `The review couldn't be completed (error ${res.status}).`,
      res.status,
    );
  }
  if (!isReviewResult(data)) {
    throw new ReviewError(
      "The server returned an incomplete result. Please try again.",
      res.status,
    );
  }
  return data;
}

/**
 * Background extraction call for the single-label preload. Unlike postReview
 * this never surfaces errors to the UI — any failure (network, 4xx/5xx,
 * malformed body) resolves to null and the caller falls back to the classic
 * review path. AbortSignal lets an invalidated preload stop waiting.
 */
export async function postExtract(
  base64: string,
  mediaType: string,
  signal?: AbortSignal,
): Promise<{ label: unknown; elapsedMs?: number } | null> {
  try {
    const res = await fetch("/api/extract", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ imageBase64: base64, mediaType }),
      signal,
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { label?: unknown; elapsedMs?: number };
    if (!data || typeof data !== "object" || data.label == null) return null;
    return { label: data.label, elapsedMs: data.elapsedMs };
  } catch {
    return null; // abort or network failure — the fallback path covers it
  }
}

/** Guard against malformed or partial API responses before the UI renders them. */
function isReviewResult(data: unknown): data is ReviewResult {
  if (!data || typeof data !== "object") return false;
  const r = data as Partial<ReviewResult>;
  if (!r.overall || !["pass", "warn", "fail", "na"].includes(r.overall)) return false;
  if (typeof r.imageQuality !== "string") return false;
  if (!Array.isArray(r.fields)) return false;
  return r.fields.every(
    (f) =>
      f &&
      typeof f === "object" &&
      typeof f.field === "string" &&
      typeof f.verdict === "string" &&
      typeof f.message === "string",
  );
}

export const VERDICT_LABEL: Record<Verdict, string> = {
  pass: "Pass",
  warn: "Review",
  fail: "Fail",
  na: "Not checked",
};

/** Accepted image types for the file inputs. */
export const ACCEPTED_IMAGE_TYPES = "image/png,image/jpeg,image/jpg,image/webp";

const ACCEPTED_IMAGE_TYPE_LIST = ACCEPTED_IMAGE_TYPES.split(",");

/** True when the browser-reported MIME type is allowed for upload. */
export function isAcceptedImageType(type: string): boolean {
  return ACCEPTED_IMAGE_TYPE_LIST.includes(type);
}
