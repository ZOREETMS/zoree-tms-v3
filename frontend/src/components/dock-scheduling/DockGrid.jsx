import { APPT_TYPE_COLORS } from "../../constants/docks";

const HOUR_PX = 80;          // pixels per hour column
const DOOR_COL_PX = 80;      // width of the door label column

export default function DockGrid({ doors, startHour = 6, endHour = 20, appointments, onSlotClick, onAppointmentClick }) {
  const totalHours = endHour - startHour;
  const hours = Array.from({ length: totalHours }, (_, i) => `${String(startHour + i).padStart(2, "0")}:00`);
  const timelineWidth = totalHours * HOUR_PX;

  function timeToOffset(timeStr) {
    const [h, m] = (timeStr || "06:00").split(":").map(Number);
    return (h - startHour) + (m / 60);
  }

  return (
    <div className="card" style={{ padding: 0 }}>
      <div className="table-wrap" style={{ overflowX: "auto" }}>
        <div style={{ minWidth: DOOR_COL_PX + timelineWidth, position: "relative" }}>
          {/* Header row */}
          <div style={{ display: "flex", borderBottom: "1px solid #e5e7eb" }}>
            <div style={{
              width: DOOR_COL_PX, minWidth: DOOR_COL_PX, flexShrink: 0,
              position: "sticky", left: 0, background: "#f8faff", zIndex: 2,
              fontWeight: 700, fontSize: 11, padding: "8px 6px", textTransform: "uppercase",
              color: "#64748b",
            }}>
              Door
            </div>
            <div style={{ display: "flex", flex: 1, position: "relative" }}>
              {hours.map((h) => (
                <div key={h} style={{
                  width: HOUR_PX, minWidth: HOUR_PX, textAlign: "center",
                  fontSize: 10, fontWeight: 600, padding: "8px 0", color: "#64748b",
                  borderLeft: "1px solid #f0f0f0",
                }}>
                  {h}
                </div>
              ))}
            </div>
          </div>

          {/* Door rows */}
          {doors.map((door) => {
            const doorAppts = appointments.filter((a) => a.door === door);
            return (
              <div key={door} style={{
                display: "flex", borderBottom: "1px solid #f0f0f0", minHeight: 44,
              }}>
                {/* Door label */}
                <div style={{
                  width: DOOR_COL_PX, minWidth: DOOR_COL_PX, flexShrink: 0,
                  position: "sticky", left: 0, background: "#fff", zIndex: 1,
                  fontWeight: 700, fontSize: 12, padding: "8px 6px",
                  display: "flex", alignItems: "center", gap: 4,
                }}>
                  🚪 {door}
                  <button
                    onClick={() => onSlotClick(door, "08:00")}
                    style={{
                      fontSize: 10, background: "var(--accent-glow)",
                      border: "1px solid rgba(59,130,246,.2)", borderRadius: 4,
                      cursor: "pointer", padding: "1px 4px", color: "var(--accent)",
                    }}
                  >+</button>
                </div>

                {/* Timeline area */}
                <div style={{ flex: 1, position: "relative", minHeight: 40 }}>
                  {/* Hour gridlines */}
                  {hours.map((h, i) => (
                    <div key={h} style={{
                      position: "absolute", left: i * HOUR_PX, top: 0, bottom: 0,
                      width: 1, background: "#f0f0f0",
                    }} />
                  ))}

                  {/* Appointment blocks */}
                  {doorAppts.map((appt) => {
                    const offset = timeToOffset(appt.start);
                    const widthHours = (appt.duration || 60) / 60;
                    const bg = APPT_TYPE_COLORS[appt.type] || APPT_TYPE_COLORS.Outbound;
                    return (
                      <div
                        key={appt.id}
                        style={{
                          position: "absolute",
                          left: offset * HOUR_PX,
                          width: widthHours * HOUR_PX,
                          top: 4, bottom: 4,
                          background: bg, color: "#fff", borderRadius: 6,
                          padding: "4px 8px", fontSize: 10, fontWeight: 700,
                          cursor: "pointer", whiteSpace: "nowrap", overflow: "hidden",
                          textOverflow: "ellipsis",
                          display: "flex", alignItems: "center",
                          boxShadow: "0 1px 3px rgba(0,0,0,.15)",
                        }}
                        title={`${appt.carrier} — ${appt.shipmentId} (${appt.duration}min)`}
                        onClick={() => onAppointmentClick(appt)}
                      >
                        {appt.carrier?.split(" ")[0] || "TBD"}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
