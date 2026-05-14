import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react';
import { DbApi } from '../lib/api';
import { useAuth } from './AuthContext';
import { useRealtimeData } from './useRealtimeData';
// REQ-02 Phase 2 (mobile parity, 2026-05-10): Express WebSocket bridge.
// Sibling to useRealtimeData — covers OMS/middleware events that don't
// land in the orders/shipments tables (dock-config edits, mw_*
// mappings, planning-parameter tweaks). See risk #2 in the 2026-05-09
// audit report.
import { useExpressEvents } from './useExpressEvents';
// REQ-OFFLINE Phase 5 (2026-05-10): write-through orders/shipments
// to the local SQLite cache after each successful refresh so the
// detail screens can serve from cache while offline. The repos are
// no-ops on the read side from DataContext's perspective — we only
// prime them with whatever the network returned.
import * as ordersRepo from '../services/offline/ordersRepo';
import * as shipmentsRepo from '../services/offline/shipmentsRepo';

export interface TmsData {
  orders: any[];
  /**
   * True row count for the orders table — sourced from
   * /api/orders/count. The `orders` array above is bounded by the
   * 500-row page DbApi.orders returns, so the dashboard tile and the
   * OrdersScreen "All" chip should read `ordersTotal` instead of
   * `orders.length` once you have more than 500 orders.
   */
  ordersTotal: number;
  shipments: any[];
  carriers: any[];
  /**
   * QA bug #113 - oms_customers (active rows only). Used by
   * services/optionsService.customerOptions to widen the New Order
   * Customer dropdown beyond just-the-customers-already-on-orders, so
   * mobile parity matches what the web sees via the OMS app. Empty
   * array when the OMS app isn't seeded for this tenant - the dropdown
   * gracefully falls back to order-derived names.
   */
  customers: any[];
  lanePreferences: any[];
  items: any[];
  locations: any[];
  /**
   * QA P211 (2026-05-11): OMS locations master, pulled alongside the
   * TMS locations array so the OrderForm picker can merge both. Empty
   * when the tenant's OMS isn't seeded; OrderFormScreen treats the
   * missing list as a graceful no-op and falls back to TMS-only.
   */
  omsLocations: any[];
  packagingUnits: any[];
  rates: any[];
  drivers: any[];
  invoices: any[];
  routeTemplates: any[];
  /**
   * Equipment master rows (trailer types). Optional in callers - when
   * absent or empty, services like rateService / equipmentService fall
   * back to SEED_EQUIPMENT.
   */
  equipmentTypes: any[];
  /** Fleet vehicles. Empty -> FleetScreen falls back to its in-file seed. */
  vehicles: any[];
}

interface DataContextValue {
  data: TmsData;
  setData: React.Dispatch<React.SetStateAction<TmsData>>;
  loading: boolean;
  error: string;
  refreshData: () => Promise<void>;
}

const emptyData: TmsData = {
  orders: [],
  ordersTotal: 0,
  shipments: [],
  carriers: [],
  customers: [],
  lanePreferences: [],
  items: [],
  omsLocations: [],
  locations: [],
  packagingUnits: [],
  rates: [],
  drivers: [],
  invoices: [],
  routeTemplates: [],
  equipmentTypes: [],
  vehicles: [],
};

const DataContext = createContext<DataContextValue | null>(null);

