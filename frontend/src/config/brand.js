// ═══════════════════════════════════════════════════════════════════
// Brand shown in the UI. One codebase, two faces:
//   VITE_BRAND=zoree    (default) — Zoree TMS
//   VITE_BRAND=kestrel  — the Kestrel Bay demo: "Kestrel Bay TMS"
// Set it in frontend/.env.local and restart the dev server. Code, repo
// and database names are not affected — this is display only.
// ═══════════════════════════════════════════════════════════════════
const BRANDS = {
  zoree: {
    key: "zoree",
    word: "zoree",
    sub: "TMS PLATFORM",
    title: "ZoreeTMS",
    product: "Zoree TMS",
    company: "Zoree LLC",
    short: "Zoree",
    ai: "Zoree AI",
    assistant: "ZoreeAI",
    tagline: "Intelligent Transportation Management",
    favicon: "/favicon.svg",
    docTitle: "ZOREE TMS",
    shipper: "Zoree Shipper",
    docContact: "Questions? Contact finance@zoree.io or call 1-800-ZOREE-TMS.",
  },
  kestrel: {
    key: "kestrel",
    word: "Kestrel Bay",
    sub: "TMS",
    title: "Kestrel Bay TMS",
    product: "Kestrel Bay TMS",
    company: "Kestrel Bay Logistics",
    short: "Kestrel Bay",
    ai: "Kestrel AI",
    assistant: "Kestrel AI",
    tagline: "Transportation & AP for Kestrel Bay Logistics",
    favicon: "/kestrel-favicon.svg",
    docTitle: "KESTREL BAY TMS",
    shipper: "Kestrel Bay Logistics",
    docContact: "Questions? Contact Kestrel Bay Logistics accounts payable.",
  },
};

const key = String(import.meta.env.VITE_BRAND || "zoree").toLowerCase();
export const BRAND = BRANDS[key] || BRANDS.zoree;

/** Set the tab title and favicon once, at startup. */
export function applyBrandToDocument(doc = typeof document !== "undefined" ? document : null) {
  if (!doc) return;
  doc.title = BRAND.title;
  const icon = doc.querySelector('link[rel="icon"]');
  if (icon) icon.setAttribute("href", BRAND.favicon);
}
