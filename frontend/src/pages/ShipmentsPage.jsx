import { useMemo, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { DbApi, TenderApi } from "../lib/api";

export default function ShipmentsPage() {
  const { shipments, orders, carriers, setData, refreshData } = useOutletContext();
  const [q, setQ] = useState("");
  const [busyId, setBusyId] = useState("");
  const [message, setMessage] = useState("");

  const carrierByName = useMemo(() => {
    const map = new Map();
    carriers.forEach((c) => {
      if (c?.name) map.set(String(c.name).toLowerCase(), c);
    });
    return map;
  }, [carriers]);

  function resolveCarrierName(shipment) {
    if (shipment?.carrier) return shipment.carrier;
    const linkedOrders = orders.filter(
      (o) =>
        String(o.shipment_id || o.shipmentId || "") === String(shipment.id || "")
    );
    for (const order of linkedOrders) {
      const preferred = order?.preferred_carrier || order?.carrier;
      if (preferred) return preferred;
    }
    return "";
  }

  const rows = useMemo(() => {
    const t = q.toLowerCase().trim();
    const computed = shipments.map((s) => {
      const linkedOrderIds = orders
        .filter((o) => String(o.shipment_id || o.shipmentId || "") === String(s.id || ""))
        .map((o) => o.id)
        .filter(Boolean);
      return {
        ...s,
        _resolvedCarrier: resolveCarrierName(s),
        _linkedOrderIds: linkedOrderIds,
      };
    });
    if (!t) return computed;
    return computed.filter((s) =>
      [
        s.id,
        s._resolvedCarrier,
        s.origin,
        s.dest,
        s.status,
        (s._linkedOrderIds || []).join(","),
      ].some((v) => String(v || "").toLowerCase().includes(t))
    );
  }, [shipments, orders, q]);

  async function onTender(row) {
    const carrierName = row._resolvedCarrier || row.carrier || "";
    const carrier = carrierByName.get(String(carrierName || "").toLowerCase());
    const to = carrier?.email || "";
    if (!to) {
      setMessage(`Cannot tender ${row.id}: carrier email is missing.`);
      return;
    }

    setBusyId(row.id);
    setMessage("");
    try {
      await DbApi.patch("shipments", row.id, {
        status: "Tendered",
        carrier: carrierName,
      });
      const emailResult = await TenderApi.sendEmail({
        to,
        shipmentId: row.id,
        carrierName,
        origin: row.origin || "",
        dest: row.dest || "",
        pickup: row.pickup_date || "",
        delivery: row.delivery_date || "",
        mode: row.mode || "",
        cost: row.total_cost || row.cost || "",
        weight: row.weight || "",
        pieces: row.pieces || "",
      });
      setData((prev) => ({
        ...prev,
        shipments: prev.shipments.map((s) =>
          s.id === row.id ? { ...s, status: "Tendered", carrier: carrierName } : s
        ),
      }));
      setMessage(
        emailResult?.sent
          ? `Tendered ${row.id} and emailed ${to}.`
          : `Tendered ${row.id}. Email skipped: ${emailResult?.message || "SMTP not configured"}.`
      );
      await refreshData();
    } catch (err) {
      setMessage(`Tender failed for ${row.id}: ${err.message || "Unknown error"}`);
    } finally {
      setBusyId("");
    }
  }

  return (
    <div>
      <h2>Shipments</h2>
      <input
        placeholder="Search shipments"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        className="search"
      />
      {message ? <div className="card">{message}</div> : null}
      <table className="grid">
        <thead>
          <tr>
            <th>ID</th>
            <th>Carrier</th>
            <th>Origin</th>
            <th>Dest</th>
            <th>Status</th>
            <th>Pickup</th>
            <th>Delivery</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((s) => (
            <tr key={s.id}>
              <td>{s.id}</td>
              <td>{s._resolvedCarrier || "-"}</td>
              <td>{s.origin}</td>
              <td>{s.dest}</td>
              <td>{s.status}</td>
              <td>{s.pickup_date || "-"}</td>
              <td>{s.delivery_date || "-"}</td>
              <td>
                <button
                  disabled={busyId === s.id || String(s.status || "").toLowerCase() === "tendered"}
                  onClick={() => onTender(s)}
                >
                  {busyId === s.id ? "Tendering..." : "Tender"}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
