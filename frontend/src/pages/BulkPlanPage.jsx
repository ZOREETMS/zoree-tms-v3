import { useMemo, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { BulkPlanApi } from "../lib/api";

function normalizeZip(value) {
  const m = String(value || "").match(/\b(\d{5})\b/);
  return m ? m[1] : "";
}

function laneKey(order) {
  const origin = order.origin || "";
  const dest = order.dest || "";
  return `${origin} -> ${dest}`;
}

export default function BulkPlanPage() {
  const { orders, refreshData } = useOutletContext();
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState([]);
  const [message, setMessage] = useState("");
  const [optimizeBy, setOptimizeBy] = useState("cost");

  const lanes = useMemo(() => {
    const groups = new Map();
    const source = orders.filter((o) => {
      const status = String(o.status || "").toLowerCase();
      return status === "unplanned" || !o.shipment_id;
    });
    source.forEach((o) => {
      const key = laneKey(o);
      if (!groups.has(key)) {
        groups.set(key, {
          laneKey: key,
          origin: o.origin || "",
          destination: o.dest || "",
          originZip: normalizeZip(o.origin_zip || o.origin),
          destZip: normalizeZip(o.dest_zip || o.dest),
          freightClass: o.freight_class || "70",
          totalWeight: 0,
          totalPieces: 0,
          orderIds: [],
        });
      }
      const g = groups.get(key);
      g.totalWeight += Number(o.weight || 0);
      g.totalPieces += Number(o.pieces || 0);
      g.orderIds.push(o.id);
    });
    return Array.from(groups.values());
  }, [orders]);

  async function onRate() {
    if (!lanes.length) {
      setMessage("No unplanned lanes available.");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const res = await BulkPlanApi.rate(lanes, optimizeBy);
      setResults(Array.isArray(res?.results) ? res.results : []);
      setMessage(`Rated ${Array.isArray(res?.results) ? res.results.length : 0} lanes.`);
    } catch (err) {
      setMessage(`Rating failed: ${err.message || "Unknown error"}`);
    } finally {
      setBusy(false);
    }
  }

  async function onExecute() {
    const plans = results
      .map((r) => {
        const lane = lanes.find((l) => l.laneKey === r.laneKey);
        if (!lane || !r?.bestQuote) return null;
        return {
          laneKey: lane.laneKey,
          origin: lane.origin,
          destination: lane.destination,
          originZip: lane.originZip,
          destZip: lane.destZip,
          totalWeight: lane.totalWeight,
          totalPieces: lane.totalPieces,
          orderIds: lane.orderIds,
          carrier: r.bestQuote.carrier || "",
          mode: r.bestQuote.mode || "LTL",
          totalCost: r.bestQuote.totalCharge || 0,
          pickupDate: "",
          deliveryDate: r.bestQuote.deliveryDate || "",
          czarliteRate: r.bestQuote.mode === "LTL",
        };
      })
      .filter(Boolean);
    if (!plans.length) {
      setMessage("No executable plans found. Run Rate first.");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const res = await BulkPlanApi.execute(plans);
      setMessage(
        `Executed ${res?.shipments?.length || 0} shipments. Orders updated: ${res?.ordersUpdated || 0}.`
      );
      await refreshData();
    } catch (err) {
      setMessage(`Execute failed: ${err.message || "Unknown error"}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <h2>Bulk Plan</h2>
      <div className="card">
        <div>Unplanned lanes: {lanes.length}</div>
        <div className="row gap">
          <label>
            Optimize By{" "}
            <select
              value={optimizeBy}
              onChange={(e) => setOptimizeBy(e.target.value)}
              disabled={busy}
            >
              <option value="cost">Cost</option>
              <option value="transit">Transit</option>
            </select>
          </label>
          <button onClick={onRate} disabled={busy}>
            {busy ? "Working..." : "Rate Lanes"}
          </button>
          <button onClick={onExecute} disabled={busy || !results.length}>
            Execute Plans
          </button>
        </div>
        {message ? <div>{message}</div> : null}
      </div>
      <table className="grid">
        <thead>
          <tr>
            <th>Lane</th>
            <th>Orders</th>
            <th>Weight</th>
            <th>Best Carrier</th>
            <th>Mode</th>
            <th>Cost</th>
            <th>Transit (days)</th>
          </tr>
        </thead>
        <tbody>
          {lanes.map((lane) => {
            const rated = results.find((r) => r.laneKey === lane.laneKey);
            const best = rated?.bestQuote;
            return (
              <tr key={lane.laneKey}>
                <td>{lane.laneKey}</td>
                <td>{lane.orderIds.length}</td>
                <td>{lane.totalWeight || 0}</td>
                <td>{best?.carrier || "-"}</td>
                <td>{best?.mode || "-"}</td>
                <td>{best?.totalCharge ? `$${best.totalCharge}` : "-"}</td>
                <td>{best?.transitDays ?? "-"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {!lanes.length ? (
        <div className="card">No unplanned orders found for bulk planning.</div>
      ) : null}
      {!results.length ? (
        <div className="card">Run "Rate Lanes" to calculate best options per lane.</div>
      ) : null}
      {results.length ? (
        <div className="card">
          Rated lanes are ready. Use "Execute Plans" to create shipments and update order assignments.
        </div>
      ) : null}
    </div>
  );
}
