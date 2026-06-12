/**
 * Label extraction layer. Extraction sits behind a `LabelExtractor` interface so
 * a firewalled deployment can swap in on-prem OCR without changing the validator
 * or UI. The prototype ships a Claude vision implementation with structured JSON
 * output.
 */
import Anthropic from "@anthropic-ai/sdk";
import { ExtractedLabel } from "./types";
import { coerceExtractedLabel } from "./extracted-label";

export interface LabelExtractor {
  /**
   * @param imageBase64 raw base64 (no data: prefix)
   * @param mediaType   e.g. "image/png", "image/jpeg"
   */
  extract(imageBase64: string, mediaType: string): Promise<ExtractedLabel>;
}

// Haiku 4.5 — default for the ~5s latency target and lower batch cost. Override
// with LABEL_MODEL=claude-opus-4-8 for harder photos (slower, more accurate).
function getModel(): string {
  return process.env.LABEL_MODEL || "claude-haiku-4-5";
}

/**
 * JSON Schema the model is forced to emit. Mirrors ExtractedLabel exactly.
 * Every field is "string | null" — the model returns null for fields genuinely
 * absent from the label, which the validator treats as a finding (not an error).
 */
const EXTRACTION_SCHEMA = {
  type: "object",
  properties: {
    brandName: { type: ["string", "null"], description: "The brand name exactly as printed, e.g. 'OLD TOM DISTILLERY'. Null if not legibly visible." },
    beverageType: {
      type: "string",
      enum: ["spirits", "wine", "beer", "other", "unknown"],
      description:
        "The product's beverage category, judged from the whole label: 'spirits' (whiskey, vodka, rum, gin, tequila, brandy, liqueur), 'wine' (incl. sparkling, champagne, vermouth, sake, fortified wine), 'beer' (incl. lager, ale, IPA, malt beverage), or 'other' for anything that doesn't fit those three (hard seltzer, canned cocktail, flavored malt/wine beverage, cider). Use 'unknown' only if you genuinely cannot tell.",
    },
    classType: { type: ["string", "null"], description: "Class/type designation, e.g. 'Kentucky Straight Bourbon Whiskey'. Null if not legibly visible." },
    alcoholContent: {
      type: ["string", "null"],
      description:
        "Alcohol content exactly as printed, e.g. '45% Alc./Vol. (90 Proof)'. Never infer or recall a typical ABV or proof for a recognized brand or beverage type — report only a statement you can actually read in THIS image. Null if not legibly visible.",
    },
    netContents: {
      type: ["string", "null"],
      description:
        "The TOTAL net contents of the container, e.g. '750 mL', '1 L', '12 FL OZ'. Do NOT report the per-serving size from a Serving Facts or Nutrition Facts panel ('Serving size: 150 mL' is not the net contents) — when both appear, report the container total. Null if not legibly visible.",
    },
    producer: { type: ["string", "null"], description: "Bottler/producer name and address as printed. Null if not legibly visible." },
    originCountry: {
      type: ["string", "null"],
      description:
        "The explicit country-of-origin statement, e.g. 'Product of Scotland', 'Hecho en México', 'Imported from France' — it must name a country. Do NOT put class/type lines, ingredient phrases, or marketing text here. Null if no origin statement is visible.",
    },
    governmentWarning: {
      type: ["string", "null"],
      description:
        "Transcribe ONLY the government warning text that is actually legible in THIS image, character-for-character, preserving capitalization and wording. " +
        "START your transcription at the heading: if the words 'GOVERNMENT WARNING' (usually in bold capitals) are printed on the label, you MUST include them verbatim at the beginning — do not begin at '(1)' and skip the heading. " +
        "Then transcribe the numbered body. Do NOT complete, reconstruct, correct, or fill in any part from your own knowledge of the standard warning. If part of it is obscured, transcribe only the legible part. If none of it is legible, return null. " +
        "This field is ONLY for a government warning statement (federal or state). Pressure cautions ('Contents under pressure'), sulfite declarations, 'drink responsibly' slogans, and other cautionary or marketing text do NOT belong here — if the label shows no government warning, return null even when other caution text is visible.",
    },
    warningLegible: {
      type: "boolean",
      description:
        "Set true if you were able to read the entire government warning text directly from the image (even with mild glare or a slight angle — that's fine, as long as you could actually make out every word). Set false ONLY if part of the warning was genuinely unreadable — cut off the edge, fully blurred, hidden behind a hand/reflection — such that you could not read those words and would have to guess them. Do not set false merely because the photo isn't perfect; set it false only when words were actually not readable.",
    },
    imageQuality: { type: "string", enum: ["good", "fair", "poor"], description: "Legibility assessment: good, fair, or poor." },
    notes: {
      type: ["string", "null"],
      description:
        "A brief LEGIBILITY caveat only: what was hard to read, cut off, glared, or blurred (e.g. 'ABV on lower label not legible'). Do NOT catalogue things on the label that aren't compliance fields — no barcodes, logos, slogans, decorative text, or QR codes. Null if there is no legibility issue worth noting.",
    },
  },
  required: [
    "brandName",
    "beverageType",
    "classType",
    "alcoholContent",
    "netContents",
    "producer",
    "originCountry",
    "governmentWarning",
    "warningLegible",
    "imageQuality",
    "notes",
  ],
  additionalProperties: false,
} as const;

