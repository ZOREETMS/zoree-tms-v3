import { useMemo, useState } from "react";
import { useOutletContext } from "react-router-dom";

const DOORS = ["Door 1", "Door 2", "Door 3", "Door 4", "Door 5", "Door 6"];
const HOURS = Array.from({ length: 15 }, (_, i) => {
  const h = i + 6;
  return `${String(h).padStart(2, "0")}:00`;
});

function todayStr() {
  const d = new Date();
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

export default function DockSchedulingPage() {
  const { shipments } = useOutletContext();
  const [dockDate, setDockDate] = useState(todayStr());
  const [appointments, setAppointments] = useState([]);
  const [editAppt, setEditAppt] = useState(null);

  // Mock appointments from shipments that have dock data
  const dayAppts = useMemo(() => {
    // For now, generate appointments from shipments with pickup on this date
    const appts = shipments
      .filter((s) => s.pickup_date === dockDate && s.status !== "Cancelled")
      .map((s, i) => ({
        id: "DA-" + s.id,
        door: DOORS[i % DOORS.length],
        start: `${String(8 + i).padStart(2, "0")}:00`,
        duration: 90,
        type: "Outbound",
        carrier: s.carrier || "TBD",
        shipmentId: s.id,
        status: "Scheduled",
      }));
    return [...appointments.filter((a) => a.date === dockDate), ...appts];
  }, [shipments, dockDate, appointments]);

  const scheduled = dayAppts.length;
  const inbound = dayAppts.filter((a) => a.type === "Inbound").length;
  const outbound = dayAppts.filter((a) => a.type === "Outbound").length;
  const freeDoors = DOORS.length - new Set(dayAppts.map((a) => a.door)).size;

  function navDay(delta) {
    const d = new Date(dockDate + "T12:00:00");
    d.setDate(d.getDate() + delta);
    setDockDate(d.toISOString().slice(0, 10));
  }

  function openNewAppt(door, hour) {
    setEditAppt({
      id: "", door, date: dockDate, start: hour, duration: 60,
      type: "Outbound", carrier: "", shipmentId: "", status: "Scheduled", notes: "",
    });
  }

  function saveAppt() {
    if (!editAppt) return;
    const appt = { ...editAppt, date: dockDate, id: editAppt.id || "DA-" + Date.now() };
    setAppointments((prev) => {
      const existing = prev.findIndex((a) => a.id === appt.id);
      if (existing >= 0) { const next = [...prev]; next[existing] = appt; return next; }
      return [...prev, appt];
    });
    setEditAppt(null);
  }

  // Format date for display
  const dateObj = new Date(dockDate + "T12:00:00");
  const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const dateDisplay = `${dayNames[dateObj.getDay()]}, ${monthNames[dateObj.getMonth()]} ${dateObj.getDate()}, ${dateObj.getFullYear()}`;

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Dock Scheduling</div>
          <div className="page-sub">Manage dock door appointments and loading windows</div>
        </div>
        <div className="header-actions">
          <button className="btn btn-secondary btn-sm" onClick={() => navDay(-1)}>← Prev Day</button>
          <button className="btn btn-secondary btn-sm" onClick={() => setDockDate(todayStr())}>Today</button>
          <button className="btn btn-secondary btn-sm" onClick={() => navDay(1)}>Next Day →</button>
          <input type="date" value={dockDate} onChange={(e) => setDockDate(e.target.value)}
                 style={{ padding: "5px 10px", borderRadius: 8, border: "1px solid var(--border2)", fontSize: 13 }} />
        </div>
      </div>

      <div className="page-content">
        <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 16, fontFamily: "'Syne',sans-serif" }}>
          📅 {dateDisplay}
        </div>

        {/* Stats */}
        <div className="stat-grid">
          <div className="stat-card blue">
            <div className="stat-label">Total Slots</div>
            <div className="stat-value">{DOORS.length * 14} hrs</div>
          </div>
          <div className="stat-card green">
            <div className="stat-label">Scheduled</div>
            <div className="stat-value">{scheduled}</div>
          </div>
          <div className="stat-card yellow">
            <div className="stat-label">Available</div>
            <div className="stat-value">{freeDoors} Doors Free</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Inbound</div>
            <div className="stat-value">{inbound}</div>
          </div>
        </div>

        {/* Filters */}
        <div className="filter-bar">
          <select className="fsel" style={{ minWidth: 180 }}>
            <option>ATLANTA, GA — ATLANTA DC</option>
            <option>CHICAGO, IL — CHICAGO WH</option>
            <option>DALLAS, TX — DALLAS DC</option>
          </select>
          <select className="fsel">
            <option value="">All Types</option>
            <option>Inbound</option>
            <option>Outbound</option>
            <option>Cross-Dock</option>
          </select>
          <select className="fsel">
            <option value="">All Statuses</option>
            <option>Scheduled</option>
            <option>Confirmed</option>
            <option>In Progress</option>
            <option>Completed</option>
          </select>
          <div className="search-wrap">
            <input className="search-input" placeholder="Search carrier, shipment..." />
          </div>
        </div>

        {/* Legend */}
        <div style={{ display: "flex", gap: 16, marginBottom: 16, fontSize: 12, padding: "8px 12px", background: "var(--bg3)", borderRadius: 8 }}>
          <span style={{ display: "flex", alignItems: "center", gap: 4 }}><span style={{ width: 10, height: 10, borderRadius: 3, background: "#3b82f6", display: "inline-block" }} /> Inbound</span>
          <span style={{ display: "flex", alignItems: "center", gap: 4 }}><span style={{ width: 10, height: 10, borderRadius: 3, background: "#16a34a", display: "inline-block" }} /> Outbound</span>
          <span style={{ display: "flex", alignItems: "center", gap: 4 }}><span style={{ width: 10, height: 10, borderRadius: 3, background: "#7c3aed", display: "inline-block" }} /> Cross-Dock</span>
          <span style={{ display: "flex", alignItems: "center", gap: 4 }}><span style={{ width: 10, height: 10, borderRadius: 3, background: "#dc2626", display: "inline-block" }} /> Conflict</span>
          <span style={{ display: "flex", alignItems: "center", gap: 4 }}><span style={{ width: 10, height: 10, borderRadius: 3, background: "#94a3b8", display: "inline-block" }} /> Blocked</span>
        </div>

        {/* Dock Grid */}
        <div className="card" style={{ padding: 0 }}>
          <div className="table-wrap">
            <table className="grid" style={{ border: "none", boxShadow: "none", minWidth: 1200 }}>
              <thead>
                <tr>
                  <th style={{ width: 80, position: "sticky", left: 0, background: "#f8faff", zIndex: 2 }}>DOOR</th>
                  {HOURS.map((h) => (
                    <th key={h} style={{ textAlign: "center", minWidth: 70, fontSize: 10 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {DOORS.map((door) => {
                  const doorAppts = dayAppts.filter((a) => a.door === door);
                  return (
                    <tr key={door}>
                      <td style={{ fontWeight: 700, fontSize: 12, position: "sticky", left: 0, background: "#fff", zIndex: 1 }}>
                        🚪 {door}
                        <button
                          onClick={() => openNewAppt(door, "08:00")}
                          style={{ marginLeft: 4, fontSize: 10, background: "var(--accent-glow)", border: "1px solid rgba(59,130,246,.2)", borderRadius: 4, cursor: "pointer", padding: "1px 4px", color: "var(--accent)" }}
                        >+</button>
                      </td>
                      {HOURS.map((h) => {
                        const appt = doorAppts.find((a) => a.start === h);
                        if (appt) {
                          const bg = appt.type === "Inbound" ? "#3b82f6" : appt.type === "Cross-Dock" ? "#7c3aed" : "#16a34a";
                          return (
                            <td key={h} style={{ padding: 2 }}>
                              <div
                                style={{
                                  background: bg, color: "#fff", borderRadius: 6,
                                  padding: "4px 6px", fontSize: 10, fontWeight: 700,
                                  cursor: "pointer", whiteSpace: "nowrap",
                                  minWidth: 80, textAlign: "center",
                                }}
                                title={`${appt.carrier} - ${appt.shipmentId}`}
                                onClick={() => setEditAppt(appt)}
                              >
                                {appt.carrier?.split(" ")[0] || "TBD"}
                              </div>
                            </td>
                          );
                        }
                        return <td key={h} style={{ padding: 2 }}></td>;
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Today's Appointments */}
        <div style={{ marginTop: 20 }}>
          <div style={{ fontFamily: "'Syne',sans-serif", fontWeight: 700, fontSize: 14, marginBottom: 12 }}>
            TODAY'S APPOINTMENTS
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))", gap: 10 }}>
            {dayAppts.length === 0 ? (
              <div className="card" style={{ padding: 20, textAlign: "center", color: "var(--text3)" }}>
                No appointments scheduled for this date
              </div>
            ) : dayAppts.map((a) => (
              <div key={a.id} className="card" style={{ padding: 14 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                  <span className={`badge ${a.type === "Inbound" ? "badge-blue" : "badge-green"}`} style={{ fontSize: 10 }}>
                    {a.type.toUpperCase()}
                  </span>
                  <strong>{a.door}</strong>
                  <span className="badge badge-planned" style={{ fontSize: 10, marginLeft: "auto" }}>• {a.status}</span>
                </div>
                <div style={{ fontWeight: 700, marginBottom: 4 }}>{a.carrier || "TBD"}</div>
                <div style={{ fontSize: 12, color: "var(--text3)" }}>
                  🕐 {a.start} – {a.duration}min
                  {a.shipmentId && <> · 📦 <span style={{ color: "var(--accent)" }}>{a.shipmentId}</span></>}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Edit Appointment Modal */}
      {editAppt && (
        <div className="modal-overlay" onClick={() => setEditAppt(null)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>DOCK SCHEDULING — {editAppt.id ? "EDIT" : "NEW"} APPOINTMENT</h3>
              <button className="modal-close" onClick={() => setEditAppt(null)}>✕</button>
            </div>
            <div className="modal-body">
              <div className="form-grid">
                <div className="form-group">
                  <label>Type</label>
                  <select value={editAppt.type} onChange={(e) => setEditAppt({ ...editAppt, type: e.target.value })}>
                    <option>Outbound</option>
                    <option>Inbound</option>
                    <option>Cross-Dock</option>
                  </select>
                </div>
                <div className="form-group">
                  <label>Door</label>
                  <select value={editAppt.door} onChange={(e) => setEditAppt({ ...editAppt, door: e.target.value })}>
                    {DOORS.map((d) => <option key={d}>{d}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label>Date</label>
                  <input type="date" value={editAppt.date || dockDate} onChange={(e) => setEditAppt({ ...editAppt, date: e.target.value })} />
                </div>
                <div className="form-group">
                  <label>Start Time</label>
                  <select value={editAppt.start} onChange={(e) => setEditAppt({ ...editAppt, start: e.target.value })}>
                    {HOURS.map((h) => <option key={h}>{h}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label>Duration</label>
                  <select value={editAppt.duration} onChange={(e) => setEditAppt({ ...editAppt, duration: parseInt(e.target.value) })}>
                    <option value="30">30 MIN</option>
                    <option value="60">1 HOUR</option>
                    <option value="90">90 MIN</option>
                    <option value="120">2 HOURS</option>
                    <option value="150">150 MIN</option>
                    <option value="180">3 HOURS</option>
                  </select>
                </div>
                <div className="form-group">
                  <label>Carrier</label>
                  <input value={editAppt.carrier || ""} onChange={(e) => setEditAppt({ ...editAppt, carrier: e.target.value })} />
                </div>
                <div className="form-group">
                  <label>Shipment Ref</label>
                  <input value={editAppt.shipmentId || ""} onChange={(e) => setEditAppt({ ...editAppt, shipmentId: e.target.value })} />
                </div>
                <div className="form-group">
                  <label>Status</label>
                  <select value={editAppt.status} onChange={(e) => setEditAppt({ ...editAppt, status: e.target.value })}>
                    <option>Scheduled</option>
                    <option>Confirmed</option>
                    <option>In Progress</option>
                    <option>Completed</option>
                    <option>Cancelled</option>
                  </select>
                </div>
              </div>
              <div className="form-group" style={{ marginTop: 10 }}>
                <label>Notes</label>
                <textarea value={editAppt.notes || ""} onChange={(e) => setEditAppt({ ...editAppt, notes: e.target.value })}
                          rows={2} style={{ width: "100%" }} />
              </div>
            </div>
            <div className="modal-footer">
              {editAppt.id && (
                <button className="btn btn-danger btn-sm" onClick={() => {
                  setAppointments((prev) => prev.filter((a) => a.id !== editAppt.id));
                  setEditAppt(null);
                }}>🗑️ Delete</button>
              )}
              <button className="btn btn-secondary" onClick={() => setEditAppt(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={saveAppt}>💾 Save Appointment</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
