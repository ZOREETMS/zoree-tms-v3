import { genId } from "./routeFormatters";

/**
 * Create a blank route template with default values.
 */
export function emptyRoute() {
  return {
    id: genId(),
    name: "",
    mode: "TL",
    carrier: "",
    max_weight: 44000,
    cost_override: "",
    miles_override: "",
    transit_days: "",
    status: "Active",
    notes: "",
    stops: [
      { sequence: 1, city: "", state: "", location: "", type: "pickup", stop_seq: 1, load_seq: "", lat: null, lng: null },
      { sequence: 2, city: "", state: "", location: "", type: "delivery", stop_seq: 2, load_seq: 1, lat: null, lng: null },
    ],
    total_miles: 0,
  };
}

/**
 * Recalculate load sequence as reverse of stop sequence.
 * Only delivery stops get a load number (LIFO — last delivery loaded first).
 * Pickup stops get empty load_seq.
 */
export function recalcLoadSeq(stopsList) {
  const deliveries = stopsList.filter((s) => s.type === "delivery");
  const deliveryCount = deliveries.length;
  let dIdx = 0;
  return stopsList.map((s, i) => {
    const base = { ...s, sequence: i + 1, stop_seq: i + 1 };
    if (s.type === "delivery") {
      base.load_seq = deliveryCount - dIdx;
      dIdx++;
    } else {
      base.load_seq = "";
    }
    return base;
  });
}