export function DataProvider({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAuth();
  const [data, setData] = useState<TmsData>(emptyData);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const refreshData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      // QA #311 / #308 / #310 — silent .catch(() => []) used to make a
      // failing endpoint indistinguishable from an empty table. Log a
      // warning per failure so the underlying issue (network, RLS,
      // missing migration, schema drift) becomes discoverable from the
      // device logs.
      const swallow = (label: string) => (err: any) => {
        // eslint-disable-next-line no-console
        console.warn(
          `[DataContext.refreshData] ${label} failed:`,
          err?.message || err,
        );
        return [] as any[];
      };
      const [
        orders,
        shipments,
        carriers,
        // QA bug #113 - oms_customers fetched via DbApi.customers().
        // Wrapped in .catch so a tenant without the OMS app seeded
        // (or transient 4xx) still produces a usable Promise.all batch.
        customers,
        lanePreferences,
        items,
        locations,
        // QA P211 (2026-05-11): OMS locations master pulled alongside
        // the TMS one so the OrderForm picker can merge both sources
        // (web parity — its LocationSearchDropdown queries OMS).
        // Wrapped in .catch so a tenant without the OMS app seeded
        // doesn't poison the Promise.all.
        omsLocations,
        packagingUnits,
        rates,
        drivers,
        invoices,
        routeTemplates,
        equipmentTypes,
        vehicles,
        // True orders count — independent failure mode: a count outage
        // should not blank out the rest of the dashboard. On miss we
        // fall back to the prior total in the setData below (or 0 on
        // first load).
        ordersTotal,
      ] = await Promise.all([
        DbApi.orders(),
        DbApi.shipments(),
        DbApi.carriers(),
        DbApi.customers().catch(swallow('customers')),
        DbApi.lanePreferences().catch(swallow('lanePreferences')),
        DbApi.items().catch(swallow('items')),
        DbApi.locations().catch(swallow('locations')),
        DbApi.omsLocations().catch(swallow('omsLocations')),
        DbApi.packagingUnits().catch(swallow('packagingUnits')),
        DbApi.rates().catch(swallow('rates')),
        DbApi.drivers().catch(swallow('drivers')),
        DbApi.invoices().catch(swallow('invoices')),
        DbApi.routeTemplates().catch(swallow('routeTemplates')),
        DbApi.equipmentTypes().catch(swallow('equipmentTypes')),
        DbApi.vehicles().catch(swallow('vehicles')),
        DbApi.ordersCount().catch((err: any) => {
          // eslint-disable-next-line no-console
          console.warn(
            '[DataContext.refreshData] ordersCount failed:',
            err?.message || err,
          );
          return undefined;
        }),
      ]);

      // REQ-OFFLINE Phase 5: write-through orders + shipments to the
      // SQLite cache so the detail screens still render while offline.
      // Best-effort — a SQLite hiccup here mustn't block the in-memory
      // state update below.
      if (Array.isArray(orders))    ordersRepo.primeFromServer(orders).catch(() => {});
      if (Array.isArray(shipments)) shipmentsRepo.primeFromServer(shipments).catch(() => {});

      setData((prev) => ({
        orders: Array.isArray(orders) ? orders : [],
        ordersTotal: typeof ordersTotal === 'number' ? ordersTotal : prev.ordersTotal ?? 0,
        shipments: Array.isArray(shipments) ? shipments : [],
        carriers: Array.isArray(carriers) ? carriers : [],
        customers: Array.isArray(customers) ? customers : [],
        lanePreferences: Array.isArray(lanePreferences) ? lanePreferences : [],
        items: Array.isArray(items) ? items : [],
        locations: Array.isArray(locations) ? locations : [],
        // QA P211 (2026-05-11): expose the OMS locations master to the
        // OrderForm picker so its dropdown matches the web's union.
        omsLocations: Array.isArray(omsLocations) ? omsLocations : [],
        packagingUnits: Array.isArray(packagingUnits) ? packagingUnits : [],
        rates: Array.isArray(rates) ? rates : [],
        drivers: Array.isArray(drivers) ? drivers : [],
        invoices: Array.isArray(invoices) ? invoices : [],
        routeTemplates: Array.isArray(routeTemplates) ? routeTemplates : [],
        equipmentTypes: Array.isArray(equipmentTypes) ? equipmentTypes : [],
        vehicles: Array.isArray(vehicles) ? vehicles : [],
      }));
    } catch (e: any) {
      setError(e.message || 'Failed loading data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isAuthenticated) {
      refreshData();
    } else {
      setData(emptyData);
      // REQ-OFFLINE Phase 5: a queue + cache belong to a session.
      // On logout, clear both so the next user doesn't see the
      // previous user's cached orders / pending writes.
      ordersRepo.clearAll().catch(() => {});
      shipmentsRepo.clearAll().catch(() => {});
    }
  }, [isAuthenticated, refreshData]);

  // QA bug #60 + #63: subscribe to Supabase Realtime so a status
  // change made on web (or by a planning batch on the server) shows
  // up on this device without a manual pull-to-refresh. The hook
  // no-ops when supabaseClient isn't configured, so unauthenticated /
  // dev builds keep working.
  useRealtimeData({
    enabled: isAuthenticated,
    onChange: refreshData,
  });

  // REQ-02 Phase 2 (mobile parity, 2026-05-10): subscribe to the
  // Express WebSocket bridge so OMS/middleware-driven events
  // (dock_config_changed, mw_request_processed, planning_parameters_changed,
  // tender_accepted, …) refresh DataContext without pull-to-refresh.
  // useRealtimeData covers Supabase postgres_changes on orders +
  // shipments; this hook covers everything else the server broadcasts.
  // The two together replace the audit Risk #2 gap from the
  // 2026-05-09 web↔mobile parity audit.
  useExpressEvents({
    enabled: isAuthenticated,
    onChange: refreshData,
  });

  return (
    <DataContext.Provider value={{ data, setData, loading, error, refreshData }}>
      {children}
    </DataContext.Provider>
  );
}

export function useData(): DataContextValue {
  const ctx = useContext(DataContext);
  if (!ctx) {
    throw new Error('useData must be used inside DataProvider');
  }
  return ctx;
}
