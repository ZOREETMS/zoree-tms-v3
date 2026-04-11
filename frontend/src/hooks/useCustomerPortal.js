import { useMemo, useState, useCallback } from "react";
import {
  computePortalStats,
  buildCustomerAccessList,
  buildVisibilityRows,
  shareTrackingLink,
  copyPortalLink,
  sendCustomerInvite,
} from "../services/customerPortalService";

/**
 * Custom hook for Customer Portal business logic.
 * Separates data computation from UI rendering.
 */
export default function useCustomerPortal(shipments, orders) {
  const [toast, setToast] = useState({ text: "", type: "" });
  const [inviteModalOpen, setInviteModalOpen] = useState(false);
  const [search, setSearch] = useState("");

  function showToast(text, type = "success") {
    setToast({ text, type });
    setTimeout(() => setToast({ text: "", type: "" }), 4000);
  }

  const stats = useMemo(
    () => computePortalStats(shipments),
    [shipments]
  );

  const customerList = useMemo(
    () => buildCustomerAccessList(shipments, orders),
    [shipments, orders]
  );

  const visibilityRows = useMemo(() => {
    const rows = buildVisibilityRows(shipments, orders);
    if (!search.trim()) return rows;
    const q = search.toLowerCase();
    return rows.filter(
      (r) =>
        r.id.toLowerCase().includes(q) ||
        r.customer.toLowerCase().includes(q) ||
        r.originShort.toLowerCase().includes(q) ||
        r.destShort.toLowerCase().includes(q)
    );
  }, [shipments, orders, search]);

  const handleCopyLink = useCallback(async () => {
    const result = await copyPortalLink();
    showToast(result.message, "success");
  }, []);

  const handleShareTracking = useCallback(async (shipmentId, customerName) => {
    const result = await shareTrackingLink(shipmentId, customerName);
    showToast(result.message, "success");
  }, []);

  const handleShareCustomer = useCallback(async (customerName) => {
    showToast(`Portal link sent to ${customerName}`, "success");
  }, []);

  const handleInvite = useCallback(async (invite) => {
    const result = await sendCustomerInvite(invite);
    showToast(result.message, "success");
    setInviteModalOpen(false);
  }, []);

  return {
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
  };
}
