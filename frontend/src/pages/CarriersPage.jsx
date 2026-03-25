import { useMemo, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { DbApi } from "../lib/api";

export default function CarriersPage() {
  const { carriers, setData, refreshData } = useOutletContext();
  const [q, setQ] = useState("");
  const [busyId, setBusyId] = useState("");
  const [message, setMessage] = useState("");

  const rows = useMemo(() => {
    const t = q.toLowerCase().trim();
    if (!t) return carriers;
    return carriers.filter((c) =>
      [c.name, c.email, c.phone, c.scac].some((v) =>
        String(v || "").toLowerCase().includes(t)
      )
    );
  }, [carriers, q]);

  async function onFieldChange(row, key, value) {
    setData((prev) => ({
      ...prev,
      carriers: prev.carriers.map((c) => (c.id === row.id ? { ...c, [key]: value } : c)),
    }));
  }

  async function onSave(row) {
    setBusyId(row.id || "");
    setMessage("");
    try {
      await DbApi.saveCarrier(row);
      setMessage(`Saved carrier ${row.name || row.id}.`);
      await refreshData();
    } catch (err) {
      setMessage(`Failed to save ${row.name || row.id}: ${err.message || "Unknown error"}`);
    } finally {
      setBusyId("");
    }
  }

  return (
    <div>
      <h2>Carriers</h2>
      <input
        placeholder="Search carriers"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        className="search"
      />
      {message ? <div className="card">{message}</div> : null}
      <table className="grid">
        <thead>
          <tr>
            <th>Name</th>
            <th>SCAC</th>
            <th>Mode</th>
            <th>Email</th>
            <th>Phone</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => (
            <tr key={c.id || c.name}>
              <td>
                <input
                  value={c.name || ""}
                  onChange={(e) => onFieldChange(c, "name", e.target.value)}
                />
              </td>
              <td>
                <input
                  value={c.scac || ""}
                  onChange={(e) => onFieldChange(c, "scac", e.target.value)}
                />
              </td>
              <td>
                <input
                  value={c.mode || ""}
                  onChange={(e) => onFieldChange(c, "mode", e.target.value)}
                />
              </td>
              <td>
                <input
                  value={c.email || ""}
                  onChange={(e) => onFieldChange(c, "email", e.target.value)}
                />
              </td>
              <td>
                <input
                  value={c.phone || ""}
                  onChange={(e) => onFieldChange(c, "phone", e.target.value)}
                />
              </td>
              <td>
                <button disabled={busyId === c.id} onClick={() => onSave(c)}>
                  {busyId === c.id ? "Saving..." : "Save"}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
