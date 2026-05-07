import { useMemo, useState } from "react";
import { useOutletContext } from "react-router-dom";
import {
  saveItem as saveItemRecord,
  duplicateItem as duplicateItemRecord,
  setItemStatus,
  savePackaging,
  setPackagingStatus,
  readItemDescription,
  readPkgDescription,
} from "../services/itemMasterService";
import { useFeatureAccess } from "../hooks/useFeatureAccess";

const EMPTY_ITEM = {
  id: "", description: "", customer: "", class: "General", nmfc: "", freight_class: "70",
  weight_unit: "", value_unit: "", len: "", wid: "", hgt: "",
  units_per_pallet: "", pkg: "Carton", stack: 1,
  hazmat: false, fragile: false, temp_ctrl: false, top_load: false,
  un: "", haz_class: "", status: "Active",
};

const EMPTY_PKG = {
  id: "", description: "", type: "Carton", material: "Corrugated",
  len: "", wid: "", hgt: "", tare: "", max_load: "", stack: 1,
  returnable: false, nested: false, hazmat: false,
  cost: "", supplier: "", status: "Active",
};

const CLASS_COLORS = {
  Electronics: { bg: "rgba(59,130,246,.1)", border: "rgba(59,130,246,.35)", text: "var(--accent)" },
  Industrial: { bg: "rgba(245,158,11,.1)", border: "rgba(245,158,11,.35)", text: "var(--yellow)" },
  Perishable: { bg: "rgba(16,185,129,.1)", border: "rgba(16,185,129,.35)", text: "var(--green)" },
  Hazmat: { bg: "rgba(239,68,68,.1)", border: "rgba(239,68,68,.35)", text: "var(--red)" },
  General: { bg: "rgba(107,114,128,.1)", border: "rgba(107,114,128,.35)", text: "var(--text3)" },
};

const TYPE_COLORS = {
  Carton: { bg: "rgba(59,130,246,.1)", border: "rgba(59,130,246,.3)", text: "var(--accent)" },
  Pallet: { bg: "rgba(245,158,11,.1)", border: "rgba(245,158,11,.3)", text: "var(--yellow)" },
  Drum:   { bg: "rgba(239,68,68,.1)", border: "rgba(239,68,68,.3)", text: "var(--red)" },
  Crate:  { bg: "rgba(107,114,128,.1)", border: "rgba(107,114,128,.3)", text: "var(--text3)" },
  Tote:   { bg: "rgba(16,185,129,.1)", border: "rgba(16,185,129,.3)", text: "var(--green)" },
  Bag:    { bg: "rgba(99,102,241,.1)", border: "rgba(99,102,241,.3)", text: "#6366f1" },
  IBC:    { bg: "rgba(239,68,68,.1)", border: "rgba(239,68,68,.3)", text: "var(--red)" },
};

const SEED_PACKAGING = [
  { id:"CTN-001", desc:"Standard Export Carton \u2014 Small",    type:"Carton", material:"Corrugated", len:12, wid:10, hgt:8,  tare:1.2, max_load:40,   stack:8,  returnable:false, nested:true,  hazmat:false, cost:1.85,  supplier:"Uline",          status:"Active" },
  { id:"CTN-002", desc:"Standard Export Carton \u2014 Medium",   type:"Carton", material:"Corrugated", len:18, wid:14, hgt:10, tare:1.8, max_load:65,   stack:6,  returnable:false, nested:true,  hazmat:false, cost:2.40,  supplier:"Uline",          status:"Active" },
  { id:"CTN-003", desc:"Standard Export Carton \u2014 Large",    type:"Carton", material:"Corrugated", len:24, wid:18, hgt:18, tare:2.5, max_load:100,  stack:5,  returnable:false, nested:true,  hazmat:false, cost:3.60,  supplier:"Uline",          status:"Active" },
  { id:"CTN-004", desc:"Heavy-Duty Double-Wall Carton",          type:"Carton", material:"Corrugated", len:24, wid:20, hgt:20, tare:4.2, max_load:200,  stack:4,  returnable:false, nested:false, hazmat:false, cost:5.10,  supplier:"Pratt",          status:"Active" },
  { id:"CTN-005", desc:"Electronics Anti-Static Carton",         type:"Carton", material:"Corrugated", len:16, wid:12, hgt:6,  tare:1.5, max_load:30,   stack:8,  returnable:false, nested:true,  hazmat:false, cost:4.20,  supplier:"Uline",          status:"Active" },
  { id:"PLT-001", desc:"GMA Standard Wood Pallet 48\u00D740",   type:"Pallet", material:"Wood",       len:48, wid:40, hgt:5,  tare:45,  max_load:2800, stack:3,  returnable:true,  nested:false, hazmat:false, cost:14.50, supplier:"CHEP",           status:"Active" },
  { id:"PLT-002", desc:"Euro Pallet 47\u00D731",                type:"Pallet", material:"Wood",       len:47, wid:31, hgt:5,  tare:33,  max_load:2200, stack:3,  returnable:true,  nested:false, hazmat:false, cost:12.00, supplier:"CHEP",           status:"Active" },
  { id:"PLT-003", desc:"Plastic Pallet 48\u00D740 \u2014 Rackable", type:"Pallet", material:"Plastic", len:48, wid:40, hgt:6, tare:55, max_load:3000, stack:4, returnable:true, nested:true, hazmat:false, cost:65.00, supplier:"iGPS", status:"Active" },
  { id:"PLT-004", desc:"Half Pallet 24\u00D740",                type:"Pallet", material:"Wood",       len:24, wid:40, hgt:5,  tare:22,  max_load:1400, stack:3,  returnable:true,  nested:false, hazmat:false, cost:8.00,  supplier:"CHEP",           status:"Active" },
  { id:"DRM-001", desc:"Steel Drum 55-Gallon Open Head",        type:"Drum",   material:"Steel",      len:23, wid:23, hgt:36, tare:42,  max_load:440,  stack:2,  returnable:true,  nested:false, hazmat:true,  cost:58.00, supplier:"Container Pros", status:"Active" },
  { id:"DRM-002", desc:"Plastic Drum 55-Gallon Closed",         type:"Drum",   material:"Plastic",    len:23, wid:23, hgt:36, tare:22,  max_load:400,  stack:2,  returnable:true,  nested:false, hazmat:true,  cost:38.00, supplier:"Container Pros", status:"Active" },
  { id:"DRM-003", desc:"Fiber Drum 25-Gallon",                  type:"Drum",   material:"Fiber",      len:18, wid:18, hgt:28, tare:8,   max_load:180,  stack:3,  returnable:false, nested:false, hazmat:false, cost:18.00, supplier:"Greif",          status:"Active" },
  { id:"CRT-001", desc:"Heavy Equipment Crate 36\u00D730\u00D730",  type:"Crate", material:"Wood",   len:36, wid:30, hgt:30, tare:85,  max_load:1200, stack:1,  returnable:false, nested:false, hazmat:false, cost:125.00,supplier:"PakTech",        status:"Active" },
  { id:"CRT-002", desc:"Server/Electronics Crate 80\u00D730\u00D746", type:"Crate", material:"Wood", len:80, wid:30, hgt:46, tare:120, max_load:600,  stack:1,  returnable:false, nested:false, hazmat:false, cost:185.00,supplier:"PakTech",        status:"Active" },
  { id:"TOT-001", desc:"Reusable Tote 24\u00D716\u00D713 \u2014 Plastic", type:"Tote", material:"Plastic", len:24, wid:16, hgt:13, tare:5.5, max_load:90, stack:6, returnable:true, nested:true, hazmat:false, cost:28.00, supplier:"Orbis", status:"Active" },
  { id:"TOT-002", desc:"Bulk Tote / Gaylord 48\u00D740\u00D736", type:"Tote", material:"Corrugated", len:48, wid:40, hgt:36, tare:18, max_load:2200, stack:1, returnable:false, nested:false, hazmat:false, cost:22.00, supplier:"Uline", status:"Active" },
  { id:"BAG-001", desc:"Poly Woven Bag 50-lb",                  type:"Bag",    material:"Plastic",    len:22, wid:14, hgt:4,  tare:0.3, max_load:50,   stack:10, returnable:false, nested:true,  hazmat:false, cost:0.65,  supplier:"Texcraft",       status:"Active" },
  { id:"IBC-001", desc:"IBC Tote 275-Gallon \u2014 Steel Cage", type:"IBC",    material:"Plastic",    len:46, wid:46, hgt:46, tare:145, max_load:2700, stack:2,  returnable:true,  nested:false, hazmat:true,  cost:320.00,supplier:"Schutz",         status:"Active" },
];

