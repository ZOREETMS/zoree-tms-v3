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

export interface TmsData {
  orders: any[];
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
  shipments: [],
  carriers: [],
  customers: [],
  lanePreferences: [],
  items: [],
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
        packagingUnits,
        rates,
        drivers,
        invoices,
        routeTemplates,
        equipmentTypes,
        vehicles,
      ] = await Promise.all([
        DbApi.orders(),
        DbApi.shipments(),
        DbApi.carriers(),
        DbApi.customers().catch(() => []),
        DbApi.lanePreferences().catch(() => []),
        DbApi.items().catch(() => []),
        DbApi.locations().catch(() => []),
        DbApi.packagingUnits().catch(() => []),
        DbApi.rates().catch(() => []),
        DbApi.drivers().catch(() => []),
        DbApi.invoices().catch(() => []),
        DbApi.routeTemplates().catch(() => []),
        DbApi.equipmentTypes().catch(() => []),
        DbApi.vehicles().catch(() => []),
      ]);

      setData({
        orders: Array.isArray(orders) ? orders : [],
        shipments: Array.isArray(shipments) ? shipments : [],
        carriers: Array.isArray(carriers) ? carriers : [],
        customers: Array.isArray(customers) ? customers : [],
        lanePreferences: Array.isArray(lanePreferences) ? lanePreferences : [],
        items: Array.isArray(items) ? items : [],
        locations: Array.isArray(locations) ? locations : [],
        packagingUnits: Array.isArray(packagingUnits) ? packagingUnits : [],
        rates: Array.isArray(rates) ? rates : [],
        drivers: Array.isArray(drivers) ? drivers : [],
        invoices: Array.isArray(invoices) ? invoices : [],
        routeTemplates: Array.isArray(routeTemplates) ? routeTemplates : [],
        equipmentTypes: Array.isArray(equipmentTypes) ? equipmentTypes : [],
        vehicles: Array.isArray(vehicles) ? vehicles : [],
      });
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
