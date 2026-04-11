import { useState } from "react";
import { emptyCustomerInvite, VISIBILITY_LEVELS } from "../../types/customerPortal";

/** Modal for inviting a new customer to the portal */
export default function InviteCustomerModal({ onClose, onSubmit }) {
  const [form, setForm] = useState(emptyCustomerInvite());

  function handleChange(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  function handleSubmit(e) {
    e.preventDefault();
    if (!form.name.trim() || !form.email.trim()) return;
    onSubmit(form);
  }

  return (
    <div className="modal-overlay open" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title">📧 Invite Customer</div>
          <button className="modal-close" onClick={onClose}>&times;</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            <div className="form-grid">
              <div className="form-group">
                <label>Customer Name</label>
                <input
                  value={form.name}
                  onChange={(e) => handleChange("name", e.target.value)}
                  placeholder="Company name"
                  required
                />
              </div>
              <div className="form-group">
                <label>Contact Email</label>
                <input
                  type="email"
                  value={form.email}
                  onChange={(e) => handleChange("email", e.target.value)}
                  placeholder="contact@company.com"
                  required
                />
              </div>
              <div className="form-group">
                <label>Company</label>
                <input
                  value={form.company}
                  onChange={(e) => handleChange("company", e.target.value)}
                  placeholder="Legal entity name"
                />
              </div>
              <div className="form-group">
                <label>Visibility Level</label>
                <select
                  value={form.visibility}
                  onChange={(e) => handleChange("visibility", e.target.value)}
                >
                  {Object.values(VISIBILITY_LEVELS).map((level) => (
                    <option key={level} value={level}>{level}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary">
              📧 Send Invite
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
