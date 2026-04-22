// ---------------------------------------------------------------------------
// frontend/src/components/shipments/OmsSyncPill.jsx
// Presentational pill that surfaces a shipment's OMS-sync status at a glance.
// All derivation happens in utils/omsSyncStatus.js — this component takes the
// derived props and renders them. No IO, no hooks, no business logic.
// ---------------------------------------------------------------------------

import React from "react";

const COLOR_TO_BADGE_CLASS = {
  green:  "badge badge-green",
  purple: "badge badge-purple",
  red:    "badge badge-red",
  gray:   "badge",
};

export default function OmsSyncPill({ status, label, color, title }) {
  // "na" renders as a dash so the column stays visually aligned without
  // screaming "nothing happened" — TMS-origin shipments legitimately
  // never populate OMS.
  if (status === "na") {
    return (
      <span
        title={title}
        style={{ color: "var(--text2)", fontSize: 11, opacity: 0.6 }}
      >
        {label || "—"}
      </span>
    );
  }

  const cls = COLOR_TO_BADGE_CLASS[color] || "badge";
  return (
    <span className={cls} title={title} style={{ fontSize: 10, padding: "0 6px" }}>
      {label}
    </span>
  );
}
