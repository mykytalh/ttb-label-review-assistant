/**
 * Generate the mock COLA review queue from the COLA Cloud sample pack.
 *
 * The app simulates the agent-side review workflow, so it needs a queue of
 * "pending" applications that each carry real application metadata and a real
 * attached label image. Rather than invent fake records, this script seeds them
 * from a free, public sample of the TTB COLA registry (COLA Cloud Sample Pack):
 * real brands, real submitted artwork, real classes and dates.
 *
 * It is a BUILD-TIME step only. The running app never calls COLA Cloud — it
 * serves the committed output (`src/data/mock-cola.json` + `public/mock-labels/`).
 * That keeps the prototype self-contained and stateless, per the brief, while the
 * data layer stays swappable behind `cola-store.ts` (see ColaCloudSource).
 *
 * Each record's *application claim* (brand/ABV/origin/…) is curated below: most
 * mirror the label (→ Ready), and a few carry a deliberate, realistic discrepancy
 * (a wrong ABV, a brand typo, a front-only label missing the warning) so the
 * review produces every result status. Every claim here was verified against the
 * real extract→validate pipeline (3 runs each) to land on its intended status.
 *
 * Usage:  node scripts/gen-mock-cola.mjs
 * Needs:  ./cola-sample-pack-v1/{cola.csv,cola_image.csv}  (free download, gitignored)
 *         network access to the sample pack's CloudFront image CDN
 */
import sharp from "sharp";
import fs from "node:fs";
import path from "node:path";

const PACK = "cola-sample-pack-v1";
const CDN = "https://dyuie4zgfxmt6.cloudfront.net";
const OUT_JSON = "src/data/mock-cola.json";
const OUT_IMAGES = "public/mock-labels";

/**
 * Curated queue. `claim` is the application data the agent's record asserts —
 * what gets cross-checked against the label. `scenario`/`expected` document the
 * intended outcome (verified against the live pipeline); they are not used by the
 * app, which computes the verdict for real at runtime.
 */
