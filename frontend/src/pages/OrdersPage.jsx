import { useMemo, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { DbApi } from "../lib/api";
import { OrdersApi } from "../lib/api";
import OrderLinesEditor from "../components/OrderLinesEditor";

export default function OrdersPage() {
  const { orders, shipments, setData, refreshData } = useOutletContext();
  const [q, setQ] = useState("");
  const [busyId, setBusyId] = useState("");
  const [message, setMessage] = useState("");
  const [detailBusy, setDetailBusy] = useState(false);
  const [selectedOrderId, setSelectedOrderId] = useState("");
  const [selectedLines, setSelectedLines] = useState([]);

  const rows = useMemo(() => {
    const t = q.toLowerCase().trim();
    if (!t) return orders;
    return orders.filter((o) =>
      [o.id, o.customer, o.origin, o.dest, o.shipment_id].some((v) =>
        String(v || "").toLowerCase().includes(t)
      )
    );
  }, [orders, q]);

  function onFieldChange(row, key, value) {
    setData((prev) => ({
      ...prev,
      orders: prev.orders.map((o) => (o.id === row.id ? { ...o, [key]: value } : o)),
    }));
  }

  async function onSave(row) {
    setBusyId(row.id);
    setMessage("");
    try {
      await DbApi.patch("orders", row.id, {
        status: row.status,
        shipment_id: row.shipment_id || null,
        preferred_carrier: row.preferred_carrier || null,
      });
      setMessage(`Saved order ${row.id}.`);
      await refreshData();
    } catch (err) {
      setMessage(`Failed to save ${row.id}: ${err.message || "Unknown error"}`);
    } finally {
      setBusyId("");
    }
  }

  async function openDetail(orderId) {
    setSelectedOrderId(orderId);
    setDetailBusy(true);
    setMessage("");
    try {
      const full = await OrdersApi.full(orderId);
      setSelectedLines(Array.isArray(full?.lines) ? full.lines : []);
    } catch (err) {
      setSelectedLines([]);
      setMessage(`Failed loading details for ${orderId}: ${err.message || "Unknown error"}`);
    } finally {
      setDetailBusy(false);
    }
  }

  async function saveLines() {
    if (!selectedOrderId) return;
    setDetailBusy(true);
    try {
      await OrdersApi.saveLines(selectedOrderId, selectedLines);
      setMessage(`Saved ${selectedLines.length} lines for ${selectedOrderId}.`);
      await refreshData();
    } finally {
      setDetailBusy(false);
    }
  }

  async function clearLines() {
    if (!selectedOrderId) return;
    setDetailBusy(true);
    setMessage("");
    try {
      await OrdersApi.clearLines(selectedOrderId);
      setSelectedLines([]);
      setMessage(`Cleared lines for ${selectedOrderId}.`);
      await refreshData();
    } catch (err) {
      setMessage(`Failed clearing lines for ${selectedOrderId}: ${err.message || "Unknown error"}`);
    } finally {
      setDetailBusy(false);
    }
  }

  return (
    <div>
      <h2>Orders</h2>
      <input
        placeholder="Search orders"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        className="search"
      />
      {message ? <div className="card">{message}</div> : null}
      <table className="grid">
        <thead>
          <tr>
            <th>ID</th>
            <th>Customer</th>
            <th>Origin</th>
            <th>Dest</th>
            <th>Status</th>
            <th>Preferred Carrier</th>
            <th>Shipment</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((o) => (
            <tr key={o.id}>
              <td>{o.id}</td>
              <td>{o.customer}</td>
              <td>{o.origin}</td>
              <td>{o.dest}</td>
              <td>
                <select
                  value={o.status || ""}
                  onChange={(e) => onFieldChange(o, "status", e.target.value)}
                >
                  <option value="">-</option>
                  <option value="Unplanned">Unplanned</option>
                  <option value="Planned">Planned</option>
                  <option value="Tendered">Tendered</option>
                  <option value="In Transit">In Transit</option>
                  <option value="Delivered">Delivered</option>
                </select>
              </td>
              <td>
                <input
                  value={o.preferred_carrier || ""}
                  onChange={(e) => onFieldChange(o, "preferred_carrier", e.target.value)}
                />
              </td>
              <td>
                <select
                  value={o.shipment_id || ""}
                  onChange={(e) => onFieldChange(o, "shipment_id", e.target.value)}
                >
                  <option value="">Unassigned</option>
                  {shipments.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.id}
                    </option>
                  ))}
                </select>
              </td>
              <td>
                <button disabled={busyId === o.id} onClick={() => onSave(o)}>
                  {busyId === o.id ? "Saving..." : "Save"}
                </button>
                <button disabled={detailBusy} onClick={() => openDetail(o.id)}>
                  Details
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {selectedOrderId ? (
        <OrderLinesEditor
          orderId={selectedOrderId}
          lines={selectedLines}
          onChange={setSelectedLines}
          onSave={saveLines}
          onClear={clearLines}
          busy={detailBusy}
        />
      ) : null}
    </div>
  );
}
