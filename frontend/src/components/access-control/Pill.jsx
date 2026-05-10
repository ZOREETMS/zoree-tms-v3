// ════════════════════════════════════════════════════════════════════
// Pill — small colored count badge used in the role hero header and
// the per-section group counts. Variant maps to the existing access
// vocabulary so callers can pass the level directly.
// ════════════════════════════════════════════════════════════════════

const ALIAS = { none: "hide" }; // 'none' renders with the neutral "hide" treatment

export default function Pill({ variant = "hide", label, count, children }) {
  const cls = ALIAS[variant] || variant;
  const body = label
    ? `${count != null ? count + " " : ""}${label}`
    : (count != null ? String(count) : children);
  return (
    <span className={`acc-pill ${cls}`}>
      <span className="dot" />
      {body}
    </span>
  );
}
