/* Carrier Bids — data layer / service */

import { BID_STATUSES } from "../types/carrierBids";

// Seed data matching the old HTML app
export const SEED_BIDS = [
  {
    id: "RFQ-2026-001",
    lane: "Chicago, IL → Dallas, TX",
    volume: 12,
    deadline: "2026-03-10",
    bids: 3,
    bestBid: "$2.18/mi",
    incumbent: "Schneider National",
    status: BID_STATUSES.OPEN,
    responses: [
      { carrier: "Swift Transport", rate: "$2.24/mi", score: 88 },
      { carrier: "JB Hunt", rate: "$2.18/mi", score: 92 },
      { carrier: "Werner", rate: "$2.31/mi", score: 85 },
    ],
  },
  {
    id: "RFQ-2026-002",
    lane: "Columbus, OH → Atlanta, GA",
    volume: 8,
    deadline: "2026-03-15",
    bids: 4,
    bestBid: "$2.05/mi",
    incumbent: "XPO Logistics",
    status: BID_STATUSES.OPEN,
    responses: [
      { carrier: "Old Dominion", rate: "$2.05/mi", score: 95 },
      { carrier: "Swift Transport", rate: "$2.12/mi", score: 87 },
      { carrier: "JB Hunt", rate: "$2.19/mi", score: 83 },
      { carrier: "Werner", rate: "$2.28/mi", score: 79 },
    ],
  },
  {
    id: "RFQ-2026-003",
    lane: "Los Angeles, CA → Seattle, WA",
    volume: 5,
    deadline: "2026-03-20",
    bids: 2,
    bestBid: "$2.42/mi",
    incumbent: "Werner Enterprises",
    status: BID_STATUSES.OPEN,
    responses: [
      { carrier: "Swift Transport", rate: "$2.42/mi", score: 86 },
      { carrier: "JB Hunt", rate: "$2.55/mi", score: 80 },
    ],
  },
  {
    id: "RFQ-2026-004",
    lane: "New York, NY → Chicago, IL",
    volume: 15,
    deadline: "2026-02-28",
    bids: 4,
    bestBid: "$2.15/mi",
    incumbent: "JB Hunt",
    status: BID_STATUSES.AWARDED,
    responses: [],
  },
  {
    id: "RFQ-2026-005",
    lane: "Houston, TX → Miami, FL",
    volume: 6,
    deadline: "2026-02-15",
    bids: 3,
    bestBid: "$2.38/mi",
    incumbent: "XPO Logistics",
    status: BID_STATUSES.AWARDED,
    responses: [],
  },
];

// TODO: Replace with real API calls when backend is ready
export function fetchBids() {
  return Promise.resolve(SEED_BIDS);
}

export function saveBid(bid) {
  // placeholder — will call DbApi.upsert("carrier_bids", bid)
  return Promise.resolve(bid);
}

export function deleteBid(id) {
  // placeholder — will call DbApi.remove("carrier_bids", id)
  return Promise.resolve(id);
}
