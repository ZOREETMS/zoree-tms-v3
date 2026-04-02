import { useState, useMemo } from "react";
import { SEED_DOCUMENTS, generateBOLForShipment, computeDocStats } from "../services/documentService";

export default function useDocuments(shipments) {
  const [documents, setDocuments] = useState(SEED_DOCUMENTS);
  const [typeFilter, setTypeFilter] = useState("");

  const filtered = useMemo(() => {
    if (!typeFilter) return documents;
    return documents.filter((d) => d.type === typeFilter);
  }, [documents, typeFilter]);

  const stats = useMemo(() => computeDocStats(documents), [documents]);

  function generateBOL() {
    const ship = (shipments || []).find(
      (s) => s.status === "Planned" || s.status === "Tendered"
    );
    if (!ship) return { success: false, message: "No planned shipments to generate BOL" };
    const newDoc = generateBOLForShipment(ship);
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
