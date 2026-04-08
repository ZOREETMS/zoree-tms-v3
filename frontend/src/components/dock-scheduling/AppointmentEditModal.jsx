import { DOCK_DOORS, DOCK_HOURS, APPT_TYPES, APPT_STATUSES, DURATION_OPTIONS } from "../../constants/docks";

export default function AppointmentEditModal({ appointment, dockDate, onChange, onSave, onDelete, onClose }) {
  if (!appointment) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>DOCK SCHEDULING — {appointment.id ? "EDIT" : "NEW"} APPOINTMENT</h3>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <div className="form-grid">
            <div className="form-group">
              <label>Type</label>
              <select value={appointment.type} onChange={(e) => onChange({ ...appointment, type: e.target.value })}>
                {APPT_TYPES.map((t) => <option key={t}>{t}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label>Door</label>
              <select value={appointment.door} onChange={(e) => onChange({ ...appointment, door: e.target.value })}>
                {DOCK_DOORS.map((d) => <option key={d}>{d}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label>Date</label>
              <input type="date" value={appointment.date || dockDate} onChange={(e) => onChange({ ...appointment, date: e.target.value })} />
            </div>
            <div className="form-group">
              <label>Start Time</label>
              <select value={appointment.start} onChange={(e) => onChange({ ...appointment, start: e.target.value })}>
                {DOCK_HOURS.map((h) => <option key={h}>{h}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label>Duration</label>
              <select value={appointment.duration} onChange={(e) => onChange({ ...appointment, duration: parseInt(e.target.value) })}>
                {DURATION_OPTIONS.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label>Carrier</label>
              <input value={appointment.carrier || ""} onChange={(e) => onChange({ ...appointment, carrier: e.target.value })} />
            </div>
            <div className="form-group">
              <label>Shipment Ref</label>
              <input value={appointment.shipmentId || ""} onChange={(e) => onChange({ ...appointment, shipmentId: e.target.value })} />
            </div>
            <div className="form-group">
              <label>Status</label>
              <select value={appointment.status} onChange={(e) => onChange({ ...appointment, status: e.target.value })}>
                {APPT_STATUSES.map((s) => <option key={s}>{s}</option>)}
              </select>
            </div>
          </div>
          <div className="form-group" style={{ marginTop: 10 }}>
            <label>Notes</label>
            <textarea value={appointment.notes || ""} onChange={(e) => onChange({ ...appointment, notes: e.target.value })}
                      rows={2} style={{ width: "100%" }} />
          </div>
        </div>
        <div className="modal-footer">
          {appointment.id && (
            <button className="btn btn-danger btn-sm" onClick={onDelete}>🗑️ Delete</button>
          )}
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={onSave}>💾 Save Appointment</button>
        </div>
      </div>
    </div>
  );
}
