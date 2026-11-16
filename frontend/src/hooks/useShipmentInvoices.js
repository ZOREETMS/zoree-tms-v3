// Carrier invoices on a shipment. A role that cannot read invoices just sees none.
import { useEffect, useState } from "react";
import { getShipmentInvoices } from "../services/shipmentInvoiceService";

export function useShipmentInvoices(shipmentId) {
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let gone = false;
    if (!shipmentId) { setInvoices([]); setLoading(false); return undefined; }
    setLoading(true);
    getShipmentInvoices(shipmentId)
      .then((rows) => { if (!gone) { setInvoices(rows); setError(""); } })
      .catch((e) => { if (!gone) { setInvoices([]); setError(e?.message || ""); } })
      .finally(() => { if (!gone) setLoading(false); });
    return () => { gone = true; };
  }, [shipmentId]);

  return { invoices, loading, error };
}
