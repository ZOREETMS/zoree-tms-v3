/**
 * LocationFilter — reusable Ship-From / Ship-To text filter.
 *
 * Stateless text input. Parent owns the value and combines it with other
 * filters in a useMemo. The match is a case-insensitive substring test
 * performed by utils/locationFilter.js#matchesLocation.
 */
export default function LocationFilter({ side, value, onChange }) {
  const placeholder = side === "from" ? "Ship From (city, name, ZIP)" : "Ship To (city, name, ZIP)";
  return (
    <input
      type="text"
      className="fsel"
      value={value || ""}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      style={{ minWidth: 180, maxWidth: 240 }}
    />
  );
}
