import { useMemo, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { DbApi } from "../lib/api";

const LOCATION_TYPES = ["Warehouse", "Distribution Center", "Customer", "Carrier", "Shipper", "Consignee", "Cross-Dock", "Port", "Rail Yard"];

const EMPTY_LOCATION = {
  id: "", name: "", type: "Warehouse", customer: "",
  address: "", city: "", state: "", zip: "", country: "US",
  lat: "", lng: "",
  contact_name: "", contact_phone: "", contact_email: "", ahphone: "",
  hours: "", dock_doors: "", trailer: "53", liftgate: "No",
  appt: false, hazmat: false, resi: false, inside_delivery: false, sort_segregate: false, twic: false,
  notes: "", status: "Active",
};

const US_STATES = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME","MD",
  "MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC",
  "SD","TN","TX","UT","VT","VA","WA","WV","WI","WY",
];

const VIEW_TABS = [
  { key: "list", label: "List", icon: "☰" },
  { key: "map", label: "Map", icon: "🌍" },
  { key: "lanes", label: "Lane Links", icon: "🔗" },
  { key: "calendars", label: "Calendars", icon: "📅" },
];

export default function LocationMasterPage() {
  const { locations, setData, refreshData } = useOutletContext();
  const [q, setQ] = useState("");
  const [filterType, setFilterType] = useState("ALL");
  const [filterState, setFilterState] = useState("ALL");
  const [viewMode, setViewMode] = useState("list");
  const [busyId, setBusyId] = useState("");
  const [message, setMessage] = useState({ text: "", type: "" });
  const [editLoc, setEditLoc] = useState(null);
  const [sortCol, setSortCol] = useState("name");
  const [sortAsc, setSortAsc] = useState(true);

  function toast(text, type = "info") {
    setMessage({ text, type });
    setTimeout(() => setMessage({ text: "", type: "" }), 4000);
  }

  const rows = useMemo(() => {
    let list = [...locations];
    if (q.trim()) {
      const t = q.toLowerCase();
      list = list.filter((loc) =>
        [loc.id, loc.name, loc.address, loc.city, loc.state, loc.zip, loc.type, loc.contact_name, loc.customer]
          .some((v) => String(v || "").toLowerCase().includes(t))
      );
    }
    if (filterType !== "ALL") {
      list = list.filter((loc) => loc.type === filterType);
    }
    if (filterState !== "ALL") {
      list = list.filter((loc) => loc.state === filterState);
    }
    return list.sort((a, b) => {
      const av = String(a[sortCol] || "").toLowerCase();
      const bv = String(b[sortCol] || "").toLowerCase();
      return sortAsc ? av.localeCompare(bv) : bv.localeCompare(av);
    });
  }, [locations, q, filterType, filterState, sortCol, sortAsc]);

  // Stats
  const stats = useMemo(() => {
    const types = {};
    const states = new Set();
    locations.forEach((loc) => {
      types[loc.type] = (types[loc.type] || 0) + 1;
      if (loc.state) states.add(loc.state);
    });
    return {
      total: locations.length,
      shippers: types["Shipper"] || 0,
      consignees: types["Consignee"] || 0,
      warehouseDc: (types["Warehouse"] || 0) + (types["Distribution Center"] || 0),
      portsRail: (types["Port"] || 0) + (types["Rail Yard"] || 0),
      statesCovered: states.size,
    };
  }, [locations]);

  // Unique states in data for filter dropdown
  const activeStates = useMemo(() => {
    const s = new Set();
    locations.forEach((loc) => { if (loc.state) s.add(loc.state); });
    return [...s].sort();
  }, [locations]);

  function toggleSort(col) {
    if (sortCol === col) setSortAsc(!sortAsc);
    else { setSortCol(col); setSortAsc(true); }
  }

  function openNew() { setEditLoc({ ...EMPTY_LOCATION }); }
  function openEdit(loc) { setEditLoc({ ...loc, _originalId: loc.id }); }
  function editField(key, value) { setEditLoc((p) => ({ ...p, [key]: value })); }

  async function saveLocation() {
    if (!editLoc) return;
    if (!editLoc.id || !editLoc.name || !editLoc.city || !editLoc.state) {
      toast("ID, Name, City, and State are required", "warning");
      return;
    }
    setBusyId("saving");
    try {
      const row = {
        id: (editLoc.id || "").toUpperCase(),
        name: (editLoc.name || "").toUpperCase(),
        type: editLoc.type || "Warehouse",
        customer: (editLoc.customer || "").toUpperCase(),
        address: (editLoc.address || "").toUpperCase(),
        city: (editLoc.city || "").toUpperCase(),
        state: (editLoc.state || "").toUpperCase(),
        zip: editLoc.zip || "",
        country: editLoc.country || "US",
        lat: parseFloat(editLoc.lat) || 0,
        lng: parseFloat(editLoc.lng) || 0,
        contact_name: (editLoc.contact_name || "").toUpperCase(),
        contact_phone: editLoc.contact_phone || "",
        contact_email: (editLoc.contact_email || "").toLowerCase(),
        ahphone: editLoc.ahphone || "",
        hours: editLoc.hours || "",
        dock_doors: parseInt(editLoc.dock_doors) || 0,
        trailer: parseInt(editLoc.trailer) || 53,
        liftgate: editLoc.liftgate || "No",
        appt: !!editLoc.appt,
        hazmat: !!editLoc.hazmat,
        resi: !!editLoc.resi,
        inside_delivery: !!editLoc.inside_delivery,
        sort_segregate: !!editLoc.sort_segregate,
        twic: !!editLoc.twic,
        notes: editLoc.notes || "",
        status: editLoc.status || "Active",
      };
      const existing = locations.find((x) => x.id === editLoc._originalId || x.id === editLoc.id);
      if (existing && editLoc._originalId) {
        await DbApi.patch("locations", editLoc._originalId, row);
      } else {
        await DbApi.upsert("locations", row);
      }
      toast(`Location ${row.id} saved`, "success");
      setEditLoc(null);
      await refreshData();
    } catch (err) {
      toast(`Failed: ${err.message}`, "error");
    } finally {
      setBusyId("");
    }
  }

  async function deleteLocation(loc) {
    if (!window.confirm(`Delete location ${loc.id} (${loc.name})? This cannot be undone.`)) return;
    setBusyId(loc.id);
    try {
      await DbApi.remove("locations", loc.id);
      toast(`Location ${loc.id} deleted`, "success");
      await refreshData();
    } catch (err) {
      toast(`Failed: ${err.message}`, "error");
    } finally {
      setBusyId("");
    }
  }

  async function toggleStatus(loc) {
    const newStatus = loc.status === "Active" ? "Inactive" : "Active";
    setBusyId(loc.id);
    try {
      await DbApi.patch("locations", loc.id, { status: newStatus });
      toast(`Location ${loc.id} ${newStatus.toLowerCase()}`, "success");
      await refreshData();
    } catch (err) {
      toast(`Failed: ${err.message}`, "error");
    } finally {
      setBusyId("");
    }
  }

  function copyLocation(loc) {
    setEditLoc({
      ...loc,
      id: "",
      name: loc.name + " (COPY)",
      _originalId: undefined,
    });
  }

  function exportCSV() {
    const headers = ["Location ID","Name","Type","Customer","Address","City","State","ZIP","Contact","Phone","Hours","Dock Doors","Appt Req","Hazmat","Status"];
    const csvRows = [headers.join(",")];
    rows.forEach((loc) => {
      csvRows.push([
        loc.id, `"${loc.name || ""}"`, loc.type, `"${loc.customer || ""}"`, `"${loc.address || ""}"`,
        loc.city, loc.state, loc.zip, `"${loc.contact_name || ""}"`, loc.contact_phone,
        `"${loc.hours || ""}"`, loc.dock_doors || 0, loc.appt ? "Yes" : "No", loc.hazmat ? "Yes" : "No", loc.status || "Active",
      ].join(","));
    });
    const blob = new Blob([csvRows.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "locations_export.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  const typeBadgeColor = (type) => {
    const map = {
      Warehouse: { bg: "rgba(59,130,246,.1)", color: "var(--accent)", border: "rgba(59,130,246,.3)" },
      "Distribution Center": { bg: "rgba(99,102,241,.1)", color: "#6366f1", border: "rgba(99,102,241,.3)" },
      Customer: { bg: "rgba(16,185,129,.1)", color: "var(--green)", border: "rgba(16,185,129,.3)" },
      Carrier: { bg: "rgba(245,158,11,.1)", color: "var(--yellow)", border: "rgba(245,158,11,.3)" },
      Shipper: { bg: "rgba(8,145,178,.1)", color: "#0891b2", border: "rgba(8,145,178,.3)" },
      Consignee: { bg: "rgba(124,58,237,.1)", color: "#7c3aed", border: "rgba(124,58,237,.3)" },
      "Cross-Dock": { bg: "rgba(220,38,38,.1)", color: "var(--red)", border: "rgba(220,38,38,.3)" },
      Port: { bg: "rgba(107,114,128,.1)", color: "var(--text3)", border: "rgba(107,114,128,.3)" },
      "Rail Yard": { bg: "rgba(107,114,128,.1)", color: "var(--text3)", border: "rgba(107,114,128,.3)" },
    };
    return map[type] || map.Warehouse;
  };

  const SortIcon = ({ col }) => (
    <span style={{ opacity: sortCol === col ? 1 : 0.3, marginLeft: 4 }}>
      {sortCol === col ? (sortAsc ? "\u25B2" : "\u25BC") : "\u21C5"}
    </span>
  );

  const IconBtn = ({ icon, title, onClick, color = "var(--accent)", bg = "rgba(59,130,246,.08)", disabled }) => (
    <button
      title={title}
      onClick={onClick}
      disabled={disabled}
      style={{
        width: 30, height: 30, borderRadius: 6, border: "none", cursor: disabled ? "default" : "pointer",
        background: bg, color, display: "inline-flex", alignItems: "center", justifyContent: "center",
        fontSize: 14, opacity: disabled ? 0.4 : 1, transition: "opacity .15s",
      }}
    >
      {icon}
    </button>
  );

  return (
    <div>
      {/* Page Header */}
      <div className="page-header">
        <div>
          <div className="page-title">LOCATION MASTER</div>
          <div className="page-sub">Shippers, consignees, warehouses, ports, and cross-docks with geolocation and operating hours</div>
        </div>
        <div className="header-actions" style={{ display: "flex", gap: 4 }}>
          {VIEW_TABS.map((tab) => (
            <button
              key={tab.key}
              className={`btn btn-sm ${viewMode === tab.key ? "btn-primary" : "btn-secondary"}`}
              onClick={() => setViewMode(tab.key)}
              style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12 }}
            >
              <span>{tab.icon}</span> {tab.label}
            </button>
          ))}
        </div>
      </div>
      <div className="page-content">

      {/* Filter Bar */}
      <div className="filter-bar" style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <div className="search-wrap">
          <input
            placeholder="Search locations..."
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="search-input"
          />
        </div>
        <select
          value={filterType}
          onChange={(e) => setFilterType(e.target.value)}
          style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid var(--border)", fontSize: 13, background: "white", cursor: "pointer", minWidth: 130 }}
        >
          <option value="ALL">All Types</option>
          {LOCATION_TYPES.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
        <select
          value={filterState}
          onChange={(e) => setFilterState(e.target.value)}
          style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid var(--border)", fontSize: 13, background: "white", cursor: "pointer", minWidth: 110 }}
        >
          <option value="ALL">All States</option>
          {activeStates.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <button className="btn btn-secondary btn-sm" onClick={exportCSV} style={{ display: "flex", alignItems: "center", gap: 4 }}>
          📥 Export
        </button>
        <button className="btn btn-primary btn-sm" onClick={openNew}>+ New Location</button>
      </div>

      {/* Summary Stats */}
      <div className="stat-grid" style={{ gridTemplateColumns: "repeat(6, 1fr)", marginBottom: 16 }}>
        <div className="stat-card blue">
          <div className="stat-label">TOTAL LOCATIONS</div>
          <div className="stat-value">{stats.total}</div>
        </div>
        <div className="stat-card" style={{ borderTop: "3px solid #0891b2" }}>
          <div className="stat-label">SHIPPERS</div>
          <div className="stat-value">{stats.shippers}</div>
        </div>
        <div className="stat-card purple">
          <div className="stat-label">CONSIGNEES</div>
          <div className="stat-value">{stats.consignees}</div>
        </div>
        <div className="stat-card amber">
          <div className="stat-label">WAREHOUSES / DCS</div>
          <div className="stat-value">{stats.warehouseDc}</div>
        </div>
        <div className="stat-card red">
          <div className="stat-label">PORTS / RAIL</div>
          <div className="stat-value">{stats.portsRail}</div>
        </div>
        <div className="stat-card green">
          <div className="stat-label">STATES COVERED</div>
          <div className="stat-value">{stats.statesCovered}</div>
        </div>
      </div>

      {/* Toast */}
      {message.text && (
        <div className={`toast toast-${message.type || "info"}`} style={{ marginBottom: 12 }}>
          {message.text}
        </div>
      )}

      {/* Location Directory Table */}
      {viewMode === "list" && (
        <>
          <div className="card" style={{ padding: 0 }}>
            <div className="card-header" style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)" }}>
              <div className="card-title" style={{ fontSize: 13, fontWeight: 700, letterSpacing: 1 }}>LOCATION DIRECTORY</div>
              <div className="text-sm text-muted">{rows.length} OF {locations.length} LOCATIONS</div>
            </div>
            <div className="table-wrap">
              <table className="grid" style={{ border: "none", boxShadow: "none" }}>
                <thead>
                  <tr>
                    <th onClick={() => toggleSort("id")} style={{ minWidth: 100 }}>Location ID <SortIcon col="id" /></th>
                    <th onClick={() => toggleSort("name")} style={{ minWidth: 160 }}>Name <SortIcon col="name" /></th>
                    <th onClick={() => toggleSort("type")}>Type <SortIcon col="type" /></th>
                    <th onClick={() => toggleSort("address")}>Address <SortIcon col="address" /></th>
                    <th onClick={() => toggleSort("city")}>City / State <SortIcon col="city" /></th>
                    <th onClick={() => toggleSort("zip")}>ZIP <SortIcon col="zip" /></th>
                    <th onClick={() => toggleSort("contact_name")}>Contact <SortIcon col="contact_name" /></th>
                    <th onClick={() => toggleSort("hours")}>Hours <SortIcon col="hours" /></th>
                    <th>Appt Req. <SortIcon col="appt" /></th>
                    <th onClick={() => toggleSort("dock_doors")}>Dock Doors <SortIcon col="dock_doors" /></th>
                    <th>Shipments <SortIcon col="shipments" /></th>
                    <th onClick={() => toggleSort("status")}>Status <SortIcon col="status" /></th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 ? (
                    <tr><td colSpan={13} className="empty-state">No locations found</td></tr>
                  ) : rows.map((loc) => {
                    const tc = typeBadgeColor(loc.type);
                    const isActive = (loc.status || "Active") === "Active";
                    return (
                      <tr key={loc.id}>
                        {/* Location ID */}
                        <td>
                          <span className="mono" style={{ color: "var(--accent)", fontWeight: 600, fontSize: 12 }}>
                            {loc.id}
                          </span>
                        </td>
                        {/* Name + customer + flag badges */}
                        <td>
                          <div style={{ fontWeight: 600, fontSize: 13, lineHeight: 1.3 }}>
                            {loc.name || "--"}
                          </div>
                          <div style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 2, flexWrap: "wrap" }}>
                            {loc.appt && (
                              <span style={{ fontSize: 9, fontWeight: 700, padding: "1px 5px", borderRadius: 3, background: "rgba(59,130,246,.12)", color: "var(--accent)", border: "1px solid rgba(59,130,246,.25)" }}>
                                📋 APPT
                              </span>
                            )}
                            {loc.hazmat && (
                              <span style={{ fontSize: 9, fontWeight: 700, padding: "1px 5px", borderRadius: 3, background: "rgba(16,185,129,.12)", color: "var(--green)", border: "1px solid rgba(16,185,129,.25)" }}>
                                ☢️ HZM
                              </span>
                            )}
                          </div>
                          {loc.customer && (
                            <div className="text-xs text-muted" style={{ marginTop: 1 }}>{loc.customer}</div>
                          )}
                        </td>
                        {/* Type badge */}
                        <td>
                          <span className="badge" style={{
                            background: tc.bg, color: tc.color, border: `1px solid ${tc.border}`,
                            fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 4, whiteSpace: "nowrap",
                          }}>
                            {(loc.type || "--").toUpperCase()}
                          </span>
                        </td>
                        {/* Address */}
                        <td className="text-sm">{loc.address || "--"}</td>
                        {/* City / State */}
                        <td style={{ fontWeight: 600, fontSize: 12 }}>
                          {loc.city || "--"}, {loc.state || "--"}
                        </td>
                        {/* ZIP */}
                        <td className="mono" style={{ fontSize: 12 }}>{loc.zip || "--"}</td>
                        {/* Contact */}
                        <td>
                          <div style={{ fontWeight: 600, fontSize: 12 }}>{loc.contact_name || "--"}</div>
                          {loc.contact_phone && <div className="text-xs text-muted">{loc.contact_phone}</div>}
                        </td>
                        {/* Hours */}
                        <td className="text-sm" style={{ fontSize: 11, whiteSpace: "nowrap" }}>{loc.hours || "--"}</td>
                        {/* Appt Required */}
                        <td style={{ textAlign: "center" }}>
                          {loc.appt ? <span style={{ color: "var(--green)", fontWeight: 700 }}>✓</span> : <span className="text-muted">--</span>}
                        </td>
                        {/* Dock Doors */}
                        <td className="mono" style={{ textAlign: "center", fontSize: 13 }}>{loc.dock_doors || "--"}</td>
                        {/* Shipments (placeholder) */}
                        <td className="mono" style={{ textAlign: "center", fontSize: 13 }}>--</td>
                        {/* Status */}
                        <td>
                          <span style={{
                            fontSize: 10, fontWeight: 700, padding: "3px 10px", borderRadius: 20, whiteSpace: "nowrap",
                            background: isActive ? "rgba(16,185,129,.1)" : "rgba(107,114,128,.1)",
                            color: isActive ? "var(--green)" : "var(--text3)",
                            border: `1px solid ${isActive ? "rgba(16,185,129,.3)" : "rgba(107,114,128,.3)"}`,
                          }}>
                            {isActive ? "ACTIVE" : "INACTIVE"}
                          </span>
                        </td>
                        {/* Actions */}
                        <td>
                          <div style={{ display: "flex", gap: 4, whiteSpace: "nowrap" }}>
                            <IconBtn icon="✏️" title="Edit" onClick={() => openEdit(loc)} />
                            <IconBtn icon="🗑️" title="Delete" onClick={() => deleteLocation(loc)} color="#dc2626" bg="rgba(220,38,38,.08)" disabled={busyId === loc.id} />
                            <IconBtn icon="📋" title="Copy" onClick={() => copyLocation(loc)} color="#7c3aed" bg="rgba(124,58,237,.08)" />
                            <IconBtn
                              icon={isActive ? "⛔" : "✅"}
                              title={isActive ? "Deactivate" : "Activate"}
                              onClick={() => toggleStatus(loc)}
                              color={isActive ? "#dc2626" : "var(--green)"}
                              bg={isActive ? "rgba(220,38,38,.08)" : "rgba(16,185,129,.08)"}
                              disabled={busyId === loc.id}
                            />
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {viewMode === "map" && (
        <div className="card" style={{ padding: 40, textAlign: "center" }}>
          <div className="text-muted">🌍 Map view coming soon</div>
        </div>
      )}
      {viewMode === "lanes" && (
        <div className="card" style={{ padding: 40, textAlign: "center" }}>
          <div className="text-muted">🔗 Lane Links view coming soon</div>
        </div>
      )}
      {viewMode === "calendars" && (
        <div className="card" style={{ padding: 40, textAlign: "center" }}>
          <div className="text-muted">📅 Calendars view coming soon</div>
        </div>
      )}

      {/* Create/Edit Modal */}
      {editLoc && (
        <div className="modal-overlay" onClick={() => setEditLoc(null)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{editLoc._originalId ? `EDIT LOCATION -- ${editLoc._originalId}` : "ADD NEW LOCATION"}</h3>
              <button className="modal-close" onClick={() => setEditLoc(null)}>X</button>
            </div>
            <div className="modal-body">
              <div className="form-grid">
                <div className="form-group">
                  <label className="form-label">Location ID *</label>
                  <input value={editLoc.id || ""} onChange={(e) => editField("id", e.target.value)} disabled={!!editLoc._originalId} />
                </div>
                <div className="form-group">
                  <label className="form-label">Name *</label>
                  <input value={editLoc.name || ""} onChange={(e) => editField("name", e.target.value)} />
                </div>
                <div className="form-group">
                  <label className="form-label">Type</label>
                  <select value={editLoc.type || "Warehouse"} onChange={(e) => editField("type", e.target.value)}>
                    {LOCATION_TYPES.map((t) => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Customer</label>
                  <input value={editLoc.customer || ""} onChange={(e) => editField("customer", e.target.value)} />
                </div>
              </div>

              <div style={{ marginTop: 16, marginBottom: 8, fontWeight: 700, fontSize: 11, color: "var(--text3)", letterSpacing: 1 }}>ADDRESS</div>
              <div className="form-grid">
                <div className="form-group" style={{ gridColumn: "span 2" }}>
                  <label className="form-label">Street Address</label>
                  <input value={editLoc.address || ""} onChange={(e) => editField("address", e.target.value)} />
                </div>
                <div className="form-group">
                  <label className="form-label">City *</label>
                  <input value={editLoc.city || ""} onChange={(e) => editField("city", e.target.value)} />
                </div>
                <div className="form-group">
                  <label className="form-label">State *</label>
                  <select value={editLoc.state || ""} onChange={(e) => editField("state", e.target.value)}>
                    <option value="">-- Select --</option>
                    {US_STATES.map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">ZIP</label>
                  <input value={editLoc.zip || ""} onChange={(e) => editField("zip", e.target.value)} />
                </div>
                <div className="form-group">
                  <label className="form-label">Country</label>
                  <input value={editLoc.country || "US"} onChange={(e) => editField("country", e.target.value)} />
                </div>
                <div className="form-group">
                  <label className="form-label">Latitude</label>
                  <input type="number" step="any" value={editLoc.lat || ""} onChange={(e) => editField("lat", e.target.value)} />
                </div>
                <div className="form-group">
                  <label className="form-label">Longitude</label>
                  <input type="number" step="any" value={editLoc.lng || ""} onChange={(e) => editField("lng", e.target.value)} />
                </div>
              </div>

              <div style={{ marginTop: 16, marginBottom: 8, fontWeight: 700, fontSize: 11, color: "var(--text3)", letterSpacing: 1 }}>CONTACT INFO</div>
              <div className="form-grid">
                <div className="form-group">
                  <label className="form-label">Contact Name</label>
                  <input value={editLoc.contact_name || ""} onChange={(e) => editField("contact_name", e.target.value)} />
                </div>
                <div className="form-group">
                  <label className="form-label">Phone</label>
                  <input value={editLoc.contact_phone || ""} onChange={(e) => editField("contact_phone", e.target.value)} />
                </div>
                <div className="form-group">
                  <label className="form-label">Email</label>
                  <input type="email" value={editLoc.contact_email || ""} onChange={(e) => editField("contact_email", e.target.value)} style={{ textTransform: "none" }} />
                </div>
                <div className="form-group">
                  <label className="form-label">After-Hours Phone</label>
                  <input value={editLoc.ahphone || ""} onChange={(e) => editField("ahphone", e.target.value)} />
                </div>
              </div>

              <div style={{ marginTop: 16, marginBottom: 8, fontWeight: 700, fontSize: 11, color: "var(--text3)", letterSpacing: 1 }}>FACILITY DETAILS</div>
              <div className="form-grid">
                <div className="form-group">
                  <label className="form-label">Operating Hours</label>
                  <input value={editLoc.hours || ""} onChange={(e) => editField("hours", e.target.value)} placeholder="e.g. MON-FRI 06:00-18:00" />
                </div>
                <div className="form-group">
                  <label className="form-label">Dock Doors</label>
                  <input type="number" value={editLoc.dock_doors || ""} onChange={(e) => editField("dock_doors", e.target.value)} />
                </div>
                <div className="form-group">
                  <label className="form-label">Max Trailer (ft)</label>
                  <input type="number" value={editLoc.trailer || "53"} onChange={(e) => editField("trailer", e.target.value)} />
                </div>
                <div className="form-group">
                  <label className="form-label">Liftgate Required</label>
                  <select value={editLoc.liftgate || "No"} onChange={(e) => editField("liftgate", e.target.value)}>
                    <option value="No">No</option>
                    <option value="Yes">Yes</option>
                  </select>
                </div>
              </div>

              <div style={{ marginTop: 16, marginBottom: 8, fontWeight: 700, fontSize: 11, color: "var(--text3)", letterSpacing: 1 }}>FLAGS</div>
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
                  <input type="checkbox" checked={!!editLoc.appt} onChange={(e) => editField("appt", e.target.checked)} /> Appointment Required
                </label>
                <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
                  <input type="checkbox" checked={!!editLoc.hazmat} onChange={(e) => editField("hazmat", e.target.checked)} /> Hazmat Certified
                </label>
                <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
                  <input type="checkbox" checked={!!editLoc.resi} onChange={(e) => editField("resi", e.target.checked)} /> Residential
                </label>
                <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
                  <input type="checkbox" checked={!!editLoc.inside_delivery} onChange={(e) => editField("inside_delivery", e.target.checked)} /> Inside Delivery
                </label>
                <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
                  <input type="checkbox" checked={!!editLoc.sort_segregate} onChange={(e) => editField("sort_segregate", e.target.checked)} /> Sort & Segregate
                </label>
                <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
                  <input type="checkbox" checked={!!editLoc.twic} onChange={(e) => editField("twic", e.target.checked)} /> TWIC Required
                </label>
              </div>

              <div className="form-grid" style={{ marginTop: 16 }}>
                <div className="form-group" style={{ gridColumn: "span 2" }}>
                  <label className="form-label">Notes</label>
                  <textarea value={editLoc.notes || ""} onChange={(e) => editField("notes", e.target.value)} rows={3} style={{ width: "100%", resize: "vertical" }} />
                </div>
                <div className="form-group">
                  <label className="form-label">Status</label>
                  <select value={editLoc.status || "Active"} onChange={(e) => editField("status", e.target.value)}>
                    <option value="Active">Active</option>
                    <option value="Inactive">Inactive</option>
                  </select>
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={() => setEditLoc(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={saveLocation} disabled={busyId === "saving"}>
                {busyId === "saving" ? "Saving..." : "Save Location"}
              </button>
            </div>
          </div>
        </div>
      )}
      </div>{/* end page-content */}
    </div>
  );
}