const SPEC = [
  {
    id: "COLA-2026-001", ttbImageId: "25307001000088_1", priority: "normal",
    applicantName: "Vinhos Penalva Imports LLC",
    claim: { brandName: "Flor de Penalva", beverageType: "wine", alcoholContent: "13%", netContents: "750 mL", originCountry: "Portugal" },
    scenario: "Clean import — all fields match the label.", expected: "Ready for Approval",
  },
  {
    id: "COLA-2026-002", ttbImageId: "25357001000288_0", priority: "normal",
    applicantName: "Apennine Selections Inc.",
    claim: { brandName: "Pietraluna", beverageType: "wine", alcoholContent: "13.5%", netContents: "750 mL", originCountry: "Italy" },
    scenario: "Clean import — all fields match the label.", expected: "Ready for Approval",
  },
  {
    id: "COLA-2026-003", ttbImageId: "25350001000305_0", priority: "normal",
    applicantName: "Adriatic Cellars LLC",
    claim: { brandName: "Dunico", beverageType: "wine", alcoholContent: "15.5%", netContents: "750 mL", originCountry: "Italy" },
    scenario: "Clean import (dessert wine) — all fields match.", expected: "Ready for Approval",
  },
  {
    id: "COLA-2026-004", ttbImageId: "25363001000090_0", priority: "normal",
    applicantName: "Bondstone Distilling Co.",
    claim: { brandName: "Bondstone", beverageType: "spirits", alcoholContent: "50%", netContents: "750 mL" },
    scenario: "Clean domestic spirit — brand, ABV, volume, warning all match.", expected: "Ready for Approval",
  },
  {
    id: "COLA-2026-005", ttbImageId: "25323001000734_1", priority: "normal",
    applicantName: "Treviso Sparkling Imports LLC",
    claim: { brandName: "Ellie Rosi Vinelli", beverageType: "wine", classType: "Sparkling Rosé Wine", alcoholContent: "11%", netContents: "750 mL", originCountry: "Italy" },
    scenario: "Brand spelling on the application differs from the label ('Rosi' vs 'Rosé') — a near match the agent must confirm.",
    expected: "Needs Agent Review",
  },
  {
    id: "COLA-2026-006", ttbImageId: "25273001000802_0", priority: "high",
    applicantName: "Arthur Wheeler Spirits Company",
    claim: { brandName: "Arthur Wheeler", beverageType: "spirits", classType: "Straight Bourbon Whiskey", alcoholContent: "45%", netContents: "750 mL" },
    scenario: "Application claims 45% ABV but the label states 50.5% — a clear mismatch beyond the ±0.3% spirits tolerance.",
    expected: "Likely Rejection",
  },
  {
    id: "COLA-2026-007", ttbImageId: "25344001000053_0", priority: "high",
    applicantName: "Sky Acres Winery LLC",
    claim: { brandName: "Sky Acres", beverageType: "wine", classType: "White Wine", alcoholContent: "13.5%" },
    scenario: "Front label submitted — the mandatory government warning is not on it (27 CFR 16.21). The front isn't the full label, so this is flagged as missing.",
    expected: "Likely Rejection",
  },
  {
    id: "COLA-2026-008", ttbImageId: "25357001000380_0", priority: "normal",
    applicantName: "Cavarena Estate Imports LLC",
    claim: { brandName: "Villa Cavarena", beverageType: "wine", alcoholContent: "13.5%", netContents: "750 mL", originCountry: "Italy" },
    scenario: "Clean import — all fields match the label.", expected: "Ready for Approval",
  },
  {
    id: "COLA-2026-009", ttbImageId: "25339001000497_1", priority: "normal",
    applicantName: "Champagne Hubert Selections Inc.",
    claim: { brandName: "Waris Hubert", beverageType: "wine", alcoholContent: "12%", netContents: "750 mL", originCountry: "France" },
    scenario: "Clean import — all fields match the label.", expected: "Ready for Approval",
  },
  {
    id: "COLA-2026-010", ttbImageId: "25360001000162_0", priority: "normal",
    applicantName: "Burgundy Fine Wine Imports LLC",
    claim: { brandName: "Domaine Fevre", beverageType: "wine", alcoholContent: "13%", netContents: "750 mL", originCountry: "France" },
    scenario: "Clean import — all fields match the label.", expected: "Ready for Approval",
  },
  {
    id: "COLA-2026-011", ttbImageId: "25351001000047_1", priority: "normal",
    applicantName: "Southern Cross Wine Imports LLC",
    claim: { brandName: "Johanneshof Cellars", beverageType: "wine", alcoholContent: "13.5%", netContents: "750 mL", originCountry: "New Zealand" },
    scenario: "Clean import — all fields match the label.", expected: "Ready for Approval",
  },
  {
    id: "COLA-2026-012", ttbImageId: "25329001000182_0", priority: "normal",
    applicantName: "Grower Champagne Imports LLC",
    claim: { brandName: "Laherte Freres", beverageType: "wine", alcoholContent: "12.5%", netContents: "750 mL", originCountry: "France" },
    scenario: "Clean import — all fields match the label.", expected: "Ready for Approval",
  },
  {
    id: "COLA-2026-013", ttbImageId: "25352001000033_0", priority: "normal",
    applicantName: "Valpolicella Imports LLC",
    claim: { brandName: "Quintarelli Guiseppe", beverageType: "wine", alcoholContent: "12.5%", netContents: "750 mL", originCountry: "Italy" },
    scenario: "Application brand 'Quintarelli Guiseppe' vs the label's 'Quintarelli Giuseppe' — a near match the agent must confirm.",
    expected: "Needs Agent Review",
  },
  {
    id: "COLA-2026-014", ttbImageId: "25352001000348_0", priority: "high",
    applicantName: "Iberian Cellars LLC",
    claim: { brandName: "Andres Alonso", beverageType: "wine", alcoholContent: "13%", netContents: "750 mL", originCountry: "Portugal" },
    scenario: "Application lists Portugal as country of origin, but the label declares Spain — an origin mismatch on an import.",
    expected: "Likely Rejection",
  },
  {
    id: "COLA-2026-015", ttbImageId: "25343001000475_0", priority: "normal",
    applicantName: "Loire Valley Imports LLC",
    claim: { brandName: "Gaspard Brochet", beverageType: "wine", alcoholContent: "15.5%", netContents: "750 mL", originCountry: "France" },
    scenario: "Application claims 15.5% ABV but the label states 12.5% — a mismatch beyond the wine tolerance band.",
    expected: "Likely Rejection",
  },
  // Additional verified clean records (curated against the live pipeline).
  {
    id: "COLA-2026-016", ttbImageId: "25357001000053_0", priority: "normal",
    applicantName: "Opal Moon Cellars",
    claim: { brandName: "Opal Moon", beverageType: "wine", alcoholContent: "14.5%", netContents: "750 mL" },
    scenario: "Clean domestic wine — all fields match.", expected: "Ready for Approval",
  },
  {
    id: "COLA-2026-018", ttbImageId: "25357001000559_1", priority: "normal",
    applicantName: "Trader Joe's Company",
    claim: { brandName: "Trader Joe's", beverageType: "wine", alcoholContent: "14.5%", netContents: "750 mL" },
    scenario: "Clean domestic wine — all fields match.", expected: "Ready for Approval",
  },
  // Imported beers / malt beverages — class variety.
  {
    id: "COLA-2026-019", ttbImageId: "25355001000111_0", priority: "normal",
    applicantName: "Pan-American Beverage Imports LLC",
    claim: { brandName: "Golden Extra", beverageType: "beer", alcoholContent: "4.6%" },
    scenario: "Clean imported beer — brand, ABV, and warning match.", expected: "Ready for Approval",
  },
  {
    id: "COLA-2026-020", ttbImageId: "25355001000132_0", priority: "normal",
    applicantName: "Regia Imports LLC",
    claim: { brandName: "Regia", beverageType: "beer", alcoholContent: "4.8%" },
    scenario: "Clean imported beer — all checked fields match.", expected: "Ready for Approval",
  },
  {
    id: "COLA-2026-021", ttbImageId: "25355001000137_0", priority: "normal",
    applicantName: "Suprema Beverages USA",
    claim: { brandName: "Suprema", beverageType: "beer", alcoholContent: "5.0%" },
    scenario: "Clean imported beer — all checked fields match.", expected: "Ready for Approval",
  },
];

