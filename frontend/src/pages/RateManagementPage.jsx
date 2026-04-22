import { useEffect, useMemo, useState } from "react";
import { useOutletContext, useSearchParams } from "react-router-dom";
import { DbApi } from "../lib/api";
import EditRateModal from "../components/EditRateModal";
import ConfirmDialog from "../components/ConfirmDialog";
import {
  deleteRate,
  downloadRateTemplate,
  duplicateRate,
  getMatchTypeBadge,
  getMatchTypeLabel,
} from "../services/rateService";
import { invalidateQuoteCache } from "../services/ordersService";

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

/* ---------- Build display lane ID with expiry date appended ---------- */
function buildLaneId(r) {
  let lane = r.lane || "";
  const exp = r.exp || r.expires || r.expiry_date || "";
  if (exp && !lane.includes(exp.replace(/-/g, ""))) {
    lane += "-" + exp.replace(/-/g, "");
  }
  return lane;
}

/* ---------- Format rate display ---------- */
function formatRate(r) {
  // CzarLite rates are computed on-demand when an order requests them — don't show DB value
  if (r.czarlite) return "\u2014";
  const raw = r.rate || r.rate_per_mile || 0;
  const num = typeof raw === "string" ? parseFloat(raw.replace(/[$,]/g, "")) : raw;
  if (!num) return "$0.00";
  const unit = (r.unit || "").toLowerCase();
  if (unit.includes("mile") || unit.includes("per mile")) {
    return "$" + num.toFixed(2);
  }
  return "$" + num.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/* ---------- Format unit display ---------- */
function formatUnit(r) {
  const unit = r.unit || "";
  if (!unit) return "\u2014";
  const u = unit.toUpperCase();
  if (u === "CWT" || u === "PER CWT") return "PER CWT";
  if (u === "MILE" || u === "PER MILE") return "PER MILE";
  if (u === "FLAT") return "FLAT";
  if (u === "CONTAINER") return "CONTAINER";
  return u;
}

/* ---------- Format transit days ---------- */
function formatTransitDays(r) {
  const td = r.transitDays || r.transit_days;
  if (!td) return "\u2014";
  const isExp =
    (r.serviceLevel || r.service_level || "").toLowerCase().indexOf("express") >= 0 ||
    (r.serviceLevel || r.service_level || "").toLowerCase().indexOf("expedit") >= 0 ||
    (r.lane || "").indexOf("EXP") >= 0;
  return (
    <>
      {td} DAY{td > 1 ? "S" : ""}
      {isExp && <span style={{ fontSize: 8, color: "#7c3aed", fontWeight: 700, marginLeft: 4 }}>TEAM</span>}
    </>
  );
}

/* ---------- Render CzarLite badge ---------- */
function CzarLiteBadge({ r, carriers }) {
  // Show CzarLite badge if rate-level OR carrier-level czarlite is enabled
  const carrierCzarlite = (carriers || []).some((c) => c.name === r.carrier && c.czarlite_enabled);
  if (!r.czarlite && !carrierCzarlite) return <span className="text-muted text-sm">{"\u2014"}</span>;
  const cls = r.czarliteClass || r.czarlite_class || r.freight_class || "";
  const minWt = r.czarliteMinWt || r.czar_min_wt || r.czarlite_min_wt || 0;
  const maxWt = r.czarliteMaxWt || r.czar_max_wt || r.czarlite_max_wt || 0;
  const wRange = (minWt || 0).toLocaleString() + "\u2013" + (maxWt || 99999).toLocaleString() + " LBS";
  return (
    <div>
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 4,
          fontSize: 10,
          fontWeight: 700,
          background: "linear-gradient(135deg,#312e81,#4f46e5)",
          color: "#fff",
          padding: "2px 8px",
          borderRadius: 20,
          whiteSpace: "nowrap",
        }}
      >
        CZARLITE{cls ? ` \u00B7 CLASS ${cls}` : ""}
      </span>
      <div style={{ fontSize: 10, color: "#6366f1", marginTop: 3 }}>
        {wRange}
      </div>
    </div>
  );
}

