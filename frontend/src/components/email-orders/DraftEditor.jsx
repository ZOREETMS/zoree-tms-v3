// One order draft from an email, editable before approval.
import { SHIP_MODES, SERVICE_LEVELS } from "../../services/emailIntakeService";
import { ui } from "./styles";

function Field({ label, value, onChange, bad, type = "text", options, readOnly }) {
  return (
    <label>
      <span style={ui.label}>{label}{bad ? " *" : ""}</span>
      {options ? (
        <select style={ui.input(bad)} value={value ?? ""} disabled={readOnly} onChange={(e) => onChange(e.target.value || null)}>
          <option value="">—</option>
          {options.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      ) : (
        <input style={ui.input(bad)} type={type} value={value ?? ""} readOnly={readOnly}
          onChange={(e) => onChange(type === "number" ? (e.target.value === "" ? null : Number(e.target.value)) : e.target.value)} />
      )}
    </label>
  );
}

function Stop({ title, stop, onChange, bad, readOnly }) {
  const set = (k) => (v) => onChange({ ...(stop || {}), [k]: v });
  const s = stop || {};
  return (
    <>
      <div style={ui.section}>{title}</div>
      <div style={ui.grid}>
        <Field label="Name" value={s.name} onChange={set("name")} readOnly={readOnly} />
        <Field label="Street" value={s.street} onChange={set("street")} readOnly={readOnly} />
        <Field label="City" value={s.city} onChange={set("city")} bad={bad} readOnly={readOnly} />
        <Field label="State" value={s.state} onChange={set("state")} readOnly={readOnly} />
        <Field label="ZIP" value={s.zip} onChange={set("zip")} bad={bad} readOnly={readOnly} />
        <Field label="Country" value={s.country} onChange={set("country")} readOnly={readOnly} />
      </div>
    </>
  );
}

const show = (v) => (v === null || v === undefined || v === "" ? "—" : String(v));
const place = (a) => {
  if (!a) return "—";
  const line2 = [[a.city, a.state].filter(Boolean).join(", "), a.zip].filter(Boolean).join(" ");
  return [a.name, a.street, line2, a.country].filter(Boolean).join(" · ") || "—";
};

function ReadOnlyItem({ label, value, wide }) {
  return (
    <div style={{ gridColumn: wide ? "1 / -1" : undefined }}>
      <span style={ui.label}>{label}</span>
      <div style={{ fontSize: 13, color: "#0f172a", padding: "2px 0" }}>{show(value)}</div>
    </div>
  );
}

/** Created / rejected drafts: what was approved, as plain text. */
function ReadOnlyDraft({ draft, index, total }) {
  const w = Number(draft.weight_lbs) > 0 ? `${Number(draft.weight_lbs).toLocaleString()} lb` : null;
  return (
    <div style={{ borderTop: "1px dashed #e2e8f0", marginTop: 12, paddingTop: 8 }}>
      {total > 1 && <div style={{ fontWeight: 700, fontSize: 13 }}>Order {index + 1} of {total}</div>}
      <div style={ui.grid}>
        <ReadOnlyItem label="Customer" value={draft.customer} />
        <ReadOnlyItem label="PO #" value={draft.po_number} />
        <ReadOnlyItem label="Reference #" value={draft.reference_number} />
        <ReadOnlyItem label="Ready date" value={draft.ready_date} />
        <ReadOnlyItem label="Due date" value={draft.due_date} />
        <ReadOnlyItem label="Weight" value={w} />
        <ReadOnlyItem label="Pieces" value={draft.pieces} />
        <ReadOnlyItem label="Mode" value={draft.ship_mode} />
        <ReadOnlyItem label="Service level" value={draft.service_level} />
        <ReadOnlyItem label="Hazmat" value={draft.hazmat ? "Yes" : "No"} />
        <ReadOnlyItem label="Commodity" value={draft.commodity} wide />
        <ReadOnlyItem label="Ship from" value={place(draft.ship_from)} wide />
        <ReadOnlyItem label="Ship to" value={place(draft.ship_to)} wide />
        {draft.special_instructions ? <ReadOnlyItem label="Special instructions" value={draft.special_instructions} wide /> : null}
      </div>
      <LineItems lines={draft.lines} />
    </div>
  );
}

function LineItems({ lines }) {
  if (!(lines || []).length) return null;
  return (
    <>
      <div style={ui.section}>Line items</div>
      <table style={ui.table}>
        <thead><tr>{["Description", "Item", "Qty", "Unit lb", "Total lb"].map((h) => <th key={h} style={ui.th}>{h}</th>)}</tr></thead>
        <tbody>
          {lines.map((l, i) => (
            <tr key={i}>
              <td style={ui.td}>{l.description}</td><td style={ui.td}>{l.item_id || "—"}</td>
              <td style={ui.td}>{l.qty ?? "—"}</td><td style={ui.td}>{l.unit_weight_lbs ?? "—"}</td><td style={ui.td}>{l.total_weight_lbs ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

export default function DraftEditor({ draft, gaps, onChange, readOnly, index, total }) {
  if (readOnly) return <ReadOnlyDraft draft={draft} index={index} total={total} />;
  const set = (k) => (v) => onChange({ ...draft, [k]: v });
  const miss = (k) => gaps.includes(k);
  return (
    <div style={{ borderTop: "1px dashed #e2e8f0", marginTop: 12, paddingTop: 8 }}>
      {total > 1 && <div style={{ fontWeight: 700, fontSize: 13 }}>Order {index + 1} of {total}</div>}
      <div style={ui.grid}>
        <Field label="Customer" value={draft.customer} onChange={set("customer")} bad={miss("customer")} readOnly={readOnly} />
        <Field label="PO #" value={draft.po_number} onChange={set("po_number")} readOnly={readOnly} />
        <Field label="Reference #" value={draft.reference_number} onChange={set("reference_number")} readOnly={readOnly} />
        <Field label="Ready date" type="date" value={draft.ready_date} onChange={set("ready_date")} bad={miss("ready_date")} readOnly={readOnly} />
        <Field label="Due date" type="date" value={draft.due_date} onChange={set("due_date")} bad={miss("due_date")} readOnly={readOnly} />
        <Field label="Weight (lb)" type="number" value={draft.weight_lbs} onChange={set("weight_lbs")} bad={miss("weight")} readOnly={readOnly} />
        <Field label="Pieces" type="number" value={draft.pieces} onChange={set("pieces")} readOnly={readOnly} />
        <Field label="Mode" value={draft.ship_mode} onChange={set("ship_mode")} options={SHIP_MODES} readOnly={readOnly} />
        <Field label="Service level" value={draft.service_level} onChange={set("service_level")} options={SERVICE_LEVELS} readOnly={readOnly} />
        <Field label="Commodity" value={draft.commodity} onChange={set("commodity")} readOnly={readOnly} />
      </div>
      <Stop title="Ship from" stop={draft.ship_from} onChange={set("ship_from")} bad={miss("origin")} readOnly={readOnly} />
      <Stop title="Ship to" stop={draft.ship_to} onChange={set("ship_to")} bad={miss("destination")} readOnly={readOnly} />
      <div style={{ ...ui.grid, gridTemplateColumns: "1fr auto" }}>
        <Field label="Special instructions" value={draft.special_instructions} onChange={set("special_instructions")} readOnly={readOnly} />
        <label style={{ alignSelf: "end", fontSize: 13, paddingBottom: 8 }}>
          <input type="checkbox" checked={!!draft.hazmat} disabled={readOnly} onChange={(e) => set("hazmat")(e.target.checked)} /> Hazmat
        </label>
      </div>
      <LineItems lines={draft.lines} />
      {(draft.assumptions || []).length > 0 && (
        <div style={{ ...ui.muted, marginTop: 8 }}>AI assumptions: {draft.assumptions.join(" · ")}</div>
      )}
    </div>
  );
}