/** Hard ceiling on the extraction call so a hung upstream can't wedge a request. */
const EXTRACT_TIMEOUT_MS = 20_000;

/**
 * The extraction contract: transcribe, never reconstruct. Rules 1–5 are the
 * anti-hallucination core (null over guess, no memory completion of the
 * warning, legibility gate, heading capture, one continuous pass) — every one
 * traces to a failure mode caught in eval. Edit only via the tuning protocol
 * in docs/PROMPT_TUNING.md.
 */
const SYSTEM_PROMPT =
  "You are a transcription assistant for alcohol-label compliance review. " +
  "You are given a photo of a beverage label. Transcribe the requested fields " +
  "EXACTLY as they appear — preserve capitalization, punctuation, and wording " +
  "verbatim, especially for the government warning.\n\n" +
  "CRITICAL ANTI-HALLUCINATION RULES:\n" +
  "1. Transcribe ONLY what is actually legible in THIS image. If a field is " +
  "obscured, blurred, cut off, glared, or otherwise unreadable, return null for " +
  "it — do NOT guess, infer, or describe it (never write things like 'not " +
  "visible' as a value; use null).\n" +
  "2. NEVER reconstruct, complete, or fill in the government warning (or any " +
  "field) from your own knowledge of the standard text. You may know the " +
  "warning by heart — that does not matter. Report only the characters you can " +
  "actually see. If part of the warning is obscured, transcribe only the legible " +
  "part and set warningLegible=false.\n" +
  "3. Set warningLegible=true when you could actually read the entire warning " +
  "from the image (mild glare or a slight angle is fine if the words are still " +
  "readable). Set it false only when part of the warning was genuinely " +
  "unreadable and you would have to guess those words.\n" +
  "4. When transcribing the government warning, INCLUDE the 'GOVERNMENT WARNING' " +
  "heading verbatim if it is printed on the label (it usually is, in bold " +
  "capitals). A common mistake is to start at '(1)' and omit the heading — do " +
  "not do that; the heading is part of the required statement and must be " +
  "captured when present.\n" +
  "5. Transcribe the warning in ONE CONTINUOUS PASS, following each printed line " +
  "to the next — the statement wraps mid-sentence, and the words at a line break " +
  "are part of the sentence, so do not skip them when moving to the next line. If " +
  "words in between are genuinely unreadable, stop at the last word you can " +
  "actually read and set warningLegible=false — never bridge a gap from memory.\n\n" +
  "The label may be photographed at an angle, under glare, in poor lighting, or " +
  "ROTATED — many phone photos are sideways (90°/180°) or the text wraps around a " +
  "curved can. Mentally rotate the image as needed and read text in ANY " +
  "orientation; sideways or upside-down text that you can still make out counts as " +
  "legible. The government warning in particular is often set in small print " +
  "running vertically up the side of a can or bottle — look for it there and " +
  "transcribe it even when rotated.\n\n" +
  "Report image quality accurately. Return null for text you could not read rather " +
  "than reconstructing it from memory.";

/** Claude vision implementation of LabelExtractor. */
export class ClaudeExtractor implements LabelExtractor {
  private client: Anthropic;

  constructor(apiKey?: string) {
    // Runs only server-side (in the API route), so the key never reaches the
    // browser. Reads ANTHROPIC_API_KEY from the environment (the SDK default).
    const key = apiKey || process.env.ANTHROPIC_API_KEY;
    this.client = new Anthropic(key ? { apiKey: key } : undefined);
  }

  async extract(imageBase64: string, mediaType: string): Promise<ExtractedLabel> {
    const response = await this.client.messages.create(
      {
      model: getModel(),
      // The structured JSON output is small; a tight cap keeps latency down and
      // can't truncate a valid result.
      max_tokens: 768,
      // Cache the (stable) system prompt so repeated calls — especially a batch —
      // skip re-processing it. A no-op if the prompt is below the cache minimum.
      system: [
        { type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } },
      ],
      output_config: {
        format: { type: "json_schema", schema: EXTRACTION_SCHEMA },
      },
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: mediaType as "image/png" | "image/jpeg" | "image/webp" | "image/gif",
                data: imageBase64,
              },
            },
            { type: "text", text: "Transcribe the label fields per the schema." },
          ],
        },
      ],
      },
      // Per-request timeout so a hung upstream can't wedge the route.
      { timeout: EXTRACT_TIMEOUT_MS },
    );

    // The model declining the image is the one stop_reason we surface directly.
    if (response.stop_reason === "refusal") {
      throw new Error("The model declined to process this image.");
    }
    const textBlock = response.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      throw new Error("No structured output returned from the model.");
    }

    // Defensive: even with structured outputs, validate/normalize the shape rather
    // than trusting JSON.parse output to be a well-formed ExtractedLabel.
    let parsed: unknown;
    try {
      parsed = JSON.parse(textBlock.text);
    } catch {
      throw new Error("The model returned malformed output. Please try again.");
    }
    return coerceExtractedLabel(parsed);
  }
}

/** Factory — single seam to swap implementations (cloud vs on-prem) later. */
export function getExtractor(): LabelExtractor {
  return new ClaudeExtractor();
}
