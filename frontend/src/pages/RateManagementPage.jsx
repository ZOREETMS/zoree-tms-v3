import { useMemo, useState } from "react";
import { useOutletContext } from "react-router-dom";

const STATUS_BADGES = {
  Active: "badge badge-green",
  Expired: "badge badge-red",
  Pending: "badge badge-amber",
  "Expiring Soon": "badge badge-amber",
};

const MODE_BADGES = {
  LTL: "badge badge-blue",
  TL: "badge badge-green",
  FTL: "badge badge-teal",
  Intermodal: "badge badge-purple",
};

/* ---------- Mock rate data (used when rates not in context) ---------- */
const MOCK_RATES = [
  { id: "RATE-001", lane: "CHI-DAL", origin: "Chicago, IL", dest: "Dallas, TX", carrier: "XPO Logistics", mode: "LTL", rate: 1250, unit: "CWT", fsc: 18.5, discount_pct: 12, discount_amt: 150, transit_days: 3, effective: "2025-01-01", expires: "2025-12-31", status: "Active", czarlite: true },
  { id: "RATE-002", lane: "ATL-MIA", origin: "Atlanta, GA", dest: "Miami, FL", carrier: "Estes Express", mode: "LTL", rate: 875, unit: "CWT", fsc: 16.0, discount_pct: 8, discount_amt: 70, transit_days: 2, effective: "2025-02-01", expires: "2025-11-30", status: "Active", czarlite: false },
  { id: "RATE-003", lane: "LAX-SEA", origin: "Los Angeles, CA", dest: "Seattle, WA", carrier: "Old Dominion", mode: "LTL", rate: 1580, unit: "CWT", fsc: 20.0, discount_pct: 15, discount_amt: 237, transit_days: 4, effective: "2025-03-01", expires: "2026-02-28", status: "Active", czarlite: true },
  { id: "RATE-004", lane: "NYC-BOS", origin: "New York, NY", dest: "Boston, MA", carrier: "Saia Inc", mode: "LTL", rate: 650, unit: "CWT", fsc: 14.5, discount_pct: 5, discount_amt: 32.5, transit_days: 1, effective: "2024-06-01", expires: "2025-05-31", status: "Expiring Soon", czarlite: false },
  { id: "RATE-005", lane: "DAL-HOU", origin: "Dallas, TX", dest: "Houston, TX", carrier: "FedEx Freight", mode: "LTL", rate: 420, unit: "CWT", fsc: 12.0, discount_pct: 10, discount_amt: 42, transit_days: 1, effective: "2024-01-01", expires: "2024-12-31", status: "Expired", czarlite: false },
  { id: "RATE-006", lane: "CHI-ATL", origin: "Chicago, IL", dest: "Atlanta, GA", carrier: "XPO Logistics", mode: "TL", rate: 3200, unit: "Flat", fsc: 22.0, discount_pct: 0, discount_amt: 0, transit_days: 2, effective: "2025-04-01", expires: "2026-03-31", status: "Active", czarlite: true },
  { id: "RATE-007", lane: "DEN-PHX", origin: "Denver, CO", dest: "Phoenix, AZ", carrier: "Werner Enterprises", mode: "TL", rate: 2800, unit: "Flat", fsc: 19.5, discount_pct: 7, discount_amt: 196, transit_days: 2, effective: "2025-01-15", expires: "2026-01-14", status: "Active", czarlite: false },
  { id: "RATE-008", lane: "SEA-PDX", origin: "Seattle, WA", dest: "Portland, OR", carrier: "ABF Freight", mode: "LTL", rate: 380, unit: "CWT", fsc: 11.0, discount_pct: 6, discount_amt: 22.8, transit_days: 1, effective: "2025-05-01", expires: "2026-04-30", status: "Active", czarlite: true },
  { id: "RATE-009", lane: "MEM-STL", origin: "Memphis, TN", dest: "St. Louis, MO", carrier: "Estes Express", mode: "Intermodal", rate: 1100, unit: "Container", fsc: 15.0, discount_pct: 10, discount_amt: 110, transit_days: 3, effective: "2025-02-15", expires: "2026-02-14", status: "Active", czarlite: false },
  { id: "RATE-010", lane: "LAX-LVS", origin: "Los Angeles, CA", dest: "Las Vegas, NV", carrier: "FedEx Freight", mode: "LTL", rate: 520, unit: "CWT", fsc: 13.0, discount_pct: 9, discount_amt: 46.8, transit_days: 1, effective: "2025-06-01", expires: "2026-05-31", status: "Pending", czarlite: true },
];