export default function ItemMasterPage() {
  const { items, packagingUnits: dbPackagingUnits = [], setData, refreshData } = useOutletContext();
  // QA #138 follow-up: matrix-driven write gate. When canEdit is false the
  // page renders read-only — Save / +New / Edit / Delete / status toggles
  // all disable. Admin always has canEdit=true via the hook's role
  // override; "view" roles see the data but no mutation affordances.
  const { canEdit: canEditItems } = useFeatureAccess("items");
  const noEditTitle = canEditItems ? "" : "View-only access — ask an admin for Edit on Items";
  // Use seed data as fallback when DB table is empty
  const packagingUnits = dbPackagingUnits.length > 0 ? dbPackagingUnits : SEED_PACKAGING;
  const [tab, setTab] = useState("items");
  const [q, setQ] = useState("");
  const [classFilter, setClassFilter] = useState("");
  const [pkgSearch, setPkgSearch] = useState("");
  const [pkgTypeFilter, setPkgTypeFilter] = useState("");
  const [busyId, setBusyId] = useState("");
  const [message, setMessage] = useState({ text: "", type: "" });
  const [editItem, setEditItem] = useState(null);
  const [editPkg, setEditPkg] = useState(null);
  const [sortCol, setSortCol] = useState("id");
  const [sortAsc, setSortAsc] = useState(true);
  const [pkgSortCol, setPkgSortCol] = useState("id");
  const [pkgSortAsc, setPkgSortAsc] = useState(true);
  const [view, setView] = useState("table");

  function toast(text, type = "info") {
    setMessage({ text, type });
    setTimeout(() => setMessage({ text: "", type: "" }), 4000);
  }

  // ── Items logic ─────────────────────────────────────────────
  const rows = useMemo(() => {
    let list = [...items];
    if (q.trim()) {
      const t = q.toLowerCase();
      list = list.filter((it) =>
        [it.id, readItemDescription(it), it.customer, it.item_class, it.nmfc, it.fclass]
          .some((v) => String(v || "").toLowerCase().includes(t))
      );
    }
    if (classFilter) {
      list = list.filter((it) => (it.item_class || it.class || "General") === classFilter);
    }
    return list.sort((a, b) => {
      // For the description column, sort using the read helper so legacy
      // rows (where the value was once stored under `desc`) still order
      // correctly alongside rows that now use `description`.
      if (sortCol === "description") {
        const av = readItemDescription(a).toLowerCase();
        const bv = readItemDescription(b).toLowerCase();
        return sortAsc ? av.localeCompare(bv) : bv.localeCompare(av);
      }
      const av = String(a[sortCol] || "").toLowerCase();
      const bv = String(b[sortCol] || "").toLowerCase();
      return sortAsc ? av.localeCompare(bv) : bv.localeCompare(av);
    });
  }, [items, q, classFilter, sortCol, sortAsc]);

  const kpis = useMemo(() => {
    const total = items.length;
    const hazmat = items.filter((it) => it.hazmat).length;
    const highValue = items.filter((it) => parseFloat(it.value_unit) > 10000).length;
    const active = items.filter((it) => (it.status || "Active") === "Active").length;
    const weights = items.map((it) => parseFloat(it.weight_unit) || 0).filter((w) => w > 0);
    const avgWeight = weights.length > 0 ? Math.round(weights.reduce((a, b) => a + b, 0) / weights.length) : 0;
    return { total, hazmat, highValue, active, avgWeight };
  }, [items]);

  function toggleSort(col) {
    if (sortCol === col) setSortAsc(!sortAsc);
    else { setSortCol(col); setSortAsc(true); }
  }

  function openNew() { setEditItem({ ...EMPTY_ITEM }); }
  function openEdit(item) {
    setEditItem({
      ...item,
      description: readItemDescription(item),
      class: item.item_class || item.class || "General",
      freight_class: item.fclass || item.freight_class || "70",
      _originalId: item.id,
    });
  }
  function editField(key, value) { setEditItem((p) => ({ ...p, [key]: value })); }

  async function saveItem() {
    if (!editItem) return;
    if (!editItem.id || !editItem.description) {
      toast("Item ID and Description are required", "warning");
      return;
    }
    setBusyId("saving");
    try {
      await saveItemRecord({ form: editItem, originalId: editItem._originalId });
      toast(`Item ${(editItem.id || "").toUpperCase()} saved`, "success");
      setEditItem(null);
      await refreshData();
    } catch (err) {
      toast(`Failed: ${err.message}`, "error");
    } finally {
      setBusyId("");
    }
  }

  async function duplicateItem(item) {
    const newId = item.id + "-COPY";
    setBusyId(item.id);
    try {
      await duplicateItemRecord(item);
      toast(`Duplicated as ${newId}`, "success");
      await refreshData();
    } catch (err) {
      toast(`Failed: ${err.message}`, "error");
    } finally {
      setBusyId("");
    }
  }

  async function toggleStatus(item) {
    const newStatus = (item.status || "Active") === "Active" ? "Inactive" : "Active";
    setBusyId(item.id);
    try {
      await setItemStatus(item.id, newStatus);
      toast(`${item.id} set to ${newStatus}`, "success");
      await refreshData();
    } catch (err) {
      toast(`Failed: ${err.message}`, "error");
    } finally {
      setBusyId("");
    }
  }

  function exportItems() {
    const headers = ["ID", "Description", "Class", "NMFC", "Freight Class", "Weight/Unit", "Value/Unit", "Dims", "Units/Pallet", "Hazmat", "Status"];
    const csvRows = [headers.join(",")];
    rows.forEach((it) => {
      csvRows.push([
        it.id, `"${readItemDescription(it)}"`, it.item_class || it.class || "",
        it.nmfc, it.fclass || it.freight_class || "", it.weight_unit, it.value_unit,
        `${it.len || 0}x${it.wid || 0}x${it.hgt || 0}`, it.units_per_pallet,
        it.hazmat ? "Yes" : "No", it.status || "Active",
      ].join(","));
    });
    const blob = new Blob([csvRows.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "items-export.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  function getClass(it) { return it.item_class || it.class || "General"; }
  function getDesc(it) { return readItemDescription(it) || "--"; }
  function getDims(it) { return `${it.len || 0}\u00D7${it.wid || 0}\u00D7${it.hgt || 0}`; }

  // ── Packaging Units logic ────────────────────────────────────
  const pkgRows = useMemo(() => {
    let list = [...packagingUnits];
    if (pkgSearch.trim()) {
      const t = pkgSearch.toLowerCase();
      list = list.filter((p) =>
        [p.id, readPkgDescription(p), p.type, p.material, p.supplier]
          .some((v) => String(v || "").toLowerCase().includes(t))
      );
    }
    if (pkgTypeFilter) {
      list = list.filter((p) => p.type === pkgTypeFilter);
    }
    return list.sort((a, b) => {
      if (pkgSortCol === "description") {
        const av = readPkgDescription(a).toLowerCase();
        const bv = readPkgDescription(b).toLowerCase();
        return pkgSortAsc ? av.localeCompare(bv) : bv.localeCompare(av);
      }
      const av = String(a[pkgSortCol] || "").toLowerCase();
      const bv = String(b[pkgSortCol] || "").toLowerCase();
      return pkgSortAsc ? av.localeCompare(bv) : bv.localeCompare(av);
    });
  }, [packagingUnits, pkgSearch, pkgTypeFilter, pkgSortCol, pkgSortAsc]);

  const pkgKpis = useMemo(() => {
    const total = packagingUnits.length;
    const cartons = packagingUnits.filter((p) => p.type === "Carton").length;
    const pallets = packagingUnits.filter((p) => p.type === "Pallet").length;
    const drums = packagingUnits.filter((p) => p.type === "Drum" || p.type === "IBC").length;
    const other = total - cartons - pallets - drums;
    return { total, cartons, pallets, drums, other };
  }, [packagingUnits]);

  function togglePkgSort(col) {
    if (pkgSortCol === col) setPkgSortAsc(!pkgSortAsc);
    else { setPkgSortCol(col); setPkgSortAsc(true); }
  }

  function openNewPkg() { setEditPkg({ ...EMPTY_PKG }); }
  function openEditPkg(pkg) {
    setEditPkg({
      ...pkg,
      // Normalise legacy `desc` field onto the canonical `description`
      // so the Save flow always writes to the right column.
      description: readPkgDescription(pkg),
      _originalId: pkg.id,
    });
  }
  function editPkgField(key, value) { setEditPkg((p) => ({ ...p, [key]: value })); }

  function calcVolume(p) {
    const l = parseFloat(p.len) || 0;
    const w = parseFloat(p.wid) || 0;
    const h = parseFloat(p.hgt) || 0;
    if (l > 0 && w > 0 && h > 0) return ((l * w * h) / 1728).toFixed(2);
    return "--";
  }

  async function savePkg() {
    if (!editPkg) return;
    const desc = editPkg.description || editPkg.desc || "";
    if (!editPkg.id || !desc) {
      toast("Pkg Code and Description are required", "warning");
      return;
    }
    setBusyId("saving-pkg");
    try {
      await savePackaging({ form: editPkg, originalId: editPkg._originalId });
      toast(`Packaging ${(editPkg.id || "").toUpperCase()} saved`, "success");
      setEditPkg(null);
      await refreshData();
    } catch (err) {
      toast(`Failed: ${err.message}`, "error");
    } finally {
      setBusyId("");
    }
  }

  async function togglePkgStatus(pkg) {
    const newStatus = (pkg.status || "Active") === "Active" ? "Inactive" : "Active";
    setBusyId(pkg.id);
    try {
      await setPackagingStatus(pkg.id, newStatus);
      toast(`${pkg.id} set to ${newStatus}`, "success");
      await refreshData();
    } catch (err) {
      toast(`Failed: ${err.message}`, "error");
    } finally {
      setBusyId("");
    }
  }

  // ── Shared components ────────────────────────────────────────
  const SortIcon = ({ col, active }) => {
    const isItems = active === "items";
    const sc = isItems ? sortCol : pkgSortCol;
    const sa = isItems ? sortAsc : pkgSortAsc;
    return (
      <span style={{ opacity: sc === col ? 1 : 0.3, marginLeft: 4 }}>
        {sc === col ? (sa ? "\u25B2" : "\u25BC") : "\u21C5"}
      </span>
    );
  };

  function ClassBadge({ cls }) {
    const c = CLASS_COLORS[cls] || CLASS_COLORS.General;
    return (
      <span style={{ background: c.bg, color: c.text, border: `1px solid ${c.border}`, fontSize: 11, fontWeight: 700, padding: "2px 9px", borderRadius: 20 }}>
        {cls}
      </span>
    );
  }

  function TypeBadge({ type }) {
    const c = TYPE_COLORS[type] || TYPE_COLORS.Carton;
    return (
      <span style={{ background: c.bg, color: c.text, border: `1px solid ${c.border}`, fontSize: 11, fontWeight: 700, padding: "2px 9px", borderRadius: 20 }}>
        {type}
      </span>
    );
  }

  function HandlingBadges({ item }) {
    const badges = [];
    if (item.hazmat) badges.push(<span key="h" style={{ fontSize: 9, background: "rgba(239,68,68,.1)", color: "var(--red)", border: "1px solid rgba(239,68,68,.25)", padding: "1px 5px", borderRadius: 8, fontWeight: 700 }}>HZM</span>);
    if (item.fragile) badges.push(<span key="f" style={{ fontSize: 9, background: "rgba(245,158,11,.1)", color: "var(--yellow)", border: "1px solid rgba(245,158,11,.25)", padding: "1px 5px", borderRadius: 8, fontWeight: 700 }}>FRAG</span>);
    if (item.temp_ctrl) badges.push(<span key="t" style={{ fontSize: 9, background: "rgba(16,185,129,.1)", color: "var(--green)", border: "1px solid rgba(16,185,129,.25)", padding: "1px 5px", borderRadius: 8, fontWeight: 700 }}>TEMP</span>);
    if (item.top_load) badges.push(<span key="tl" style={{ fontSize: 9, background: "rgba(99,102,241,.1)", color: "#6366f1", border: "1px solid rgba(99,102,241,.25)", padding: "1px 5px", borderRadius: 8, fontWeight: 700 }}>TOP</span>);
    if (badges.length === 0) return null;
    return <div style={{ display: "flex", flexWrap: "wrap", gap: 3, marginTop: 4 }}>{badges}</div>;
  }

  function PkgPropertyBadges({ pkg }) {
    const badges = [];
    if (pkg.returnable) badges.push(<span key="r" style={{ fontSize: 9, background: "rgba(16,185,129,.1)", color: "var(--green)", border: "1px solid rgba(16,185,129,.25)", padding: "1px 5px", borderRadius: 8, fontWeight: 700 }}>RET</span>);
    if (pkg.nested) badges.push(<span key="n" style={{ fontSize: 9, background: "rgba(59,130,246,.1)", color: "var(--accent)", border: "1px solid rgba(59,130,246,.25)", padding: "1px 5px", borderRadius: 8, fontWeight: 700 }}>NEST</span>);
    if (pkg.hazmat) badges.push(<span key="h" style={{ fontSize: 9, background: "rgba(239,68,68,.1)", color: "var(--red)", border: "1px solid rgba(239,68,68,.25)", padding: "1px 5px", borderRadius: 8, fontWeight: 700 }}>HZM</span>);
    if (badges.length === 0) return null;
    return <div style={{ display: "flex", flexWrap: "wrap", gap: 3, marginTop: 4 }}>{badges}</div>;
  }

  function StatusBadge({ status }) {
    const isActive = (status || "Active") === "Active";
    return (
      <span style={{
        background: isActive ? "rgba(16,185,129,.1)" : "rgba(107,114,128,.1)",
        color: isActive ? "var(--green)" : "var(--text3)",
        border: `1px solid ${isActive ? "rgba(16,185,129,.3)" : "rgba(107,114,128,.3)"}`,
        fontSize: 11, fontWeight: 700, padding: "2px 9px", borderRadius: 20,
      }}>
        {isActive ? "Active" : "Inactive"}
      </span>
    );
  }

  // Cards view for items
  function renderCards() {
    const CLASS_BG = { Electronics: "#eff6ff", Industrial: "#fffbeb", Perishable: "#f0fdf4", Hazmat: "#fef2f2", General: "#f9fafb" };
    return (
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 12, padding: 16 }}>
        {rows.map((it) => {
          const cls = getClass(it);
          const bg = CLASS_BG[cls] || "#f8faff";
          const col = (CLASS_COLORS[cls] || CLASS_COLORS.General).text;
          const density = it.len && it.wid && it.hgt ? ((it.weight_unit || 0) / ((it.len * it.wid * it.hgt) / 1728)).toFixed(1) + " lbs/ft\u00B3" : "\u2014";
          return (
            <div key={it.id} style={{ background: "#fff", border: "1.5px solid var(--border)", borderRadius: 12, overflow: "hidden", cursor: "pointer" }}
              onClick={() => openEdit(it)}>
              <div style={{ background: bg, padding: "12px 14px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span className="mono" style={{ color: col, fontWeight: 700, fontSize: 12 }}>{it.id}</span>
                <span style={{ color: col, background: bg, border: `1px solid ${col}`, fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 20 }}>{cls}</span>
              </div>
              <div style={{ padding: 14 }}>
                <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4, lineHeight: 1.3 }}>{getDesc(it)}</div>
                <div style={{ fontSize: 11, color: "var(--text3)", marginBottom: 12 }}>{it.customer || "--"}</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, fontSize: 11 }}>
                  <div><span style={{ color: "var(--text3)" }}>Weight: </span><strong>{it.weight_unit || 0} lbs</strong></div>
                  <div><span style={{ color: "var(--text3)" }}>Value: </span><strong style={{ color: "var(--green)" }}>${(it.value_unit || 0).toLocaleString()}</strong></div>
                  <div><span style={{ color: "var(--text3)" }}>Class: </span><strong>{it.fclass || it.freight_class || "--"}</strong></div>
                  <div><span style={{ color: "var(--text3)" }}>Density: </span><strong>{density}</strong></div>
                  <div><span style={{ color: "var(--text3)" }}>Dims: </span><strong>{getDims(it)}"</strong></div>
                  <div><span style={{ color: "var(--text3)" }}>Pkg: </span><strong>{it.units_per_pallet || 1}/pallet</strong></div>
                </div>
                <HandlingBadges item={it} />
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  // Tab toggle style
  const tabStyle = (active) => ({
    padding: "5px 14px", borderRadius: 8, border: "none", fontSize: 12, fontWeight: 600,
    cursor: "pointer", transition: "all .15s", fontFamily: "inherit",
    background: active ? "var(--accent)" : "transparent",
    color: active ? "#fff" : "var(--text3)",
  });

  return (
    <div>
      {/* Page Header */}
      <div className="page-header" style={{ flexDirection: "column", alignItems: "stretch", gap: 10, padding: "16px 28px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <div className="page-title">Item Master</div>
            <div className="page-sub">Product catalog with freight attributes, dimensions, and packaging specs</div>
          </div>
          <div style={{ display: "flex", gap: 2, background: "#f0f4ff", borderRadius: 10, padding: 3, border: "1px solid rgba(59,130,246,.15)" }}>
            <button style={tabStyle(tab === "items")} onClick={() => setTab("items")}>Items</button>
            <button style={tabStyle(tab === "pkg")} onClick={() => setTab("pkg")}>Packaging Units</button>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {tab === "items" ? (
            <>
              <input
                placeholder="Search items..."
                value={q}
                onChange={(e) => setQ(e.target.value)}
                style={{ padding: "7px 12px", border: "1.5px solid var(--border)", borderRadius: 8, fontSize: 13, fontFamily: "inherit", outline: "none", width: 190 }}
              />
              <select
                value={classFilter}
                onChange={(e) => setClassFilter(e.target.value)}
                style={{ padding: "7px 10px", border: "1.5px solid var(--border)", borderRadius: 8, fontSize: 13, fontFamily: "inherit", background: "#fff" }}
              >
                <option value="">All Classes</option>
                <option value="Electronics">Electronics</option>
                <option value="Industrial">Industrial</option>
                <option value="Perishable">Perishable</option>
                <option value="Hazmat">Hazmat</option>
                <option value="General">General</option>
              </select>
              <button className="btn btn-secondary btn-sm" onClick={exportItems}>Export</button>
              <button
                className="btn btn-primary btn-sm"
                onClick={openNew}
                disabled={!canEditItems}
                title={noEditTitle}
              >
                + New Item
              </button>
            </>
          ) : (
            <>
              <input
                placeholder="Search packaging..."
                value={pkgSearch}
                onChange={(e) => setPkgSearch(e.target.value)}
                style={{ padding: "7px 12px", border: "1.5px solid var(--border)", borderRadius: 8, fontSize: 13, fontFamily: "inherit", outline: "none", width: 200 }}
              />
              <select
                value={pkgTypeFilter}
                onChange={(e) => setPkgTypeFilter(e.target.value)}
                style={{ padding: "7px 10px", border: "1.5px solid var(--border)", borderRadius: 8, fontSize: 13, fontFamily: "inherit", background: "#fff" }}
              >
                <option value="">All Types</option>
                <option value="Carton">Carton</option>
                <option value="Pallet">Pallet</option>
                <option value="Drum">Drum</option>
                <option value="Crate">Crate</option>
                <option value="Bag">Bag</option>
                <option value="Roll">Roll</option>
                <option value="Tote">Tote</option>
                <option value="IBC">IBC</option>
              </select>
              <button
                className="btn btn-primary btn-sm"
                onClick={openNewPkg}
                disabled={!canEditItems}
                title={noEditTitle}
              >
                + New Packaging
              </button>
            </>
          )}
        </div>
      </div>
      <div className="page-content">

      {/* Toast */}
      {message.text && (
        <div className={`toast toast-${message.type || "info"}`} style={{ marginBottom: 12 }}>
          {message.text}
        </div>
      )}

      {/* ═══ ITEMS TAB ═══ */}
      {tab === "items" && (
        <>
          {/* KPI Stats */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr 1fr", gap: 12, marginBottom: 20 }}>
            <div className="stat-card blue"><div className="stat-label">Total Items</div><div className="stat-value" style={{ fontSize: 26 }}>{kpis.total}</div></div>
            <div className="stat-card yellow"><div className="stat-label">Hazmat Items</div><div className="stat-value" style={{ fontSize: 26 }}>{kpis.hazmat}</div></div>
            <div className="stat-card red"><div className="stat-label">High-Value (&gt;$10K)</div><div className="stat-value" style={{ fontSize: 26 }}>{kpis.highValue}</div></div>
            <div className="stat-card green"><div className="stat-label">Active Items</div><div className="stat-value" style={{ fontSize: 26 }}>{kpis.active}</div></div>
            <div className="stat-card blue"><div className="stat-label">Avg Weight (lbs)</div><div className="stat-value" style={{ fontSize: 26 }}>{kpis.avgWeight}</div></div>
          </div>

          {/* Product Catalog Card */}
          <div className="card" style={{ padding: 0 }}>
            <div className="card-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span className="card-title">Product Catalog</span>
              <div style={{ display: "flex", gap: 6 }}>
                <button className="btn btn-secondary btn-sm" style={view === "table" ? { background: "var(--accent)", color: "#fff" } : {}} onClick={() => setView("table")}>Table</button>
                <button className="btn btn-secondary btn-sm" style={view === "cards" ? { background: "var(--accent)", color: "#fff" } : {}} onClick={() => setView("cards")}>Cards</button>
              </div>
            </div>

            {view === "table" ? (
              <div className="table-wrap">
              <table className="grid" style={{ border: "none", boxShadow: "none" }}>
                <thead>
                  <tr>
                    <th style={{ cursor: "pointer" }} onClick={() => toggleSort("id")}>Item # <SortIcon col="id" active="items" /></th>
                    <th style={{ cursor: "pointer" }} onClick={() => toggleSort("description")}>Description <SortIcon col="description" active="items" /></th>
                    <th style={{ cursor: "pointer" }} onClick={() => toggleSort("item_class")}>Class <SortIcon col="item_class" active="items" /></th>
                    <th style={{ cursor: "pointer" }} onClick={() => toggleSort("nmfc")}>NMFC # <SortIcon col="nmfc" active="items" /></th>
                    <th style={{ cursor: "pointer" }} onClick={() => toggleSort("fclass")}>Freight Class <SortIcon col="fclass" active="items" /></th>
                    <th style={{ cursor: "pointer" }} onClick={() => toggleSort("weight_unit")}>Weight/Unit <SortIcon col="weight_unit" active="items" /></th>
                    <th>Dims (L&times;W&times;H in)</th>
                    <th>Units/Pallet</th>
                    <th>Hazmat</th>
                    <th style={{ cursor: "pointer" }} onClick={() => toggleSort("value_unit")}>Value/Unit <SortIcon col="value_unit" active="items" /></th>
                    <th style={{ cursor: "pointer" }} onClick={() => toggleSort("status")}>Status <SortIcon col="status" active="items" /></th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 ? (
                    <tr><td colSpan={12} className="empty-state">No items found</td></tr>
                  ) : rows.map((it) => {
                    const cls = getClass(it);
                    const status = it.status || "Active";
                    return (
                      <tr key={it.id} style={status === "Inactive" ? { opacity: 0.55 } : {}}>
                        <td><span className="mono" style={{ color: "var(--accent)", fontWeight: 700, cursor: "pointer", textDecoration: "underline" }} onClick={() => openEdit(it)}>{it.id}</span></td>
                        <td><div style={{ fontWeight: 600, fontSize: 13 }}>{getDesc(it)}</div><HandlingBadges item={it} /></td>
                        <td><ClassBadge cls={cls} /></td>
                        <td className="mono" style={{ fontSize: 12 }}>{it.nmfc || "--"}</td>
                        <td className="mono" style={{ fontWeight: 700 }}>{it.fclass || it.freight_class || "--"}</td>
                        <td className="mono">{it.weight_unit || 0} lbs</td>
                        <td className="mono" style={{ fontSize: 12 }}>{getDims(it)}</td>
                        <td className="mono">{it.units_per_pallet || 1}</td>
                        <td style={{ textAlign: "center" }}>{it.hazmat ? <span style={{ color: "var(--red)", fontSize: 16 }}>&#9762;</span> : <span style={{ color: "#ddd" }}>&mdash;</span>}</td>
                        <td className="mono" style={{ color: "var(--green)", fontWeight: 700 }}>${(it.value_unit || 0).toLocaleString()}</td>
                        <td><StatusBadge status={status} /></td>
                        <td style={{ whiteSpace: "nowrap" }}>
                          <div style={{ display: "flex", gap: 5 }}>
                            <button
                              className="btn btn-secondary btn-sm"
                              onClick={() => openEdit(it)}
                              disabled={!canEditItems}
                              title={noEditTitle || "Edit item"}
                            >
                              Edit
                            </button>
                            <button
                              className="btn btn-secondary btn-sm"
                              onClick={() => duplicateItem(it)}
                              disabled={busyId === it.id || !canEditItems}
                              title={canEditItems ? "Duplicate" : noEditTitle}
                            >
                              &#10697;
                            </button>
                            <button
                              className="btn btn-secondary btn-sm"
                              onClick={() => toggleStatus(it)}
                              disabled={busyId === it.id || !canEditItems}
                              title={canEditItems ? (status === "Active" ? "Deactivate" : "Activate") : noEditTitle}
                            >
                              {status === "Active" ? "\uD83D\uDEAB" : "\u2705"}
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              </div>
            ) : (
              renderCards()
            )}
          </div>
        </>
      )}

      {/* ═══ PACKAGING UNITS TAB ═══ */}
      {tab === "pkg" && (
        <>
          {/* Packaging KPIs */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr 1fr", gap: 12, marginBottom: 20 }}>
            <div className="stat-card blue"><div className="stat-label">Total Pkg Types</div><div className="stat-value" style={{ fontSize: 26 }}>{pkgKpis.total}</div></div>
            <div className="stat-card green"><div className="stat-label">Cartons</div><div className="stat-value" style={{ fontSize: 26 }}>{pkgKpis.cartons}</div></div>
            <div className="stat-card yellow"><div className="stat-label">Pallets</div><div className="stat-value" style={{ fontSize: 26 }}>{pkgKpis.pallets}</div></div>
            <div className="stat-card blue"><div className="stat-label">Drums</div><div className="stat-value" style={{ fontSize: 26 }}>{pkgKpis.drums}</div></div>
            <div className="stat-card green"><div className="stat-label">Other</div><div className="stat-value" style={{ fontSize: 26 }}>{pkgKpis.other}</div></div>
          </div>

          {/* Packaging Table */}
          <div className="card" style={{ padding: 0 }}>
            <div className="card-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span className="card-title">Packaging Unit Master</span>
              <span style={{ fontSize: 12, color: "var(--text3)" }}>Define reusable packaging configurations linked to items</span>
            </div>
            <div className="table-wrap">
            <table className="grid" style={{ border: "none", boxShadow: "none" }}>
              <thead>
                <tr>
                  <th style={{ cursor: "pointer" }} onClick={() => togglePkgSort("id")}>Pkg Code <SortIcon col="id" active="pkg" /></th>
                  <th style={{ cursor: "pointer" }} onClick={() => togglePkgSort("description")}>Description <SortIcon col="description" active="pkg" /></th>
                  <th>Type</th>
                  <th>Dims (L&times;W&times;H in)</th>
                  <th style={{ cursor: "pointer" }} onClick={() => togglePkgSort("tare")}>Tare Weight (lbs) <SortIcon col="tare" active="pkg" /></th>
                  <th style={{ cursor: "pointer" }} onClick={() => togglePkgSort("max_load")}>Max Load (lbs) <SortIcon col="max_load" active="pkg" /></th>
                  <th>Max Stack</th>
                  <th style={{ cursor: "pointer" }} onClick={() => togglePkgSort("volume")}>Volume (ft&sup3;) <SortIcon col="volume" active="pkg" /></th>
                  <th>Returnable</th>
                  <th>Linked Items</th>
                  <th style={{ cursor: "pointer" }} onClick={() => togglePkgSort("status")}>Status <SortIcon col="status" active="pkg" /></th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {pkgRows.length === 0 ? (
                  <tr><td colSpan={12} className="empty-state">No packaging units found</td></tr>
                ) : pkgRows.map((p) => {
                  const status = p.status || "Active";
                  const vol = calcVolume(p);
                  return (
                    <tr key={p.id} style={status === "Inactive" ? { opacity: 0.55 } : {}}>
                      <td><span className="mono" style={{ color: "var(--accent)", fontWeight: 700, cursor: "pointer", textDecoration: "underline" }} onClick={() => openEditPkg(p)}>{p.id}</span></td>
                      <td>
                        <div style={{ fontWeight: 600, fontSize: 13 }}>{readPkgDescription(p) || "--"}</div>
                        <PkgPropertyBadges pkg={p} />
                      </td>
                      <td><TypeBadge type={p.type} /></td>
                      <td className="mono" style={{ fontSize: 12 }}>{getDims(p)}</td>
                      <td className="mono">{p.tare || 0} lbs</td>
                      <td className="mono" style={{ fontWeight: 700 }}>{(p.max_load || 0).toLocaleString()} lbs</td>
                      <td className="mono">{p.stack || 1}</td>
                      <td className="mono">{vol} ft&sup3;</td>
                      <td style={{ textAlign: "center" }}>{p.returnable ? <span style={{ color: "var(--green)" }}>&check;</span> : <span style={{ color: "#ddd" }}>&mdash;</span>}</td>
                      <td style={{ color: "var(--text3)" }}>&mdash;</td>
                      <td><StatusBadge status={status} /></td>
                      <td style={{ whiteSpace: "nowrap" }}>
                        <div style={{ display: "flex", gap: 5 }}>
                          <button
                            className="btn btn-secondary btn-sm"
                            onClick={() => openEditPkg(p)}
                            disabled={!canEditItems}
                            title={noEditTitle || "Edit packaging"}
                          >
                            Edit
                          </button>
                          <button
                            className="btn btn-secondary btn-sm"
                            onClick={() => togglePkgStatus(p)}
                            disabled={busyId === p.id || !canEditItems}
                            title={canEditItems ? (status === "Active" ? "Deactivate" : "Activate") : noEditTitle}
                          >
                            {status === "Active" ? "\uD83D\uDEAB" : "\u2705"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            </div>
          </div>
        </>
      )}

      {/* ═══ ITEM EDIT MODAL ═══ */}
      {editItem && (
        <div className="modal-overlay" onClick={() => setEditItem(null)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{editItem._originalId ? `Edit Item \u2014 ${editItem._originalId}` : "Add New Item"}</h3>
              <button className="modal-close" onClick={() => setEditItem(null)}>X</button>
            </div>
            <div className="modal-body">
              <div className="form-grid">
                <div className="form-group">
                  <label className="form-label">Item ID *</label>
                  <input value={editItem.id || ""} onChange={(e) => editField("id", e.target.value)} disabled={!!editItem._originalId} />
                </div>
                <div className="form-group">
                  <label className="form-label">Description *</label>
                  <input value={editItem.description || ""} onChange={(e) => editField("description", e.target.value)} />
                </div>
                <div className="form-group">
                  <label className="form-label">Customer</label>
                  <input value={editItem.customer || ""} onChange={(e) => editField("customer", e.target.value)} />
                </div>
                <div className="form-group">
                  <label className="form-label">Item Class</label>
                  <select value={editItem.class || "General"} onChange={(e) => editField("class", e.target.value)}>
                    <option value="General">General</option>
                    <option value="Electronics">Electronics</option>
                    <option value="Industrial">Industrial</option>
                    <option value="Perishable">Perishable</option>
                    <option value="Hazmat">Hazmat</option>
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">NMFC Code</label>
                  <input value={editItem.nmfc || ""} onChange={(e) => editField("nmfc", e.target.value)} />
                </div>
                <div className="form-group">
                  <label className="form-label">Freight Class</label>
                  <select value={editItem.freight_class || "70"} onChange={(e) => editField("freight_class", e.target.value)}>
                    {["50","55","60","65","70","77.5","85","92.5","100","110","125","150","175","200","250","300","400","500"].map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Weight/Unit (lbs)</label>
                  <input type="number" value={editItem.weight_unit || ""} onChange={(e) => editField("weight_unit", e.target.value)} />
                </div>
                <div className="form-group">
                  <label className="form-label">Value/Unit ($)</label>
                  <input type="number" value={editItem.value_unit || ""} onChange={(e) => editField("value_unit", e.target.value)} />
                </div>
                <div className="form-group">
                  <label className="form-label">Length (in)</label>
                  <input type="number" value={editItem.len || ""} onChange={(e) => editField("len", e.target.value)} />
                </div>
                <div className="form-group">
                  <label className="form-label">Width (in)</label>
                  <input type="number" value={editItem.wid || ""} onChange={(e) => editField("wid", e.target.value)} />
                </div>
                <div className="form-group">
                  <label className="form-label">Height (in)</label>
                  <input type="number" value={editItem.hgt || ""} onChange={(e) => editField("hgt", e.target.value)} />
                </div>
                <div className="form-group">
                  <label className="form-label">Units/Pallet</label>
                  <input type="number" value={editItem.units_per_pallet || ""} onChange={(e) => editField("units_per_pallet", e.target.value)} />
                </div>
                <div className="form-group">
                  <label className="form-label">Packaging</label>
                  <select value={editItem.pkg || "Carton"} onChange={(e) => editField("pkg", e.target.value)}>
                    {["Carton","Pallet","Drum","Crate","Bag","Roll","Bundle","Tote"].map((p) => <option key={p} value={p}>{p}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Max Stack</label>
                  <input type="number" value={editItem.stack || ""} onChange={(e) => editField("stack", e.target.value)} />
                </div>
              </div>
              <div style={{ marginTop: 16, marginBottom: 8, fontWeight: 700, fontSize: 11, color: "var(--text3)", letterSpacing: 1 }}>HANDLING FLAGS</div>
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}><input type="checkbox" checked={!!editItem.hazmat} onChange={(e) => editField("hazmat", e.target.checked)} /> Hazmat</label>
                <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}><input type="checkbox" checked={!!editItem.fragile} onChange={(e) => editField("fragile", e.target.checked)} /> Fragile</label>
                <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}><input type="checkbox" checked={!!editItem.temp_ctrl} onChange={(e) => editField("temp_ctrl", e.target.checked)} /> Temp Controlled</label>
                <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}><input type="checkbox" checked={!!editItem.top_load} onChange={(e) => editField("top_load", e.target.checked)} /> Top Load Only</label>
              </div>
              {editItem.hazmat && (
                <>
                  <div style={{ marginTop: 16, marginBottom: 8, fontWeight: 700, fontSize: 11, color: "var(--text3)", letterSpacing: 1 }}>HAZMAT DETAILS</div>
                  <div className="form-grid">
                    <div className="form-group"><label className="form-label">UN Number</label><input value={editItem.un || ""} onChange={(e) => editField("un", e.target.value)} /></div>
                    <div className="form-group"><label className="form-label">Hazmat Class</label><input value={editItem.haz_class || ""} onChange={(e) => editField("haz_class", e.target.value)} /></div>
                  </div>
                </>
              )}
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={() => setEditItem(null)}>Cancel</button>
              <button
                className="btn btn-primary"
                onClick={saveItem}
                disabled={busyId === "saving" || !canEditItems}
                title={noEditTitle}
              >
                {busyId === "saving" ? "Saving..." : "Save Item"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ═══ PACKAGING EDIT MODAL ═══ */}
      {editPkg && (
        <div className="modal-overlay" onClick={() => setEditPkg(null)}>
          <div className="modal-card" style={{ width: 600 }} onClick={(e) => e.stopPropagation()}>
            {/* Green gradient header */}
            <div style={{ background: "linear-gradient(135deg,#1a4731,#16a34a)", borderRadius: "16px 16px 0 0", padding: "16px 22px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div>
                <div style={{ fontSize: 11, color: "rgba(255,255,255,.6)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>Packaging Units</div>
                <span style={{ color: "#fff", fontSize: 16, fontWeight: 700 }}>{editPkg._originalId ? `Edit \u2014 ${editPkg._originalId}` : "New Packaging Unit"}</span>
              </div>
              <button onClick={() => setEditPkg(null)} style={{ color: "rgba(255,255,255,.7)", fontSize: 22, background: "none", border: "none", cursor: "pointer" }}>&times;</button>
            </div>
            <div className="modal-body" style={{ padding: 24 }}>
              {/* Section: Identity */}
              <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text3)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 12 }}>Identity</div>
              <div className="form-grid" style={{ marginBottom: 20 }}>
                <div className="form-group">
                  <label className="form-label">Pkg Code *</label>
                  <input value={editPkg.id || ""} onChange={(e) => editPkgField("id", e.target.value)} disabled={!!editPkg._originalId} placeholder="e.g. CTN-001" />
                </div>
                <div className="form-group">
                  <label className="form-label">Description *</label>
                  <input
                    value={editPkg.description || ""}
                    onChange={(e) => editPkgField("description", e.target.value)}
                    placeholder="e.g. Standard Export Carton"
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Type *</label>
                  <select value={editPkg.type || "Carton"} onChange={(e) => editPkgField("type", e.target.value)}>
                    <option value="Carton">Carton</option><option value="Pallet">Pallet</option><option value="Drum">Drum</option>
                    <option value="Crate">Crate</option><option value="Bag">Bag</option><option value="Roll">Roll</option>
                    <option value="Bundle">Bundle</option><option value="Tote">Tote</option><option value="IBC">IBC (Intermediate Bulk Container)</option><option value="Tube">Tube</option>
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Material</label>
                  <select value={editPkg.material || "Corrugated"} onChange={(e) => editPkgField("material", e.target.value)}>
                    <option value="Corrugated">Corrugated Cardboard</option><option value="Wood">Wood</option><option value="Plastic">Plastic</option>
                    <option value="Steel">Steel</option><option value="Aluminum">Aluminum</option><option value="Fiber">Fiberboard</option><option value="Foam">Foam-lined</option>
                  </select>
                </div>
              </div>

              {/* Section: Dimensions & Weight */}
              <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text3)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 12 }}>Dimensions & Weight</div>
              <div className="form-grid" style={{ marginBottom: 20 }}>
                <div className="form-group"><label className="form-label">Length (in)</label><input type="number" value={editPkg.len || ""} onChange={(e) => editPkgField("len", e.target.value)} placeholder="0" /></div>
                <div className="form-group"><label className="form-label">Width (in)</label><input type="number" value={editPkg.wid || ""} onChange={(e) => editPkgField("wid", e.target.value)} placeholder="0" /></div>
                <div className="form-group"><label className="form-label">Height (in)</label><input type="number" value={editPkg.hgt || ""} onChange={(e) => editPkgField("hgt", e.target.value)} placeholder="0" /></div>
                <div className="form-group"><label className="form-label">Tare Weight (lbs)</label><input type="number" value={editPkg.tare || ""} onChange={(e) => editPkgField("tare", e.target.value)} placeholder="0.00" /></div>
                <div className="form-group"><label className="form-label">Max Load Weight (lbs)</label><input type="number" value={editPkg.max_load || ""} onChange={(e) => editPkgField("max_load", e.target.value)} placeholder="0" /></div>
                <div className="form-group"><label className="form-label">Max Stack Height</label><input type="number" value={editPkg.stack || ""} onChange={(e) => editPkgField("stack", e.target.value)} placeholder="1" /></div>
              </div>

              {/* Volume calculator */}
              {(() => {
                const l = parseFloat(editPkg.len) || 0;
                const w = parseFloat(editPkg.wid) || 0;
                const h = parseFloat(editPkg.hgt) || 0;
                if (l > 0 && w > 0 && h > 0) {
                  const vol = (l * w * h / 1728).toFixed(3);
                  return (
                    <div style={{ padding: "10px 14px", background: "rgba(22,163,74,.08)", border: "1px solid rgba(22,163,74,.2)", borderRadius: 9, fontSize: 12, marginBottom: 20 }}>
                      <strong>Volume:</strong> {vol} ft&sup3; &nbsp;|&nbsp; <strong>Dims:</strong> {l}&times;{w}&times;{h} in
                    </div>
                  );
                }
                return null;
              })()}

              {/* Section: Properties (two-column panel) */}
              <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text3)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 12 }}>Properties</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 20 }}>
                <div style={{ background: "#f8faff", borderRadius: 10, padding: 14, border: "1px solid var(--border)" }}>
                  <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, cursor: "pointer", fontSize: 13 }}>
                    <input type="checkbox" checked={!!editPkg.returnable} onChange={(e) => editPkgField("returnable", e.target.checked)} style={{ accentColor: "var(--accent)" }} /> Returnable / Reusable
                  </label>
                  <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, cursor: "pointer", fontSize: 13 }}>
                    <input type="checkbox" checked={!!editPkg.nested} onChange={(e) => editPkgField("nested", e.target.checked)} style={{ accentColor: "var(--accent)" }} /> Nestable when empty
                  </label>
                  <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 13 }}>
                    <input type="checkbox" checked={!!editPkg.hazmat} onChange={(e) => editPkgField("hazmat", e.target.checked)} style={{ accentColor: "var(--accent)" }} /> Hazmat-rated container
                  </label>
                </div>
                <div style={{ background: "#f8faff", borderRadius: 10, padding: 14, border: "1px solid var(--border)" }}>
                  <div className="form-group" style={{ marginBottom: 10 }}>
                    <label style={{ fontSize: 11 }}>Unit Cost ($)</label>
                    <input type="number" value={editPkg.cost || ""} onChange={(e) => editPkgField("cost", e.target.value)} placeholder="0.00" style={{ marginTop: 4, fontSize: 12, padding: "6px 10px" }} />
                  </div>
                  <div className="form-group">
                    <label style={{ fontSize: 11 }}>Supplier / Source</label>
                    <input value={editPkg.supplier || ""} onChange={(e) => editPkgField("supplier", e.target.value)} placeholder="e.g. Uline, Pratt" style={{ marginTop: 4, fontSize: 12, padding: "6px 10px" }} />
                  </div>
                </div>
              </div>

              {/* Linked Items */}
              <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text3)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 10 }}>Linked Items</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, padding: 10, background: "#f8faff", borderRadius: 9, border: "1px solid var(--border)", minHeight: 40, fontSize: 12, color: "var(--text3)" }}>
                {(() => {
                  const pkgType = editPkg.type || "Carton";
                  const linked = items.filter((it) => (it.pkg || "Carton") === pkgType);
                  if (linked.length === 0) return "No items linked to this packaging type";
                  return linked.map((it) => (
                    <span key={it.id} style={{ background: "rgba(59,130,246,.08)", color: "var(--accent)", border: "1px solid rgba(59,130,246,.2)", padding: "2px 8px", borderRadius: 6, fontSize: 11, fontWeight: 600 }}>
                      {it.id}
                    </span>
                  ));
                })()}
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={() => setEditPkg(null)}>Cancel</button>
              <button
                className="btn btn-primary"
                onClick={savePkg}
                disabled={busyId === "saving-pkg" || !canEditItems}
                title={noEditTitle}
              >
                {busyId === "saving-pkg" ? "Saving..." : "Save Packaging"}
              </button>
            </div>
          </div>
        </div>
      )}

      </div>{/* end page-content */}
    </div>
  );
}
