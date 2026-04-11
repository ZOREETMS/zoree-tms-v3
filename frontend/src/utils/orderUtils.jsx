/**
 * Order utility functions — pure helpers with no API or state dependencies.
 */

// ── Currency formatter ──
export function fmt$(n) {
  return "$" + Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ── Business-day arithmetic ──
export function addBusinessDays(dateStr, days) {
  const d = new Date(dateStr + "T12:00:00");
  const step = days >= 0 ? 1 : -1;
  let remaining = Math.abs(days);
  while (remaining > 0) {
    d.setDate(d.getDate() + step);
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) remaining--;
  }
  return d.toISOString().slice(0, 10);
}

// ── Pickup / delivery date calculation ──
export function calcDates(quote, dueDate, readyDate) {
  const today = new Date().toISOString().slice(0, 10);
  let transit = quote.transitDays || null;
  if (!transit) {
    return { pickup: null, delivery: null, transit: null, warning: "", error: "No transit time available — configure transit_days in rate table, add miles, or enable CarrierConnect" };
  }
  const minPickup = today > (readyDate || "") ? today : (readyDate || today);
  let pickup = minPickup;
  if (dueDate) {
    const idealPickup = addBusinessDays(dueDate, -transit);
    if (idealPickup >= minPickup) pickup = idealPickup;
  }
  const delivery = addBusinessDays(pickup, transit);
  const warning = dueDate && delivery > dueDate ? "Late — delivery after due date" : "";
  return { pickup, delivery, transit, warning };
}

// ── City → ZIP fallback ──
const CITY_ZIPS = {
  "chicago": "60602", "dallas": "75202", "atlanta": "30303", "los angeles": "90012",
  "new york": "10001", "houston": "77002", "san jose": "95112", "charlotte": "28202",
  "memphis": "38103", "louisville": "40202", "columbus": "43215", "indianapolis": "46204",
  "nashville": "37203", "san francisco": "94102", "seattle": "98101", "denver": "80202",
  "phoenix": "85004", "detroit": "48226", "minneapolis": "55401", "miami": "33131",
  "college park": "30337", "laredo": "78040", "el paso": "79901", "savannah": "31401",
};

export function cityZipLookup(str) {
  const city = (str || "").split(",")[0].trim().toLowerCase();
  return CITY_ZIPS[city] || "";
}

// ── Constraint badges ──
export function constraintBadges(o) {
  const badges = [];
  if (o.noConsolidate) badges.push({ label: "🚫 Solo", bg: "rgba(220,38,38,.1)", color: "#dc2626", border: "rgba(220,38,38,.25)" });
  if (o.dedicatedEquip) badges.push({ label: "🚛 Dedicated", bg: "rgba(217,119,6,.1)", color: "#d97706", border: "rgba(217,119,6,.25)" });
  if (o.hazmat) badges.push({ label: "☢️ Hazmat", bg: "rgba(220,38,38,.1)", color: "#dc2626", border: "rgba(220,38,38,.25)" });
  if (o.preferredCarrier) badges.push({ label: "📌 " + String(o.preferredCarrier).split(" ")[0], bg: "rgba(59,130,246,.1)", color: "#3b82f6", border: "rgba(59,130,246,.25)" });
  if (o.excludedCarrier) badges.push({ label: "⛔ No " + String(o.excludedCarrier).split(" ")[0], bg: "rgba(107,114,128,.1)", color: "#6b7280", border: "rgba(107,114,128,.25)" });
  return badges;
}

// ── Detail field display component ──
export function SdField({ icon, label, value }) {
  const display = value === null || value === undefined || value === "" ? "\u2014" : value;
  const isEmpty = display === "\u2014";
  return (
    <div className="sd-field">
      <div className="sd-field-label">{icon} {label}</div>
      <div className={"sd-field-value" + (isEmpty ? " empty" : "")}>{display}</div>
    </div>
  );
}
