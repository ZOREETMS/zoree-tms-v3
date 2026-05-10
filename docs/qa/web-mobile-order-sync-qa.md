# Web -> Mobile Order Sync — Manual QA Checklist

**Bug:** Updating an order on the web app didn't reflect in the mobile
order until the order was manually refreshed (pull-to-refresh).

**Fix (2026-05-10):** `mobile/src/hooks/useOrderDetailLiveSync.ts` —
the OrderDetailScreen now refetches lines + history whenever the
`orders` row's `updated_at` changes server-side (which Supabase
Realtime already broadcasts), and on app-foreground transitions.

## Pre-conditions

- [ ] Web build is the version with the existing realtime publication
      (`supabase/migrations/20260429_oms_orders_realtime_publication.sql`
      must already be applied — `orders` and `shipments` are in the
      `supabase_realtime` publication).
- [ ] Mobile build has `EXPO_PUBLIC_SUPABASE_ANON_KEY` set
      (`mobile/src/config/env.ts`). Without it Realtime is silently
      disabled and this fix has nothing to ride on.
- [ ] You can sign in as the same user on both web and mobile, or as
      two users in the same tenant.
- [ ] Pick one existing order with at least 2 line items and note its
      ORD-2026-... id. You'll edit it from the web side.

## Setup

1. Open the web app -> Orders -> select your test order. Keep the
   OrderDetailModal open in the Edit tab.
2. On the phone, open the mobile app and navigate to the same order's
   detail screen. Leave the screen visible — DO NOT pull to refresh
   between steps.

## Test cases

### 1. Header field edit (status / customer / commodity)

- [ ] On web, change Status from "Unplanned" to "Planned" (or any
      transition allowed for this order). Save.
- [ ] On mobile, within ~1–2 seconds the status badge in the header
      should flip to "Planned". No pull-to-refresh.
- [ ] On web, change Customer or Commodity. Save.
- [ ] On mobile, the corresponding row in the "Order Information" card
      should update without a manual refresh.

### 2. Order-line edit (was the worst-affected slice)

- [ ] On web, open the Lines tab. Change a line's Qty (e.g. 3 -> 7) and
      Save.
- [ ] On mobile within ~1–2 seconds the per-line Qty should change
      AND the header Weight + Pieces totals should reflect the new
      total. **Both** must update without pull-to-refresh.
- [ ] Add a new line on web. Save.
- [ ] Mobile per-line table should grow by one entry without manual
      refresh.
- [ ] Delete a line on web. Save.
- [ ] Mobile per-line table should shrink by one entry without manual
      refresh.

### 3. Change-history surface

- [ ] On web, edit any field (e.g. notes -> "QA test"). Save.
- [ ] On mobile, the History card on the order detail should add a new
      entry within ~1–2 seconds, no manual refresh required.

### 4. Background -> foreground catch-up

- [ ] On mobile, send the app to background (home button).
- [ ] On web, change the order status (e.g. Cancelled).
- [ ] Wait ~30 seconds, then bring the mobile app to foreground.
- [ ] The order detail should be up to date immediately on resume —
      this is the AppState 'active' tick path.

### 5. No spurious refetch storms

- [ ] On web, in a different tab, edit a *different* order (not the
      one you're watching on mobile).
- [ ] Watch the mobile app's logs (`expo start` console) during the
      web edit. The OrderDetailScreen should NOT log a new
      `OrdersApi.lines(...)` request — only the order list refresh
      runs, not the per-detail fetch.

### 6. Offline-then-online (sanity check, REQ-OFFLINE Phase 5 already
       handles the queue side)

- [ ] Put the phone in airplane mode.
- [ ] On web, edit the order's status.
- [ ] On mobile, the screen will not update (expected — no socket).
- [ ] Re-enable wifi/cell. Within ~1–2 seconds of socket reconnect,
      the mobile order detail should catch up. (The `SUBSCRIBED`
      transition in `useRealtimeData` triggers a `refreshData`, which
      then bumps `useOrderDetailLiveSync`'s tick.)

## Expected timing

Realtime debounce is 250 ms in `useRealtimeData`. Allow up to ~1.5 s
end-to-end (network + Supabase fan-out + 250 ms debounce + render).
Anything reliably > 5 s is a regression — check that the device still
has a live socket (look for `[realtime] orders status=SUBSCRIBED` in
the dev console on connect).

## If something is stale

1. Check `__DEV__` logs for `[supabaseClient] Missing Supabase URL or
   anon key`. If you see it, the build is missing
   `EXPO_PUBLIC_SUPABASE_ANON_KEY` and Realtime is disabled.
2. Check `[realtime] orders status=...` — should show `SUBSCRIBED`.
   If it shows `CHANNEL_ERROR` repeatedly, the publication or the RLS
   policy on `orders` may be misconfigured (re-verify
   `20260429_oms_orders_realtime_publication.sql` is applied).
3. Confirm `getOrderSyncSignature` is finding the order: the most
   common failure is an id-type mismatch (numeric vs string). The
   helper handles both, but custom payload shapes might miss the
   `id`/`order_id` lookup.
