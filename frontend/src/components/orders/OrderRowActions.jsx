import RowActionsMenu from "../ui/RowActionsMenu";
import { isPlannable } from "../../services/ordersService";

// QA #138 follow-up: when canEdit is false (matrix says 'view' or 'none'),
// the row actions collapse to read-only — primary becomes View, the
// destructive items are dropped. Backend canWriteTable still rejects, so
// this is just to keep the UX honest.
export default function OrderRowActions({
  order,
  shipments = [],
  busy = false,
  canEdit = true,
  onPlan,
  onCrossDock,
  onAddToShipment,
  onEdit,
  onView,
  onCancel,
  onDelete,
  onTender,
  onUnplan,
  onCopy,
}) {
  const o = order;
  const status = o.status;

  // Read-only fallback when the matrix forbids edits. Returned for any
  // status — overrides the per-status menus below.
  if (!canEdit) {
    return (
      <RowActionsMenu
        busy={busy}
        primary={{ label: "View", icon: "👁", variant: "btn-secondary", onClick: () => onView?.(o.id) }}
        items={[]}
      />
    );
  }

  if (isPlannable(o)) {
    return (
      <RowActionsMenu
        busy={busy}
        primary={{
          label: "Plan",
          icon: "⚡",
          variant: "btn-primary",
          onClick: () => onPlan?.(o.id),
        }}
        items={[
          { key: "addship", icon: "📦", label: "Add to Shipment", onClick: () => onAddToShipment?.(o) },
          { key: "crossdock", icon: "🔄", label: "Cross-Dock Plan", onClick: () => onCrossDock?.(o.id) },
          { divider: true },
          { key: "view", icon: "👁", label: "View Details", onClick: () => onView?.(o.id) },
          { key: "edit", icon: "✏️", label: "Edit", onClick: () => onEdit?.(o.id) },
          { key: "copy", icon: "📋", label: "Duplicate", onClick: () => onCopy?.(o.id) },
          { divider: true },
          { key: "cancel", icon: "🚫", label: "Cancel Order", tone: "warn", onClick: () => onCancel?.(o.id) },
          { key: "delete", icon: "🗑️", label: "Delete", tone: "danger", onClick: () => onDelete?.(o.id) },
        ]}
      />
    );
  }

  if (status === "Planned") {
    const ship = o.shipment_id ? shipments.find((s) => s.id === o.shipment_id) : null;
    const st = String(ship?.status || "").toLowerCase();
    const alreadyTendered = ["tendered", "tender accepted", "confirmed", "in transit", "delivered"].includes(st);

    return (
      <RowActionsMenu
        busy={busy}
        primary={alreadyTendered
          ? { label: "Unplan", icon: "🔓", variant: "btn-secondary", onClick: () => onUnplan?.(o.id) }
          : { label: "Tender", icon: "📤", variant: "btn-success", onClick: () => onTender?.(o.id) }
        }
        items={[
          { key: "view", icon: "👁", label: "View Details", onClick: () => onView?.(o.id) },
          { key: "copy", icon: "📋", label: "Duplicate", onClick: () => onCopy?.(o.id) },
          { divider: true, hidden: alreadyTendered },
          { key: "unplan", icon: "🔓", label: "Unplan", tone: "warn", onClick: () => onUnplan?.(o.id), hidden: alreadyTendered },
        ]}
      />
    );
  }

  if (status === "Consolidated") {
    return (
      <RowActionsMenu
        busy={busy}
        primary={{ label: "Unplan", icon: "🔓", variant: "btn-secondary", onClick: () => onUnplan?.(o.id) }}
        items={[
          { key: "view", icon: "👁", label: "View Details", onClick: () => onView?.(o.id) },
          { key: "copy", icon: "📋", label: "Duplicate", onClick: () => onCopy?.(o.id) },
        ]}
      />
    );
  }

  if (status === "Cancelled") {
    return (
      <RowActionsMenu
        busy={busy}
        primary={{ label: "View", icon: "👁", variant: "btn-secondary", onClick: () => onView?.(o.id) }}
        items={[
          { key: "copy", icon: "📋", label: "Duplicate", onClick: () => onCopy?.(o.id) },
          { divider: true },
          { key: "delete", icon: "🗑️", label: "Delete Permanently", tone: "danger", onClick: () => onDelete?.(o.id) },
        ]}
      />
    );
  }

  return (
    <RowActionsMenu
      busy={busy}
      primary={{ label: "View", icon: "👁", variant: "btn-secondary", onClick: () => onView?.(o.id) }}
      items={[
        { key: "copy", icon: "📋", label: "Duplicate", onClick: () => onCopy?.(o.id) },
      ]}
    />
  );
}
