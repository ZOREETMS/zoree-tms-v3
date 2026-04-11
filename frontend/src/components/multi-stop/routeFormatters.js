/**
 * Format number as USD currency string.
 * fmt$(2571.43) → "$2,571.43"
 */
export function fmt$(n) {
  return (
    "$" +
    Number(n || 0).toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  );
}

/**
 * Format transit hours as human-readable string.
 * formatTransitTime(22.5) → "22h 30m"
 */
export function formatTransitTime(hours) {
  if (!hours) return "--";
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  if (h === 0) return `${m}m`;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

/**
 * Generate route template ID in format RT-YYYY-NNNN.
 */
export function genId() {
  const y = new Date().getFullYear();
  const r = String(Math.floor(1000 + Math.random() * 9000));
  return `RT-${y}-${r}`;
}
