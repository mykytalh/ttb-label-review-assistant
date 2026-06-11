/**
 * Server-side orchestration: extract a label from an image, then validate it
 * against application data. Shared by single review and each batch row.
 */
import { getExtractor, LabelExtractor } from "./extractor";
import { validate } from "./validate";
import { ApplicationData, ReviewResult } from "./types";

/**
 * @param labelOnly  Batch mode: no application to compare against, so check that
 *   the core required elements are present on the label itself (a missing brand
 *   or class/type fails) rather than treating absent fields as "nothing to check".
 * @param extractor  Defaults to the configured (cloud) extractor. Injectable so
 *   the orchestration can be unit-tested without a network call, and so a future
 *   on-prem OCR backend can be swapped in behind the same `LabelExtractor` seam.
 */
export async function reviewLabel(
  app: ApplicationData,
  imageBase64: string,
  mediaType: string,
  labelOnly = false,
  extractor: LabelExtractor = getExtractor(),
): Promise<ReviewResult> {
  const start = Date.now();
  const label = await extractor.extract(imageBase64, mediaType);
  const result = validate(app, label, { labelOnly });
  result.elapsedMs = Date.now() - start;
  return result;
}
