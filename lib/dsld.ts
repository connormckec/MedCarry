/**
 * NIH Dietary Supplement Label Database (DSLD) helpers.
 * Docs verified: https://dsld.od.nih.gov/api-guide (API v9, base https://api.ods.od.nih.gov/dsld/v9/).
 * Send only product terminology — never patient names, DOB, notes, or photos.
 */

import type { MedicationFields } from "./medication.ts";

export const DSLD_API_BASE = "https://api.ods.od.nih.gov/dsld/v9";
export const DSLD_API_VERSION = "9.4.0";
export const DSLD_DOCS_URL = "https://dsld.od.nih.gov/api-guide";

export type DsldServingSize = {
  unit?: string;
  minQuantity?: number;
  maxQuantity?: number;
  minDailyServings?: number;
  maxDailyServings?: number;
  inSFB?: boolean;
};

export type DsldHitSource = {
  fullName?: string;
  brandName?: string;
  upcSku?: string;
  physicalState?: { langualCodeDescription?: string; langualCode?: string };
  servingSizes?: DsldServingSize[];
  netContents?: { unit?: string; quantity?: number; display?: string }[];
};

export type DsldSearchHit = {
  id: string;
  fullName: string;
  brandName: string;
  physicalState: string;
  servingSummary: string;
  upcSku: string;
};

export type DsldLookupResult = {
  matches: DsldSearchHit[];
  query: string;
  source: "NIH DSLD";
  apiVersion: string;
  note: string;
  available: boolean;
};

export class DsldError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DsldError";
  }
}

/** Reject anything that looks like patient identity or free-text notes. */
export function buildDsldProductQuery(input: {
  productName: string;
  brandName?: string;
  strength?: string;
}): string {
  const name = (input.productName || "").trim().replace(/\s+/g, " ");
  const brand = (input.brandName || "").trim().replace(/\s+/g, " ");
  if (name.length < 3) throw new DsldError("Enter at least three characters of a product name.");
  if (name.length > 120) throw new DsldError("Product name is too long for a supplement lookup.");
  if (/\b(?:dob|ssn|mrn|patient|date of birth)\b/i.test(`${name} ${brand}`)) {
    throw new DsldError("Send only product name and brand — not patient identifiers.");
  }
  if (name.includes("\n") || /take\b/i.test(name) && name.length > 80) {
    throw new DsldError("Send only product terminology, never directions or notes.");
  }
  const parts = [brand, name, (input.strength || "").trim()].filter(Boolean);
  return parts.join(" ").slice(0, 160);
}

function servingSummary(sizes: DsldServingSize[] | undefined): string {
  if (!sizes?.length) return "";
  return sizes
    .slice(0, 2)
    .map((s) => {
      const qty =
        s.minQuantity != null && s.maxQuantity != null && s.minQuantity !== s.maxQuantity
          ? `${s.minQuantity}–${s.maxQuantity}`
          : String(s.minQuantity ?? s.maxQuantity ?? "");
      const unit = s.unit || "serving";
      return qty ? `${qty} ${unit}`.trim() : unit;
    })
    .filter(Boolean)
    .join("; ");
}

export function mapDsldHits(payload: unknown): DsldSearchHit[] {
  if (!payload || typeof payload !== "object") return [];
  const hits = (payload as { hits?: { _id?: string; _source?: DsldHitSource }[] }).hits;
  if (!Array.isArray(hits)) return [];
  return hits.slice(0, 8).map((h) => {
    const src = h._source || {};
    return {
      id: String(h._id || ""),
      fullName: String(src.fullName || "").slice(0, 200),
      brandName: String(src.brandName || "").slice(0, 120),
      physicalState: String(src.physicalState?.langualCodeDescription || "").slice(0, 80),
      servingSummary: servingSummary(src.servingSizes).slice(0, 120),
      upcSku: String(src.upcSku || "").slice(0, 40),
    };
  }).filter((h) => h.id && h.fullName);
}

/**
 * Format label-facing Supplement Facts text from a DSLD hit.
 * Serving size stays label facts — never copied into patient-reported use.
 */
export function formatDsldSupplementFacts(hit: DsldSearchHit): string {
  const lines = [
    hit.brandName ? `Brand: ${hit.brandName}` : "",
    `Product: ${hit.fullName}`,
    hit.physicalState ? `Form: ${hit.physicalState}` : "",
    hit.servingSummary ? `Label serving size: ${hit.servingSummary} (per serving on the label — not your reported use)` : "",
    hit.upcSku ? `UPC/SKU: ${hit.upcSku}` : "",
    `Source: NIH DSLD label ${hit.id}`,
  ].filter(Boolean);
  return lines.join("\n").slice(0, 2500);
}

/** Apply a selected DSLD product onto draft fields without inventing RxNorm or patient use. */
export function applyDsldMatch(fields: MedicationFields, hit: DsldSearchHit): MedicationFields {
  const productName = [hit.brandName, hit.fullName].filter(Boolean).join(" ").replace(/\s+/g, " ").trim().slice(0, 180);
  const facts = formatDsldSupplementFacts(hit);
  return {
    ...fields,
    category: "supplement",
    productName: productName || fields.productName,
    supplementFacts: fields.supplementFacts.trim()
      ? `${facts}\n\n— From your label —\n${fields.supplementFacts}`.slice(0, 2500)
      : facts,
    rxCui: "",
    referenceName: `DSLD:${hit.id} ${hit.fullName}`.slice(0, 300),
    // Do not invent strength amounts from DSLD into the strength field when label OCR had none.
  };
}

export async function searchDsldProducts(
  query: string,
  fetchImpl: typeof fetch = fetch,
): Promise<DsldLookupResult> {
  const q = query.trim();
  const note =
    "NIH DSLD matches are label catalog candidates. Confirm brand, form, and serving size on your bottle. Coverage is incomplete; label-based entry is always OK. Rate limit ~1000 requests/hour without a data.gov key.";
  try {
    const url = `${DSLD_API_BASE}/browse-products/?method=by_keyword&q=${encodeURIComponent(q)}&size=8`;
    const res = await fetchImpl(url, {
      signal: AbortSignal.timeout(8000),
      headers: { Accept: "application/json" },
    });
    if (!res.ok) {
      return {
        matches: [],
        query: q,
        source: "NIH DSLD",
        apiVersion: DSLD_API_VERSION,
        note: "The NIH supplement catalog is unavailable right now. Enter the label details manually.",
        available: false,
      };
    }
    const data = await res.json();
    return {
      matches: mapDsldHits(data),
      query: q,
      source: "NIH DSLD",
      apiVersion: DSLD_API_VERSION,
      note,
      available: true,
    };
  } catch {
    return {
      matches: [],
      query: q,
      source: "NIH DSLD",
      apiVersion: DSLD_API_VERSION,
      note: "The NIH supplement catalog is unavailable right now. Enter the label details manually.",
      available: false,
    };
  }
}
