import { useState } from "react";
import { emptyRfq } from "../../types/carrierBids";

export default function CreateRfqModal({ onSave, onClose }) {
  const [form, setForm] = useState(emptyRfq());

  function handleChange(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  function handleSubmit(e) {
    e.preventDefault();
    if (!form.lane || !form.volume || !form.deadline) return;
    onSave({ ...form, volume: Number(form.volume) });
  }

  return (
    <div className="modal-overlay open">
      <div className="modal" style={{ width: 520 }}>
        <div className="modal-header">
          <span className="modal-title">Create New RFQ</span>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            <div className="form-grid">
              <div className="form-group full">
                <label>Lane (Origin → Destination)</label>
                <input
                  type="text"
                  placeholder="e.g. Chicago, IL → Dallas, TX"
                  value={form.lane}
                  onChange={(e) => handleChange("lane", e.target.value)}
                  required
                />
              </div>
              <div className="form-group">
                <label>Volume (loads/month)</label>
                <input
                  type="number"
                  min="1"
                  placeholder="e.g. 12"
                  value={form.volume}
                  onChange={(e) => handleChange("volume", e.target.value)}
                  required
                />
              </div>
              <div className="form-group">
                <label>Bid Deadline</label>
                <input
                  type="date"
                  value={form.deadline}
                  onChange={(e) => handleChange("deadline", e.target.value)}
                  required
                />
              </div>
            </div>
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary">
              Create RFQ
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
