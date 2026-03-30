import { useState, useEffect } from "react";
import { REJECTION_REASONS } from "./TenderCard";
import { plannedDeliveryDate, plannedPickupDate, resolveCarrierName } from "../../utils/carrierPortal";

export default function TenderRespondModal({ shipment, preselect, onClose, onSubmit }) {
  const [choice, setChoice] = useState(preselect || null);
  const [driverName, setDriverName] = useState("");
  const [driverPhone, setDriverPhone] = useState("");
  const [truckNum, setTruckNum] = useState("");
  const [proNumber, setProNumber] = useState("");
  const [carrierPickupDate, setCarrierPickupDate] = useState("");
  const [pickupEta, setPickupEta] = useState("");
  const [acceptNotes, setAcceptNotes] = useState("");
  const [rejectReason, setRejectReason] = useState("");
  const [rejectNotes, setRejectNotes] = useState("");

  useEffect(() => {
    if (!shipment) return;
    setChoice(preselect || null);
    setDriverName("");
    setDriverPhone("");
    setTruckNum("");
    setProNumber("");
    setAcceptNotes("");
    setRejectReason("");
    setRejectNotes("");
    setCarrierPickupDate(plannedPickupDate(shipment) !== "—" ? plannedPickupDate(shipment) : "");
    // Default pickup ETA to shipment pickup date
    try {
      const d = new Date(plannedPickupDate(shipment) + "T08:00");
      d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
      setPickupEta(d.toISOString().slice(0, 16));
    } catch { setPickupEta(""); }
  }, [shipment, preselect]);

  if (!shipment) return null;

  function handleSubmit() {
    if (!choice) return;
    if (choice === "reject" && !rejectReason) return;

    const now = new Date();
    const respondedAt = now.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
      + " " + now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });

    if (choice === "accept") {
      onSubmit({
        action: "accept",
        driver: driverName.trim(),
        phone: driverPhone.trim(),
        truck: truckNum.trim(),
        proNumber: proNumber.trim(),
        carrierPickupDate,
        pickupEta,
        notes: acceptNotes.trim(),
        respondedAt,
        carrierName: resolveCarrierName(shipment),
      });
    } else {
      onSubmit({
        action: "reject",
        reason: rejectReason,
        notes: rejectNotes.trim(),
        respondedAt,
        carrierName: resolveCarrierName(shipment),
      });
    }
  }

  function selectChoice(c) {
    setChoice(c);
  }

  const isAccept = choice === "accept";
  const isReject = choice === "reject";

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()} style={{ width: 520 }}>
        {/* Header */}
        <div className="modal-header" style={{ background: "linear-gradient(135deg,#1e2d6b,#3b82f6)" }}>
          <div>
            <div style={{ fontSize: 11, color: "rgba(255,255,255,.6)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 3 }}>
              Carrier Response
            </div>
            <h3 style={{ color: "#fff", margin: 0 }}>Respond to Tender — {shipment.id}</h3>
          </div>
          <button className="modal-close" onClick={onClose} style={{ color: "rgba(255,255,255,.7)" }}>&#10005;</button>
        </div>

        <div style={{ padding: 0 }}>
          {/* Shipment Summary */}
          <div style={{ padding: "18px 20px", background: "#f8faff", borderBottom: "1px solid var(--border)" }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
              <SummaryCell label="Carrier" value={resolveCarrierName(shipment)} />
              <SummaryCell label="Lane" value={`${(shipment.origin || "").split(",")[0]} \u2192 ${(shipment.dest || "").split(",")[0]}`} />
              <SummaryCell label="Rate" value={shipment.cost || shipment.total_cost || "N/A"} valueColor="var(--green)" />
              <SummaryCell label="Planned Pickup" value={plannedPickupDate(shipment)} mono />
              <SummaryCell label="Planned Delivery" value={plannedDeliveryDate(shipment)} mono />
              <SummaryCell label="Weight" value={`${Number(shipment.weight || 0).toLocaleString()} lbs`} />
            </div>
          </div>

          {/* Response Choice */}
          <div style={{ padding: "18px 20px" }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text3)", textTransform: "uppercase", letterSpacing: ".8px", marginBottom: 12 }}>
              Your Response *
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 18 }}>
              <ChoiceCard
                active={isAccept}
                color="var(--green)"
                activeBg="rgba(16,185,129,.06)"
                icon="&#10003;"
                title="Accept Tender"
                subtitle="Confirm capacity & accept shipment"
                onClick={() => selectChoice("accept")}
              />
              <ChoiceCard
                active={isReject}
                color="var(--red)"
                activeBg="rgba(239,68,68,.05)"
                icon="&#10007;"
                title="Reject Tender"
                subtitle="Decline with reason"
                onClick={() => selectChoice("reject")}
              />
            </div>

            {/* Accept Fields */}
            {isAccept && (
              <div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
                  <FormField label="Driver Name" value={driverName} onChange={setDriverName} placeholder="Assigned driver" />
                  <FormField label="Driver Phone" value={driverPhone} onChange={setDriverPhone} placeholder="(555) 000-0000" />
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
                  <FormField label="Truck / Unit #" value={truckNum} onChange={setTruckNum} placeholder="Truck or trailer number" />
                  <FormField label="Carrier Pickup Date" type="date" value={carrierPickupDate} onChange={setCarrierPickupDate} />
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
                  <FormField label="PRO Number" value={proNumber} onChange={setProNumber} placeholder="Enter PRO number" />
                  <FormField label="Estimated Pickup (Optional)" type="datetime-local" value={pickupEta} onChange={setPickupEta} />
                </div>
                <FormField label="Notes to Shipper" value={acceptNotes} onChange={setAcceptNotes} placeholder="Any special instructions or notes..." textarea />
              </div>
            )}

            {/* Reject Fields */}
            {isReject && (
              <div>
                <div style={{ marginBottom: 14 }}>
                  <label style={labelStyle}>Rejection Reason *</label>
                  <select
                    value={rejectReason}
                    onChange={(e) => setRejectReason(e.target.value)}
                    style={inputStyle}
                  >
                    <option value="">— Select reason —</option>
                    {REJECTION_REASONS.map((r) => (
                      <option key={r} value={r}>{r}</option>
                    ))}
                  </select>
                </div>
                <FormField label="Additional Comments" value={rejectNotes} onChange={setRejectNotes} placeholder="Provide additional details..." textarea />
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="modal-footer">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button
            className="btn"
            onClick={handleSubmit}
            disabled={!choice || (isReject && !rejectReason)}
            style={{
              minWidth: 140,
              background: isAccept ? "var(--green)" : isReject ? "var(--red)" : "var(--accent)",
              color: "#fff",
              border: `1px solid ${isAccept ? "var(--green)" : isReject ? "var(--red)" : "var(--accent)"}`,
              opacity: (!choice || (isReject && !rejectReason)) ? 0.5 : 1,
            }}
          >
            {isAccept ? "Confirm Acceptance" : isReject ? "Submit Rejection" : "Submit Response"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Sub-components ── */

const labelStyle = {
  fontSize: 11, fontWeight: 700, color: "var(--text3)",
  textTransform: "uppercase", letterSpacing: ".8px",
  display: "block", marginBottom: 5,
};

const inputStyle = {
  width: "100%", padding: "8px 10px", border: "1.5px solid var(--border)",
  borderRadius: 8, fontSize: 13, fontFamily: "inherit", boxSizing: "border-box",
  background: "#fff",
};

function SummaryCell({ label, value, valueColor, mono }) {
  return (
    <div>
      <div style={{ fontSize: 10, color: "var(--text3)", textTransform: "uppercase" }}>{label}</div>
      <div style={{
        fontWeight: 700, fontSize: 13, marginTop: 2,
        color: valueColor || "var(--text)",
        fontFamily: mono ? "monospace" : "inherit",
      }}>
        {value}
      </div>
    </div>
  );
}

function ChoiceCard({ active, color, activeBg, icon, title, subtitle, onClick }) {
  return (
    <div
      onClick={onClick}
      style={{
        display: "flex", alignItems: "center", gap: 12,
        padding: "14px 16px", border: `2px solid ${active ? color : "var(--border)"}`,
        borderRadius: 12, cursor: "pointer", transition: "all .15s",
        background: active ? activeBg : "",
      }}
    >
      <div style={{
        width: 36, height: 36, borderRadius: "50%",
        background: `${color}18`, display: "flex",
        alignItems: "center", justifyContent: "center",
        fontSize: 18, flexShrink: 0,
      }}>
        {icon}
      </div>
      <div>
        <div style={{ fontWeight: 700, fontSize: 13, color }}>{title}</div>
        <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 2 }}>{subtitle}</div>
      </div>
    </div>
  );
}

function FormField({ label, value, onChange, placeholder, type = "text", textarea }) {
  return (
    <div>
      <label style={labelStyle}>{label}</label>
      {textarea ? (
        <textarea
          rows={2}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          style={{ ...inputStyle, resize: "none" }}
        />
      ) : (
        <input
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          style={inputStyle}
        />
      )}
    </div>
  );
}
