import { useMemo, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { DbApi } from "../lib/api";

const LOCATION_TYPES = ["Warehouse", "Distribution Center", "Customer", "Carrier", "Shipper", "Consignee", "Cross-Dock", "Port", "Rail Yard"];

const EMPTY_LOCATION = {
  id: "", name: "", type: "Warehouse", customer: "",
  addr: "", city: "", state: "", zip: "", country: "US",
  lat: "", lng: "",
  contact: "", phone: "", email: "", ahphone: "",
  hours: "", docks: "", trailer: "53", liftgate: "No",
  appt: false, hazmat: false, resi: false, inside: false, sort: false, twic: false,
  notes: "", status: "Active",
};

const US_STATES = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME","MD",
  "MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC",
  "SD","TN","TX","UT","VT","VA","WA","WV","WI","WY",
];

export default function LocationMasterPage() {
  const { locations, setData, refreshData } = useOutletContext();
  const [q, setQ] = useState("");
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
        [loc.id, loc.name, loc.addr, loc.city, loc.state, loc.zip, loc.type, loc.contact]
          .some((v) => String(v || "").toLowerCase().includes(t))
      );
    }
    return list.sort((a, b) => {
      const av = String(a[sortCol] || "").toLowerCase();
      const bv = String(b[sortCol] || "").toLowerCase();
      return sortAsc ? av.localeCompare(bv) : bv.localeCompare(av);
    });
  }, [locations, q, sortCol, sortAsc]);

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
        addr: (editLoc.addr || "").toUpperCase(),
        city: (editLoc.city || "").toUpperCase(),
        state: (editLoc.state || "").toUpperCase(),
        zip: editLoc.zip || "",
        country: editLoc.country || "US",
        lat: parseFloat(editLoc.lat) || 0,
        lng: parseFloat(editLoc.lng) || 0,
        contact: (editLoc.contact || "").toUpperCase(),
        phone: editLoc.phone || "",
        email: (editLoc.email || "").toLowerCase(),
        ahphone: editLoc.ahphone || "",
        hours: editLoc.hours || "",
        docks: parseInt(editLoc.docks) || 0,
        trailer: parseInt(editLoc.trailer) || 53,
        liftgate: editLoc.liftgate || "No",
        appt: !!editLoc.appt,
        hazmat: !!editLoc.hazmat,
        resi: !!editLoc.resi,
        inside: !!editLoc.inside,
        sort: !!editLoc.sort,
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

  return (
    <div>
      {/* Page Header */}
      <div className="page-header">
        <div>
          <div className="page-title">Location Master</div>
          <div className="page-sub">Shippers, consignees, warehouses, and facilities with geolocation and operating hours</div>
        </div>
        <div className="header-actions">
          <button className="btn btn-primary btn-sm" onClick={openNew}>+ Add Location</button>
        </div>
      </div>
      <div className="page-content">

      {/* Search */}
      <div className="filter-bar">
        <div className="search-wrap">
          <input
            placeholder="Search location ID, name, address, city, state..."
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

      {/* Locations Table */}
      <div className="card" style={{ padding: 0 }}><div className="table-wrap">
      <table className="grid" style={{ border: "none", boxShadow: "none" }}>
        <thead>
          <tr>
            <th onClick={() => toggleSort("id")}>Location ID <SortIcon col="id" /></th>
            <th onClick={() => toggleSort("name")}>Name <SortIcon col="name" /></th>
            <th onClick={() => toggleSort("addr")}>Address <SortIcon col="addr" /></th>
            <th onClick={() => toggleSort("city")}>City <SortIcon col="city" /></th>
            <th onClick={() => toggleSort("state")}>State <SortIcon col="state" /></th>
            <th onClick={() => toggleSort("zip")}>ZIP <SortIcon col="zip" /></th>
            <th onClick={() => toggleSort("type")}>Type <SortIcon col="type" /></th>
            <th onClick={() => toggleSort("docks")}>Dock Doors <SortIcon col="docks" /></th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr><td colSpan={9} className="empty-state">No locations found</td></tr>
          ) : rows.map((loc) => {
            const tc = typeBadgeColor(loc.type);
            return (
              <tr key={loc.id}>
                <td>
                  <span className="mono" style={{ color: "var(--accent)", fontWeight: 600 }}>
                    {loc.id}
                  </span>
                </td>
                <td style={{ fontWeight: 600 }}>{loc.name || "--"}</td>
                <td className="text-sm">{loc.addr || "--"}</td>
                <td>{loc.city || "--"}</td>
                <td className="mono">{loc.state || "--"}</td>
                <td className="mono">{loc.zip || "--"}</td>
                <td>
                  <span className="badge" style={{
                    background: tc.bg,
                    color: tc.color,
                    border: `1px solid ${tc.border}`,
                    fontSize: 11,
                    fontWeight: 700,
                    padding: "2px 9px",
                    borderRadius: 20,
                  }}>
                    {loc.type || "--"}
                  </span>
                </td>
                <td className="mono" style={{ textAlign: "center" }}>{loc.docks || 0}</td>
                <td style={{ whiteSpace: "nowrap" }}>
                  <button className="btn btn-secondary btn-sm" onClick={() => openEdit(loc)}>Edit</button>{" "}
                  <button
                    className="btn btn-sm"
                    style={{ background: "rgba(220,38,38,.08)", color: "#dc2626", border: "1px solid rgba(220,38,38,.2)", padding: "4px 8px", borderRadius: 6, fontSize: 12, cursor: "pointer" }}
                    disabled={busyId === loc.id}
                    onClick={() => deleteLocation(loc)}
                  >Delete</button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      </div></div>

      <div className="text-sm text-muted mt-2">
        {rows.length} of {locations.length} locations
      </div>

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
                  <input value={editLoc.addr || ""} onChange={(e) => editField("addr", e.target.value)} />
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
                  <input value={editLoc.contact || ""} onChange={(e) => editField("contact", e.target.value)} />
                </div>
                <div className="form-group">
                  <label className="form-label">Phone</label>
                  <input value={editLoc.phone || ""} onChange={(e) => editField("phone", e.target.value)} />
                </div>
                <div className="form-group">
                  <label className="form-label">Email</label>
                  <input type="email" value={editLoc.email || ""} onChange={(e) => editField("email", e.target.value)} style={{ textTransform: "none" }} />
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
                  <input value={editLoc.hours || ""} onChange={(e) => editField("hours", e.target.value)} placeholder="e.g. 06:00-18:00 M-F" />
                </div>
                <div className="form-group">
                  <label className="form-label">Dock Doors</label>
                  <input type="number" value={editLoc.docks || ""} onChange={(e) => editField("docks", e.target.value)} />
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
                  <input type="checkbox" checked={!!editLoc.inside} onChange={(e) => editField("inside", e.target.checked)} /> Inside Delivery
                </label>
                <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
                  <input type="checkbox" checked={!!editLoc.sort} onChange={(e) => editField("sort", e.target.checked)} /> Sort & Segregate
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
