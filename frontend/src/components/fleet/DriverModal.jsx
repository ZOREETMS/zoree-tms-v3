import { useState, useEffect } from "react";
import { DRIVER_STATUSES, CDL_CLASSES, ENDORSEMENTS, emptyDriver } from "../../types/fleet";

export default function DriverModal({ isOpen, driver, vehicles, onClose, onSave, onDelete }) {
  const [form, setForm] = useState(emptyDriver());
  const isEdit = !!driver;

  useEffect(() => {
    if (driver) setForm({ ...emptyDriver(), ...driver });
    else setForm(emptyDriver());
  }, [driver, isOpen]);

  function handleChange(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  function toggleEndorsement(endorsement) {
    setForm((prev) => {
      const has = prev.endorsements.includes(endorsement);
      return {
        ...prev,
        endorsements: has
          ? prev.endorsements.filter((e) => e !== endorsement)
          : [...prev.endorsements, endorsement],
      };
    });
  }

  function handleSubmit() {
    if (!form.name.trim() || !form.cdl.trim()) return;
    onSave(form);
  }

  if (!isOpen) return null;

  const inputStyle = {
    width: "100%", padding: "8px 10px",
    border: "1.5px solid var(--border)", borderRadius: 8,
    fontSize: 13, fontFamily: "inherit", boxSizing: "border-box",
  };

  const labelStyle = {
    fontSize: 11, fontWeight: 700, color: "var(--text3)",
    display: "block", marginBottom: 4,
  };

  const sectionLabel = {
    fontSize: 11, fontWeight: 700, color: "var(--text3)",
    textTransform: "uppercase", letterSpacing: ".8px", marginBottom: 10,
  };

  return (
    <div className="modal-overlay open">
      <div className="modal" style={{ width: 660 }}>
        <div className="modal-header" style={{ background: "linear-gradient(135deg,#1e3a5f,#0e7490)" }}>
          <div>
            <div style={{ fontSize: 11, color: "rgba(255,255,255,.6)", textTransform: "uppercase", letterSpacing: "1px", marginBottom: 3 }}>
              Driver Management
            </div>
            <span className="modal-title" style={{ color: "#fff" }}>
              {isEdit ? `Edit Driver \u2014 ${driver.name}` : "Add Driver"}
            </span>
          </div>
          <button className="modal-close" onClick={onClose} style={{ color: "rgba(255,255,255,.7)", fontSize: 22 }}>
            \u2715
          </button>
        </div>

        <div className="modal-body" style={{ padding: 22 }}>
          {/* Identity Section */}
          <div style={sectionLabel}>👤 Identity</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 18 }}>
            <div>
              <label style={labelStyle}>Full Name *</label>
              <input style={inputStyle} value={form.name} onChange={(e) => handleChange("name", e.target.value)} placeholder="e.g. James Wilson" />
            </div>
            <div>
              <label style={labelStyle}>Phone</label>
              <input style={inputStyle} value={form.phone} onChange={(e) => handleChange("phone", e.target.value)} placeholder="(312) 555-0100" />
            </div>
            <div>
              <label style={labelStyle}>Email</label>
              <input style={inputStyle} type="email" value={form.email} onChange={(e) => handleChange("email", e.target.value)} placeholder="driver@company.com" />
            </div>
            <div>
              <label style={labelStyle}>Hire Date</label>
              <input style={inputStyle} type="date" value={form.hireDate} onChange={(e) => handleChange("hireDate", e.target.value)} />
            </div>
          </div>

          {/* CDL Section */}
          <div style={sectionLabel}>📋 CDL & Licensing</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 16 }}>
            <div>
              <label style={labelStyle}>CDL Number *</label>
              <input style={{ ...inputStyle, fontFamily: "monospace" }} value={form.cdl} onChange={(e) => handleChange("cdl", e.target.value)} placeholder="CDL-IL-1234567" />
            </div>
            <div>
              <label style={labelStyle}>CDL Class</label>
              <select style={{ ...inputStyle, background: "#fff" }} value={form.cdlClass} onChange={(e) => handleChange("cdlClass", e.target.value)}>
                {CDL_CLASSES.map((c) => <option key={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>CDL Expiry</label>
              <input style={inputStyle} type="date" value={form.cdlExp} onChange={(e) => handleChange("cdlExp", e.target.value)} />
            </div>
          </div>

          {/* Endorsements */}
          <div style={{ marginBottom: 18 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text3)", marginBottom: 8 }}>Endorsements</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {ENDORSEMENTS.map((e) => (
                <label
                  key={e}
                  style={{
                    display: "flex", alignItems: "center", gap: 6,
                    padding: "6px 12px", background: "#f8faff", borderRadius: 8,
                    border: "1px solid var(--border)", fontSize: 12, cursor: "pointer",
                  }}
                >
                  <input
                    type="checkbox"
                    style={{ accentColor: "var(--accent)" }}
                    checked={form.endorsements.includes(e)}
                    onChange={() => toggleEndorsement(e)}
                  />
                  {e}
                </label>
              ))}
            </div>
          </div>

          {/* Assignment Section */}
          <div style={sectionLabel}>🚛 Assignment & Status</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 16 }}>
            <div>
              <label style={labelStyle}>Assigned Vehicle</label>
              <select style={{ ...inputStyle, background: "#fff" }} value={form.vehicle} onChange={(e) => handleChange("vehicle", e.target.value)}>
                <option value="">{"\u2014 Unassigned \u2014"}</option>
                {vehicles.map((v) => (
                  <option key={v.unit} value={v.unit}>
                    {v.unit} · {v.type} · {v.status}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Status</label>
              <select style={{ ...inputStyle, background: "#fff" }} value={form.status} onChange={(e) => handleChange("status", e.target.value)}>
                {DRIVER_STATUSES.map((s) => <option key={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>HOS Hours Today</label>
              <input style={inputStyle} type="number" min="0" max="11" step="0.1" value={form.hosToday} onChange={(e) => handleChange("hosToday", parseFloat(e.target.value) || 0)} />
            </div>
            <div>
              <label style={labelStyle}>Current Location</label>
              <input style={inputStyle} value={form.location} onChange={(e) => handleChange("location", e.target.value)} placeholder="City, ST" />
            </div>
            <div>
              <label style={labelStyle}>Home Terminal</label>
              <input style={inputStyle} value={form.homeTerm} onChange={(e) => handleChange("homeTerm", e.target.value)} placeholder="City, ST" />
            </div>
          </div>

          {/* Notes */}
          <div>
            <label style={{ ...labelStyle, textTransform: "uppercase", letterSpacing: ".8px" }}>Notes</label>
            <textarea
              rows={2}
              style={{ ...inputStyle, resize: "vertical" }}
              value={form.notes}
              onChange={(e) => handleChange("notes", e.target.value)}
              placeholder="Preferences, restrictions, certifications\u2026"
            />
          </div>
        </div>

        <div className="modal-footer" style={{ justifyContent: "space-between" }}>
          {isEdit && (
            <button
              onClick={onDelete}
              style={{
                background: "rgba(239,68,68,.08)", color: "var(--red)",
                border: "1px solid rgba(239,68,68,.25)", padding: "8px 16px",
                borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
              }}
            >
              🗑 Remove Driver
            </button>
          )}
          <div style={{ display: "flex", gap: 8, marginLeft: "auto" }}>
            <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
            <button className="btn btn-primary" onClick={handleSubmit}>💾 Save Driver</button>
          </div>
        </div>
      </div>
    </div>
  );
}
