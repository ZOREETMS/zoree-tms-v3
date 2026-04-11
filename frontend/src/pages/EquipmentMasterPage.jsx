import { useMemo, useState } from "react";
import { useOutletContext } from "react-router-dom";
import EquipmentTable from "../components/equipment/EquipmentTable";
import EquipmentModal from "../components/equipment/EquipmentModal";
import {
  getEquipmentList,
  saveEquipmentRecord,
  deactivateEquipment,
  computeEquipmentStats,
  EMPTY_EQUIPMENT,
} from "../services/equipmentService";

export default function EquipmentMasterPage() {
  const { equipmentTypes = [], refreshData } = useOutletContext();
  const [q, setQ] = useState("");
  const [busyId, setBusyId] = useState("");
  const [message, setMessage] = useState({ text: "", type: "" });
  const [editItem, setEditItem] = useState(null);
  const [sortCol, setSortCol] = useState("name");
  const [sortAsc, setSortAsc] = useState(true);

  function toast(text, type = "info") {
    setMessage({ text, type });
    setTimeout(() => setMessage({ text: "", type: "" }), 4000);
  }

  const list = getEquipmentList(equipmentTypes);
  const stats = computeEquipmentStats(list);

  const rows = useMemo(() => {
    let data = [...list];
    if (q.trim()) {
      const t = q.toLowerCase();
      data = data.filter((e) =>
        [e.name, e.code, e.description, e.status]
          .some((v) => String(v || "").toLowerCase().includes(t))
      );
    }
    return data.sort((a, b) => {
      let av = a[sortCol], bv = b[sortCol];
      if (typeof av === "number" || typeof bv === "number") {
        return sortAsc ? (Number(av) || 0) - (Number(bv) || 0) : (Number(bv) || 0) - (Number(av) || 0);
      }
      av = String(av || "").toLowerCase();
      bv = String(bv || "").toLowerCase();
      return sortAsc ? av.localeCompare(bv) : bv.localeCompare(av);
    });
  }, [list, q, sortCol, sortAsc]);

  function toggleSort(col) {
    if (sortCol === col) setSortAsc(!sortAsc);
    else { setSortCol(col); setSortAsc(true); }
  }

  async function handleSave() {
    if (!editItem) return;
    if (!editItem.name) { toast("Name is required", "warning"); return; }
    setBusyId("saving");
    try {
      await saveEquipmentRecord(editItem);
      toast(`Equipment "${editItem.name}" saved`, "success");
      setEditItem(null);
      await refreshData();
    } catch (err) { toast(`Failed: ${err.message}`, "error"); }
    finally { setBusyId(""); }
  }

  async function handleDelete(eq) {
    if (!window.confirm(`Deactivate equipment "${eq.name}"?`)) return;
    setBusyId(eq.id);
    try {
      await deactivateEquipment(eq.id);
      toast(`${eq.name} deactivated`, "success");
      await refreshData();
    } catch (err) { toast(`Failed: ${err.message}`, "error"); }
    finally { setBusyId(""); }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <div>
          <h2>Equipment Master</h2>
          <div className="page-subtitle">Define equipment types with weight and volume capacities</div>
        </div>
        <button className="btn btn-primary" onClick={() => setEditItem({ ...EMPTY_EQUIPMENT })}>+ Add Equipment</button>
      </div>

      {/* Stats Cards */}
      <div className="flex gap-3 mb-3" style={{ flexWrap: "wrap" }}>
        {[
          { label: "Total Types", value: stats.total, color: "#6366f1" },
          { label: "Active", value: stats.active, color: "#10b981" },
          { label: "Temp Controlled", value: stats.tempControlled, color: "#3b82f6" },
          { label: "Hazmat Certified", value: stats.hazmat, color: "#f59e0b" },
        ].map((s) => (
          <div key={s.label} style={{
            background: "var(--bg2)", border: "1px solid var(--border)", borderRadius: 12,
            padding: "14px 22px", minWidth: 140, flex: 1,
          }}>
            <div style={{ fontSize: 11, color: "var(--text3)", fontWeight: 700, letterSpacing: 1 }}>{s.label.toUpperCase()}</div>
            <div style={{ fontSize: 28, fontWeight: 800, color: s.color, marginTop: 2 }}>{s.value}</div>
          </div>
        ))}
      </div>

      <div className="search-bar">
        <input placeholder="Search equipment types..." value={q} onChange={(e) => setQ(e.target.value)} className="search" />
      </div>

      {message.text && <div className={`toast toast-${message.type}`} style={{ marginBottom: 12 }}>{message.text}</div>}

      <EquipmentTable
        rows={rows}
        sortCol={sortCol}
        sortAsc={sortAsc}
        onToggleSort={toggleSort}
        onEdit={(eq) => setEditItem({ ...eq })}
        onDelete={handleDelete}
        busyId={busyId}
      />

      {editItem && (
        <EquipmentModal
          item={editItem}
          onFieldChange={(key, value) => setEditItem((p) => ({ ...p, [key]: value }))}
          onSave={handleSave}
          onClose={() => setEditItem(null)}
          busyId={busyId}
        />
      )}
    </div>
  );
}
