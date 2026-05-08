import { useMemo, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { DOCK_DOORS, DEFAULT_DOCK_CONFIG } from "../constants/docks";
// API calls go through dockScheduleService (services layer)
import { parseLoadingWindow } from "../services/dockService";
import { getDockConfigForWarehouse, saveDockConfig, persistShipmentDockAssignment } from "../services/dockScheduleService";
import { useEditGate } from "../hooks/useEditGate";
import DockLegend from "../components/dock-scheduling/DockLegend";
import DockGrid from "../components/dock-scheduling/DockGrid";
import AppointmentCard from "../components/dock-scheduling/AppointmentCard";
import AppointmentEditModal from "../components/dock-scheduling/AppointmentEditModal";
import { formatDateDisplay, todayStr } from "../utils/dateUtils";

export default function DockSchedulingPage() {
  const { orders, shipments, warehouseDockConfigs = [], refreshData } = useOutletContext();
  // QA #147: Execution module access at 'view' must collapse edit
  // affordances (Configure, slot click → new appt, Save Config, edit appt
  // save/delete). Matrix-driven gate; backend canWriteTable is still the
  // authoritative reject.
  const gate = useEditGate("dock_scheduling");
  const [dockDate, setDockDate] = useState(todayStr());
  const [appointments, setAppointments] = useState([]);
  const [editAppt, setEditAppt] = useState(null);
  const [warehouseFilter, setWarehouseFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [searchQ, setSearchQ] = useState("");
  const [showConfig, setShowConfig] = useState(false);
  const [configSaving, setConfigSaving] = useState(false);

  // Build warehouse options from ORDER origins (not just shipments)
  const warehouseOptions = useMemo(() => {
    const origins = new Set();
    (orders || []).forEach((o) => { const v = (o.origin || "").trim().toUpperCase(); if (v) origins.add(v); });
    (shipments || []).forEach((s) => { const v = (s.origin || "").trim().toUpperCase(); if (v) origins.add(v); });
    return [...origins].sort().map((o) => ({ value: o, label: o }));
  }, [orders, shipments]);

  // Get dock config for selected warehouse
  const dockConfig = useMemo(() => {
    if (!warehouseFilter) return DEFAULT_DOCK_CONFIG;
    return getDockConfigForWarehouse(warehouseDockConfigs, warehouseFilter);
  }, [warehouseFilter, warehouseDockConfigs]);

  // Editable config state for the config panel
  const currentDbRow = useMemo(() => {
    return (warehouseDockConfigs || []).find((c) => c.warehouse === warehouseFilter) || null;
  }, [warehouseDockConfigs, warehouseFilter]);

  const [editConfig, setEditConfig] = useState(null);

  function openConfig() {
    if (!gate.canEdit) return;            // QA #147 defensive guard
    setEditConfig({
      num_doors: currentDbRow?.num_doors ?? 6,
      max_per_door: currentDbRow?.max_per_door ?? 4,
      max_hours_per_door: currentDbRow?.max_hours_per_door ?? 14,
      start_hour: currentDbRow?.start_hour ?? 6,
      end_hour: currentDbRow?.end_hour ?? 20,
    });
    setShowConfig(true);
  }

  async function handleSaveConfig() {
    if (!gate.canEdit) return;            // QA #147 defensive guard
    if (!warehouseFilter || !editConfig) return;
    setConfigSaving(true);
    try {
      await saveDockConfig({
        id: currentDbRow?.id || null,
        warehouse: warehouseFilter,
        ...editConfig,
      });
      await refreshData();
      setShowConfig(false);
    } catch (err) {
      alert(`Save failed: ${err.message}`);
    } finally {
      setConfigSaving(false);
    }
  }

  // Build appointments from shipments
  const dayAppts = useMemo(() => {
    const appts = (shipments || [])
      .filter((s) => s.pickup_date === dockDate && s.status !== "Cancelled" && !s.dock_issue)
      .map((s, i) => {
        const door = s.dock_door || dockConfig.doors[i % dockConfig.doors.length];
        const { start, duration } = parseLoadingWindow(s, i);
        return {
          id: "DA-" + s.id,
          door,
          start,
          duration,
          type: "Outbound",
          carrier: s.carrier || "TBD",
          shipmentId: s.id,
          status: s.dock_door ? "Confirmed" : "Scheduled",
        };
      });
    const all = [...appointments.filter((a) => a.date === dockDate), ...appts];

    const filtered = all.filter((a) => {
      if (warehouseFilter && a.shipmentId) {
        const ship = shipments.find((s) => s.id === a.shipmentId);
        if ((ship?.origin || "").trim().toUpperCase() !== warehouseFilter) return false;
      }
      if (typeFilter && a.type !== typeFilter) return false;
      if (statusFilter && a.status !== statusFilter) return false;
      if (searchQ) {
        const q = searchQ.toLowerCase();
        if (!(a.carrier || "").toLowerCase().includes(q) && !(a.shipmentId || "").toLowerCase().includes(q)) return false;
      }
      return true;
    });

    if (dockConfig.maxPerDoor < Infinity || dockConfig.maxHoursPerDoor < Infinity) {
      const doorCounts = {};
      const doorMinutes = {};
      return filtered.filter((a) => {
        doorCounts[a.door] = (doorCounts[a.door] || 0) + 1;
        doorMinutes[a.door] = (doorMinutes[a.door] || 0) + (a.duration || 60);
        if (dockConfig.maxPerDoor < Infinity && doorCounts[a.door] > dockConfig.maxPerDoor) return false;
        if (dockConfig.maxHoursPerDoor < Infinity && doorMinutes[a.door] > dockConfig.maxHoursPerDoor * 60) return false;
        return true;
      });
    }
    return filtered;
  }, [shipments, dockDate, appointments, warehouseFilter, typeFilter, statusFilter, searchQ, dockConfig]);

  const scheduled = dayAppts.length;
  const inbound = dayAppts.filter((a) => a.type === "Inbound").length;
  const freeDoors = dockConfig.doors.length - new Set(dayAppts.map((a) => a.door)).size;
  const totalHrs = dockConfig.doors.length * (dockConfig.maxHoursPerDoor < Infinity ? dockConfig.maxHoursPerDoor : (dockConfig.endHour - dockConfig.startHour));

  function navDay(delta) {
    const d = new Date(dockDate + "T12:00:00");
    d.setDate(d.getDate() + delta);
    setDockDate(d.toISOString().slice(0, 10));
  }

  function openNewAppt(door, hour) {
    if (!gate.canEdit) return;            // QA #147 defensive guard
    setEditAppt({
      id: "", door, date: dockDate, start: hour, duration: 60,
      type: "Outbound", carrier: "", shipmentId: "", status: "Scheduled", notes: "",
    });
  }

  async function saveAppt() {
    if (!gate.canEdit) return;            // QA #147 defensive guard
    if (!editAppt) return;
    const appt = { ...editAppt, date: dockDate, id: editAppt.id || "DA-" + Date.now() };

    // Shipment-tied appointment: persist dock fields back to the shipment
    // row so Shipment Details / OMS / exports see the new door. Local
    // appointments state isn't authoritative for these — the next render
    // will rebuild them from refreshed shipments.
    if (appt.shipmentId) {
      try {
        await persistShipmentDockAssignment(appt.shipmentId, {
          door:       appt.door,
          start:      appt.start,
          duration:   appt.duration,
          pickupDate: appt.date,
        });
        await refreshData();
        setEditAppt(null);
      } catch (err) {
        alert(`Failed to update shipment dock: ${err.message}`);
      }
      return;
    }

    // Ad-hoc (non-shipment) appointment — keep the local-state path.
    setAppointments((prev) => {
      const existing = prev.findIndex((a) => a.id === appt.id);
      if (existing >= 0) { const next = [...prev]; next[existing] = appt; return next; }
      return [...prev, appt];
    });
    setEditAppt(null);
  }

  function deleteAppt() {
    if (!gate.canEdit) return;            // QA #147 defensive guard
    if (!editAppt) return;
    setAppointments((prev) => prev.filter((a) => a.id !== editAppt.id));
    setEditAppt(null);
  }

  const inputSt = { padding: "6px 10px", borderRadius: 6, border: "1px solid var(--border)", fontSize: 12, width: 80 };
  const labelSt = { fontSize: 11, fontWeight: 600, color: "var(--text3)", marginBottom: 4 };

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
          {"\ud83d\udcc5"} {formatDateDisplay(dockDate)}
        </div>

        {/* Stats */}
        <div className="stat-grid">
          <div className="stat-card blue">
            <div className="stat-label">Total Slots</div>
            <div className="stat-value">{totalHrs} hrs</div>
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
          <select className="fsel" style={{ minWidth: 180 }} value={warehouseFilter} onChange={(e) => { setWarehouseFilter(e.target.value); setShowConfig(false); }}>
            <option value="">All Warehouses</option>
            {warehouseOptions.map((w) => <option key={w.value} value={w.value}>{w.label}</option>)}
          </select>
          {warehouseFilter && (
            <button
              className="btn btn-secondary btn-sm"
              onClick={showConfig ? () => setShowConfig(false) : openConfig}
              style={{ fontSize: 11 }}
              {...gate.editProps()}        /* QA #147: matches matrix */
            >
              {showConfig ? "Hide Config" : "Configure"}
            </button>
          )}
          <select className="fsel" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
            <option value="">All Types</option>
            <option>Inbound</option>
            <option>Outbound</option>
            <option>Cross-Dock</option>
          </select>
          <select className="fsel" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">All Statuses</option>
            <option>Scheduled</option>
            <option>Confirmed</option>
            <option>In Progress</option>
            <option>Completed</option>
          </select>
          <div className="search-wrap">
            <input className="search-input" placeholder="Search carrier, shipment..." value={searchQ} onChange={(e) => setSearchQ(e.target.value)} />
          </div>
        </div>

        {/* Warehouse Dock Config Panel */}
        {showConfig && editConfig && warehouseFilter && (
          <div className="card" style={{ padding: 16, marginBottom: 12, border: "1px solid rgba(99,102,241,.2)", background: "rgba(99,102,241,.03)" }}>
            <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 12, color: "var(--accent)" }}>
              Dock Configuration — {warehouseFilter}
              {currentDbRow && <span style={{ fontSize: 10, fontWeight: 400, color: "var(--text3)", marginLeft: 8 }}>Saved</span>}
            </div>
            <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "flex-end" }}>
              <div>
                <div style={labelSt}>Doors</div>
                <input type="number" min={1} max={20} value={editConfig.num_doors}
                  onChange={(e) => setEditConfig({ ...editConfig, num_doors: parseInt(e.target.value) || 1 })} style={inputSt} />
              </div>
              <div>
                <div style={labelSt}>Max Appts / Door</div>
                <input type="number" min={1} max={20} value={editConfig.max_per_door}
                  onChange={(e) => setEditConfig({ ...editConfig, max_per_door: parseInt(e.target.value) || 1 })} style={inputSt} />
              </div>
              <div>
                <div style={labelSt}>Max Hrs / Door</div>
                <input type="number" min={1} max={24} value={editConfig.max_hours_per_door}
                  onChange={(e) => setEditConfig({ ...editConfig, max_hours_per_door: parseInt(e.target.value) || 1 })} style={inputSt} />
              </div>
              <div>
                <div style={labelSt}>Start Hour</div>
                <select value={editConfig.start_hour} onChange={(e) => setEditConfig({ ...editConfig, start_hour: parseInt(e.target.value) })} style={inputSt}>
                  {Array.from({ length: 24 }, (_, i) => <option key={i} value={i}>{String(i).padStart(2, "0")}:00</option>)}
                </select>
              </div>
              <div>
                <div style={labelSt}>End Hour</div>
                <select value={editConfig.end_hour} onChange={(e) => setEditConfig({ ...editConfig, end_hour: parseInt(e.target.value) })} style={inputSt}>
                  {Array.from({ length: 24 }, (_, i) => <option key={i + 1} value={i + 1}>{String(i + 1).padStart(2, "0")}:00</option>)}
                </select>
              </div>
              <button
                className="btn btn-primary btn-sm"
                onClick={handleSaveConfig}
                style={{ background: "linear-gradient(135deg,#1a237e,#6366f1)", border: "none", height: 32 }}
                {...gate.editProps({ disabled: configSaving })}   /* QA #147 */
              >
                {configSaving ? "Saving..." : "Save Config"}
              </button>
            </div>
          </div>
        )}

        <DockLegend />
        <DockGrid
          doors={dockConfig.doors}
          startHour={dockConfig.startHour}
          endHour={dockConfig.endHour}
          appointments={dayAppts}
          /* QA #147: when matrix says 'view', empty-slot click and
              appointment-detail-edit are both disabled at the source so
              the user never lands inside a modal they can't save. */
          onSlotClick={gate.canEdit ? openNewAppt : undefined}
          onAppointmentClick={gate.canEdit ? setEditAppt : undefined}
        />

        {/* Dock Issues */}
        {(() => {
          const issues = (shipments || []).filter((s) => s.dock_issue && s.pickup_date === dockDate && s.status !== "Cancelled"
            && (!warehouseFilter || (s.origin || "").trim().toUpperCase() === warehouseFilter));
          if (issues.length === 0) return null;
          return (
            <div style={{ marginTop: 12, marginBottom: 12 }}>
              <div style={{ fontFamily: "'Syne',sans-serif", fontWeight: 700, fontSize: 14, marginBottom: 8, color: "#dc2626" }}>
                DOCK ISSUES ({issues.length})
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))", gap: 10 }}>
                {issues.map((s) => (
                  <div key={s.id} className="card" style={{ padding: 14, border: "1.5px solid rgba(220,38,38,.3)", background: "rgba(220,38,38,.04)" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
                      <span style={{ background: "#dc2626", color: "#fff", fontSize: 10, padding: "2px 8px", borderRadius: 10, fontWeight: 700 }}>NO DOCK</span>
                      <span style={{ fontSize: 12, fontWeight: 700 }}>{s.carrier || "TBD"}</span>
                    </div>
                    <div style={{ fontSize: 11, color: "var(--text3)" }}>{s.dock_issue}</div>
                    <div style={{ fontSize: 11, marginTop: 4 }}>{s.id} — {s.origin}</div>
                  </div>
                ))}
              </div>
            </div>
          );
        })()}

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
              <AppointmentCard key={a.id} appointment={a} />
            ))}
          </div>
        </div>
      </div>

      <AppointmentEditModal
        appointment={editAppt}
        doors={dockConfig.doors}
        dockDate={dockDate}
        onChange={setEditAppt}
        onSave={saveAppt}
        onDelete={deleteAppt}
        onClose={() => setEditAppt(null)}
      />
    </div>
  );
}
