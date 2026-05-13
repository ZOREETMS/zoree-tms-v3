import { useOutletContext } from "react-router-dom";
import useCustomerPortal from "../hooks/useCustomerPortal";
import PortalStats from "../components/customer-portal/PortalStats";
import CustomerAccessList from "../components/customer-portal/CustomerAccessList";
import ShipmentVisibilityTable from "../components/customer-portal/ShipmentVisibilityTable";
import InviteCustomerModal from "../components/customer-portal/InviteCustomerModal";
import { useRowSelection } from "../hooks/useRowSelection";
import SelectionBar from "../components/ui/SelectionBar";
// QA 249/254 (2026-05-12): Planner / Viewer have view-only access to
// Customer Portal but Share / Invite were unconditional. Gate via
// useFeatureAccess.
import { useFeatureAccess } from "../hooks/useFeatureAccess";

export default function CustomerPortalPage() {
  const { shipments, orders } = useOutletContext();
  const { canEdit: canEditPortal } = useFeatureAccess("customer_portal");
  const {
    stats,
    customerList,
    visibilityRows,
    toast,
    search,
    setSearch,
    inviteModalOpen,
    setInviteModalOpen,
    handleCopyLink,
    handleShareTracking,
    handleShareCustomer,
    handleInvite,
  } = useCustomerPortal(shipments, orders);

  const sel = useRowSelection({ getKey: (r) => r.id });

  return (
    <div>
      {/* Page Header */}
      <div style={{
        padding: "18px 28px 16px",
        borderBottom: "1px solid var(--border)",
        background: "#fff",
        position: "sticky",
        top: 0,
        zIndex: 5,
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "space-between",
        gap: 12,
        boxShadow: "0 1px 8px rgba(30,45,107,0.06)",
        flexWrap: "wrap",
      }}>
        <div>
          <h2 style={{ margin: 0 }}>Customer Portal</h2>
          <div className="page-subtitle">
            Shipment visibility and status sharing with customers
          </div>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search shipments..."
            style={{
              padding: "7px 12px",
              border: "1.5px solid var(--border)",
              borderRadius: 8,
              fontSize: 13,
              fontFamily: "inherit",
              outline: "none",
              width: 190,
            }}
          />
          <button
            className="btn btn-secondary btn-sm"
            onClick={handleCopyLink}
          >
            🔗 Copy Portal Link
          </button>
          {canEditPortal && (
            <button
              className="btn btn-primary btn-sm"
              onClick={() => setInviteModalOpen(true)}
            >
              📧 Invite Customer
            </button>
          )}
        </div>
      </div>

      <div style={{ padding: "24px 28px" }}>
        {/* Toast */}
        {toast.text && (
          <div
            className={`toast toast-${toast.type}`}
            style={{ marginBottom: 12 }}
          >
            {toast.text}
          </div>
        )}

        {/* Top row: Stats + Customer List */}
        <div style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 16,
          marginBottom: 20,
        }}>
          <PortalStats stats={stats} />
          <CustomerAccessList
            customers={customerList}
            onShare={canEditPortal ? handleShareCustomer : null}
            canEdit={canEditPortal}
          />
        </div>

        {/* Shipment Visibility Table */}
        <SelectionBar count={sel.size} entityLabel="Shipment" onClear={sel.clear} />
        <ShipmentVisibilityTable
          rows={visibilityRows}
          onShare={canEditPortal ? handleShareTracking : null}
          sel={sel}
          canEdit={canEditPortal}
        />
      </div>

      {/* Invite Customer Modal */}
      {inviteModalOpen && (
        <InviteCustomerModal
          onClose={() => setInviteModalOpen(false)}
          onSubmit={handleInvite}
        />
      )}
    </div>
  );
}
