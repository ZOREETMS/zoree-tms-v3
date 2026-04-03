import { useState, useMemo } from "react";
import { SEED_DOCUMENTS, generateBOLForShipment, computeDocStats } from "../services/documentService";
import { OrdersApi } from "../lib/api";

export default function useDocuments(shipments, orders) {
  const [documents, setDocuments] = useState(SEED_DOCUMENTS);
  const [typeFilter, setTypeFilter] = useState("");

  const filtered = useMemo(() => {
    if (!typeFilter) return documents;
    return documents.filter((d) => d.type === typeFilter);
  }, [documents, typeFilter]);

  const stats = useMemo(() => computeDocStats(documents), [documents]);

  async function generateBOL(shipmentId) {
    const ship = shipmentId
      ? (shipments || []).find((s) => s.id === shipmentId)
      : (shipments || []).find((s) => s.status === "Planned" || s.status === "Tendered");
    if (!ship) return { success: false, message: shipmentId ? `Shipment ${shipmentId} not found` : "No planned shipments to generate BOL" };
    // Check if BOL already exists for this shipment
    const existing = documents.find((d) => d.ship === ship.id && d.type === "BOL");
    if (existing) return { success: false, message: `BOL already exists for ${ship.id}` };
    // Fetch linked orders and line items
    const orderIds = Array.isArray(ship.order_ids) ? ship.order_ids : [];
    const linkedOrders = (orders || []).filter((o) => orderIds.includes(o.id));
    let allLines = [];
    try {
      const lineResults = await Promise.all(orderIds.map((oid) => OrdersApi.lines(oid).catch(() => [])));
      allLines = lineResults.flat();
    } catch { /* ignore */ }
    const newDoc = generateBOLForShipment(ship, linkedOrders, allLines);
    setDocuments((prev) => [newDoc, ...prev]);
    return { success: true, message: "BOL generated for " + ship.id, doc: newDoc };
  }

  function addDocument(doc) {
    setDocuments((prev) => [doc, ...prev]);
  }

  function findDocById(docId) {
    return documents.find((d) => d.id === docId);
  }

  return {
    documents: filtered,
    allDocuments: documents,
    stats,
    typeFilter,
    setTypeFilter,
    generateBOL,
    addDocument,
    findDocById,
  };
}
