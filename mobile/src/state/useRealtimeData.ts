/**
 * useRealtimeData — Supabase Realtime subscription for orders +
 * shipments tables. Mirror of frontend/src/hooks/useRealtimeOrders.js
 * but covering both tables in one hook so DataContext only wires it
 * once.
 *
 * QA bug #60 ("Status updates not real-time, need manual refresh"):
 * we listen for any INSERT / UPDATE / DELETE on either table and
 * trigger a debounced refreshData(). 250ms matches web.
 *
 * Behaviour:
 *   - Only subscribes when authenticated. Logging out closes the
 *     channels so we don't keep listening on a dead session.
 *   - Falls back to a no-op when @supabase/supabase-js isn't
 *     configured (no anon key in build), so the rest of the app
 *     keeps working — just without live updates.
 *   - Debounces multiple rapid changes (a planning batch can fire 30+
 *     UPDATEs at once) into a single refreshData call.
 *   - Channel-state aware (#60 follow-up): if the realtime socket
 *     drops (cellular hand-off, app backgrounded, server bounce) the
 *     subscribe() callback fires with CLOSED / CHANNEL_ERROR /
 *     TIMED_OUT. We trigger a refresh on every SUBSCRIBED transition
 *     so the user sees the latest state on reconnect without having
 *     to pull-to-refresh — and we re-fire on app foreground via
 *     AppState so a phone returning from sleep catches up.
 */
import { useEffect } from 'react';
import { AppState } from 'react-native';
import { getSupabaseClient } from '../lib/supabaseClient';

export interface UseRealtimeDataArgs {
  /** Only subscribe when this is true. */
  enabled: boolean;
  /** Called (debounced) whenever the watched tables change. */
  onChange: () => void | Promise<void>;
  /** Override the debounce window — only useful in tests. */
  debounceMs?: number;
}

const DEFAULT_DEBOUNCE_MS = 250;

export function useRealtimeData({
  enabled,
  onChange,
  debounceMs = DEFAULT_DEBOUNCE_MS,
}: UseRealtimeDataArgs): void {
  useEffect(() => {
    if (!enabled) return;
    const client = getSupabaseClient();
    if (!client) {
      // No Supabase client configured — silently no-op so callers
      // don't have to special-case this. Manual refresh still works.
      return;
    }

    let timer: ReturnType<typeof setTimeout> | null = null;
    const fire = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        try {
          const result = onChange();
          if (result && typeof (result as any).catch === 'function') {
            (result as any).catch(() => {
              /* swallow refresh errors so a flaky network doesn't
                 wedge the realtime listener */
            });
          }
        } catch {
          /* same — never let a refresh error tear down the channel */
        }
        timer = null;
      }, debounceMs);
    };

    /**
     * Subscribe-status callback shared by both channels. Supabase-js
     * invokes this with one of:
     *   'SUBSCRIBED'      — channel is live (initial connect AND every
     *                       reconnect after a drop). Treat both the
     *                       same: pull fresh data so the user sees
     *                       what they missed while disconnected.
     *   'CLOSED'          — channel torn down. Logged for diagnostics.
     *   'CHANNEL_ERROR'   — server rejected; auto-reconnect handles it.
     *   'TIMED_OUT'       — heartbeat lapsed; supabase-js retries.
     */
    const onChannelStatus = (channelName: string) => (status: string) => {
      if (status === 'SUBSCRIBED') {
        fire();
      } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        // Diagnostic only — supabase-js auto-reconnects internally.
        // Avoid console.warn so dev logs aren't noisy on routine app
        // backgrounding.
        if (__DEV__) {
          console.log(`[realtime] ${channelName} status=${status}`);
        }
      }
    };

    // Mirror web pattern: one channel per table, event:'*' covers
    // INSERT / UPDATE / DELETE. Naming the channel "rt:orders" (web
    // already uses this name) is fine — Supabase channel names are
    // per-client, not global, so two devices with the same channel
    // name don't collide.
    const ordersChannel = client
      .channel('rt:mobile-orders')
      .on(
        // @ts-expect-error supabase-js ships postgres_changes as a
        // string literal type; we use the broad string union here so
        // future TS bumps don't flake the build.
        'postgres_changes',
        { event: '*', schema: 'public', table: 'orders' },
        () => fire(),
      )
      .subscribe(onChannelStatus('orders'));

    const shipmentsChannel = client
      .channel('rt:mobile-shipments')
      .on(
        // @ts-expect-error see above
        'postgres_changes',
        { event: '*', schema: 'public', table: 'shipments' },
        () => fire(),
      )
      .subscribe(onChannelStatus('shipments'));

    // App-foreground refresh: when the user returns from background
    // (phone asleep, app switched away) the socket may have been
    // suspended. Force a refresh so the screen they're on doesn't
    // render stale data while waiting for the next realtime event.
    const appStateSub = AppState.addEventListener('change', (next) => {
      if (next === 'active') fire();
    });

    return () => {
      if (timer) clearTimeout(timer);
      appStateSub.remove();
      client.removeChannel(ordersChannel);
      client.removeChannel(shipmentsChannel);
    };
  }, [enabled, onChange, debounceMs]);
}
