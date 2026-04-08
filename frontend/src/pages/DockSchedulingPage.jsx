import { useMemo, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { DOCK_DOORS, getWarehouseDockConfig } from "../constants/docks";
import { parseLoadingWindow } from "../services/dockService";
import DockLegend from "../components/dock-scheduling/DockLegend";
import DockGrid from "../components/dock-scheduling/DockGrid";
import AppointmentCard from "../components/dock-scheduling/AppointmentCard";
import AppointmentEditModal from "../components/dock-scheduling/AppointmentEditModal";
import { formatDateDisplay, todayStr } from "../utils/dateUtils";

export default function DockSchedulingPage() {
  const { shipments } = useOutletContext();
  const [dockDate, setDockDate] = useState(todayStr());
  const [appointments, setAppointments] = useState([]);
  const [editAppt, setEditAppt] = useState(null);
  const [warehouseFilter, setWarehouseFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [searchQ, setSearchQ] = useState("");

  // Build warehouse options from unique shipment origins (normalized to uppercase)
  const warehouseOptions = useMemo(() => {
    const origins = new Set(shipments.map((s) => (s.origin || "").trim().toUpperCase()).filter(Boolean));
    return [...origins].sort().map((o) => ({ value: o, label: o }));
  }, [shipments]);

  // Get dock config for selected warehouse (doors + max per door)
  const dockConfig = useMemo(() => {
    if (!warehouseFilter) return { doors: DOCK_DOORS, maxPerDoor: Infinity };
    return getWarehouseDockConfig(warehouseFilter);
  }, [warehouseFilter]);

  // Build appointments from shipments that have dock data persisted during planning
  const dayAppts = useMemo(() => {
    const appts = shipments
      .filter((s) => s.pickup_date === dockDate && s.status !== "Cancelled")
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

    // Apply filters
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

    // Enforce per-door limits (max appointments and max hours)
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

  function deleteAppt() {
    if (!editAppt) return;
    setAppointments((prev) => prev.filter((a) => a.id !== editAppt.id));
    setEditAppt(null);
  }

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
            <div className="stat-value">{dockConfig.doors.length * (dockConfig.maxHoursPerDoor < Infinity ? dockConfig.maxHoursPerDoor : 14)} hrs</div>
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
          <select className="fsel" style={{ minWidth: 180 }} value={warehouseFilter} onChange={(e) => setWarehouseFilter(e.target.value)}>
            <option value="">All Warehouses</option>
            {warehouseOptions.map((w) => <option key={w.value} value={w.value}>{w.label}</option>)}
          </select>
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

        <DockLegend />
        <DockGrid doors={dockConfig.doors} startHour={dockConfig.startHour} endHour={dockConfig.endHour} appointments={dayAppts} onSlotClick={openNewAppt} onAppointmentClick={setEditAppt} />

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