export default function RateManagementPage() {
  const { carriers, rates: contextRates, refreshData } = useOutletContext();
  const [searchParams] = useSearchParams();

  // State — initialize search from URL ?q= param (e.g. linked from shipment rate_id)
  const [q, setQ] = useState(searchParams.get("q") || "");
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
  const [sortCol, setSortCol] = useState("lane");
  const [sortAsc, setSortAsc] = useState(true);
  const [message, setMessage] = useState({ text: "", type: "" });
  const [editRate, setEditRate] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null); // rate row pending delete confirmation
  const [deleting, setDeleting] = useState(false);

  // Auto-open rate detail when navigating with ?q= (e.g. from shipment rate_id link)
  useEffect(() => {
    const qParam = searchParams.get("q");
    if (!qParam || !contextRates?.length) return;
    const match = contextRates.find((r) =>
      (r.id && String(r.id) === qParam) || (r.lane && r.lane === qParam)
    );
    if (match) setEditRate(match);
  }, [searchParams, contextRates]);

  // Use real data from context
  const rates = contextRates || [];

  // Miles from DB field (saved via edit modal)
  function getDist(r) {
    return r.miles || r.distance || null;
  }

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

  // Normalize field access — DB uses snake_case, some contexts use camelCase
  function getEff(r) { return r.eff || r.effective || r.effective_date || r.effectiveDate || ""; }
  function getExp(r) { return r.exp || r.expires || r.expiry_date || r.expiryDate || ""; }
  function getOrigin(r) { return r.origin || ""; }
  function getDest(r) { return r.dest || r.destination || ""; }
  function getDiscount(r) { return r.discount || r.discount_pct || null; }
  function getDiscountFlat(r) { return r.discountFlat || r.discount_flat || r.discount_amt || null; }
  function getTransitDays(r) { return r.transitDays || r.transit_days || null; }
  function getFsc(r) { return r.fsc || r.fsc_pct || r.fscPct || null; }

  // Stats
  const stats = useMemo(() => {
    const now = new Date().toISOString().slice(0, 10);
    const thirtyDays = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
    return {
      total: rates.length,
      active: rates.filter((r) => r.status === "Active").length,
      expiringSoon: rates.filter((r) => r.status === "Expiring Soon" || (r.status === "Active" && getExp(r) >= now && getExp(r) <= thirtyDays)).length,
      expired: rates.filter((r) => r.status === "Expired" || (getExp(r) && getExp(r) < now)).length,
      czarlite: rates.filter((r) => r.czarlite || carriers.some((c) => c.name === r.carrier && c.czarlite_enabled)).length,
    };
  }, [rates]);

  // Filtered + sorted rows
  const rows = useMemo(() => {
    let filtered = rates;

    if (czarliteOnly) {
      filtered = filtered.filter((r) => r.czarlite === true);
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
      filtered = filtered.filter((r) => getOrigin(r).toLowerCase().includes(t));
    }
    if (destFilter.trim()) {
      const t = destFilter.toLowerCase().trim();
      filtered = filtered.filter((r) => getDest(r).toLowerCase().includes(t));
    }
    if (effFrom) {
      filtered = filtered.filter((r) => getEff(r) && getEff(r) >= effFrom);
    }
    if (effTo) {
      filtered = filtered.filter((r) => getEff(r) && getEff(r) <= effTo);
    }
    if (expFrom) {
      filtered = filtered.filter((r) => getExp(r) && getExp(r) >= expFrom);
    }
    if (expTo) {
      filtered = filtered.filter((r) => getExp(r) && getExp(r) <= expTo);
    }
    if (q.trim()) {
      const t = q.toLowerCase().trim();
      filtered = filtered.filter((r) =>
        [buildLaneId(r), getOrigin(r), getDest(r), r.carrier, r.mode, r.status, r.unit]
          .some((v) => String(v || "").toLowerCase().includes(t))
      );
    }

    return [...filtered].sort((a, b) => {
      let av = a[sortCol];
      let bv = b[sortCol];
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

  async function handleSaveRate(id, payload, isNew) {
    try {
      if (isNew) {
        await DbApi.upsert("rates", payload);
        toast("Rate created successfully", "success");
      } else {
        await DbApi.patch("rates", id, payload);
        toast(`Rate ${payload.lane || id} updated`, "success");
      }
      // Ensure planning uses latest rates after any rate mutation.
      invalidateQuoteCache();
      setEditRate(null);
      if (refreshData) await refreshData();
    } catch (err) {
      toast(`Failed: ${err.message}`, "error");
    }
  }

  async function handleCopyRate(rate) {
    try {
      await duplicateRate(rate);
      toast(`Rate ${rate.lane || ""} copied`, "success");
      invalidateQuoteCache();
      if (refreshData) await refreshData();
    } catch (err) {
      toast(`Copy failed: ${err.message}`, "error");
    }
  }

  async function confirmDeleteRate() {
    if (!deleteTarget?.id) return;
    setDeleting(true);
    try {
      await deleteRate(deleteTarget.id);
      toast(`Rate ${deleteTarget.lane || deleteTarget.id} deleted`, "success");
      invalidateQuoteCache();
      setDeleteTarget(null);
      if (refreshData) await refreshData();
    } catch (err) {
      toast(`Delete failed: ${err.message}`, "error");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div>
      {/* Page Header */}
      <div className="page-header" style={{ flexDirection: "column", alignItems: "stretch", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <div className="page-title">RATE MANAGEMENT</div>
            <div className="page-sub">CONTRACTED RATES, CARRIER PREFERENCES, AND LANE ASSIGNMENTS</div>
          </div>
        </div>
        <div className="header-actions" style={{ padding: 0 }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button className="btn btn-secondary btn-sm" onClick={() => { downloadRateTemplate(); toast("Rate template downloaded", "success"); }}>
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
            <button className="btn btn-secondary btn-sm" onClick={() => setEditRate({
              lane: "", mode: "TL", origin: "", dest: "", carrier: "",
              status: "Active", rate: "", unit: "per mile", fsc: "",
              eff: new Date().toISOString().slice(0, 10), exp: "",
              miles: "", transitDays: "", serviceLevel: "Standard",
              czarlite: false,
            })}>
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
            <div style={{ fontSize: 10, color: "#6366f1", marginTop: 2 }}>CLICK TO FILTER</div>
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
          <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text3)", marginRight: 4 }}>FILTERS:</span>
          <div className="search-wrap">
            <input
              placeholder="SEARCH LANE, ORIGIN, DEST."
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="search-input"
              style={{ width: 180 }}
            />
          </div>
          <select className="fsel" value={carrierFilter} onChange={(e) => setCarrierFilter(e.target.value)}>
            <option value="All">ALL CARRIERS</option>
            {carrierNames.map((c) => (
              <option key={c} value={c}>{c.toUpperCase()}</option>
            ))}
          </select>
          <select className="fsel" value={modeFilter} onChange={(e) => setModeFilter(e.target.value)}>
            <option value="All">ALL MODES</option>
            <option value="LTL">LTL</option>
            <option value="TL">TL</option>
            <option value="FTL">FTL</option>
            <option value="Intermodal">INTERMODAL</option>
          </select>
          <select className="fsel" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="All">ALL STATUSES</option>
            <option value="Active">ACTIVE</option>
            <option value="Expired">EXPIRED</option>
            <option value="Pending">PENDING</option>
            <option value="Expiring Soon">EXPIRING SOON</option>
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
          <span style={{ fontSize: 11, color: "var(--text3)", marginLeft: 4 }}>START:</span>
          <input
            type="date"
            value={effFrom}
            onChange={(e) => setEffFrom(e.target.value)}
            style={{ padding: "5px 8px", border: "1.5px solid var(--border)", borderRadius: 8, fontSize: 11, fontFamily: "inherit", outline: "none", width: 130 }}
            title="Effective date from"
          />
          <span style={{ fontSize: 11, color: "var(--text3)" }}>TO</span>
          <input
            type="date"
            value={effTo}
            onChange={(e) => setEffTo(e.target.value)}
            style={{ padding: "5px 8px", border: "1.5px solid var(--border)", borderRadius: 8, fontSize: 11, fontFamily: "inherit", outline: "none", width: 130 }}
            title="Effective date to"
          />
          <span style={{ fontSize: 11, color: "var(--text3)", marginLeft: 6 }}>EXPIRY:</span>
          <input
            type="date"
            value={expFrom}
            onChange={(e) => setExpFrom(e.target.value)}
            style={{ padding: "5px 8px", border: "1.5px solid var(--border)", borderRadius: 8, fontSize: 11, fontFamily: "inherit", outline: "none", width: 130 }}
            title="Expiry date from"
          />
          <span style={{ fontSize: 11, color: "var(--text3)" }}>TO</span>
          <input
            type="date"
            value={expTo}
            onChange={(e) => setExpTo(e.target.value)}
            style={{ padding: "5px 8px", border: "1.5px solid var(--border)", borderRadius: 8, fontSize: 11, fontFamily: "inherit", outline: "none", width: 130 }}
            title="Expiry date to"
          />
          <span style={{ flex: 1 }} />
          <span style={{ fontSize: 11, color: "var(--text3)" }}>{rows.length} OF {rates.length} RATES</span>
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
        <div style={{ position: "relative", border: "1px solid var(--border)", borderRadius: 16, background: "#fff", boxShadow: "0 1px 2px rgba(15,23,42,0.04)" }}>
          <div style={{ overflowX: "scroll", overflowY: "visible", WebkitOverflowScrolling: "touch" }}>
            <table className="grid" style={{ border: "none", boxShadow: "none", width: 1800 }}>
              <thead>
                <tr>
                  <th onClick={() => toggleSort("lane")} style={{ cursor: "pointer" }}>LANE <SortIcon col="lane" /></th>
                  <th onClick={() => toggleSort("origin")} style={{ cursor: "pointer" }}>ORIGIN <SortIcon col="origin" /></th>
                  <th onClick={() => toggleSort("dest")} style={{ cursor: "pointer" }}>DESTINATION <SortIcon col="dest" /></th>
                  <th onClick={() => toggleSort("carrier")} style={{ cursor: "pointer" }}>CARRIER <SortIcon col="carrier" /></th>
                  <th onClick={() => toggleSort("mode")} style={{ cursor: "pointer" }}>MODE <SortIcon col="mode" /></th>
                  <th onClick={() => toggleSort("match_type")} style={{ cursor: "pointer" }}>MATCH TYPE <SortIcon col="match_type" /></th>
                  <th onClick={() => toggleSort("rate")} style={{ cursor: "pointer" }}>RATE <SortIcon col="rate" /></th>
                  <th onClick={() => toggleSort("unit")} style={{ cursor: "pointer" }}>UNIT <SortIcon col="unit" /></th>
                  <th onClick={() => toggleSort("fsc")} style={{ cursor: "pointer" }}>FSC <SortIcon col="fsc" /></th>
                  <th onClick={() => toggleSort("discount")} style={{ cursor: "pointer", color: "#059669" }}>DISCOUNT% <SortIcon col="discount" /></th>
                  <th onClick={() => toggleSort("discountFlat")} style={{ cursor: "pointer", color: "#059669" }}>DISC $ <SortIcon col="discountFlat" /></th>
                  <th onClick={() => toggleSort("service_level")} style={{ cursor: "pointer" }}>SERVICE LEVEL <SortIcon col="service_level" /></th>
                  <th onClick={() => toggleSort("transitDays")} style={{ cursor: "pointer" }}>TRANSIT DAYS <SortIcon col="transitDays" /></th>
                  <th onClick={() => toggleSort("miles")} style={{ cursor: "pointer" }}>MILES <SortIcon col="miles" /></th>
                  <th onClick={() => toggleSort("eff")} style={{ cursor: "pointer" }}>EFFECTIVE <SortIcon col="eff" /></th>
                  <th onClick={() => toggleSort("exp")} style={{ cursor: "pointer" }}>EXPIRES <SortIcon col="exp" /></th>
                  <th onClick={() => toggleSort("status")} style={{ cursor: "pointer" }}>STATUS <SortIcon col="status" /></th>
                  <th>CZARLITE</th>
                  <th>ACTIONS</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr><td colSpan={19} className="empty-state">No rates found</td></tr>
                ) : rows.map((r, idx) => (
                  <tr
                    key={r.id || idx}
                    style={r.czarlite ? { borderLeft: "3px solid #6366f1", background: "rgba(99,102,241,.03)" } : undefined}
                  >
                    <td style={{ whiteSpace: "nowrap", minWidth: 220 }}>
                      <a href="#" onClick={(e) => { e.preventDefault(); setEditRate(r); }} className="mono" style={{ color: "var(--accent)", fontWeight: 600, fontSize: 12, textDecoration: "none", cursor: "pointer" }}>
                        {buildLaneId(r)}
                      </a>
                    </td>
                    <td className="text-sm">{getOrigin(r).toUpperCase() || "\u2014"}</td>
                    <td className="text-sm">{getDest(r).toUpperCase() || "\u2014"}</td>
                    <td className="text-sm">{(r.carrier || "\u2014").toUpperCase()}</td>
                    <td>
                      <span className={MODE_BADGES[r.mode] || "badge badge-blue"}>{(r.mode || "\u2014").toUpperCase()}</span>
                    </td>
                    <td title={getMatchTypeLabel(r.match_type)} style={{ textAlign: "center" }}>
                      <span
                        className="badge"
                        style={{
                          fontSize: 10,
                          fontWeight: 700,
                          background: "rgba(99,102,241,.1)",
                          color: "#4f46e5",
                          border: "1px solid rgba(99,102,241,.25)",
                          padding: "2px 8px",
                          borderRadius: 20,
                          whiteSpace: "nowrap",
                        }}
                      >
                        {getMatchTypeBadge(r.match_type)}
                      </span>
                    </td>
                    <td className="mono fw-700" style={r.czarlite ? { color: "#6366f1" } : { color: "var(--green)" }}>
                      {formatRate(r)}
                    </td>
                    <td className="text-sm" style={{ color: "var(--text3)" }}>{formatUnit(r)}</td>
                    <td className="mono text-sm">
                      {getFsc(r) != null ? `${String(getFsc(r)).replace("%", "")}%` : "\u2014"}
                    </td>
                    <td className="mono text-sm" style={{ color: "#059669", textAlign: "center" }}>
                      {getDiscount(r) ? `${getDiscount(r)}%` : "\u2014"}
                    </td>
                    <td className="mono text-sm" style={{ color: "#059669", textAlign: "center" }}>
                      {getDiscountFlat(r) ? `$${getDiscountFlat(r)}` : "\u2014"}
                    </td>
                    <td className="text-sm" style={{ textAlign: "center" }}>
                      {(r.service_level || r.serviceLevel || "\u2014").toUpperCase()}
                    </td>
                    <td className="mono text-sm" style={{ textAlign: "center" }}>
                      {formatTransitDays(r)}
                    </td>
                    <td className="mono text-sm" style={{ textAlign: "center" }}>
                      {getDist(r) ? getDist(r).toLocaleString() : "\u2014"}
                    </td>
                    <td className="mono text-sm">{getEff(r) || "\u2014"}</td>
                    <td className="mono text-sm">{getExp(r) || "\u2014"}</td>
                    <td>
                      <span className={STATUS_BADGES[r.status] || "badge badge-blue"}>
                        {(r.status || "\u2014").toUpperCase()}
                      </span>
                    </td>
                    <td>
                      <CzarLiteBadge r={r} carriers={carriers} />
                    </td>
                    <td style={{ whiteSpace: "nowrap" }}>
                      <div style={{ display: "inline-flex", gap: 4 }}>
                        <button
                          className="btn btn-ghost btn-sm"
                          onClick={() => setEditRate(r)}
                          style={{ fontSize: 11 }}
                          title="Edit rate"
                        >
                          Edit
                        </button>
                        <button
                          className="btn btn-ghost btn-sm"
                          onClick={() => handleCopyRate(r)}
                          style={{ fontSize: 11 }}
                          title="Duplicate this rate"
                        >
                          Copy
                        </button>
                        <button
                          className="btn btn-ghost btn-sm"
                          onClick={() => setDeleteTarget(r)}
                          style={{ fontSize: 11, color: "#b91c1c" }}
                          title="Delete rate"
                          disabled={!r.id}
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="text-sm text-muted mt-2">
          {rows.length} OF {rates.length} RATES
        </div>
      </div>{/* end page-content */}

      {/* Edit Rate Modal */}
      <EditRateModal
        rate={editRate}
        onClose={() => setEditRate(null)}
        onSave={handleSaveRate}
        isNew={editRate && !editRate.id}
        carriers={carriers}
        existingLanes={rates.map((r) => r.lane).filter(Boolean)}
      />

      {/* Delete confirmation */}
      <ConfirmDialog
        open={!!deleteTarget}
        tone="danger"
        title="Delete rate?"
        message={
          deleteTarget
            ? `This will permanently delete rate "${deleteTarget.lane || deleteTarget.id}". This cannot be undone.`
            : ""
        }
        confirmLabel="Delete"
        busy={deleting}
        onConfirm={confirmDeleteRate}
        onCancel={() => (deleting ? null : setDeleteTarget(null))}
      />
    </div>
  );
}
