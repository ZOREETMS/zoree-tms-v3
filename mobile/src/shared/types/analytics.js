export const TRANSPORT_MODES = [
  { key: "TL",     label: "Truckload (TL)", color: "var(--accent)" },
  { key: "LTL",    label: "LTL",            color: "var(--cyan)" },
  { key: "RAIL",   label: "Rail",           color: "var(--purple)" },
  { key: "AIR",    label: "Air",            color: "var(--yellow)" },
  { key: "PARCEL", label: "Parcel",         color: "var(--green)" },
];

export const CARRIER_GRADE_THRESHOLDS = {
  A: 95,
  B: 90,
};

export function getCarrierGrade(otdPct) {
  if (otdPct >= CARRIER_GRADE_THRESHOLDS.A) return "A";
  if (otdPct >= CARRIER_GRADE_THRESHOLDS.B) return "B";
  return "C";
}

export const GRADE_COLORS = {
  A: "var(--green)",
  B: "var(--accent)",
  C: "var(--yellow)",
};
