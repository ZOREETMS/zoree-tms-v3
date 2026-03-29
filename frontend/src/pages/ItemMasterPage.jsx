import { useMemo, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { DbApi } from "../lib/api";

const EMPTY_ITEM = {
  id: "", description: "", customer: "", class: "General", nmfc: "", freight_class: "70",
  weight_unit: "", value_unit: "", len: "", wid: "", hgt: "",
  units_per_pallet: "", pkg: "Carton", stack: 1,
  hazmat: false, fragile: false, temp_ctrl: false, top_load: false,
  un: "", haz_class: "", status: "Active",
};

const CLASS_COLORS = {
  Electronics: { bg: "rgba(59,130,246,.1)", border: "rgba(59,130,246,.35)", text: "var(--accent)" },
  Industrial: { bg: "rgba(245,158,11,.1)", border: "rgba(245,158,11,.35)", text: "var(--yellow)" },
  Perishable: { bg: "rgba(16,185,129,.1)", border: "rgba(16,185,129,.35)", text: "var(--green)" },
  Hazmat: { bg: "rgba(239,68,68,.1)", border: "rgba(239,68,68,.35)", text: "var(--red)" },
  General: { bg: "rgba(107,114,128,.1)", border: "rgba(107,114,128,.35)", text: "var(--text3)" },
};

export default function ItemMasterPage() {
  const { items, setData, refreshData } = useOutletContext();
  const [q, setQ] = useState("");
  const [classFilter, setClassFilter] = useState("");
  const [busyId, setBusyId] = useState("");
  const [message, setMessage] = useState({ text: "", type: "" });
  const [editItem, setEditItem] = useState(null);
  const [sortCol, setSortCol] = useState("id");
  const [sortAsc, setSortAsc] = useState(true);
  const [view, setView] = useState("table");

  function toast(text, type = "info") {
    setMessage({ text, type });
    setTimeout(() => setMessage({ text: "", type: "" }), 4000);
  }

  const rows = useMemo(() => {
    let list = [...items];
    if (q.trim()) {
      const t = q.toLowerCase();
      list = list.filter((it) =>
        [it.id, it.desc, it.description, it.customer, it.item_class, it.nmfc, it.fclass]
          .some((v) => String(v || "").toLowerCase().includes(t))
      );
    }
    if (classFilter) {
      list = list.filter((it) => (it.item_class || it.class || "General") === classFilter);
    }
    return list.sort((a, b) => {
      const av = String(a[sortCol] || "").toLowerCase();
      const bv = String(b[sortCol] || "").toLowerCase();
      return sortAsc ? av.localeCompare(bv) : bv.localeCompare(av);
    });
  }, [items, q, classFilter, sortCol, sortAsc]);

  // KPI calculations
  const kpis = useMemo(() => {
    const total = items.length;
    const hazmat = items.filter((it) => it.hazmat).length;
    const highValue = items.filter((it) => parseFloat(it.value_unit) > 10000).length;
    const active = items.filter((it) => (it.status || "Active") === "Active").length;
    const weights = items.map((it) => parseFloat(it.weight_unit) || 0).filter((w) => w > 0);
    const avgWeight = weights.length > 0 ? Math.round(weights.reduce((a, b) => a + b, 0) / weights.length) : 0;
    return { total, hazmat, highValue, active, avgWeight };
  }, [items]);

  function toggleSort(col) {
    if (sortCol === col) setSortAsc(!sortAsc);
    else { setSortCol(col); setSortAsc(true); }
  }

  function openNew() { setEditItem({ ...EMPTY_ITEM }); }
  function openEdit(item) {
    setEditItem({
      ...item,
      description: item.desc || item.description || "",
      class: item.item_class || item.class || "General",
      freight_class: item.fclass || item.freight_class || "70",
      _originalId: item.id,
    });
  }
  function editField(key, value) { setEditItem((p) => ({ ...p, [key]: value })); }

  async function saveItem() {
    if (!editItem) return;
    if (!editItem.id || !editItem.description) {
      toast("Item ID and Description are required", "warning");
      return;
    }
    setBusyId("saving");
    try {
      const row = {
        id: (editItem.id || "").toUpperCase(),
        desc: (editItem.description || "").toUpperCase(),
        customer: (editItem.customer || "").toUpperCase(),
        item_class: editItem.class || "General",
        nmfc: (editItem.nmfc || "").toUpperCase(),
        fclass: editItem.freight_class || "70",
        weight_unit: parseFloat(editItem.weight_unit) || 0,
        value_unit: parseFloat(editItem.value_unit) || 0,
        len: parseFloat(editItem.len) || 0,
        wid: parseFloat(editItem.wid) || 0,
        hgt: parseFloat(editItem.hgt) || 0,
        units_per_pallet: parseInt(editItem.units_per_pallet) || 1,
        pkg: editItem.pkg || "Carton",
        stack: parseInt(editItem.stack) || 1,
        hazmat: !!editItem.hazmat,
        fragile: !!editItem.fragile,
        temp_ctrl: !!editItem.temp_ctrl,
        top_load: !!editItem.top_load,
        un: editItem.un || "",
        haz_class: editItem.haz_class || "",
        status: editItem.status || "Active",
      };
      const existing = items.find((x) => x.id === editItem._originalId || x.id === editItem.id);
      if (existing && editItem._originalId) {
        await DbApi.patch("items", editItem._originalId, row);
      } else {
        await DbApi.upsert("items", row);
      }
      toast(`Item ${row.id} saved`, "success");
      setEditItem(null);
      await refreshData();
    } catch (err) {
      toast(`Failed: ${err.message}`, "error");
    } finally {
      setBusyId("");
    }
  }

  async function duplicateItem(item) {
    const newId = item.id + "-COPY";
    const row = { ...item, id: newId };
    delete row.created_at;
    delete row.updated_at;
    setBusyId(item.id);
    try {
      await DbApi.upsert("items", row);
      toast(`Duplicated as ${newId}`, "success");
      await refreshData();
    } catch (err) {
      toast(`Failed: ${err.message}`, "error");
    } finally {
      setBusyId("");
    }
  }

  async function toggleStatus(item) {
    const newStatus = (item.status || "Active") === "Active" ? "Inactive" : "Active";
    setBusyId(item.id);
    try {
      await DbApi.patch("items", item.id, { status: newStatus });
      toast(`${item.id} set to ${newStatus}`, "success");
      await refreshData();
    } catch (err) {
      toast(`Failed: ${err.message}`, "error");
    } finally {
      setBusyId("");
    }
  }

  function exportItems() {
    const headers = ["ID", "Description", "Class", "NMFC", "Freight Class", "Weight/Unit", "Value/Unit", "Dims", "Units/Pallet", "Hazmat", "Status"];
    const csvRows = [headers.join(",")];
    rows.forEach((it) => {
      csvRows.push([
        it.id, `"${it.desc || it.description || ""}"`, it.item_class || it.class || "",
        it.nmfc, it.fclass || it.freight_class || "", it.weight_unit, it.value_unit,
        `${it.len || 0}x${it.wid || 0}x${it.hgt || 0}`, it.units_per_pallet,
        it.hazmat ? "Yes" : "No", it.status || "Active",
      ].join(","));
    });
    const blob = new Blob([csvRows.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "items-export.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  // Helper to get item display values
  function getClass(it) { return it.item_class || it.class || "General"; }
  function getDesc(it) { return it.desc || it.description || "--"; }
  function getDims(it) { return `${it.len || 0}\u00D7${it.wid || 0}\u00D7${it.hgt || 0}`; }

  const SortIcon = ({ col }) => (
    <span style={{ opacity: sortCol === col ? 1 : 0.3, marginLeft: 4 }}>
      {sortCol === col ? (sortAsc ? "\u25B2" : "\u25BC") : "\u21C5"}
    </span>
  );

  function ClassBadge({ cls }) {
    const c = CLASS_COLORS[cls] || CLASS_COLORS.General;
    return (
      <span style={{ background: c.bg, color: c.text, border: `1px solid ${c.border}`, fontSize: 11, fontWeight: 700, padding: "2px 9px", borderRadius: 20 }}>
        {cls}
      </span>
    );
  }

  function HandlingBadges({ item }) {
    const badges = [];
    if (item.hazmat) badges.push(<span key="h" style={{ fontSize: 9, background: "rgba(239,68,68,.1)", color: "var(--red)", border: "1px solid rgba(239,68,68,.25)", padding: "1px 5px", borderRadius: 8, fontWeight: 700 }}>HZM</span>);
    if (item.fragile) badges.push(<span key="f" style={{ fontSize: 9, background: "rgba(245,158,11,.1)", color: "var(--yellow)", border: "1px solid rgba(245,158,11,.25)", padding: "1px 5px", borderRadius: 8, fontWeight: 700 }}>FRAG</span>);
    if (item.temp_ctrl) badges.push(<span key="t" style={{ fontSize: 9, background: "rgba(16,185,129,.1)", color: "var(--green)", border: "1px solid rgba(16,185,129,.25)", padding: "1px 5px", borderRadius: 8, fontWeight: 700 }}>TEMP</span>);
    if (item.top_load) badges.push(<span key="tl" style={{ fontSize: 9, background: "rgba(99,102,241,.1)", color: "#6366f1", border: "1px solid rgba(99,102,241,.25)", padding: "1px 5px", borderRadius: 8, fontWeight: 700 }}>TOP</span>);
    if (badges.length === 0) return null;
    return <div style={{ display: "flex", flexWrap: "wrap", gap: 3, marginTop: 4 }}>{badges}</div>;
  }

  function StatusBadge({ status }) {
    const isActive = (status || "Active") === "Active";
    return (
      <span style={{
        background: isActive ? "rgba(16,185,129,.1)" : "rgba(107,114,128,.1)",
        color: isActive ? "var(--green)" : "var(--text3)",
        border: `1px solid ${isActive ? "rgba(16,185,129,.3)" : "rgba(107,114,128,.3)"}`,
        fontSize: 11, fontWeight: 700, padding: "2px 9px", borderRadius: 20,
      }}>
        {isActive ? "Active" : "Inactive"}
      </span>
    );
  }

  // Cards view
  function renderCards() {
    const CLASS_BG = { Electronics: "#eff6ff", Industrial: "#fffbeb", Perishable: "#f0fdf4", Hazmat: "#fef2f2", General: "#f9fafb" };
    return (
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 12, padding: 16 }}>
        {rows.map((it) => {
          const cls = getClass(it);
          const bg = CLASS_BG[cls] || "#f8faff";
          const col = (CLASS_COLORS[cls] || CLASS_COLORS.General).text;
          const density = it.len && it.wid && it.hgt ? ((it.weight_unit || 0) / ((it.len * it.wid * it.hgt) / 1728)).toFixed(1) + " lbs/ft\u00B3" : "\u2014";
          return (
            <div key={it.id} style={{ background: "#fff", border: "1.5px solid var(--border)", borderRadius: 12, overflow: "hidden", cursor: "pointer" }}
              onClick={() => openEdit(it)}>
              <div style={{ background: bg, padding: "12px 14px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span className="mono" style={{ color: col, fontWeight: 700, fontSize: 12 }}>{it.id}</span>
                <span style={{ color: col, background: bg, border: `1px solid ${col}`, fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 20 }}>{cls}</span>
              </div>
              <div style={{ padding: 14 }}>
                <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4, lineHeight: 1.3 }}>{getDesc(it)}</div>
                <div style={{ fontSize: 11, color: "var(--text3)", marginBottom: 12 }}>{it.customer || "--"}</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, fontSize: 11 }}>
                  <div><span style={{ color: "var(--text3)" }}>Weight: </span><strong>{it.weight_unit || 0} lbs</strong></div>
                  <div><span style={{ color: "var(--text3)" }}>Value: </span><strong style={{ color: "var(--green)" }}>${(it.value_unit || 0).toLocaleString()}</strong></div>
                  <div><span style={{ color: "var(--text3)" }}>Class: </span><strong>{it.fclass || it.freight_class || "--"}</strong></div>
                  <div><span style={{ color: "var(--text3)" }}>Density: </span><strong>{density}</strong></div>
                  <div><span style={{ color: "var(--text3)" }}>Dims: </span><strong>{getDims(it)}"</strong></div>
                  <div><span style={{ color: "var(--text3)" }}>Pkg: </span><strong>{it.units_per_pallet || 1}/pallet</strong></div>
                </div>
                <HandlingBadges item={it} />
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div>
      {/* Page Header */}
      <div className="page-header">
        <div>
          <div className="page-title">Item Master</div>
          <div className="page-sub">Product catalog with freight attributes, dimensions, and packaging specs</div>
        </div>
        <div className="header-actions" style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input
            placeholder="Search items..."
            value={q}
            onChange={(e) => setQ(e.target.value)}
            style={{ padding: "7px 12px", border: "1.5px solid var(--border)", borderRadius: 8, fontSize: 13, fontFamily: "inherit", outline: "none", width: 190 }}
          />
          <select
            value={classFilter}
            onChange={(e) => setClassFilter(e.target.value)}
            style={{ padding: "7px 10px", border: "1.5px solid var(--border)", borderRadius: 8, fontSize: 13, fontFamily: "inherit", background: "#fff" }}
          >
            <option value="">All Classes</option>
            <option value="Electronics">Electronics</option>
            <option value="Industrial">Industrial</option>
            <option value="Perishable">Perishable</option>
            <option value="Hazmat">Hazmat</option>
            <option value="General">General</option>
          </select>
          <button className="btn btn-secondary btn-sm" onClick={exportItems}>Export</button>
          <button className="btn btn-primary btn-sm" onClick={openNew}>+ New Item</button>
        </div>
      </div>
      <div className="page-content">

      {/* KPI Stats */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr 1fr", gap: 12, marginBottom: 20 }}>
        <div className="stat-card blue"><div className="stat-label">Total Items</div><div className="stat-value" style={{ fontSize: 26 }}>{kpis.total}</div></div>
        <div className="stat-card yellow"><div className="stat-label">Hazmat Items</div><div className="stat-value" style={{ fontSize: 26 }}>{kpis.hazmat}</div></div>
        <div className="stat-card red"><div className="stat-label">High-Value (&gt;$10K)</div><div className="stat-value" style={{ fontSize: 26 }}>{kpis.highValue}</div></div>
        <div className="stat-card green"><div className="stat-label">Active Items</div><div className="stat-value" style={{ fontSize: 26 }}>{kpis.active}</div></div>
        <div className="stat-card blue"><div className="stat-label">Avg Weight (lbs)</div><div className="stat-value" style={{ fontSize: 26 }}>{kpis.avgWeight}</div></div>
      </div>

      {/* Toast */}
      {message.text && (
        <div className={`toast toast-${message.type || "info"}`} style={{ marginBottom: 12 }}>
          {message.text}
        </div>
      )}

      {/* Product Catalog Card */}
      <div className="card" style={{ padding: 0 }}>
        <div className="card-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span className="card-title">Product Catalog</span>
          <div style={{ display: "flex", gap: 6 }}>
            <button
              className="btn btn-secondary btn-sm"
              style={view === "table" ? { background: "var(--accent)", color: "#fff" } : {}}
              onClick={() => setView("table")}
            >Table</button>
            <button
              className="btn btn-secondary btn-sm"
              style={view === "cards" ? { background: "var(--accent)", color: "#fff" } : {}}
              onClick={() => setView("cards")}
            >Cards</button>
          </div>
        </div>

        {view === "table" ? (
          <div className="table-wrap">
          <table className="grid" style={{ border: "none", boxShadow: "none" }}>
            <thead>
              <tr>
                <th style={{ cursor: "pointer" }} onClick={() => toggleSort("id")}>Item # <SortIcon col="id" /></th>
                <th style={{ cursor: "pointer" }} onClick={() => toggleSort("desc")}>Description <SortIcon col="desc" /></th>
                <th style={{ cursor: "pointer" }} onClick={() => toggleSort("item_class")}>Class <SortIcon col="item_class" /></th>
                <th style={{ cursor: "pointer" }} onClick={() => toggleSort("nmfc")}>NMFC # <SortIcon col="nmfc" /></th>
                <th style={{ cursor: "pointer" }} onClick={() => toggleSort("fclass")}>Freight Class <SortIcon col="fclass" /></th>
                <th style={{ cursor: "pointer" }} onClick={() => toggleSort("weight_unit")}>Weight/Unit <SortIcon col="weight_unit" /></th>
                <th>Dims (L×W×H in)</th>
                <th>Units/Pallet</th>
                <th>Hazmat</th>
                <th style={{ cursor: "pointer" }} onClick={() => toggleSort("value_unit")}>Value/Unit <SortIcon col="value_unit" /></th>
                <th style={{ cursor: "pointer" }} onClick={() => toggleSort("status")}>Status <SortIcon col="status" /></th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr><td colSpan={12} className="empty-state">No items found</td></tr>
              ) : rows.map((it) => {
                const cls = getClass(it);
                const status = it.status || "Active";
                return (
                  <tr key={it.id} style={status === "Inactive" ? { opacity: 0.55 } : {}}>
                    <td>
                      <span className="mono" style={{ color: "var(--accent)", fontWeight: 700, cursor: "pointer", textDecoration: "underline" }}
                        onClick={() => openEdit(it)}>
                        {it.id}
                      </span>
                    </td>
                    <td>
                      <div style={{ fontWeight: 600, fontSize: 13 }}>{getDesc(it)}</div>
                      <HandlingBadges item={it} />
                    </td>
                    <td><ClassBadge cls={cls} /></td>
                    <td className="mono" style={{ fontSize: 12 }}>{it.nmfc || "--"}</td>
                    <td className="mono" style={{ fontWeight: 700 }}>{it.fclass || it.freight_class || "--"}</td>
                    <td className="mono">{it.weight_unit || 0} lbs</td>
                    <td className="mono" style={{ fontSize: 12 }}>{getDims(it)}</td>
                    <td className="mono">{it.units_per_pallet || 1}</td>
                    <td style={{ textAlign: "center" }}>
                      {it.hazmat ? <span style={{ color: "var(--red)", fontSize: 16 }}>&#9762;</span> : <span style={{ color: "#ddd" }}>&mdash;</span>}
                    </td>
                    <td className="mono" style={{ color: "var(--green)", fontWeight: 700 }}>${(it.value_unit || 0).toLocaleString()}</td>
                    <td><StatusBadge status={status} /></td>
                    <td style={{ whiteSpace: "nowrap" }}>
                      <div style={{ display: "flex", gap: 5 }}>
                        <button className="btn btn-secondary btn-sm" onClick={() => openEdit(it)}>Edit</button>
                        <button className="btn btn-secondary btn-sm" onClick={() => duplicateItem(it)} disabled={busyId === it.id} title="Duplicate">&#10697;</button>
                        <button className="btn btn-secondary btn-sm" onClick={() => toggleStatus(it)} disabled={busyId === it.id} title={status === "Active" ? "Deactivate" : "Activate"}>
                          {status === "Active" ? "\uD83D\uDEAB" : "\u2705"}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
        ) : (
          renderCards()
        )}
      </div>

      {/* Create/Edit Modal */}
      {editItem && (
        <div className="modal-overlay" onClick={() => setEditItem(null)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{editItem._originalId ? `Edit Item \u2014 ${editItem._originalId}` : "Add New Item"}</h3>
              <button className="modal-close" onClick={() => setEditItem(null)}>X</button>
            </div>
            <div className="modal-body">
              <div className="form-grid">
                <div className="form-group">
                  <label className="form-label">Item ID *</label>
                  <input value={editItem.id || ""} onChange={(e) => editField("id", e.target.value)} disabled={!!editItem._originalId} />
                </div>
                <div className="form-group">
                  <label className="form-label">Description *</label>
                  <input value={editItem.description || ""} onChange={(e) => editField("description", e.target.value)} />
                </div>
                <div className="form-group">
                  <label className="form-label">Customer</label>
                  <input value={editItem.customer || ""} onChange={(e) => editField("customer", e.target.value)} />
                </div>
                <div className="form-group">
                  <label className="form-label">Item Class</label>
                  <select value={editItem.class || "General"} onChange={(e) => editField("class", e.target.value)}>
                    <option value="General">General</option>
                    <option value="Electronics">Electronics</option>
                    <option value="Industrial">Industrial</option>
                    <option value="Perishable">Perishable</option>
                    <option value="Hazmat">Hazmat</option>
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">NMFC Code</label>
                  <input value={editItem.nmfc || ""} onChange={(e) => editField("nmfc", e.target.value)} />
                </div>
                <div className="form-group">
                  <label className="form-label">Freight Class</label>
                  <select value={editItem.freight_class || "70"} onChange={(e) => editField("freight_class", e.target.value)}>
                    {["50","55","60","65","70","77.5","85","92.5","100","110","125","150","175","200","250","300","400","500"].map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Weight/Unit (lbs)</label>
                  <input type="number" value={editItem.weight_unit || ""} onChange={(e) => editField("weight_unit", e.target.value)} />
                </div>
                <div className="form-group">
                  <label className="form-label">Value/Unit ($)</label>
                  <input type="number" value={editItem.value_unit || ""} onChange={(e) => editField("value_unit", e.target.value)} />
                </div>
                <div className="form-group">
                  <label className="form-label">Length (in)</label>
                  <input type="number" value={editItem.len || ""} onChange={(e) => editField("len", e.target.value)} />
                </div>
                <div className="form-group">
                  <label className="form-label">Width (in)</label>
                  <input type="number" value={editItem.wid || ""} onChange={(e) => editField("wid", e.target.value)} />
                </div>
                <div className="form-group">
                  <label className="form-label">Height (in)</label>
                  <input type="number" value={editItem.hgt || ""} onChange={(e) => editField("hgt", e.target.value)} />
                </div>
                <div className="form-group">
                  <label className="form-label">Units/Pallet</label>
                  <input type="number" value={editItem.units_per_pallet || ""} onChange={(e) => editField("units_per_pallet", e.target.value)} />
                </div>
                <div className="form-group">
                  <label className="form-label">Packaging</label>
                  <select value={editItem.pkg || "Carton"} onChange={(e) => editField("pkg", e.target.value)}>
                    <option value="Carton">Carton</option>
                    <option value="Pallet">Pallet</option>
                    <option value="Drum">Drum</option>
                    <option value="Crate">Crate</option>
                    <option value="Bag">Bag</option>
                    <option value="Roll">Roll</option>
                    <option value="Bundle">Bundle</option>
                    <option value="Tote">Tote</option>
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Max Stack</label>
                  <input type="number" value={editItem.stack || ""} onChange={(e) => editField("stack", e.target.value)} />
                </div>
              </div>

              <div style={{ marginTop: 16, marginBottom: 8, fontWeight: 700, fontSize: 11, color: "var(--text3)", letterSpacing: 1 }}>HANDLING FLAGS</div>
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
                  <input type="checkbox" checked={!!editItem.hazmat} onChange={(e) => editField("hazmat", e.target.checked)} /> Hazmat
                </label>
                <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
                  <input type="checkbox" checked={!!editItem.fragile} onChange={(e) => editField("fragile", e.target.checked)} /> Fragile
                </label>
                <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
                  <input type="checkbox" checked={!!editItem.temp_ctrl} onChange={(e) => editField("temp_ctrl", e.target.checked)} /> Temp Controlled
                </label>
                <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
                  <input type="checkbox" checked={!!editItem.top_load} onChange={(e) => editField("top_load", e.target.checked)} /> Top Load Only
                </label>
              </div>

              {editItem.hazmat && (
                <>
                  <div style={{ marginTop: 16, marginBottom: 8, fontWeight: 700, fontSize: 11, color: "var(--text3)", letterSpacing: 1 }}>HAZMAT DETAILS</div>
                  <div className="form-grid">
                    <div className="form-group">
                      <label className="form-label">UN Number</label>
                      <input value={editItem.un || ""} onChange={(e) => editField("un", e.target.value)} />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Hazmat Class</label>
                      <input value={editItem.haz_class || ""} onChange={(e) => editField("haz_class", e.target.value)} />
                    </div>
                  </div>
                </>
              )}
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={() => setEditItem(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={saveItem} disabled={busyId === "saving"}>
                {busyId === "saving" ? "Saving..." : "Save Item"}
              </button>
            </div>
          </div>
        </div>
      )}
      </div>{/* end page-content */}
    </div>
  );
}
