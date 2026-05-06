import { useState, useMemo, useEffect, useCallback } from "react";
import { generateBOLForShipment, computeDocStats, fetchDocuments, saveDocument, removeDocument } from "../services/documentService";
import { ShipmentsApi, OrdersApi } from "../lib/api";

export default function useDocuments(shipments, orders) {
  const [documents, setDocuments] = useState([]);
  const [typeFilter, setTypeFilter] = useState("");
  const [loading, setLoading] = useState(true);

  // Fetch documents from API on mount
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchDocuments()
      .then((docs) => { if (!cancelled) setDocuments(docs); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const filtered = useMemo(() => {
    if (!typeFilter) return documents;
    return documents.filter((d) => d.type === typeFilter);
  }, [documents, typeFilter]);

  const stats = useMemo(() => computeDocStats(documents), [documents]);

  const generateBOL = useCallback(async (shipmentId) => {
    const ship = shipmentId
      ? (shipments || []).find((s) => s.id === shipmentId)
      : (shipments || []).find((s) => s.status === "Planned" || s.status === "Tendered");
    if (!ship) return { success: false, message: shipmentId ? `Shipment ${shipmentId} not found` : "No planned shipments to generate BOL" };

    const orderIds = Array.isArray(ship.order_ids) ? ship.order_ids : [];
    const linkedOrders = (orders || []).filter((o) => orderIds.includes(o.id));
    let allLines = [];
    try {
      const lineResults = await Promise.all(orderIds.map((oid) => OrdersApi.lines(oid).catch(() => [])));
      allLines = lineResults.flat();
    } catch { /* ignore */ }

    const newDoc = generateBOLForShipment(ship, linkedOrders, allLines);
    const existing = documents.find((d) => d.id === newDoc.id && d.type === "BOL");

    // Optimistic local update — replace if existing, or prepend
    setDocuments((prev) =>
      existing
        ? prev.map((d) => (d.id === newDoc.id ? newDoc : d))
        : [newDoc, ...prev]
    );

    // Persist to DB
    saveDocument(newDoc).catch(() => {});
    // Update shipment bol_number field. Routes through the audited
    // PATCH /api/shipments/:id (Bug #38) so the change_history row
    // lands in the timeline instead of going through the raw
    // /db/shipments path.
    ShipmentsApi.update(ship.id, { bolNumber: newDoc.id }).catch(() => {});

    const action = existing ? "regenerated" : "generated";
    return { success: true, message: `BOL ${action} for ${ship.id}`, doc: newDoc };
  }, [shipments, orders, documents]);

  const addDocument = useCallback((doc) => {
    setDocuments((prev) => [doc, ...prev]);
    saveDocument(doc).catch(() => {});
  }, []);

  const updateDocument = useCallback((docId, updates) => {
    setDocuments((prev) =>
      prev.map((d) => (d.id === docId ? { ...d, ...updates } : d))
    );
    const doc = documents.find((d) => d.id === docId);
    if (doc) saveDocument({ ...doc, ...updates }).catch(() => {});
  }, [documents]);

  const deleteDocument = useCallback((docId) => {
    setDocuments((prev) => prev.filter((d) => d.id !== docId));
    removeDocument(docId).catch(() => {});
  }, []);

  const refreshDocuments = useCallback(() => {
    setLoading(true);
    fetchDocuments()
      .then((docs) => setDocuments(docs))
      .finally(() => setLoading(false));
  }, []);

  function findDocById(docId) {
    return documents.find((d) => d.id === docId);
  }

  return {
    documents: filtered,
    allDocuments: documents,
    stats,
    typeFilter,
    setTypeFilter,
    loading,
    generateBOL,
    addDocument,
    updateDocument,
    deleteDocument,
    refreshDocuments,
    findDocById,
  };
}
