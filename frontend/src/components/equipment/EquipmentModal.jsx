export default function EquipmentModal({ item, onFieldChange, onSave, onClose, busyId }) {
  const ef = (key, value) => onFieldChange(key, value);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>{item.id ? `EDIT EQUIPMENT — ${item.name}` : "ADD NEW EQUIPMENT"}</h3>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          {/* Name & Code */}
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Equipment Name *</label>
              <input value={item.name || ""} onChange={(e) => ef("name", e.target.value)} placeholder="e.g. Dry Van 53ft" />
            </div>
            <div className="form-group">
              <label className="form-label">Code</label>
              <input value={item.code || ""} onChange={(e) => ef("code", e.target.value)} placeholder="e.g. DV53" maxLength={10} />
            </div>
          </div>

          {/* Description & Status */}
          <div className="form-row">
            <div className="form-group" style={{ flex: 2 }}>
              <label className="form-label">Description</label>
              <input value={item.description || ""} onChange={(e) => ef("description", e.target.value)} placeholder="Brief description" />
            </div>
            <div className="form-group">
              <label className="form-label">Status</label>
              <select value={item.status || "Active"} onChange={(e) => ef("status", e.target.value)}>
                <option value="Active">ACTIVE</option>
                <option value="Inactive">INACTIVE</option>
              </select>
            </div>
          </div>

          {/* Capacity */}
          <div style={{ marginTop: 16, marginBottom: 8, fontWeight: 700, fontSize: 11, color: "var(--text3)", letterSpacing: 1 }}>CAPACITY</div>
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Max Weight (lbs)</label>
              <input type="number" value={item.max_weight || ""} onChange={(e) => ef("max_weight", e.target.value)} placeholder="45000" />
            </div>
            <div className="form-group">
              <label className="form-label">Max Volume (cu ft)</label>
              <input type="number" value={item.max_volume || ""} onChange={(e) => ef("max_volume", e.target.value)} placeholder="3800" />
            </div>
          </div>

          {/* Dimensions */}
          <div style={{ marginTop: 16, marginBottom: 8, fontWeight: 700, fontSize: 11, color: "var(--text3)", letterSpacing: 1 }}>DIMENSIONS (ft)</div>
          <div className="form-row-3">
            <div className="form-group">
              <label className="form-label">Length</label>
              <input type="number" value={item.length || ""} onChange={(e) => ef("length", e.target.value)} placeholder="53" />
            </div>
            <div className="form-group">
              <label className="form-label">Width</label>
              <input type="number" value={item.width || ""} onChange={(e) => ef("width", e.target.value)} placeholder="8.5" />
            </div>
            <div className="form-group">
              <label className="form-label">Height</label>
              <input type="number" value={item.height || ""} onChange={(e) => ef("height", e.target.value)} placeholder="9" />
            </div>
          </div>

          {/* Flags */}
          <div style={{ marginTop: 16, marginBottom: 8, fontWeight: 700, fontSize: 11, color: "var(--text3)", letterSpacing: 1 }}>FLAGS</div>
          <div className="flex gap-3">
            <label className="flex items-center gap-2" style={{
              padding: "10px 16px", borderRadius: 10, cursor: "pointer",
              background: item.temp_controlled ? "rgba(59,130,246,0.08)" : "var(--bg2)",
              border: `1px solid ${item.temp_controlled ? "rgba(59,130,246,0.3)" : "var(--border)"}`,
            }}>
              <input type="checkbox" checked={!!item.temp_controlled} onChange={(e) => ef("temp_controlled", e.target.checked)} />
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, color: item.temp_controlled ? "#3b82f6" : "var(--text)" }}>TEMP CONTROLLED</div>
                <div style={{ fontSize: 10, color: "var(--text3)" }}>Refrigerated / temperature-sensitive</div>
              </div>
            </label>
            <label className="flex items-center gap-2" style={{
              padding: "10px 16px", borderRadius: 10, cursor: "pointer",
              background: item.hazmat_certified ? "rgba(245,158,11,0.08)" : "var(--bg2)",
              border: `1px solid ${item.hazmat_certified ? "rgba(245,158,11,0.3)" : "var(--border)"}`,
            }}>
              <input type="checkbox" checked={!!item.hazmat_certified} onChange={(e) => ef("hazmat_certified", e.target.checked)} />
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, color: item.hazmat_certified ? "#f59e0b" : "var(--text)" }}>HAZMAT CERTIFIED</div>
                <div style={{ fontSize: 10, color: "var(--text3)" }}>Approved for hazardous materials</div>
              </div>
            </label>
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-green" onClick={onSave} disabled={busyId === "saving"}>
            {busyId === "saving" ? "Saving..." : "Save Equipment"}
          </button>
        </div>
      </div>
    </div>
  );
}
