import { useState, useEffect } from "react";
import { VEHICLE_TYPES, VEHICLE_STATUSES, emptyVehicle } from "../../types/fleet";

export default function VehicleModal({ isOpen, vehicle, onClose, onSave }) {
  const [form, setForm] = useState(emptyVehicle());
  const isEdit = !!vehicle;

  useEffect(() => {
    if (vehicle) setForm({ ...emptyVehicle(), ...vehicle });
    else setForm(emptyVehicle());
  }, [vehicle, isOpen]);

  function handleChange(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  function handleSubmit() {
    if (!form.unit.trim()) return;
    onSave({
      ...form,
      unit: form.unit.trim(),
      milesYTD: parseInt(form.milesYTD) || 0,
      driver: isEdit ? vehicle.driver : "Unassigned",
      dest: isEdit ? vehicle.dest : "\u2014",
    });
  }

  if (!isOpen) return null;

  return (
    <div className="modal-overlay open">
      <div className="modal" style={{ width: 500 }}>
        <div className="modal-header" style={{ background: "linear-gradient(135deg,#1e3a5f,#0e7490)" }}>
          <div>
            <span className="modal-title" style={{ color: "#fff" }}>
              {isEdit ? `Edit Vehicle \u2014 ${vehicle.unit}` : "Add Vehicle"}
            </span>
          </div>
          <button className="modal-close" onClick={onClose} style={{ color: "rgba(255,255,255,.7)", fontSize: 22 }}>
            \u2715
          </button>
        </div>

        <div className="modal-body" style={{ padding: 22, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          <FormField label="Unit # *" value={form.unit} onChange={(v) => handleChange("unit", v)} placeholder="TRK-111" mono />
          <FormField label="Type" type="select" value={form.type} onChange={(v) => handleChange("type", v)} options={VEHICLE_TYPES} />
          <FormField label="Current Location" value={form.location} onChange={(v) => handleChange("location", v)} placeholder="City, ST" />
          <FormField label="Next PM Date" type="date" value={form.nextPM} onChange={(v) => handleChange("nextPM", v)} />
          <FormField label="Miles YTD" type="number" value={form.milesYTD} onChange={(v) => handleChange("milesYTD", v)} placeholder="0" />
          <FormField label="Status" type="select" value={form.status} onChange={(v) => handleChange("status", v)} options={VEHICLE_STATUSES} />
        </div>

        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSubmit}>💾 Save Vehicle</button>
        </div>
      </div>
    </div>
  );
}

function FormField({ label, value, onChange, type = "text", placeholder, options, mono }) {
  const inputStyle = {
    width: "100%", padding: "8px 10px",
    border: "1.5px solid var(--border)", borderRadius: 8,
    fontSize: 13, fontFamily: mono ? "monospace" : "inherit",
    boxSizing: "border-box",
  };

  return (
    <div>
      <label style={{ fontSize: 11, fontWeight: 700, color: "var(--text3)", display: "block", marginBottom: 4 }}>
        {label}
      </label>
      {type === "select" ? (
        <select style={{ ...inputStyle, background: "#fff" }} value={value} onChange={(e) => onChange(e.target.value)}>
          {options.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
        </select>
      ) : (
        <input
          type={type}
          style={inputStyle}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
        />
      )}
    </div>
  );
}
