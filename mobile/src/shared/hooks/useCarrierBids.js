/* useCarrierBids — state management for the Carrier Bids feature */

import { useState, useMemo } from "react";
import { BID_STATUSES } from "../types/carrierBids";

export function useCarrierBids(initialData = []) {
  const [bids, setBids] = useState(initialData);

  const stats = useMemo(() => {
    const activeRfqs = bids.filter((b) => b.status === BID_STATUSES.OPEN).length;
    const totalBids = bids.reduce((sum, b) => sum + (b.bids || 0), 0);
    const awarded = bids.filter((b) => b.status === BID_STATUSES.AWARDED).length;
    // QA #325 — dashboard should mirror the web 4-status breakdown
    // (Open / Awarded / Closed). Closed = explicit closed status OR
    // cancelled — both indicate the RFQ is no longer accepting bids.
    const closed = bids.filter(
      (b) => b.status === BID_STATUSES.CLOSED || b.status === BID_STATUSES.CANCELLED,
    ).length;
    return { activeRfqs, totalBids, awarded, closed, avgSavings: "8.4%" };
  }, [bids]);

  function awardBid(rfqId, carrier) {
    setBids((prev) =>
      prev.map((b) =>
        b.id === rfqId
          ? { ...b, status: BID_STATUSES.AWARDED, incumbent: carrier }
          : b
      )
    );
  }

  function addRfq(rfq) {
    const id = `RFQ-${new Date().getFullYear()}-${String(bids.length + 1).padStart(3, "0")}`;
    const newRfq = {
      ...rfq,
      id,
      bids: 0,
      bestBid: "—",
      incumbent: "—",
      status: BID_STATUSES.OPEN,
      responses: [],
    };
    setBids((prev) => [newRfq, ...prev]);
    return newRfq;
  }

  return { bids, stats, awardBid, addRfq };
}
