import { DOCK_DOORS, DOCK_HOURS, APPT_TYPE_COLORS } from "../../constants/docks";

export default function DockGrid({ appointments, onSlotClick, onAppointmentClick }) {
  return (
    <div className="card" style={{ padding: 0 }}>
      <div className="table-wrap">
        <table className="grid" style={{ border: "none", boxShadow: "none", minWidth: 1200 }}>
          <thead>
            <tr>
              <th style={{ width: 80, position: "sticky", left: 0, background: "#f8faff", zIndex: 2 }}>DOOR</th>
              {DOCK_HOURS.map((h) => (
                <th key={h} style={{ textAlign: "center", minWidth: 70, fontSize: 10 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {DOCK_DOORS.map((door) => {
              const doorAppts = appointments.filter((a) => a.door === door);
              return (
                <tr key={door}>
                  <td style={{ fontWeight: 700, fontSize: 12, position: "sticky", left: 0, background: "#fff", zIndex: 1 }}>
                    🚪 {door}
                    <button
                      onClick={() => onSlotClick(door, "08:00")}
                      style={{ marginLeft: 4, fontSize: 10, background: "var(--accent-glow)", border: "1px solid rgba(59,130,246,.2)", borderRadius: 4, cursor: "pointer", padding: "1px 4px", color: "var(--accent)" }}
                    >+</button>
                  </td>
                  {DOCK_HOURS.map((h) => {
                    const appt = doorAppts.find((a) => a.start === h);
                    if (appt) {
                      const bg = APPT_TYPE_COLORS[appt.type] || APPT_TYPE_COLORS.Outbound;
                      return (
                        <td key={h} style={{ padding: 2 }}>
                          <div
                            style={{
                              background: bg, color: "#fff", borderRadius: 6,
                              padding: "4px 6px", fontSize: 10, fontWeight: 700,
                              cursor: "pointer", whiteSpace: "nowrap",
                              minWidth: 80, textAlign: "center",
                            }}
                            title={`${appt.carrier} - ${appt.shipmentId}`}
                            onClick={() => onAppointmentClick(appt)}
                          >
                            {appt.carrier?.split(" ")[0] || "TBD"}
                          </div>
                        </td>
                      );
                    }
                    return <td key={h} style={{ padding: 2 }} />;
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
