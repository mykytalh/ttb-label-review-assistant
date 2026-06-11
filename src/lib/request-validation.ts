/**
 * Server-side request validation for the review API.
 *
 * The browser already downscales images, but a server must never trust the
 * client: the endpoint is reachable directly. So we independently validate the
 * shape of the application data, the declared media type (allowlist), the base64
 * payload, and the decoded image size — rejecting anything malformed or oversized
 * before it ever reaches the model. Pure and unit-tested.
 */
import { ApplicationData, BeverageType } from "./types";

/** Image media types we accept. Anything else is rejected, not coerced. */
export const ALLOWED_MEDIA_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
] as const;

export type AllowedMediaType = (typeof ALLOWED_MEDIA_TYPES)[number];

// The agent can only SELECT Auto or one of the three classes; "other" is never an
// agent choice (it's only ever the AI's own detection). Anything else → "auto".
const VALID_BEVERAGE_TYPES: BeverageType[] = ["auto", "spirits", "wine", "beer"];

/** Max decoded image size accepted server-side (8 MB). The client downscales to
 *  ~1024px (tens of KB); this is a generous ceiling that still blocks abuse. */
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

/** Cap on any single free-text application field, to bound payload + prompt size. */
const MAX_FIELD_LEN = 500;

export interface ValidatedReview {
  application: ApplicationData;
  imageBase64: string;
  mediaType: AllowedMediaType;
}

export type ValidationOutcome =
  | { ok: true; value: ValidatedReview }
  | { ok: false; status: number; error: string };

/** Estimate decoded byte length of a base64 string without allocating a Buffer. */
function base64ByteLength(b64: string): number {
  const len = b64.length;
  const padding = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
  return Math.floor((len * 3) / 4) - padding;
}

const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;

/**
 * Defense-in-depth: confirm the decoded bytes actually start with a known image
 * signature, so a base64-encoded text/binary blob with a forged image media type
 * can't slip past the allowlist and waste a paid model call. Only the first few
 * bytes are decoded. Returns true if the leading bytes match ANY supported image
 * (we don't force the magic to equal the declared type — a JPEG mislabeled as PNG
 * is still a real image; we only reject things that are not images at all).
 */
function looksLikeImage(b64: string): boolean {
  // 16 base64 chars decode to 12 bytes — enough for every signature below.
  let head: Uint8Array;
  try {
    const bin = atob(b64.slice(0, 16));
    head = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  } catch {
    return false;
  }
  const starts = (...sig: number[]) => sig.every((b, i) => head[i] === b);
  const isPng = starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
  const isJpeg = starts(0xff, 0xd8, 0xff);
  const isGif = starts(0x47, 0x49, 0x46, 0x38); // "GIF8"
  // WebP: "RIFF"???? "WEBP" — bytes 0-3 = RIFF, bytes 8-11 = WEBP.
  const isWebp =
    starts(0x52, 0x49, 0x46, 0x46) &&
    head[8] === 0x57 && head[9] === 0x45 && head[10] === 0x42 && head[11] === 0x50;
  return isPng || isJpeg || isGif || isWebp;
}

/** Trim + length-cap a free-text field; returns undefined for empty. */
function clean(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  if (!t) return undefined;
  return t.slice(0, MAX_FIELD_LEN);
}

/**
 * Validate and normalize a raw request body into a ValidatedReview, or return a
 * structured rejection with the right HTTP status. Never throws.
 */
export function validateReviewRequest(body: unknown): ValidationOutcome {
  if (typeof body !== "object" || body === null) {
    return { ok: false, status: 400, error: "Request body must be a JSON object." };
  }
  const b = body as Record<string, unknown>;

  // --- application ---
  const app = b.application;
  if (typeof app !== "object" || app === null) {
    return { ok: false, status: 400, error: "Missing application details." };
  }
  const a = app as Record<string, unknown>;
  // Brand is optional at the API level: the single-review UI gates on it client-
  // side, but the batch screen sends no application and just reads each label.
  const brandName = clean(a.brandName);

  const beverageType: BeverageType = VALID_BEVERAGE_TYPES.includes(
    a.beverageType as BeverageType,
  )
    ? (a.beverageType as BeverageType)
    : "auto";

  const application: ApplicationData = {
    brandName,
    beverageType,
    classType: clean(a.classType),
    alcoholContent: clean(a.alcoholContent),
    netContents: clean(a.netContents),
    producer: clean(a.producer),
    originCountry: clean(a.originCountry),
  };

  // --- media type ---
  const mediaType = b.mediaType;
  if (typeof mediaType !== "string" || !ALLOWED_MEDIA_TYPES.includes(mediaType as AllowedMediaType)) {
    return {
      ok: false,
      status: 415,
      error: `Unsupported image type. Use PNG, JPEG, WebP, or GIF.`,
    };
  }

  // --- image payload ---
  const imageBase64 = b.imageBase64;
  if (typeof imageBase64 !== "string" || imageBase64.length === 0) {
    return { ok: false, status: 400, error: "A label image is required." };
  }
  if (!BASE64_RE.test(imageBase64)) {
    return { ok: false, status: 400, error: "The image data is not valid base64." };
  }
  if (base64ByteLength(imageBase64) > MAX_IMAGE_BYTES) {
    return { ok: false, status: 413, error: "That image is too large. Use a smaller photo." };
  }
  if (!looksLikeImage(imageBase64)) {
    return { ok: false, status: 400, error: "That file does not look like an image. Upload a photo of the label." };
  }

  return {
    ok: true,
    value: { application, imageBase64, mediaType: mediaType as AllowedMediaType },
  };
}