/** Minimal RFC-4180 CSV parser (handles quoted, multi-line cells). */
function parseCsv(text) {
  const rows = []; let row = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
    else if (c === '"') q = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
    else if (c !== "\r") cell += c;
  }
  if (cell.length || row.length) { row.push(cell); rows.push(row); }
  const header = rows.shift();
  return rows.filter((r) => r.length === header.length).map((r) => Object.fromEntries(header.map((h, i) => [h, r[i]])));
}

async function main() {
  const cola = parseCsv(fs.readFileSync(path.join(PACK, "cola.csv"), "utf8"));
  const colaById = new Map(cola.map((r) => [r.TTB_ID, r]));
  fs.mkdirSync(OUT_IMAGES, { recursive: true });
  fs.mkdirSync(path.dirname(OUT_JSON), { recursive: true });

  const records = [];
  for (const s of SPEC) {
    const ttbId = s.ttbImageId.replace(/_\d+$/, "");
    const src = colaById.get(ttbId);
    if (!src) throw new Error(`TTB_ID ${ttbId} not found in sample pack`);

    // Download the label image (CloudFront → downscaled JPEG, matching the
    // client's own 1024px/JPEG prep so the committed image is review-ready).
    const res = await fetch(`${CDN}/${s.ttbImageId}.webp`);
    if (!res.ok) throw new Error(`image ${s.ttbImageId}: HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    const imageName = `${ttbId}.jpg`;
    await sharp(buf).rotate().resize(1024, 1024, { fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 82 }).toFile(path.join(OUT_IMAGES, imageName));

    records.push({
      id: s.id,
      ttbId,
      applicantName: s.applicantName,
      ...s.claim,
      // Authentic registry metadata, for display realism and traceability.
      productName: src.PRODUCT_NAME || null,
      registryClass: src.CLASS_NAME || null,
      permitNumber: src.PERMIT_NUMBER || null,
      sourceLabel: src.DOMESTIC_OR_IMPORTED || null,
      status: "Pending Review",
      priority: s.priority,
      submittedAt: src.APPLICATION_DATE || null,
      labelImage: `/mock-labels/${imageName}`,
      scenario: s.scenario,
      expected: s.expected,
    });
    console.log(`✓ ${s.id}  ${s.claim.brandName.padEnd(20)} → ${s.expected}`);
  }

  fs.writeFileSync(OUT_JSON, JSON.stringify(records, null, 2) + "\n");
  console.log(`\nWrote ${records.length} records to ${OUT_JSON} and images to ${OUT_IMAGES}/`);
}

main().catch((e) => { console.error(e); process.exit(1); });
