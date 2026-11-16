// Invoices of the active domain grouped by shipment, for billing status on
// the Shipments list. A role without invoice access gets an empty map.
import { useCallback, useEffect, useState } from "react";
import { getInvoicesByShipment } from "../services/shipmentInvoiceService";

export function useInvoicesByShipment() {
  const [byShipment, setByShipment] = useState(() => new Map());
  const reload = useCallback(() => {
    getInvoicesByShipment().then(setByShipment).catch(() => setByShipment(new Map()));
  }, []);
  useEffect(() => { reload(); }, [reload]);
  return { byShipment, reload };
}
