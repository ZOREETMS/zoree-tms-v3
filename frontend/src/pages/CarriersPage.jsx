import { useMemo, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { saveCarrierRecord, deleteCarrierRecord } from "../services/carriersService";
import { useRowSelection } from "../hooks/useRowSelection";
import SelectionBar from "../components/ui/SelectionBar";
import { SelectionHeaderCheckbox, SelectionRowCheckbox } from "../components/ui/SelectionCheckbox";

export default function CarriersPage() {
  const { carriers, setData, refreshData } = useOutletContext();
  const [q, setQ] = useState("");
  const [busyId, setBusyId] = useState("");
  const [message, setMessage] = useState({ text: "", type: "" });
  const [editCarrier, setEditCarrier] = useState(null);
  const [sortCol, setSortCol] = useState("name");
  const [sortAsc, setSortAsc] = useState(true);
  const sel = useRowSelection({ getKey: (c) => c.id });

  function toast(text, type = "info") {
    setMessage({ text, type });
    setTimeout(() => setMessage({ text: "", type: "" }), 4000);
  }

  const rows = useMemo(() => {
    let list = [...carriers];
    if (q.trim()) {
      const t = q.toLowerCase();
      list = list.filter((c) =>
        [c.name, c.scac, c.mode, c.email, c.phone, c.contact]
          .some((v) => String(v || "").toLowerCase().includes(t))
      );
    }
    return list.sort((a, b) => {
      const av = String(a[sortCol] || "").toLowerCase();
      const bv = String(b[sortCol] || "").toLowerCase();
      return sortAsc ? av.localeCompare(bv) : bv.localeCompare(av);
    });
  }, [carriers, q, sortCol, sortAsc]);

  function toggleSort(col) {
    if (sortCol === col) setSortAsc(!sortAsc);
    else { setSortCol(col); setSortAsc(true); }
  }

  function openEdit(carrier) { setEditCarrier({ ...carrier }); }
  function openNew() {
    setEditCarrier({
      id: "", name: "", scac: "", mode: "TL", status: "Active",
      on_time_pct: 95, claim_ratio: 0.5, cost_per_mile: 0,
      contact: "", phone: "", email: "",
      czarlite_enabled: false, carrierconnect_enabled: false, pcmiler_enabled: false,
      eia_fsc_enabled: false,
    });
  }

  async function saveCarrier() {
    if (!editCarrier) return;
    if (!editCarrier.name || !editCarrier.scac) { toast("Name and SCAC required", "warning"); return; }
    setBusyId("saving");
    try {
      await saveCarrierRecord(editCarrier);
      toast(`Carrier ${(editCarrier.name || "").toUpperCase()} saved`, "success");
      setEditCarrier(null);
      await refreshData();
    } catch (err) { toast(`Failed: ${err.message}`, "error"); }
    finally { setBusyId(""); }
  }

  async function deleteCarrier(c) {
    if (!window.confirm(`Permanently delete carrier ${c.name}? This cannot be undone.`)) return;
    setBusyId(c.id);
    try {
      await deleteCarrierRecord(c.id);
      toast(`${c.name} deleted`, "success");
      await refreshData();
    } catch (err) { toast(`Failed: ${err.message}`, "error"); }
    finally { setBusyId(""); }
  }

  function editField(key, value) { setEditCarrier((p) => ({ ...p, [key]: value })); }

  const SortIcon = ({ col }) => (
    <span style={{ opacity: sortCol === col ? 1 : 0.3, marginLeft: 4 }}>
      {sortCol === col ? (sortAsc ? "▲" : "▼") : "⇅"}
    </span>
  );

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <div>
          <h2>Carrier Management</h2>
          <div className="page-subtitle">Performance, contracts, and capacity planning</div>
        </div>
        <button className="btn btn-primary" onClick={openNew}>+ Add Carrier</button>
      </div>

      <div className="search-bar">
        <input placeholder="🔍 Search carriers..." value={q} onChange={(e) => setQ(e.target.value)} className="search" />
      </div>

      {message.text && <div className={`toast toast-${message.type}`} style={{ marginBottom: 12 }}>{message.text}</div>}

      <SelectionBar count={sel.size} entityLabel="Carrier" onClear={sel.clear} />

      <table className="grid">
        <thead>
          <tr>
            <th style={{ width: 36, textAlign: "center" }}><SelectionHeaderCheckbox sel={sel} rows={rows} /></th>
            <th onClick={() => toggleSort("name")}>Carrier <SortIcon col="name" /></th>
            <th>SCAC</th>
            <th>Mode</th>
            <th>OTD %</th>
            <th>Claim Rate</th>
            <th>Status</th>
            <th style={{ textAlign: "center" }}>CzarLite</th>
            <th style={{ textAlign: "center" }}>CC XL</th>
            <th style={{ textAlign: "center" }}>PC*MILER</th>
            <th style={{ textAlign: "center" }}>EIA FSC</th>
            <th>Contact</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr><td colSpan={13} className="empty-state">No carriers found</td></tr>
          ) : rows.map((c) => (
            <tr key={c.id}>
              <td style={{ textAlign: "center" }}><SelectionRowCheckbox sel={sel} rowKey={c.id} /></td>
              <td className="fw-700">{c.name || "—"}</td>
              <td><span className="badge badge-blue" style={{ fontSize: 10, fontFamily: "monospace" }}>{c.scac || "—"}</span></td>
              <td>{c.mode || "—"}</td>
              <td className="mono">{c.on_time_pct || "—"}%</td>
              <td className="mono" style={{ color: parseFloat(c.claim_ratio) > 1 ? "var(--red)" : "var(--green)" }}>{c.claim_ratio || "—"}%</td>
              <td><span className={`badge ${c.status === "Active" ? "badge-green" : "badge-red"}`}>{c.status || "—"}</span></td>
              <td style={{ textAlign: "center" }}>{c.czarlite_enabled ? "✅" : "☐"}</td>
              <td style={{ textAlign: "center" }}>{c.carrierconnect_enabled ? "✅" : "☐"}</td>
              <td style={{ textAlign: "center" }}>{c.pcmiler_enabled ? "✅" : "☐"}</td>
              <td style={{ textAlign: "center" }}>{c.eia_fsc_enabled ? "✅" : "☐"}</td>
              <td className="text-xs text-muted">{c.contact || c.email || "—"}</td>
              <td style={{ whiteSpace: "nowrap" }}>
                <button className="btn btn-sm" onClick={() => openEdit(c)}>✏️ Edit</button>{" "}
                <button className="btn btn-sm btn-red" onClick={() => deleteCarrier(c)} disabled={busyId === c.id}>🗑️</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="text-sm text-muted mt-2">{rows.length} carriers</div>

      {/* Edit/Create Modal */}
      {editCarrier && (
        <div className="modal-overlay" onClick={() => setEditCarrier(null)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{editCarrier.id ? `EDIT CARRIER — ${editCarrier.name}` : "ADD NEW CARRIER"}</h3>
              <button className="modal-close" onClick={() => setEditCarrier(null)}>✕</button>
            </div>
            <div className="modal-body">
              <div className="form-row">
                <div className="form-group"><label className="form-label">Carrier Name *</label>
                  <input value={editCarrier.name || ""} onChange={(e) => editField("name", e.target.value)} /></div>
                <div className="form-group"><label className="form-label">SCAC Code *</label>
                  <input value={editCarrier.scac || ""} onChange={(e) => editField("scac", e.target.value)} maxLength={4} /></div>
              </div>
              <div className="form-row">
                <div className="form-group"><label className="form-label">Mode</label>
                  <select value={editCarrier.mode || "TL"} onChange={(e) => editField("mode", e.target.value)}>
                    <option value="TL">TL</option><option value="LTL">LTL</option><option value="BOTH">BOTH</option>
                  </select></div>
                <div className="form-group"><label className="form-label">Status</label>
                  <select value={editCarrier.status || "Active"} onChange={(e) => editField("status", e.target.value)}>
                    <option value="Active">ACTIVE</option><option value="Inactive">INACTIVE</option>
                  </select></div>
              </div>
              <div className="form-row-3">
                <div className="form-group"><label className="form-label">OTD %</label>
                  <input type="number" value={editCarrier.on_time_pct || ""} onChange={(e) => editField("on_time_pct", e.target.value)} /></div>
                <div className="form-group"><label className="form-label">Claim Rate %</label>
                  <input type="number" value={editCarrier.claim_ratio || ""} onChange={(e) => editField("claim_ratio", e.target.value)} /></div>
                <div className="form-group"><label className="form-label">Avg Cost/Mi ($)</label>
                  <input type="number" value={editCarrier.cost_per_mile || ""} onChange={(e) => editField("cost_per_mile", e.target.value)} /></div>
              </div>

              {/* REQ-06: invoice tolerance config */}
              <div style={{ marginTop: 16, marginBottom: 8, fontWeight: 700, fontSize: 11, color: "var(--text3)", letterSpacing: 1 }}>INVOICE AUDIT TOLERANCE</div>
              <div style={{ fontSize: 11, color: "var(--text3)", marginBottom: 6 }}>
                Invoices from this carrier are auto-approved when the variance vs agreed shipment cost is within <strong>either</strong> the %-limit or the $-limit. Leave blank to fall back to the system default (5% / $100).
              </div>
              <div className="form-row-3">
                <div className="form-group"><label className="form-label">Tolerance (%)</label>
                  <input type="number" step="0.1" placeholder="default 5.0" value={editCarrier.invoice_tolerance_pct ?? ""} onChange={(e) => editField("invoice_tolerance_pct", e.target.value)} /></div>
                <div className="form-group"><label className="form-label">Tolerance ($)</label>
                  <input type="number" step="1" placeholder="default 100" value={editCarrier.invoice_tolerance_abs_usd ?? ""} onChange={(e) => editField("invoice_tolerance_abs_usd", e.target.value)} /></div>
                <div className="form-group"><label className="form-label">&nbsp;</label>
                  <div style={{ fontSize: 10, color: "var(--text3)", fontStyle: "italic" }}>Preview: an invoice within either bound auto-approves + sends to AP.</div>
                </div>
              </div>

              <div style={{ marginTop: 16, marginBottom: 8, fontWeight: 700, fontSize: 11, color: "var(--text3)", letterSpacing: 1 }}>CONTACT INFO</div>
              <div className="form-row-3">
                <div className="form-group"><label className="form-label">Contact Name</label>
                  <input value={editCarrier.contact || ""} onChange={(e) => editField("contact", e.target.value)} /></div>
                <div className="form-group"><label className="form-label">Phone</label>
                  <input value={editCarrier.phone || ""} onChange={(e) => editField("phone", e.target.value)} /></div>
                <div className="form-group"><label className="form-label">Email</label>
                  <input type="email" value={editCarrier.email || ""} onChange={(e) => editField("email", e.target.value)} style={{ textTransform: "none" }} /></div>
              </div>

              <div style={{ marginTop: 16, marginBottom: 8, fontWeight: 700, fontSize: 11, color: "var(--text3)", letterSpacing: 1 }}>SMC³ INTEGRATION</div>
              <div className="flex gap-3">
                <label className="flex items-center gap-2" style={{
                  padding: "10px 16px", borderRadius: 10, cursor: "pointer",
                  background: editCarrier.czarlite_enabled ? "rgba(99,102,241,0.08)" : "var(--bg2)",
                  border: `1px solid ${editCarrier.czarlite_enabled ? "rgba(99,102,241,0.3)" : "var(--border)"}`,
                }}>
                  <input type="checkbox" checked={!!editCarrier.czarlite_enabled} onChange={(e) => editField("czarlite_enabled", e.target.checked)} />
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: editCarrier.czarlite_enabled ? "#6366f1" : "var(--text)" }}>🏷️ CZARLITE ENABLED</div>
                    <div style={{ fontSize: 10, color: "var(--text3)" }}>Use SMC³ RateWare® XL for LTL rating</div>
                  </div>
                </label>
                <label className="flex items-center gap-2" style={{
                  padding: "10px 16px", borderRadius: 10, cursor: "pointer",
                  background: editCarrier.carrierconnect_enabled ? "rgba(16,185,129,0.08)" : "var(--bg2)",
                  border: `1px solid ${editCarrier.carrierconnect_enabled ? "rgba(16,185,129,0.3)" : "var(--border)"}`,
                }}>
                  <input type="checkbox" checked={!!editCarrier.carrierconnect_enabled} onChange={(e) => editField("carrierconnect_enabled", e.target.checked)} />
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: editCarrier.carrierconnect_enabled ? "#059669" : "var(--text)" }}>📡 CARRIERCONNECT® XL</div>
                    <div style={{ fontSize: 10, color: "var(--text3)" }}>Fetch live transit days via SMC³</div>
                  </div>
                </label>
                <label className="flex items-center gap-2" style={{
                  padding: "10px 16px", borderRadius: 10, cursor: "pointer",
                  background: editCarrier.pcmiler_enabled ? "rgba(168,85,247,0.08)" : "var(--bg2)",
                  border: `1px solid ${editCarrier.pcmiler_enabled ? "rgba(168,85,247,0.3)" : "var(--border)"}`,
                }}>
                  <input type="checkbox" checked={!!editCarrier.pcmiler_enabled} onChange={(e) => editField("pcmiler_enabled", e.target.checked)} />
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: editCarrier.pcmiler_enabled ? "#a855f7" : "var(--text)" }}>🗺️ PC*MILER ENABLED</div>
                    <div style={{ fontSize: 10, color: "var(--text3)" }}>Use PC*MILER distance API for mileage during rating</div>
                  </div>
                </label>
              </div>

              {/* Migration 045: EIA-indexed fuel surcharge opt-in */}
              <div style={{ marginTop: 16, marginBottom: 8, fontWeight: 700, fontSize: 11, color: "var(--text3)", letterSpacing: 1 }}>FUEL SURCHARGE</div>
              <div className="flex gap-3">
                <label className="flex items-center gap-2" style={{
                  padding: "10px 16px", borderRadius: 10, cursor: "pointer",
                  background: editCarrier.eia_fsc_enabled ? "rgba(245,158,11,0.08)" : "var(--bg2)",
                  border: `1px solid ${editCarrier.eia_fsc_enabled ? "rgba(245,158,11,0.3)" : "var(--border)"}`,
                }}>
                  <input type="checkbox" checked={!!editCarrier.eia_fsc_enabled} onChange={(e) => editField("eia_fsc_enabled", e.target.checked)} />
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: editCarrier.eia_fsc_enabled ? "#d97706" : "var(--text)" }}>⛽ EIA FUEL SURCHARGE</div>
                    <div style={{ fontSize: 10, color: "var(--text3)" }}>Calculate FSC from the EIA diesel index using this carrier's uploaded schedule (Fuel Surcharge page) instead of the static rate FSC %</div>
                  </div>
                </label>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={() => setEditCarrier(null)}>Cancel</button>
              <button className="btn btn-green" onClick={saveCarrier} disabled={busyId === "saving"}>
                {busyId === "saving" ? "Saving..." : "💾 Save Carrier"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
