import { useEffect, useMemo, useRef, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { BulkPlanApi } from "../lib/api";

/* ─────────── Static Data ─────────── */

const CITY_ZIP_MAP = {
  "Chicago, IL": "60601",
  "Dallas, TX": "75201",
  "Columbus, OH": "43201",
  "Atlanta, GA": "30301",
  "Houston, TX": "77001",
  "New York, NY": "10001",
  "Phoenix, AZ": "85001",
  "Memphis, TN": "38101",
  "Denver, CO": "80201",
  "Los Angeles, CA": "90001",
  "Seattle, WA": "98101",
  "Charlotte, NC": "28201",
  "Boston, MA": "02101",
  "Miami, FL": "33101",
  "San Jose, CA": "95101",
  "Mountain View, CA": "94041",
};

const ORIGINS = [
  "Chicago, IL",
  "Houston, TX",
  "Los Angeles, CA",
  "Atlanta, GA",
  "Dallas, TX",
];
const DESTINATIONS = [
  "Dallas, TX",
  "Miami, FL",
  "Seattle, WA",
  "Phoenix, AZ",
  "New York, NY",
  "Denver, CO",
];

const FALLBACK_TL_RATES = [
  { carrier: "J.B. Hunt Transport", rate: "$2.38", fsc: "21.0%", mode: "TL" },
  { carrier: "Werner Enterprises", rate: "$2.45", fsc: "22.5%", mode: "TL" },
  { carrier: "J.B. Hunt Transport", rate: "$2.98", fsc: "21.0%", mode: "TL" },
  { carrier: "Werner Enterprises", rate: "$3.06", fsc: "22.5%", mode: "TL" },
];

/* ─────────── CzarLite Engine ─────────── */
const CZARLITE_BASE_RATES = {
  50: 4.2, 55: 4.55, 60: 5.1, 65: 5.75, 70: 6.4,
  77.5: 7.2, 85: 8.05, 92.5: 9.1, 100: 10.2, 110: 11.5,
  125: 13.0, 150: 15.6, 175: 18.2, 200: 21.3,
  250: 26.5, 300: 31.8, 400: 42.4, 500: 53.0,
};
const CZARLITE_MILE_FACTORS = [
  { max: 200, factor: 1.0 }, { max: 400, factor: 0.94 }, { max: 600, factor: 0.87 },
  { max: 800, factor: 0.81 }, { max: 1000, factor: 0.76 }, { max: 1200, factor: 0.72 },
  { max: 1500, factor: 0.68 }, { max: 2000, factor: 0.63 }, { max: 9999, factor: 0.58 },
];
const CZARLITE_WEIGHT_BREAKS = [
  { min: 0, max: 499, factor: 1.0 },
  { min: 500, max: 999, factor: 0.92 },
  { min: 1000, max: 1999, factor: 0.84 },
  { min: 2000, max: 4999, factor: 0.76 },
  { min: 5000, max: 9999, factor: 0.66 },
  { min: 10000, max: 19999, factor: 0.56 },
  { min: 20000, max: 99999, factor: 0.44 },
];

/* ─────────── Helper Functions ─────────── */
function getDist(o, d) {
  return 750; // Placeholder — real mileage comes from PC*MILER during rating
}

function normLaneCity(addr) {
  const stripped = (addr || "").toLowerCase().split(",")[0].replace(/\s*\d{5}(-\d{4})?\s*$/, "").trim();
  const aliases = { atlanata: "atlanta", "los angelos": "los angeles", dalls: "dallas" };
  return aliases[stripped] || stripped;
}

function calcCost(rateStr, fscStr, miles) {
  const rpm = parseFloat(String(rateStr).replace("$", ""));
  const fsc = parseFloat(String(fscStr)) / 100;
  const base = Math.round(rpm * miles);
  const fuel = Math.round(base * fsc);
  return { base, fuel, acc: 0, total: base + fuel };
}

function getCzarliteRate(weight, freightClass, miles, fscPct) {
  const classes = Object.keys(CZARLITE_BASE_RATES).map(Number).sort((a, b) => a - b);
  const resolvedClass = classes.reduce((prev, curr) =>
    Math.abs(curr - freightClass) < Math.abs(prev - freightClass) ? curr : prev
  );
  const baseRatePerCwt = CZARLITE_BASE_RATES[resolvedClass];
  if (!baseRatePerCwt) return null;

  let mileFactor = CZARLITE_MILE_FACTORS[CZARLITE_MILE_FACTORS.length - 1].factor;
  for (const mf of CZARLITE_MILE_FACTORS) {
    if (miles <= mf.max) { mileFactor = mf.factor; break; }
  }
  let wBreakFactor = CZARLITE_WEIGHT_BREAKS[0].factor;
  for (const wb of CZARLITE_WEIGHT_BREAKS) {
    if (weight >= wb.min && weight <= wb.max) { wBreakFactor = wb.factor; break; }
  }
  const cwt = weight / 100;
  const adjustedRate = baseRatePerCwt * mileFactor * wBreakFactor;
  const base = Math.round(adjustedRate * cwt);
  const fsc = parseFloat(String(fscPct || "21.0%").replace("%", "")) / 100;
  const fuel = Math.round(base * fsc);
  const acc = 120;
  return {
    base, fuel, acc, total: base + fuel + acc,
    ratePerCwt: adjustedRate.toFixed(2), cwt: cwt.toFixed(1),
    resolvedClass, mileFactor, wBreakFactor,
  };
}

/* ─────────── Mock rate data (same as RateManagementPage) ─────────── */
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

function getActiveRates(origin, dest) {
  const oCity = normLaneCity(origin);
  const dCity = normLaneCity(dest);
  return MOCK_RATES.filter((r) => {
    if (r.status !== "Active") return false;
    return normLaneCity(r.origin) === oCity && normLaneCity(r.dest) === dCity;
  });
}

/* ═══════════════════════════════════════════════════════════════════
   ROUTE OPTIMIZER PAGE
   ═══════════════════════════════════════════════════════════════════ */
export default function RouteOptimizerPage() {
  const ctx = useOutletContext() || {};

  /* ── Route Builder state ── */
  const [origin, setOrigin] = useState("Chicago, IL");
  const [dest, setDest] = useState("Dallas, TX");
  const [mode, setMode] = useState("ALL");
  const [weight, setWeight] = useState("4000");
  const [originZip, setOriginZip] = useState("");
  const [destZip, setDestZip] = useState("");

  /* ── CzarLite compare state ── */
  const [czarOriginZip, setCzarOriginZip] = useState("");
  const [czarDestZip, setCzarDestZip] = useState("");
  const [czarWeight, setCzarWeight] = useState("4000");

  /* ── Results ── */
  const [optimized, setOptimized] = useState(false);
  const [optResults, setOptResults] = useState(null);
  const [rateCompareRows, setRateCompareRows] = useState([]);
  const [loadingCzarlite, setLoadingCzarlite] = useState(false);
  const [toast, setToast] = useState({ text: "", type: "" });

  const [sortCol, setSortCol] = useState("total");
  const [sortAsc, setSortAsc] = useState(true);

  function showToast(text, type = "info") {
    setToast({ text, type });
    setTimeout(() => setToast({ text: "", type: "" }), 4000);
  }

  /* ── Keep ZIP inputs in sync ── */
  function handleOriginZipChange(val) { setOriginZip(val); setCzarOriginZip(val); }
  function handleDestZipChange(val) { setDestZip(val); setCzarDestZip(val); }
  function handleCzarOriginZipChange(val) { setCzarOriginZip(val); setOriginZip(val); }
  function handleCzarDestZipChange(val) { setCzarDestZip(val); setDestZip(val); }
  function handleWeightChange(val) { setWeight(val); setCzarWeight(val); }
  function handleCzarWeightChange(val) { setCzarWeight(val); setWeight(val); }

  /* ── Build rate comparison rows (pure function — all values passed in) ── */
  async function fetchRateRows({ o, d, modeFilter, wt, oZip, dZip }) {
    const dist = getDist(o, d);
    const showTL = modeFilter === "ALL" || modeFilter === "TL";
    const showLTL = modeFilter === "ALL" || modeFilter === "LTL";
    const w = parseInt(wt) || 5000;

    let rows = [];

    // TL rates — call backend bulk-plan/rate (uses PC*MILER + rate.miles from DB)
    if (showTL) {
      try {
        const lane = {
          laneKey: `${o} -> ${d}`, origin: o, destination: d,
          originZip: oZip || CITY_ZIP_MAP[o] || "", destZip: dZip || CITY_ZIP_MAP[d] || "",
          freightClass: "70", totalWeight: w, totalPieces: 1, orderIds: [],
        };
        const rateRes = await BulkPlanApi.rate([lane], "cost");
        const results = Array.isArray(rateRes?.results) ? rateRes.results : [];
        const tlQuotes = (results[0]?.quotes || []).filter((q) => q.mode === "TL");
        rows = rows.concat(
          tlQuotes.map((q) => ({
            carrier: q.carrier, mode: "TL",
            base: q.czarBaseGross || 0, fsc: q.fscCharge || 0,
            acc: 0, total: q.totalCharge || 0,
            transit: q.transitDays || null,
            _czarlite: false,
            miles: q.miles || null,
            pcmilerMiles: q.pcmilerMiles || null,
            serviceLevel: q.serviceLevel || "",
          }))
        );
      } catch (e) {
        console.warn("[RouteOptimizer] TL bulk-plan/rate error:", e.message);
        // Fallback to local calc with 750 mi
        rows = rows.concat(
          FALLBACK_TL_RATES.map((r) => {
            const c = calcCost(r.rate, r.fsc, dist);
            return {
              carrier: r.carrier, mode: "TL", base: c.base, fsc: c.fuel,
              acc: c.acc, total: c.total, transit: Math.max(1, Math.ceil(dist / 500)),
              _czarlite: false,
            };
          })
        );
      }
    }

    // Non-CzarLite LTL
    if (showLTL) {
      const nonCzLtl = getActiveRates(o, d).filter((r) => r.mode === "LTL" && !r.czarlite);
      rows = rows.concat(
        nonCzLtl.map((r) => {
          const c = calcCost(r.rate, r.fsc, dist);
          return {
            carrier: r.carrier, mode: "LTL", base: c.base, fsc: c.fuel,
            acc: c.acc, total: c.total, transit: r.transit_days || null,
            _czarlite: false,
          };
        })
      );
    }

    // CzarLite LTL — call live /api/ltl/quote API (same as old HTML)
    if (showLTL) {
      const effectiveOZip = oZip || CITY_ZIP_MAP[o] || "";
      const effectiveDZip = dZip || CITY_ZIP_MAP[d] || "";
      if (effectiveOZip.length >= 4 && effectiveDZip.length >= 4) {
        try {
          const apiBase = import.meta.env.VITE_API_BASE || window.ZOREE_API_URL || "http://localhost:3001/api";
          const token = localStorage.getItem("zoree_token") || "";
          const resp = await fetch(`${apiBase}/ltl/quote`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
            body: JSON.stringify({
              originZip: effectiveOZip, destZip: effectiveDZip, weight: w,
              freightClass: 70, originCity: o, destCity: d,
            }),
          });
          const data = await resp.json();
          if (data.quotes && data.quotes.length) {
            const czRows = data.quotes.map((q) => ({
              carrier: q.carrier, mode: "LTL",
              base: q.czarBaseGross || q.czarBase || 0,
              fsc: q.fscCharge || 0,
              acc: 0, total: q.totalCharge || 0,
              transit: q.transitDays || null,
              _czarlite: true, _czarliteClass: q.class || 70,
              _cwt: ((q.billedWeight || w) / 100).toFixed(1),
              ratePerCwt: ((q.czarBase || 0) / ((q.billedWeight || w) / 100)).toFixed(2),
              czarBase: q.czarBase, czarBaseGross: q.czarBaseGross || q.czarBase || 0,
              fscCharge: q.fscCharge || 0,
              discountPct: q.discountPct || 0, discountAmt: q.discountAmt || 0,
              _ccLive: !!q._ccLive, _ccFailed: !!q._ccFailed, _pref: false,
              serviceLevel: q.serviceLevel || "",
            }));
            rows = rows.concat(czRows);
          }
        } catch (e) {
          console.warn("[RouteOptimizer] LTL API error, using local fallback:", e.message);
          rows = rows.concat(localCzarliteFallback(w, dist));
        }
      } else {
        rows = rows.concat(localCzarliteFallback(w, dist));
      }
    }

    rows.sort((a, b) => a.total - b.total);
    return rows;
  }

  /* ── Local CzarLite fallback when API unavailable ── */
  function localCzarliteFallback(w, dist) {
    const synthCarrierDefs = [
      { name: "Old Dominion Freight", fscPct: 0, ccLive: false, ccFailed: true },
      { name: "Averitt Express", fscPct: 0, ccLive: true, transit: 1, pref: true },
    ];
    return synthCarrierDefs.map((def) => {
      const czRate = getCzarliteRate(w, 70, dist, `${def.fscPct}%`);
      if (!czRate) return null;
      return {
        carrier: def.name, mode: "LTL", base: czRate.base, fsc: czRate.fuel,
        acc: czRate.acc, total: czRate.total,
        transit: def.transit || null,
        _czarlite: true, _czarliteClass: czRate.resolvedClass,
        _cwt: czRate.cwt, ratePerCwt: czRate.ratePerCwt,
        czarBase: czRate.base, czarBaseGross: czRate.base,
        fscCharge: czRate.fuel, discountPct: 0, discountAmt: 0,
        _ccLive: def.ccLive || false, _ccFailed: def.ccFailed || false, _pref: def.pref || false,
      };
    }).filter(Boolean);
  }

  /* ── Optimize handler ── */
  async function handleOptimize(silent) {
    const wNum = parseInt(weight) || 5000;
    const util = Math.min(100, Math.round((wNum / 44000) * 100));

    setLoadingCzarlite(true);
    try {
      const rows = await fetchRateRows({
        o: origin, d: dest, modeFilter: mode, wt: czarWeight || weight,
        oZip: czarOriginZip || originZip, dZip: czarDestZip || destZip,
      });
      const best = rows[0] || { carrier: "TBD", mode: "\u2014", base: 0, fuel: 0, acc: 0, total: 0, _czarlite: false };

      // Use best carrier's miles, fallback to 750
      const dist = best.miles || getDist(origin, dest);
      const hrs = (dist / 55).toFixed(1);
      const hosOk = parseFloat(hrs) <= 11;

      setRateCompareRows(rows);
      setOptResults({ origin, dest, dist, hrs, hosOk, best, util, allCount: rows.length });
      setOptimized(true);
      if (!silent) showToast(`Route optimized \u2014 ${rows.length} carriers compared (${mode})`, "success");
    } finally {
      setLoadingCzarlite(false);
    }
  }

  /* ── Auto-refresh when ZIP or weight changes (like old HTML onRateZipChange) ── */
  const debounceRef = useRef(null);
  const isFirstRender = useRef(true);
  useEffect(() => {
    // Skip on first render
    if (isFirstRender.current) { isFirstRender.current = false; return; }
    // Auto-refresh: if not yet optimized, only trigger when both ZIPs are valid
    const oZ = czarOriginZip || originZip;
    const dZ = czarDestZip || destZip;
    if (!optimized && (oZ.length < 4 || dZ.length < 4)) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      const wNum = parseInt(weight) || 5000;
      const util = Math.min(100, Math.round((wNum / 44000) * 100));
      setLoadingCzarlite(true);
      try {
        const rows = await fetchRateRows({
          o: origin, d: dest, modeFilter: mode, wt: czarWeight || weight,
          oZip: czarOriginZip || originZip, dZip: czarDestZip || destZip,
        });
        const best = rows[0] || { carrier: "TBD", mode: "\u2014", base: 0, fuel: 0, acc: 0, total: 0, _czarlite: false };
        const dist = best.miles || getDist(origin, dest);
        const hrs = (dist / 55).toFixed(1);
        const hosOk = parseFloat(hrs) <= 11;
        setRateCompareRows(rows);
        setOptResults({ origin, dest, dist, hrs, hosOk, best, util, allCount: rows.length });
      } finally {
        setLoadingCzarlite(false);
      }
    }, 600);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [czarOriginZip, czarDestZip, czarWeight, originZip, destZip, weight]);

  /* ── Sorted rate compare rows ── */
  const sortedRows = useMemo(() => {
    return [...rateCompareRows].sort((a, b) => {
      const av = a[sortCol], bv = b[sortCol];
      if (typeof av === "number" && typeof bv === "number") return sortAsc ? av - bv : bv - av;
      return sortAsc
        ? String(av || "").localeCompare(String(bv || ""))
        : String(bv || "").localeCompare(String(av || ""));
    });
  }, [rateCompareRows, sortCol, sortAsc]);

  function toggleSort(col) {
    if (sortCol === col) setSortAsc(!sortAsc);
    else { setSortCol(col); setSortAsc(true); }
  }

  const SortIcon = ({ col }) => (
    <span style={{ opacity: sortCol === col ? 1 : 0.3, marginLeft: 4, fontSize: 10 }}>
      {sortCol === col ? (sortAsc ? "\u25B2" : "\u25BC") : "\u21C5"}
    </span>
  );

  /* ═════════════════════ RENDER ═════════════════════ */
  return (
    <div>
      {/* ── Page Header ── */}
      <div className="page-header">
        <div>
          <div className="page-title">Route Optimizer</div>
          <div className="page-sub">Build and optimize multi-stop routes with cost &amp; HOS analysis</div>
        </div>
        <div className="header-actions">
          <button className="btn btn-primary btn-sm" onClick={handleOptimize} disabled={loadingCzarlite}>
            {loadingCzarlite ? "⏳ Optimizing..." : "⚡ Optimize Route"}
          </button>
        </div>
      </div>

      <div className="page-content">
        {/* ── Toast ── */}
        {toast.text && (
          <div
            style={{
              marginBottom: 12, padding: "10px 16px", borderRadius: 10,
              background: toast.type === "success" ? "var(--green-dim)" : "var(--accent-glow)",
              border: `1px solid ${toast.type === "success" ? "rgba(16,185,129,.25)" : "rgba(59,130,246,.25)"}`,
              fontSize: 13, fontWeight: 600,
              color: toast.type === "success" ? "var(--green)" : "var(--accent)",
            }}
          >
            {toast.text}
          </div>
        )}

        {/* ── Route Builder + Results ── */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
          {/* Route Builder Card */}
          <div className="card">
            <div className="card-header">
              <span className="card-title">Route Builder</span>
            </div>
            <div className="card-body">
              <div style={{ marginBottom: 12 }}>
                <label>Origin</label>
                <select
                  value={origin} onChange={(e) => setOrigin(e.target.value)}
                  style={{ width: "100%", marginTop: 6 }}
                >
                  {ORIGINS.map((o) => <option key={o}>{o}</option>)}
                </select>
              </div>
              <div style={{ marginBottom: 12 }}>
                <label>Destination</label>
                <select
                  value={dest} onChange={(e) => setDest(e.target.value)}
                  style={{ width: "100%", marginTop: 6 }}
                >
                  {DESTINATIONS.map((d) => <option key={d}>{d}</option>)}
                </select>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <div>
                  <label>Load Type</label>
                  <select
                    value={mode}
                    onChange={(e) => setMode(e.target.value)}
                    style={{ width: "100%", marginTop: 6 }}
                  >
                    <option value="ALL">All</option>
                    <option value="TL">TL</option>
                    <option value="LTL">LTL</option>
                  </select>
                </div>
                <div>
                  <label>Weight (lbs)</label>
                  <input
                    type="number" value={weight}
                    onChange={(e) => handleWeightChange(e.target.value)}
                    style={{ width: "100%", marginTop: 6 }}
                  />
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 10 }}>
                <div>
                  <label style={{ fontSize: 11, color: "var(--text3)", fontWeight: 600 }}>
                    Origin ZIP <span style={{ color: "#6366f1", fontSize: 10 }}>for LTL CzarLite</span>
                  </label>
                  <input
                    type="text" placeholder="e.g. 77001" maxLength={10}
                    value={originZip} onChange={(e) => handleOriginZipChange(e.target.value)}
                    style={{ width: "100%", marginTop: 6, fontFamily: "monospace" }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: 11, color: "var(--text3)", fontWeight: 600 }}>
                    Dest ZIP <span style={{ color: "#6366f1", fontSize: 10 }}>for LTL CzarLite</span>
                  </label>
                  <input
                    type="text" placeholder="e.g. 75201" maxLength={10}
                    value={destZip} onChange={(e) => handleDestZipChange(e.target.value)}
                    style={{ width: "100%", marginTop: 6, fontFamily: "monospace" }}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Optimization Results Card */}
          <div className="card">
            <div className="card-header">
              <span className="card-title">Optimization Results</span>
            </div>
            <div className="card-body">
              {!optimized ? (
                <div style={{ textAlign: "center", padding: "40px 20px", color: "var(--text3)" }}>
                  <div style={{ fontSize: 40, marginBottom: 10, opacity: 0.3 }}>🗺️</div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text2)" }}>
                    Click Optimize Route to calculate
                  </div>
                </div>
              ) : optResults && (
                <div>
                  {/* Origin → Dest header */}
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "var(--text3)", marginBottom: 10 }}>
                    <span style={{ fontWeight: 600 }}>{optResults.origin}</span>
                    <span>→</span>
                    <span style={{ fontWeight: 600 }}>{optResults.dest}</span>
                  </div>
                  <div style={{ height: 4, background: "linear-gradient(90deg,var(--green),var(--accent))", borderRadius: 4, marginBottom: 16 }} />

                  {/* Result rows */}
                  {[
                    { icon: "📍", label: "Distance", value: `${optResults.dist.toLocaleString()} miles` },
                    { icon: "⏱", label: "Drive Time", value: `${optResults.hrs} hrs @ 55 mph` },
                    {
                      icon: "🚛", label: "Best Carrier",
                      value: (
                        <span style={{ color: "var(--accent)", fontWeight: 700 }}>
                          {optResults.best.carrier}
                          {optResults.best._czarlite && (
                            <span style={{ fontSize: 10, background: "#4f46e5", color: "#fff", padding: "2px 7px", borderRadius: 5, fontWeight: 700, marginLeft: 5 }}>
                              LTL·CzarLite
                            </span>
                          )}
                          {!optResults.best._czarlite && optResults.best.mode === "LTL" && (
                            <span style={{ fontSize: 10, background: "#0891b2", color: "#fff", padding: "1px 6px", borderRadius: 5, fontWeight: 700, marginLeft: 5 }}>
                              LTL
                            </span>
                          )}
                        </span>
                      ),
                    },
                    {
                      icon: "⛽", label: "Linehaul + FSC",
                      value: `$${optResults.best.base.toLocaleString()} + $${optResults.best.fuel?.toLocaleString() || optResults.best.fsc?.toLocaleString() || 0}`,
                    },
                    {
                      icon: "💰", label: "Total Est. (cheapest)",
                      bold: true,
                      value: (
                        <span className="mono" style={{ color: "var(--green)", fontSize: 16, fontWeight: 800 }}>
                          ${optResults.best.total.toLocaleString()}
                        </span>
                      ),
                    },
                  ].map(({ icon, label, value, bold }, i) => (
                    <div key={i} style={{
                      marginBottom: 6, display: "flex", justifyContent: "space-between",
                      padding: "8px 0", borderBottom: "1px solid var(--border)",
                    }}>
                      <span style={{ color: bold ? "var(--text)" : "var(--text2)", fontWeight: bold ? 700 : 400 }}>
                        {icon} {label}
                      </span>
                      <span className="mono">{value}</span>
                    </div>
                  ))}

                  {/* Utilization bar */}
                  <div style={{ marginTop: 10, marginBottom: 4 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
                      <span style={{ fontSize: 11, color: "var(--text3)" }}>Trailer Utilization</span>
                      <span
                        className="mono"
                        style={{
                          fontSize: 11,
                          color: optResults.util >= 90 ? "var(--green)" : optResults.util >= 70 ? "var(--yellow)" : "var(--red)",
                        }}
                      >
                        {optResults.util}% of 44,000 lbs
                      </span>
                    </div>
                    <div style={{ background: "#f1f5f9", borderRadius: 6, height: 7 }}>
                      <div
                        style={{
                          width: `${optResults.util}%`,
                          background: optResults.util >= 90 ? "var(--green)" : optResults.util >= 70 ? "var(--yellow)" : "var(--red)",
                          borderRadius: 6, height: 7,
                        }}
                      />
                    </div>
                  </div>

                  {/* HOS Alert */}
                  <div
                    className={`alert ${optResults.hosOk ? "alert-success" : "alert-warning"}`}
                    style={{ marginTop: 12, display: "flex", gap: 8, alignItems: "flex-start", padding: "10px 14px", borderRadius: 10 }}
                  >
                    <span className="alert-icon">{optResults.hosOk ? "✅" : "⚠️"}</span>
                    <div className="alert-text">
                      <strong>HOS: </strong>
                      {optResults.hosOk
                        ? "Within 11-hour single-driver limit"
                        : "Exceeds single-driver limit \u2014 consider team drivers"
                      }
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── Carrier Rate Comparison Table ── */}
        <div className="card">
          <div className="card-header" style={{ flexWrap: "wrap", gap: 10 }}>
            <span className="card-title">Carrier Rate Comparison</span>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginLeft: "auto" }}>
              <label style={{ fontSize: 11, color: "var(--text3)", fontWeight: 600, whiteSpace: "nowrap" }}>Origin ZIP:</label>
              <input
                type="text" placeholder="77001" maxLength={10}
                value={czarOriginZip} onChange={(e) => handleCzarOriginZipChange(e.target.value)}
                style={{
                  width: 75, fontFamily: "monospace", fontSize: 12, padding: "5px 8px",
                  border: "1.5px solid rgba(99,102,241,.35)", borderRadius: 7,
                  background: "#f5f3ff", outline: "none",
                }}
              />
              <label style={{ fontSize: 11, color: "var(--text3)", fontWeight: 600, whiteSpace: "nowrap" }}>Dest ZIP:</label>
              <input
                type="text" placeholder="75201" maxLength={10}
                value={czarDestZip} onChange={(e) => handleCzarDestZipChange(e.target.value)}
                style={{
                  width: 75, fontFamily: "monospace", fontSize: 12, padding: "5px 8px",
                  border: "1.5px solid rgba(99,102,241,.35)", borderRadius: 7,
                  background: "#f5f3ff", outline: "none",
                }}
              />
              <label style={{ fontSize: 11, color: "var(--text3)", fontWeight: 600, whiteSpace: "nowrap" }}>Weight:</label>
              <input
                type="number" value={czarWeight} min={100} max={44000} step={500}
                onChange={(e) => handleCzarWeightChange(e.target.value)}
                style={{
                  width: 80, padding: "5px 8px",
                  border: "1.5px solid rgba(99,102,241,.35)", borderRadius: 7,
                  fontSize: 12, fontFamily: "inherit", color: "#4338ca", fontWeight: 600,
                  background: "#f5f3ff", outline: "none",
                }}
              />
            </div>
          </div>
          <div className="card-body" style={{ padding: 0 }}>
            <div className="table-wrap">
              <table style={{ width: "100%", tableLayout: "fixed", textTransform: "uppercase" }}>
                <colgroup>
                  <col style={{ width: "16%" }} />  {/* Carrier */}
                  <col style={{ width: "6%" }} />   {/* Mode */}
                  <col style={{ width: "8%" }} />   {/* Base Rate */}
                  <col style={{ width: "8%" }} />   {/* Discount */}
                  <col style={{ width: "7%" }} />   {/* FSC */}
                  <col style={{ width: "9%" }} />   {/* Total */}
                  <col style={{ width: "9%" }} />   {/* Service Level */}
                  <col style={{ width: "10%" }} />  {/* Transit Days */}
                  <col style={{ width: "10%" }} />  {/* Est. Delivery */}
                  <col style={{ width: "7%" }} />   {/* Score */}
                  <col style={{ width: "10%" }} />  {/* Actions */}
                </colgroup>
                <thead>
                  <tr>
                    {[
                      { col: "carrier", label: "Carrier" },
                      { col: "mode", label: "Mode" },
                      { col: "base", label: "Base Rate" },
                      { col: null, label: "Discount" },
                      { col: "fsc", label: "FSC" },
                      { col: "total", label: "Total" },
                      { col: "serviceLevel", label: "Service Level" },
                      { col: "transit", label: "Transit Days" },
                      { col: null, label: "Est. Delivery" },
                      { col: null, label: "Score" },
                      { col: null, label: "" },
                    ].map(({ col, label }, idx) => (
                      <th
                        key={idx}
                        onClick={col ? () => toggleSort(col) : undefined}
                        style={{
                          cursor: col ? "pointer" : "default",
                          color: sortCol === col ? "var(--accent)" : undefined,
                          background: sortCol === col ? "rgba(59,130,246,.06)" : undefined,
                          padding: "12px 14px",
                        }}
                      >
                        {label} {col && <SortIcon col={col} />}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sortedRows.length === 0 ? (
                    <tr>
                      <td colSpan={11} style={{ textAlign: "center", padding: 40, color: "var(--text3)", fontSize: 13 }}>
                        {optimized
                          ? "No carrier rates found for this lane"
                          : "Click Optimize Route above to compare carrier rates"}
                      </td>
                    </tr>
                  ) : (
                    sortedRows.map((o, i) => {
                      const isBest = i === 0 && sortCol === "total" && sortAsc;
                      const rowStyle = o._czarlite
                        ? { background: "rgba(99,102,241,.04)", borderLeft: "3px solid #6366f1" }
                        : {};

                      // CzarLite badge
                      const czBadge = o._czarlite ? (
                        <span style={{
                          fontSize: 10, background: "linear-gradient(135deg,#312e81,#4f46e5)",
                          color: "#fff", padding: "2px 7px", borderRadius: 8, fontWeight: 700, marginLeft: 6,
                          display: "inline-block", textTransform: "none", verticalAlign: "middle",
                          letterSpacing: 0.3,
                        }}>
                          CzarLite{o._czarliteClass ? ` Cl.${o._czarliteClass}` : ""} – LTL
                        </span>
                      ) : null;

                      // Rate note for CzarLite
                      const rateNote = o._czarlite ? (
                        <div style={{ fontSize: 9, color: "#6366f1", marginTop: 3, whiteSpace: "normal", textTransform: "none" }}>
                          CzarLite base ${o.czarBaseGross || o.czarBase || o.base || 0}
                          {o.discountAmt > 0 && ` − $${o.discountAmt} disc`}
                          {` + FSC $${o.fscCharge || o.fsc || 0}`}
                        </div>
                      ) : null;

                      // Discount cell
                      const discCell = o.discountAmt && o.discountAmt > 0 ? (
                        <span style={{ color: "#059669", fontWeight: 700 }}>
                          -${o.discountAmt}
                          {o.discountPct > 0 && (
                            <div style={{ fontSize: 9, color: "#059669" }}>{o.discountPct}%</div>
                          )}
                        </span>
                      ) : "\u2014";

                      // Transit with TMS/CC label
                      let transitCell;
                      if (o._ccLive && o.transit) {
                        transitCell = (
                          <span>
                            {o.transit} day{o.transit > 1 ? "s" : ""}
                            {" "}<span style={{ fontSize: 9, background: "#059669", color: "#fff", padding: "1px 5px", borderRadius: 4, marginLeft: 3 }}>CC</span>
                          </span>
                        );
                      } else if (o._ccFailed) {
                        transitCell = <span style={{ fontSize: 10, color: "#dc2626" }}>CC Unlicensed</span>;
                      } else if (o.transit) {
                        transitCell = (
                          <span>
                            {o.transit} day{o.transit > 1 ? "s" : ""}
                            {" "}<span style={{ fontSize: 9, color: "var(--text3)", textTransform: "none" }}>(TMS)</span>
                          </span>
                        );
                      } else {
                        transitCell = "\u2014";
                      }

                      // Score
                      const score = isBest
                        ? <span style={{ color: "var(--green)", fontWeight: 700 }}>Best</span>
                        : o._pref
                          ? <span style={{ color: "var(--accent)", fontWeight: 600 }}>Pref</span>
                          : o._czarlite
                            ? <span style={{ color: "#6366f1" }}>CzarLite</span>
                            : "-";

                      return (
                        <tr key={`${o.carrier}-${o.mode}-${i}`} style={rowStyle}>
                          <td style={{ whiteSpace: "normal", padding: "16px 14px" }}>
                            <strong>{o.carrier}</strong>
                            {czBadge}
                            {o._ccLive && (
                              <span style={{
                                fontSize: 9, background: "linear-gradient(135deg,#065f46,#059669)",
                                color: "#fff", padding: "1px 6px", borderRadius: 8, fontWeight: 700,
                                marginLeft: 4, display: "inline-block", textTransform: "none",
                                verticalAlign: "middle",
                              }}>CC</span>
                            )}
                            {rateNote}
                            {o.miles && !o._czarlite && (
                              <div style={{ fontSize: 9, color: o.pcmilerMiles ? "#a855f7" : "var(--text3)", marginTop: 3, textTransform: "none" }}>
                                📏 {o.miles.toLocaleString()} mi{o.pcmilerMiles ? " (PC*MILER)" : ""}
                              </div>
                            )}
                          </td>
                          <td style={{ padding: "16px 14px" }}><span className="tag">{o.mode}</span></td>
                          <td className="mono" style={{ padding: "16px 14px" }}>${(o.base || 0).toLocaleString()}</td>
                          <td className="mono" style={{ padding: "16px 14px" }}>{discCell}</td>
                          <td className="mono" style={{ padding: "16px 14px" }}>
                            {((o.fsc || 0) + (o.acc || 0)) > 0
                              ? `$${((o.fsc || 0) + (o.acc || 0)).toLocaleString()}`
                              : "$0"}
                          </td>
                          <td
                            className="mono"
                            style={{
                              padding: "16px 14px",
                              color: isBest ? "var(--green)" : o._czarlite ? "#6366f1" : "var(--text)",
                              fontWeight: 700,
                            }}
                          >
                            ${(o.total || 0).toLocaleString()}
                          </td>
                          <td className="text-sm" style={{ padding: "16px 14px", textAlign: "center" }}>
                            {(o.serviceLevel || "\u2014").toUpperCase()}
                          </td>
                          <td className="mono" style={{ padding: "16px 14px" }}>{transitCell}</td>
                          <td className="mono" style={{ padding: "16px 14px" }}>{"\u2014"}</td>
                          <td style={{ padding: "16px 14px" }}>{score}</td>
                          <td style={{ padding: "16px 14px", textAlign: "right" }}>
                            <button
                              className="btn btn-primary btn-sm"
                              onClick={() => showToast(`Selected ${o.carrier} (${o.mode}) — $${o.total.toLocaleString()}`, "success")}
                            >
                              Select
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                  {/* Hint row for ZIPs */}
                  {optimized && sortedRows.length > 0 && (!czarOriginZip || !czarDestZip) && (
                    <tr>
                      <td colSpan={11} style={{ textAlign: "center", color: "#9ca3af", padding: "14px 12px", fontSize: 11, letterSpacing: 0.5 }}>
                        Enter Origin ZIP + Dest ZIP above for live LTL rates
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