export default function RateManagementPage() {
  const { carriers } = useOutletContext();

  // State
  const [q, setQ] = useState("");
  const [carrierFilter, setCarrierFilter] = useState("All");
  const [modeFilter, setModeFilter] = useState("All");
  const [statusFilter, setStatusFilter] = useState("All");
  const [originFilter, setOriginFilter] = useState("");
  const [destFilter, setDestFilter] = useState("");
  const [effFrom, setEffFrom] = useState("");
  const [effTo, setEffTo] = useState("");
  const [expFrom, setExpFrom] = useState("");
  const [expTo, setExpTo] = useState("");
  const [czarliteOnly, setCzarliteOnly] = useState(false);
  const [sortCol, setSortCol] = useState("id");
  const [sortAsc, setSortAsc] = useState(false);
  const [message, setMessage] = useState({ text: "", type: "" });

  const rates = MOCK_RATES;

  function toast(text, type = "info") {
    setMessage({ text, type });
    setTimeout(() => setMessage({ text: "", type: "" }), 4000);
  }

  // Unique carrier names from rates + carriers context
  const carrierNames = useMemo(() => {
    const names = new Set();
    rates.forEach((r) => { if (r.carrier) names.add(r.carrier); });
    carriers.forEach((c) => { if (c?.name) names.add(c.name); });
    return [...names].sort();
  }, [rates, carriers]);

  // Stats
  const stats = useMemo(() => {
    const now = new Date().toISOString().slice(0, 10);
    const thirtyDays = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
    return {
      total: rates.length,
      active: rates.filter((r) => r.status === "Active").length,
      expiringSoon: rates.filter((r) => r.status === "Expiring Soon" || (r.status === "Active" && r.expires >= now && r.expires <= thirtyDays)).length,
      expired: rates.filter((r) => r.status === "Expired" || r.expires < now).length,
      czarlite: rates.filter((r) => r.czarlite).length,
    };
  }, [rates]);

  // Filtered + sorted rows
  const rows = useMemo(() => {
    let filtered = rates;

    if (czarliteOnly) {
      filtered = filtered.filter((r) => r.czarlite);
    }
    if (carrierFilter !== "All") {
      filtered = filtered.filter((r) => r.carrier === carrierFilter);
    }
    if (modeFilter !== "All") {
      filtered = filtered.filter((r) => r.mode === modeFilter);
    }
    if (statusFilter !== "All") {
      filtered = filtered.filter((r) => r.status === statusFilter);
    }
    if (originFilter.trim()) {
      const t = originFilter.toLowerCase().trim();
      filtered = filtered.filter((r) => (r.origin || "").toLowerCase().includes(t));
    }
    if (destFilter.trim()) {
      const t = destFilter.toLowerCase().trim();
      filtered = filtered.filter((r) => (r.dest || "").toLowerCase().includes(t));
    }
    if (effFrom) {
      filtered = filtered.filter((r) => r.effective >= effFrom);
    }
    if (effTo) {
      filtered = filtered.filter((r) => r.effective <= effTo);
    }
    if (expFrom) {
      filtered = filtered.filter((r) => r.expires >= expFrom);
    }
    if (expTo) {
      filtered = filtered.filter((r) => r.expires <= expTo);
    }
    if (q.trim()) {
      const t = q.toLowerCase().trim();
      filtered = filtered.filter((r) =>
        [r.id, r.lane, r.origin, r.dest, r.carrier, r.mode, r.status, r.unit]
          .some((v) => String(v || "").toLowerCase().includes(t))
      );
    }

    return [...filtered].sort((a, b) => {
      let av = a[sortCol];
      let bv = b[sortCol];
      // Numeric sort for numeric columns
      if (typeof av === "number" && typeof bv === "number") {
        return sortAsc ? av - bv : bv - av;
      }
      av = String(av || "").toLowerCase();
      bv = String(bv || "").toLowerCase();
      return sortAsc ? av.localeCompare(bv) : bv.localeCompare(av);
    });
  }, [rates, q, carrierFilter, modeFilter, statusFilter, originFilter, destFilter, effFrom, effTo, expFrom, expTo, czarliteOnly, sortCol, sortAsc]);

  function toggleSort(col) {
    if (sortCol === col) setSortAsc(!sortAsc);
    else { setSortCol(col); setSortAsc(true); }
  }

  function clearAllFilters() {
    setQ("");
    setCarrierFilter("All");
    setModeFilter("All");
    setStatusFilter("All");
    setOriginFilter("");
    setDestFilter("");
    setEffFrom("");
    setEffTo("");
    setExpFrom("");
    setExpTo("");
    setCzarliteOnly(false);
  }

  function handleStatClick(filter) {
    clearAllFilters();
    if (filter === "czarlite") {
      setCzarliteOnly(true);
    } else if (filter !== "total") {
      setStatusFilter(filter);
    }
  }

  const SortIcon = ({ col }) => (
    <span style={{ opacity: sortCol === col ? 1 : 0.3, marginLeft: 4 }}>
      {sortCol === col ? (sortAsc ? "\u25B2" : "\u25BC") : "\u21C5"}
    </span>
  );

  return (
    <div>
      {/* Page Header */}
      <div className="page-header" style={{ flexDirection: "column", alignItems: "stretch", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <div className="page-title">Rate Management</div>
            <div className="page-sub">Contracted rates, carrier preferences, and lane assignments</div>
          </div>
        </div>
        <div className="header-actions" style={{ padding: 0 }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button className="btn btn-secondary btn-sm" onClick={() => toast("Template download started", "success")}>
              Download Template
            </button>
            <button className="btn btn-primary btn-sm" onClick={() => toast("Upload panel coming soon", "info")}>
              Upload Rates (Excel)
            </button>
            <button
              className="btn btn-secondary btn-sm"
              style={{
                borderColor: czarliteOnly ? "rgba(99,102,241,.7)" : "rgba(99,102,241,.4)",
                color: "#4338ca",
                background: czarliteOnly ? "rgba(79,70,229,.12)" : undefined,
              }}
              onClick={() => setCzarliteOnly(!czarliteOnly)}
            >
              CzarLite Only
            </button>
            <button
              className="btn btn-secondary btn-sm"
              style={{ borderColor: "rgba(99,102,241,.5)", color: "#4338ca", background: "linear-gradient(135deg,rgba(79,70,229,.06),rgba(99,102,241,.03))" }}
              onClick={() => toast("SMC3 configuration coming soon", "info")}
            >
              <span style={{ display: "inline-block", width: 7, height: 7, borderRadius: "50%", background: "#d1d5db", marginRight: 5, verticalAlign: "middle" }} />
              SMC3 Connect
            </button>
            <button
              className="btn btn-secondary btn-sm"
              style={{ borderColor: "rgba(34,197,94,.5)", color: "#16a34a", background: "linear-gradient(135deg,rgba(34,197,94,.07),rgba(34,197,94,.03))" }}
              onClick={() => toast("DB Sync initiated", "success")}
            >
              DB Sync All
            </button>
            <button
              className="btn btn-secondary btn-sm"
              style={{ borderColor: "rgba(34,197,94,.5)", color: "#16a34a" }}
              onClick={() => toast("Reloading from database...", "info")}
            >
              Reload DB
            </button>
            <button className="btn btn-secondary btn-sm" onClick={() => toast("Add Rate modal coming soon", "info")}>
              + Add Rate
            </button>
          </div>
        </div>
      </div>

      <div className="page-content">
        {/* Stat Cards */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr 1fr", gap: 12, marginBottom: 18 }}>
          <div className="stat-card blue" style={{ cursor: "pointer" }} onClick={() => handleStatClick("total")}>
            <div className="stat-label">TOTAL RATES</div>
            <div className="stat-value" style={{ fontSize: 26 }}>{stats.total}</div>
          </div>
          <div className="stat-card green" style={{ cursor: "pointer" }} onClick={() => handleStatClick("Active")}>
            <div className="stat-label">ACTIVE</div>
            <div className="stat-value" style={{ fontSize: 26 }}>{stats.active}</div>
          </div>
          <div className="stat-card yellow" style={{ cursor: "pointer" }} onClick={() => handleStatClick("Expiring Soon")}>
            <div className="stat-label">EXPIRING SOON</div>
            <div className="stat-value" style={{ fontSize: 26 }}>{stats.expiringSoon}</div>
          </div>
          <div className="stat-card red" style={{ cursor: "pointer" }} onClick={() => handleStatClick("Expired")}>
            <div className="stat-label">EXPIRED</div>
            <div className="stat-value" style={{ fontSize: 26 }}>{stats.expired}</div>
          </div>
          <div
            className="stat-card"
            style={{
              background: czarliteOnly
                ? "linear-gradient(135deg,rgba(79,70,229,.15),rgba(99,102,241,.08))"
                : "linear-gradient(135deg,rgba(79,70,229,.08),rgba(99,102,241,.04))",
              border: czarliteOnly
                ? "1.5px solid rgba(99,102,241,.5)"
                : "1.5px solid rgba(99,102,241,.25)",
              cursor: "pointer",
            }}
            onClick={() => handleStatClick("czarlite")}
          >
            <div className="stat-label" style={{ color: "#6366f1" }}>CZARLITE RATES</div>
            <div className="stat-value" style={{ fontSize: 26, color: "#4f46e5" }}>{stats.czarlite}</div>
            <div style={{ fontSize: 10, color: "#6366f1", marginTop: 2 }}>Click to filter</div>
          </div>
        </div>

        {/* CzarLite filter banner */}
        {czarliteOnly && (
          <div style={{
            marginBottom: 12, padding: "10px 16px",
            background: "linear-gradient(135deg,rgba(79,70,229,.1),rgba(99,102,241,.06))",
            border: "1.5px solid rgba(99,102,241,.3)", borderRadius: 10,
            display: "flex", alignItems: "center", gap: 10,
          }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: "#4338ca" }}>Showing CzarLite rates only</span>
            <button
              onClick={() => setCzarliteOnly(false)}
              style={{ marginLeft: "auto", fontSize: 12, color: "#6366f1", textDecoration: "underline", background: "none", border: "none", cursor: "pointer" }}
            >
              Clear filter
            </button>
          </div>
        )}

        {/* Filter Bar */}
        <div style={{
          display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center",
          marginBottom: 14, padding: "10px 14px",
          background: "var(--bg2)", borderRadius: 10, border: "1px solid var(--border)",
        }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text3)", marginRight: 4 }}>Filters:</span>
          <div className="search-wrap">
            <input
              placeholder="Search lane, origin, dest..."
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="search-input"
              style={{ width: 180 }}
            />
          </div>
          <select className="fsel" value={carrierFilter} onChange={(e) => setCarrierFilter(e.target.value)}>
            <option value="All">All Carriers</option>
            {carrierNames.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          <select className="fsel" value={modeFilter} onChange={(e) => setModeFilter(e.target.value)}>
            <option value="All">All Modes</option>
            <option value="LTL">LTL</option>
            <option value="TL">TL</option>
            <option value="FTL">FTL</option>
            <option value="Intermodal">Intermodal</option>
          </select>
          <select className="fsel" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="All">All Statuses</option>
            <option value="Active">Active</option>
            <option value="Expired">Expired</option>
            <option value="Pending">Pending</option>
            <option value="Expiring Soon">Expiring Soon</option>
          </select>
          <input
            placeholder="Origin..."
            value={originFilter}
            onChange={(e) => setOriginFilter(e.target.value)}
            style={{ padding: "6px 10px", border: "1.5px solid var(--border)", borderRadius: 8, fontSize: 12, fontFamily: "inherit", outline: "none", width: 120 }}
          />
          <input
            placeholder="Destination..."
            value={destFilter}
            onChange={(e) => setDestFilter(e.target.value)}
            style={{ padding: "6px 10px", border: "1.5px solid var(--border)", borderRadius: 8, fontSize: 12, fontFamily: "inherit", outline: "none", width: 120 }}
          />
          <span style={{ fontSize: 11, color: "var(--text3)", marginLeft: 4 }}>Start:</span>
          <input
            type="date"
            value={effFrom}
            onChange={(e) => setEffFrom(e.target.value)}
            style={{ padding: "5px 8px", border: "1.5px solid var(--border)", borderRadius: 8, fontSize: 11, fontFamily: "inherit", outline: "none", width: 130 }}
            title="Effective date from"
          />
          <span style={{ fontSize: 11, color: "var(--text3)" }}>to</span>
          <input
            type="date"
            value={effTo}
            onChange={(e) => setEffTo(e.target.value)}
            style={{ padding: "5px 8px", border: "1.5px solid var(--border)", borderRadius: 8, fontSize: 11, fontFamily: "inherit", outline: "none", width: 130 }}
            title="Effective date to"
          />
          <span style={{ fontSize: 11, color: "var(--text3)", marginLeft: 6 }}>Expiry:</span>
          <input
            type="date"
            value={expFrom}
            onChange={(e) => setExpFrom(e.target.value)}
            style={{ padding: "5px 8px", border: "1.5px solid var(--border)", borderRadius: 8, fontSize: 11, fontFamily: "inherit", outline: "none", width: 130 }}
            title="Expiry date from"
          />
          <span style={{ fontSize: 11, color: "var(--text3)" }}>to</span>
          <input
            type="date"
            value={expTo}
            onChange={(e) => setExpTo(e.target.value)}
            style={{ padding: "5px 8px", border: "1.5px solid var(--border)", borderRadius: 8, fontSize: 11, fontFamily: "inherit", outline: "none", width: 130 }}
            title="Expiry date to"
          />
          <span style={{ flex: 1 }} />
          <span style={{ fontSize: 11, color: "var(--text3)" }}>{rows.length} of {rates.length} rates</span>
          <button
            onClick={clearAllFilters}
            style={{ fontSize: 11, color: "var(--accent)", background: "none", border: "none", cursor: "pointer", textDecoration: "underline" }}
          >
            Clear All
          </button>
        </div>

        {/* Toast */}
        {message.text && (
          <div className={`toast toast-${message.type || "info"}`} style={{ marginBottom: 12 }}>
            {message.text}
          </div>
        )}

        {/* Rates Table */}
        <div className="card" style={{ padding: 0 }}>
          <div className="table-wrap">
            <table className="grid" style={{ border: "none", boxShadow: "none" }}>
              <thead>
                <tr>
                  <th onClick={() => toggleSort("lane")} style={{ cursor: "pointer" }}>LANE <SortIcon col="lane" /></th>
                  <th onClick={() => toggleSort("origin")} style={{ cursor: "pointer" }}>ORIGIN <SortIcon col="origin" /></th>
                  <th onClick={() => toggleSort("dest")} style={{ cursor: "pointer" }}>DESTINATION <SortIcon col="dest" /></th>
                  <th onClick={() => toggleSort("carrier")} style={{ cursor: "pointer" }}>CARRIER <SortIcon col="carrier" /></th>
                  <th onClick={() => toggleSort("mode")} style={{ cursor: "pointer" }}>MODE <SortIcon col="mode" /></th>
                  <th onClick={() => toggleSort("rate")} style={{ cursor: "pointer" }}>RATE <SortIcon col="rate" /></th>
                  <th onClick={() => toggleSort("unit")} style={{ cursor: "pointer" }}>UNIT <SortIcon col="unit" /></th>
                  <th onClick={() => toggleSort("fsc")} style={{ cursor: "pointer" }}>FSC <SortIcon col="fsc" /></th>
                  <th onClick={() => toggleSort("discount_pct")} style={{ cursor: "pointer", color: "#059669" }}>DISCOUNT% <SortIcon col="discount_pct" /></th>
                  <th onClick={() => toggleSort("discount_amt")} style={{ cursor: "pointer", color: "#059669" }}>DISC $ <SortIcon col="discount_amt" /></th>
                  <th onClick={() => toggleSort("transit_days")} style={{ cursor: "pointer" }}>TRANSIT DAYS <SortIcon col="transit_days" /></th>
                  <th onClick={() => toggleSort("effective")} style={{ cursor: "pointer" }}>EFFECTIVE <SortIcon col="effective" /></th>
                  <th onClick={() => toggleSort("expires")} style={{ cursor: "pointer" }}>EXPIRES <SortIcon col="expires" /></th>
                  <th onClick={() => toggleSort("status")} style={{ cursor: "pointer" }}>STATUS <SortIcon col="status" /></th>
                  <th>CZARLITE</th>
                  <th>ACTIONS</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr><td colSpan={16} className="empty-state">No rates found</td></tr>
                ) : rows.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <span className="mono" style={{ color: "var(--accent)", fontWeight: 600 }}>{r.lane}</span>
                    </td>
                    <td className="text-sm">{r.origin || "\u2014"}</td>
                    <td className="text-sm">{r.dest || "\u2014"}</td>
                    <td className="text-sm">{r.carrier || "\u2014"}</td>
                    <td>
                      <span className={MODE_BADGES[r.mode] || "badge badge-blue"}>{r.mode || "\u2014"}</span>
                    </td>
                    <td className="mono fw-700">${(r.rate || 0).toLocaleString()}</td>
                    <td className="text-sm">{r.unit || "\u2014"}</td>
                    <td className="mono text-sm">{r.fsc != null ? `${r.fsc}%` : "\u2014"}</td>
                    <td className="mono text-sm" style={{ color: "#059669" }}>
                      {r.discount_pct != null ? `${r.discount_pct}%` : "\u2014"}
                    </td>
                    <td className="mono text-sm" style={{ color: "#059669" }}>
                      {r.discount_amt != null ? `$${r.discount_amt.toLocaleString()}` : "\u2014"}
                    </td>
                    <td className="mono text-sm" style={{ textAlign: "center" }}>{r.transit_days ?? "\u2014"}</td>
                    <td className="mono text-sm">{r.effective || "\u2014"}</td>
                    <td className="mono text-sm">{r.expires || "\u2014"}</td>
                    <td>
                      <span className={STATUS_BADGES[r.status] || "badge badge-blue"}>{r.status || "\u2014"}</span>
                    </td>
                    <td>
                      {r.czarlite ? (
                        <span className="badge badge-purple" style={{ fontSize: 10 }}>CzarLite</span>
                      ) : (
                        <span className="text-muted text-sm">\u2014</span>
                      )}
                    </td>
                    <td style={{ whiteSpace: "nowrap" }}>
                      <button
                        className="btn btn-secondary btn-sm"
                        onClick={() => toast(`Editing rate ${r.id}`, "info")}
                        style={{ fontSize: 11 }}
                      >
                        Edit
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="text-sm text-muted mt-2">
          {rows.length} of {rates.length} rates
        </div>
      </div>{/* end page-content */}
    </div>
  );
}
