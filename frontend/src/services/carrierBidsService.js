/* Carrier Bids — data layer / service */

import { BID_STATUSES } from "../types/carrierBids";

// TODO: Replace with real API calls when backend is ready
export function fetchBids() {
  return Promise.resolve([]);
}

export function saveBid(bid) {
  // placeholder — will call DbApi.upsert("carrier_bids", bid)
  return Promise.resolve(bid);
}

export function deleteBid(id) {
  // placeholder — will call DbApi.remove("carrier_bids", id)
  return Promise.resolve(id);
}
