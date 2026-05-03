import { useMemo, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { DbApi } from "../lib/api";
import { invalidateQuoteCache } from "../services/ordersService";

const PRIORITY_STYLES = {
  High:   { color: "var(--red)",    bg: "rgba(239,68,68,.1)" },
  Medium: { color: "var(--yellow)", bg: "rgba(245,158,11,.1)" },
  Low:    { color: "var(--green)",  bg: "rgba(16,185,129,.1)" },
};

const CUSTOMERS = ["Cisco Systems", "AT&T", "Meta", "Google", "Seagate", "XPO"];

function emptyPref() {
  return {
    id: "",
    originCity: "", originState: "",
    destCity: "", destState: "",
    mode: "TL", customer: "",
    preferred: [], excluded: [], priority: "Medium",
    reason: "", transitDays: null, status: "Active",
  };
}

// Origin/Destination are stored as "CITY, STATE" in a single column.
// Split for UI; recombine on save.
function splitCityState(value) {
  const raw = String(value || "");
  const idx = raw.lastIndexOf(",");
  if (idx === -1) return { city: raw.trim(), state: "" };
  return { city: raw.slice(0, idx).trim(), state: raw.slice(idx + 1).trim() };
}

function joinCityState(city, state) {
  const c = (city || "").trim().toUpperCase();
  const s = (state || "").trim().toUpperCase();
  if (!c && !s) return "";
  if (!s) return c;
  return `${c}, ${s}`;
}

export default function LanePreferencesPage() {
  const { orders, carriers, lanePreferences, setData, refreshData } = useOutletContext();
  const [q, setQ] = useState("");
  const [message, setMessage] = useState({ text: "", type: "" });
  const [busyId, setBusyId] = useState("");
  const [editPref, setEditPref] = useState(null);
  const [prefCarriers, setPrefCarriers] = useState([]);
  const [exclCarriers, setExclCarriers] = useState([]);
  const [addPrefVal, setAddPrefVal] = useState("");
  const [addExclVal, setAddExclVal] = useState("");
  const [sortCol, setSortCol] = useState("id");
  const [sortAsc, setSortAsc] = useState(true);

  function toast(text, type = "info") {
    setMessage({ text, type });
    setTimeout(() => setMessage({ text: "", type: "" }), 4000);
  }

  // ── KPIs ──
  const kpis = useMemo(() => {
    const allPref = lanePreferences.reduce((s, p) => s + (p.preferred || []).length, 0);
    const allExcl = lanePreferences.reduce((s, p) => s + (p.excluded || []).length, 0);
    const lanes = new Set(lanePreferences.map((p) => `${p.origin}|${p.dest}`));
    return {
      total: lanePreferences.length,
      preferred: allPref,
      excluded: allExcl,
      lanes: lanes.size,
    };
  }, [lanePreferences]);

  // ── Filtered + sorted rows ──
  const rows = useMemo(() => {
    let list = [...lanePreferences];
    if (q.trim()) {
      const t = q.toLowerCase();
      list = list.filter((p) =>
        [p.id, p.origin, p.dest, p.mode, p.customer, ...(p.preferred || []), ...(p.excluded || [])]
          .some((v) => String(v || "").toLowerCase().includes(t))
      );
    }
    return list.sort((a, b) => {
      const av = String(a[sortCol] || "").toLowerCase();
      const bv = String(b[sortCol] || "").toLowerCase();
      return sortAsc ? av.localeCompare(bv) : bv.localeCompare(av);
    });
  }, [lanePreferences, q, sortCol, sortAsc]);

  function toggleSort(col) {
    if (sortCol === col) setSortAsc(!sortAsc);
    else { setSortCol(col); setSortAsc(true); }
  }

  const SortIcon = ({ col }) => (
    <span style={{ opacity: sortCol === col ? 1 : 0.3, marginLeft: 4 }}>
      {sortCol === col ? (sortAsc ? "▲" : "▼") : "⇅"}
    </span>
  );

  // ── Customer coverage ──
  const customerCoverage = useMemo(() => {
    const allCustomers = [...CUSTOMERS, "All"];
    return allCustomers
      .map((cust) => {
        const count = lanePreferences.filter((p) =>
          cust === "All" ? !p.customer : p.customer === cust
        ).length;
        const pct = lanePreferences.length ? Math.round((count / lanePreferences.length) * 100) : 0;
        return { name: cust === "All" ? "All Customers" : cust, count, pct };
      })
      .filter((c) => c.count > 0);
  }, [lanePreferences]);

  // ── Count orders on a lane ──
  function laneOrderCount(p) {
    return (orders || []).filter((o) => {
      const oMatch = (o.origin || "").toLowerCase().includes((p.origin || "").split(",")[0].trim().toLowerCase());
      const dMatch = (o.dest || "").toLowerCase().includes((p.dest || "").split(",")[0].trim().toLowerCase());
      const cMatch = !p.customer || o.customer === p.customer;
      return oMatch && dMatch && cMatch;
    }).length;
  }

  // ── Modal open ──
  function openNew() {
    const pref = emptyPref();
    setEditPref(pref);
    setPrefCarriers([]);
    setExclCarriers([]);
    setAddPrefVal("");
    setAddExclVal("");
  }

  function openEdit(p) {
    const o = splitCityState(p.origin);
    const d = splitCityState(p.dest);
    setEditPref({
      ...p,
      _originalId: p.id,
      originCity: o.city,
      originState: o.state,
      destCity: d.city,
      destState: d.state,
      // API returns transit_days (snake_case); map to the field the form uses.
      transitDays: p.transit_days ?? p.transitDays ?? null,
    });
    setPrefCarriers([...(p.preferred || [])]);
    setExclCarriers([...(p.excluded || [])]);
    setAddPrefVal("");
    setAddExclVal("");
  }

  function editField(key, value) {
    setEditPref((prev) => ({ ...prev, [key]: value }));
  }

  // ── Carrier list management in modal ──
  function addPreferred() {
    if (!addPrefVal) return;
    if (prefCarriers.includes(addPrefVal)) { toast("Already in preferred list", "warning"); return; }
    if (exclCarriers.includes(addPrefVal)) { toast("Carrier is already in excluded list", "warning"); return; }
    setPrefCarriers((prev) => [...prev, addPrefVal]);
    setAddPrefVal("");
  }

  function addExcluded() {
    if (!addExclVal) return;
    if (exclCarriers.includes(addExclVal)) { toast("Already in excluded list", "warning"); return; }
    if (prefCarriers.includes(addExclVal)) { toast("Carrier is already in preferred list", "warning"); return; }
    setExclCarriers((prev) => [...prev, addExclVal]);
    setAddExclVal("");
  }

  function removePrefCarrier(name) { setPrefCarriers((prev) => prev.filter((c) => c !== name)); }
  function removeExclCarrier(name) { setExclCarriers((prev) => prev.filter((c) => c !== name)); }

  // ── Save ──
  async function savePref() {
    if (!editPref) return;
    const id = (editPref.id || "").trim().toUpperCase();
    const originCity = (editPref.originCity || "").trim();
    const originState = (editPref.originState || "").trim();
    const destCity = (editPref.destCity || "").trim();
    const destState = (editPref.destState || "").trim();
    if (!id || !originCity || !originState || !destCity || !destState) {
      toast("Lane ID, Origin City/State, and Destination City/State are required", "warning");
      return;
    }
    if (originState.length !== 2 || destState.length !== 2) {
      toast("State must be a 2-letter code (e.g. CA, TX)", "warning");
      return;
    }
    const origin = joinCityState(originCity, originState);
    const dest = joinCityState(destCity, destState);

    setBusyId("saving");
    try {
      const row = {
        id,
        origin,
        dest,
        mode: editPref.mode || "TL",
        customer: editPref.customer || "",
        preferred: prefCarriers,
        excluded: exclCarriers,
        priority: editPref.priority || "Medium",
        reason: editPref.reason || "",
        transit_days: editPref.transitDays ? parseInt(editPref.transitDays) : null,
        status: editPref.status || "Active",
      };

      const isEditing = !!editPref._originalId;

      if (isEditing) {
        if (editPref._originalId !== id) {
          // Renaming the primary key: collision check, then delete-old + insert-new.
          // PATCH would fail here because no row with the new id exists yet.
          if (lanePreferences.find((x) => x.id === id)) {
            toast(`${id} already exists`, "warning"); setBusyId(""); return;
          }
          await DbApi.remove("lane_preferences", editPref._originalId);
          await DbApi.upsert("lane_preferences", row);
        } else {
          await DbApi.patch("lane_preferences", id, row);
        }
        toast(`${id} updated`, "success");
      } else {
        if (lanePreferences.find((x) => x.id === id)) { toast(`${id} already exists`, "warning"); setBusyId(""); return; }
        await DbApi.upsert("lane_preferences", row);
        toast(`Lane preference ${id} created`, "success");
      }

      setEditPref(null);
      // Lane prefs feed into carrier quote sorting — drop the in-memory
      // quote cache so the next plan run re-fetches with the new rules.
      invalidateQuoteCache();
      await refreshData();
    } catch (err) {
      toast(`Failed: ${err.message}`, "error");
    } finally {
      setBusyId("");
    }
  }

  // ── Toggle status ──
  async function toggleStatus(p) {
    setBusyId(p.id);
    try {
      const newStatus = p.status === "Active" ? "Inactive" : "Active";
      await DbApi.patch("lane_preferences", p.id, { ...p, status: newStatus });
      toast(`${p.id} set to ${newStatus}`, "info");
      invalidateQuoteCache();
      await refreshData();
    } catch (err) { toast(`Failed: ${err.message}`, "error"); }
    finally { setBusyId(""); }
  }

  // ── Delete ──
  async function deletePref(p) {
    if (!window.confirm(`Delete lane preference ${p.id}?`)) return;
    setBusyId(p.id);
    try {
      await DbApi.remove("lane_preferences", p.id);
      toast(`${p.id} deleted`, "info");
      invalidateQuoteCache();
      await refreshData();
    } catch (err) { toast(`Failed: ${err.message}`, "error"); }
    finally { setBusyId(""); }
  }

  // ── Active carrier options for dropdowns ──
  const carrierOptions = (carriers || []).filter((c) => c.status === "Active");

  return (
    <div>
      {/* Page Header */}
      <div className="page-header">
        <div>
          <div className="page-title">Lane Preferences</div>
          <div className="page-sub">Set preferred and excluded carriers per lane</div>
        </div>
        <div className="header-actions">
          <button className="btn btn-primary" onClick={openNew}>+ Add Lane Preference</button>
        </div>
      </div>

      <div className="page-content">
        {message.text && (
          <div className={`toast toast-${message.type}`} style={{ marginBottom: 12 }}>{message.text}</div>
        )}

        {/* Stat Cards */}
        <div className="stat-grid">
          <div className="stat-card blue">
            <div className="stat-label">Total Lane Prefs</div>
            <div className="stat-value" style={{ fontSize: 26 }}>{kpis.total}</div>
          </div>
          <div className="stat-card green">
            <div className="stat-label">Preferred Carriers</div>
            <div className="stat-value" style={{ fontSize: 26 }}>{kpis.preferred}</div>
          </div>
          <div className="stat-card red">
            <div className="stat-label">Excluded Carriers</div>
            <div className="stat-value" style={{ fontSize: 26 }}>{kpis.excluded}</div>
          </div>
          <div className="stat-card yellow">
            <div className="stat-label">Lanes Covered</div>
            <div className="stat-value" style={{ fontSize: 26 }}>{kpis.lanes}</div>
          </div>
        </div>

        {/* Search */}
        <div className="filter-bar" style={{ marginBottom: 16 }}>
          <input
            placeholder="Search lanes..."
            value={q}
            onChange={(e) => setQ(e.target.value)}
            style={{
              padding: "7px 12px", border: "1.5px solid var(--border)", borderRadius: 8,
              fontSize: 13, fontFamily: "inherit", outline: "none", width: 240,
            }}
          />
        </div>

        {/* Lane Preferences Table */}
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-header">
            <span className="card-title">Lane Carrier Preferences</span>
            <span style={{ fontSize: 12, color: "var(--text3)" }}>
              Preferences are enforced automatically during order planning
            </span>
          </div>
          <div className="table-wrap">
            <table className="grid">
              <thead>
                <tr>
                  <th onClick={() => toggleSort("id")} style={{ cursor: "pointer" }}>Lane <SortIcon col="id" /></th>
                  <th onClick={() => toggleSort("origin")} style={{ cursor: "pointer" }}>Origin <SortIcon col="origin" /></th>
                  <th onClick={() => toggleSort("dest")} style={{ cursor: "pointer" }}>Destination <SortIcon col="dest" /></th>
                  <th onClick={() => toggleSort("mode")} style={{ cursor: "pointer" }}>Mode <SortIcon col="mode" /></th>
                  <th>Preferred Carriers</th>
                  <th>Excluded Carriers</th>
                  <th onClick={() => toggleSort("priority")} style={{ cursor: "pointer" }}>Priority <SortIcon col="priority" /></th>
                  <th>Reason</th>
                  <th>Applied To</th>
                  <th onClick={() => toggleSort("status")} style={{ cursor: "pointer" }}>Status <SortIcon col="status" /></th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={11} style={{ textAlign: "center", padding: 24, color: "var(--text3)" }}>
                      No lane preferences found. Click "+ Add Lane Preference" to create one.
                    </td>
                  </tr>
                ) : rows.map((p) => {
                  const ps = PRIORITY_STYLES[p.priority] || PRIORITY_STYLES.Medium;
                  const orderCount = laneOrderCount(p);
                  return (
                    <tr key={p.id}>
                      <td>
                        <span
                          className="mono"
                          style={{ color: "var(--accent)", fontWeight: 700, fontSize: 12, cursor: "pointer", textDecoration: "underline" }}
                          onClick={() => openEdit(p)}
                        >
                          {p.id}
                        </span>
                      </td>
                      <td style={{ fontWeight: 600, fontSize: 13 }}>{p.origin}</td>
                      <td style={{ fontWeight: 600, fontSize: 13 }}>{p.dest}</td>
                      <td><span className="badge">{p.mode}</span></td>
                      <td>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 3 }}>
                          {(p.preferred || []).length > 0
                            ? (p.preferred || []).map((c) => (
                                <span key={c} style={{
                                  fontSize: 10, background: "rgba(16,185,129,.1)", color: "var(--green)",
                                  border: "1px solid rgba(16,185,129,.25)", padding: "2px 7px",
                                  borderRadius: 8, fontWeight: 600, whiteSpace: "nowrap",
                                }}>
                                  {"\u2713"} {c.split(" ")[0]}
                                </span>
                              ))
                            : <span style={{ color: "#ddd", fontSize: 12 }}>{"\u2014"}</span>}
                        </div>
                      </td>
                      <td>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 3 }}>
                          {(p.excluded || []).length > 0
                            ? (p.excluded || []).map((c) => (
                                <span key={c} style={{
                                  fontSize: 10, background: "rgba(239,68,68,.1)", color: "var(--red)",
                                  border: "1px solid rgba(239,68,68,.25)", padding: "2px 7px",
                                  borderRadius: 8, fontWeight: 600, whiteSpace: "nowrap",
                                }}>
                                  {"\u2717"} {c.split(" ")[0]}
                                </span>
                              ))
                            : <span style={{ color: "#ddd", fontSize: 12 }}>{"\u2014"}</span>}
                        </div>
                      </td>
                      <td>
                        <span style={{
                          background: ps.bg, color: ps.color, border: `1px solid ${ps.color}`,
                          fontSize: 11, fontWeight: 700, padding: "2px 9px", borderRadius: 20,
                        }}>
                          {p.priority}
                        </span>
                      </td>
                      <td style={{ fontSize: 11, color: "var(--text3)", maxWidth: 180 }}>{p.reason || "\u2014"}</td>
                      <td>
                        {p.customer
                          ? <span style={{ fontSize: 11, fontWeight: 600, color: "var(--accent)" }}>{p.customer}</span>
                          : <span style={{ fontSize: 11, color: "var(--text3)" }}>All Customers</span>}
                        {orderCount > 0 && (
                          <span style={{
                            fontSize: 10, background: "rgba(59,130,246,.1)", color: "var(--accent)",
                            border: "1px solid rgba(59,130,246,.2)", padding: "1px 6px",
                            borderRadius: 8, fontWeight: 700, marginLeft: 4,
                          }}>
                            {orderCount} orders
                          </span>
                        )}
                      </td>
                      <td>
                        <span style={{
                          background: p.status === "Active" ? "var(--green-dim)" : "rgba(107,114,128,.1)",
                          color: p.status === "Active" ? "var(--green)" : "var(--text3)",
                          border: `1px solid ${p.status === "Active" ? "rgba(16,185,129,.3)" : "rgba(107,114,128,.3)"}`,
                          fontSize: 11, fontWeight: 700, padding: "2px 9px", borderRadius: 20,
                        }}>
                          {p.status}
                        </span>
                      </td>
                      <td style={{ whiteSpace: "nowrap" }}>
                        <button className="btn btn-secondary btn-sm" onClick={() => openEdit(p)} disabled={busyId === p.id}>Edit</button>{" "}
                        <button className="btn btn-secondary btn-sm" onClick={() => toggleStatus(p)} disabled={busyId === p.id}>
                          {p.status === "Active" ? "Disable" : "Enable"}
                        </button>{" "}
                        <button className="btn btn-secondary btn-sm" onClick={() => deletePref(p)} disabled={busyId === p.id} style={{ color: "var(--red)" }}>
                          Delete
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Info Panels */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          {/* How Lane Preferences Work */}
          <div className="card">
            <div className="card-header">
              <span className="card-title">How Lane Preferences Work</span>
            </div>
            <div style={{ padding: 16, fontSize: 13, color: "var(--text2)", lineHeight: 1.7 }}>
              <div style={{ marginBottom: 10 }}>When an order is planned on a lane with preferences set:</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                  <span style={{ color: "var(--green)", fontSize: 16, marginTop: -1 }}>{"\u2713"}</span>
                  <span><strong>Preferred carriers</strong> appear at the top of the rate selection list, highlighted in blue</span>
                </div>
                <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                  <span style={{ color: "var(--red)", fontSize: 16, marginTop: -1 }}>{"\u2717"}</span>
                  <span><strong>Excluded carriers</strong> are hidden from the rate selection list entirely</span>
                </div>
                <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                  <span style={{ color: "var(--yellow)", fontSize: 16, marginTop: -1 }}>{"\u2605"}</span>
                  <span><strong>Priority level</strong> determines which preference wins when multiple rules match a lane</span>
                </div>
                <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                  <span style={{ color: "var(--accent)", fontSize: 16, marginTop: -1 }}>{"\u21A9"}</span>
                  <span>Order-level constraints (set on individual orders) <strong>always override</strong> lane-level preferences</span>
                </div>
              </div>
            </div>
          </div>

          {/* Preference Coverage by Customer */}
          <div className="card">
            <div className="card-header">
              <span className="card-title">Preference Coverage by Customer</span>
            </div>
            <div style={{ padding: 16 }}>
              {customerCoverage.length === 0 ? (
                <div style={{ color: "var(--text3)", fontSize: 12, padding: 8 }}>No preferences set yet.</div>
              ) : customerCoverage.map((c) => (
                <div key={c.name} style={{ marginBottom: 10 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                    <span style={{ fontSize: 12, fontWeight: 600 }}>{c.name}</span>
                    <span className="mono" style={{ fontSize: 11, color: "var(--text3)" }}>
                      {c.count} rule{c.count !== 1 ? "s" : ""}
                    </span>
                  </div>
                  <div style={{ background: "#f1f5f9", borderRadius: 6, height: 7 }}>
                    <div style={{ width: `${c.pct}%`, background: "var(--accent)", borderRadius: 6, height: 7 }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Edit / Create Modal */}
      {editPref && (
        <div className="modal-overlay" onClick={() => setEditPref(null)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()} style={{ width: 680, maxHeight: "90vh", overflow: "auto" }}>
            <div className="modal-header" style={{ background: "linear-gradient(135deg,#1e3a5f,#7c3aed)", borderRadius: "16px 16px 0 0" }}>
              <div>
                <div style={{ fontSize: 11, color: "rgba(255,255,255,.6)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>
                  Lane Carrier Preferences
                </div>
                <h3 style={{ color: "#fff", margin: 0 }}>
                  {editPref._originalId ? `Edit \u2014 ${editPref._originalId}` : "New Lane Preference"}
                </h3>
              </div>
              <button className="modal-close" onClick={() => setEditPref(null)} style={{ color: "rgba(255,255,255,.7)", fontSize: 22 }}>{"\u2715"}</button>
            </div>

            <div className="modal-body" style={{ padding: 24 }}>
              {/* Lane Definition */}
              <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text3)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 12 }}>
                Lane Definition
              </div>
              <div className="form-grid" style={{ marginBottom: 20 }}>
                <div className="form-group">
                  <label className="form-label">Lane ID *</label>
                  <input
                    value={editPref.id || ""}
                    onChange={(e) => editField("id", e.target.value)}
                    placeholder="e.g. CHI-DAL-PREF"
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Mode</label>
                  <select value={editPref.mode || "TL"} onChange={(e) => editField("mode", e.target.value)}>
                    <option value="TL">Truckload (TL)</option>
                    <option value="LTL">LTL</option>
                    <option value="Any">Any Mode</option>
                    <option value="Rail">Rail</option>
                    <option value="Intermodal">Intermodal</option>
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Origin City *</label>
                  <input
                    value={editPref.originCity || ""}
                    onChange={(e) => editField("originCity", e.target.value)}
                    placeholder="e.g. Chicago"
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Origin State *</label>
                  <input
                    value={editPref.originState || ""}
                    onChange={(e) => editField("originState", e.target.value.toUpperCase())}
                    placeholder="e.g. IL"
                    maxLength={2}
                    style={{ textTransform: "uppercase" }}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Destination City *</label>
                  <input
                    value={editPref.destCity || ""}
                    onChange={(e) => editField("destCity", e.target.value)}
                    placeholder="e.g. Dallas"
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Destination State *</label>
                  <input
                    value={editPref.destState || ""}
                    onChange={(e) => editField("destState", e.target.value.toUpperCase())}
                    placeholder="e.g. TX"
                    maxLength={2}
                    style={{ textTransform: "uppercase" }}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Customer (optional)</label>
                  <select value={editPref.customer || ""} onChange={(e) => editField("customer", e.target.value)}>
                    <option value="">All Customers</option>
                    {CUSTOMERS.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Priority</label>
                  <select value={editPref.priority || "Medium"} onChange={(e) => editField("priority", e.target.value)}>
                    <option value="High">High - Override other rules</option>
                    <option value="Medium">Medium - Standard</option>
                    <option value="Low">Low - Fallback only</option>
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Status</label>
                  <select value={editPref.status || "Active"} onChange={(e) => editField("status", e.target.value)}>
                    <option value="Active">Active</option>
                    <option value="Inactive">Inactive</option>
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Transit Days</label>
                  <input
                    type="number"
                    min={1}
                    max={30}
                    value={editPref.transitDays || ""}
                    onChange={(e) => editField("transitDays", e.target.value)}
                    placeholder="e.g. 3"
                  />
                  <div style={{ fontSize: 10, color: "var(--text3)", marginTop: 4 }}>Overrides mode default in middleware</div>
                </div>
              </div>

              {/* Carrier Preferences */}
              <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text3)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 12 }}>
                Carrier Preferences
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 20 }}>
                {/* Preferred */}
                <div style={{
                  background: "rgba(16,185,129,.05)", border: "1.5px solid rgba(16,185,129,.2)",
                  borderRadius: 12, padding: 14,
                }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "var(--green)", marginBottom: 10 }}>
                    {"\u2713"} PREFERRED CARRIERS
                  </div>
                  <div style={{ fontSize: 11, color: "var(--text3)", marginBottom: 10 }}>
                    These carriers will be shown first and highlighted during planning
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 10 }}>
                    {prefCarriers.length === 0
                      ? <div style={{ color: "var(--text3)", fontSize: 11, padding: "4px 0" }}>None added</div>
                      : prefCarriers.map((c) => (
                          <div key={c} style={{
                            display: "flex", alignItems: "center", gap: 8, padding: "6px 10px",
                            background: "rgba(16,185,129,.08)", borderRadius: 8,
                            border: "1px solid var(--green)", fontSize: 12, fontWeight: 600,
                          }}>
                            <span style={{ flex: 1, color: "var(--text)" }}>{c}</span>
                            <button
                              onClick={() => removePrefCarrier(c)}
                              style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text3)", fontSize: 14, padding: 0, lineHeight: 1 }}
                            >{"\u2715"}</button>
                          </div>
                        ))}
                  </div>
                  <div style={{ display: "flex", gap: 6 }}>
                    <select
                      value={addPrefVal}
                      onChange={(e) => setAddPrefVal(e.target.value)}
                      style={{
                        flex: 1, padding: "6px 9px", border: "1.5px solid rgba(16,185,129,.3)",
                        borderRadius: 8, fontSize: 12, fontFamily: "inherit", background: "#fff",
                      }}
                    >
                      <option value="">+ Select carrier to add</option>
                      {carrierOptions.map((c) => (
                        <option key={c.id} value={c.name}>{c.name} ({c.scac})</option>
                      ))}
                    </select>
                    <button
                      onClick={addPreferred}
                      style={{
                        padding: "6px 12px", background: "var(--green)", color: "#fff",
                        border: "none", borderRadius: 8, cursor: "pointer", fontSize: 12, fontWeight: 600,
                      }}
                    >Add</button>
                  </div>
                </div>

                {/* Excluded */}
                <div style={{
                  background: "rgba(239,68,68,.05)", border: "1.5px solid rgba(239,68,68,.2)",
                  borderRadius: 12, padding: 14,
                }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "var(--red)", marginBottom: 10 }}>
                    {"\u2717"} EXCLUDED CARRIERS
                  </div>
                  <div style={{ fontSize: 11, color: "var(--text3)", marginBottom: 10 }}>
                    These carriers will be hidden from rate selection on this lane
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 10 }}>
                    {exclCarriers.length === 0
                      ? <div style={{ color: "var(--text3)", fontSize: 11, padding: "4px 0" }}>None added</div>
                      : exclCarriers.map((c) => (
                          <div key={c} style={{
                            display: "flex", alignItems: "center", gap: 8, padding: "6px 10px",
                            background: "rgba(239,68,68,.08)", borderRadius: 8,
                            border: "1px solid var(--red)", fontSize: 12, fontWeight: 600,
                          }}>
                            <span style={{ flex: 1, color: "var(--text)" }}>{c}</span>
                            <button
                              onClick={() => removeExclCarrier(c)}
                              style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text3)", fontSize: 14, padding: 0, lineHeight: 1 }}
                            >{"\u2715"}</button>
                          </div>
                        ))}
                  </div>
                  <div style={{ display: "flex", gap: 6 }}>
                    <select
                      value={addExclVal}
                      onChange={(e) => setAddExclVal(e.target.value)}
                      style={{
                        flex: 1, padding: "6px 9px", border: "1.5px solid rgba(239,68,68,.3)",
                        borderRadius: 8, fontSize: 12, fontFamily: "inherit", background: "#fff",
                      }}
                    >
                      <option value="">+ Select carrier to add</option>
                      {carrierOptions.map((c) => (
                        <option key={c.id} value={c.name}>{c.name} ({c.scac})</option>
                      ))}
                    </select>
                    <button
                      onClick={addExcluded}
                      style={{
                        padding: "6px 12px", background: "var(--red)", color: "#fff",
                        border: "none", borderRadius: 8, cursor: "pointer", fontSize: 12, fontWeight: 600,
                      }}
                    >Add</button>
                  </div>
                </div>
              </div>

              {/* Reason */}
              <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text3)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 10 }}>
                Reason / Notes
              </div>
              <textarea
                rows={2}
                value={editPref.reason || ""}
                onChange={(e) => editField("reason", e.target.value)}
                placeholder="e.g. Preferred due to high OTD on this lane. Exclude JB Hunt - recent claim issues."
                style={{
                  width: "100%", padding: "9px 12px", border: "1.5px solid var(--border)",
                  borderRadius: 9, fontSize: 13, fontFamily: "inherit", resize: "vertical", boxSizing: "border-box",
                }}
              />

              {/* Live Preview */}
              {(editPref.originCity && editPref.originState && editPref.destCity && editPref.destState && (prefCarriers.length > 0 || exclCarriers.length > 0)) && (
                <div style={{
                  marginTop: 16, padding: "12px 16px",
                  background: "linear-gradient(135deg,rgba(124,58,237,.06),rgba(59,130,246,.06))",
                  border: "1px solid rgba(124,58,237,.2)", borderRadius: 10, fontSize: 12,
                }}>
                  <div style={{ fontWeight: 700, color: "#7c3aed", marginBottom: 6 }}>Preview - How this affects planning:</div>
                  <div style={{ color: "var(--text2)", lineHeight: 1.7 }}>
                    <div>Lane: <strong>{joinCityState(editPref.originCity, editPref.originState)} {"\u2192"} {joinCityState(editPref.destCity, editPref.destState)}</strong></div>
                    {prefCarriers.length > 0 && (
                      <div>{"\u2713"} When planning on this lane, these carriers will appear first: <strong>{prefCarriers.join(", ")}</strong></div>
                    )}
                    {exclCarriers.length > 0 && (
                      <div>{"\u2717"} These carriers will be hidden from rate selection: <strong>{exclCarriers.join(", ")}</strong></div>
                    )}
                    <div>{"\u2691"} Order-level carrier constraints will still override these settings.</div>
                  </div>
                </div>
              )}
            </div>

            <div className="modal-footer">
              <button className="btn" onClick={() => setEditPref(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={savePref} disabled={busyId === "saving"}>
                {busyId === "saving" ? "Saving..." : "Save Preference"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
