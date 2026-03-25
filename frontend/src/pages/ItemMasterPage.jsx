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

export default function ItemMasterPage() {
  const { items, setData, refreshData } = useOutletContext();
  const [q, setQ] = useState("");
  const [busyId, setBusyId] = useState("");
  const [message, setMessage] = useState({ text: "", type: "" });
  const [editItem, setEditItem] = useState(null);
  const [sortCol, setSortCol] = useState("id");
  const [sortAsc, setSortAsc] = useState(true);

  function toast(text, type = "info") {
    setMessage({ text, type });
    setTimeout(() => setMessage({ text: "", type: "" }), 4000);
  }

  const rows = useMemo(() => {
    let list = [...items];
    if (q.trim()) {
      const t = q.toLowerCase();
      list = list.filter((it) =>
        [it.id, it.description, it.customer, it.class, it.nmfc, it.freight_class]
          .some((v) => String(v || "").toLowerCase().includes(t))
      );
    }
    return list.sort((a, b) => {
      const av = String(a[sortCol] || "").toLowerCase();
      const bv = String(b[sortCol] || "").toLowerCase();
      return sortAsc ? av.localeCompare(bv) : bv.localeCompare(av);
    });
  }, [items, q, sortCol, sortAsc]);

  function toggleSort(col) {
    if (sortCol === col) setSortAsc(!sortAsc);
    else { setSortCol(col); setSortAsc(true); }
  }

  function openNew() { setEditItem({ ...EMPTY_ITEM }); }
  function openEdit(item) { setEditItem({ ...item }); }
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
      // Check if this is an existing item (editing) vs new
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

  async function deleteItem(item) {
    if (!window.confirm(`Delete item ${item.id}? This cannot be undone.`)) return;
    setBusyId(item.id);
    try {
      await DbApi.remove("items", item.id);
      toast(`Item ${item.id} deleted`, "success");
      await refreshData();
    } catch (err) {
      toast(`Failed: ${err.message}`, "error");
    } finally {
      setBusyId("");
    }
  }

  function weightRange(wt) {
    const w = parseFloat(wt) || 0;
    if (w === 0) return "--";
    if (w < 100) return "< 100 lbs";
    if (w < 500) return "100-500 lbs";
    if (w < 1000) return "500-1K lbs";
    if (w < 5000) return "1K-5K lbs";
    return "5K+ lbs";
  }

  const SortIcon = ({ col }) => (
    <span style={{ opacity: sortCol === col ? 1 : 0.3, marginLeft: 4 }}>
      {sortCol === col ? (sortAsc ? "\u25B2" : "\u25BC") : "\u21C5"}
    </span>
  );

  return (
    <div>
      {/* Page Header */}
      <div className="page-header">
        <div>
          <div className="page-title">Item Master</div>
          <div className="page-sub">Product catalog with freight attributes, dimensions, and packaging specs</div>
        </div>
        <div className="header-actions">
          <button className="btn btn-primary btn-sm" onClick={openNew}>+ Add Item</button>
        </div>
      </div>
      <div className="page-content">

      {/* Search */}
      <div className="filter-bar">
        <div className="search-wrap">
          <input
            placeholder="Search item ID, description, customer, NMFC..."
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="search-input"
          />
        </div>
      </div>

      {/* Toast */}
      {message.text && (
        <div className={`toast toast-${message.type || "info"}`} style={{ marginBottom: 12 }}>
          {message.text}
        </div>
      )}

      {/* Items Table */}
      <div className="card" style={{ padding: 0 }}><div className="table-wrap">
      <table className="grid" style={{ border: "none", boxShadow: "none" }}>
        <thead>
          <tr>
            <th onClick={() => toggleSort("id")}>Item ID <SortIcon col="id" /></th>
            <th onClick={() => toggleSort("desc")}>Description <SortIcon col="desc" /></th>
            <th onClick={() => toggleSort("customer")}>Customer <SortIcon col="customer" /></th>
            <th onClick={() => toggleSort("fclass")}>Freight Class <SortIcon col="fclass" /></th>
            <th onClick={() => toggleSort("nmfc")}>NMFC Code <SortIcon col="nmfc" /></th>
            <th onClick={() => toggleSort("weight_unit")}>Weight Range <SortIcon col="weight_unit" /></th>
            <th>Hazmat</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr><td colSpan={8} className="empty-state">No items found</td></tr>
          ) : rows.map((it) => (
            <tr key={it.id}>
              <td>
                <span className="mono" style={{ color: "var(--accent)", fontWeight: 600 }}>
                  {it.id}
                </span>
              </td>
              <td>{it.description || "--"}</td>
              <td>{it.customer || "--"}</td>
              <td className="mono" style={{ fontWeight: 700 }}>{it.freight_class || "--"}</td>
              <td className="mono" style={{ fontSize: 12 }}>{it.nmfc || "--"}</td>
              <td className="mono">{weightRange(it.weight_unit)}</td>
              <td style={{ textAlign: "center" }}>
                {it.hazmat ? (
                  <span className="badge badge-red">HAZMAT</span>
                ) : (
                  <span style={{ color: "#ddd" }}>--</span>
                )}
              </td>
              <td style={{ whiteSpace: "nowrap" }}>
                <button className="btn btn-secondary btn-sm" onClick={() => openEdit({ ...it, _originalId: it.id })}>Edit</button>{" "}
                <button
                  className="btn btn-sm"
                  style={{ background: "rgba(220,38,38,.08)", color: "#dc2626", border: "1px solid rgba(220,38,38,.2)", padding: "4px 8px", borderRadius: 6, fontSize: 12, cursor: "pointer" }}
                  disabled={busyId === it.id}
                  onClick={() => deleteItem(it)}
                >Delete</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      </div></div>

      <div className="text-sm text-muted mt-2">
        {rows.length} of {items.length} items
      </div>

      {/* Create/Edit Modal */}
      {editItem && (
        <div className="modal-overlay" onClick={() => setEditItem(null)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{editItem._originalId ? `EDIT ITEM -- ${editItem._originalId}` : "ADD NEW ITEM"}</h3>
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
