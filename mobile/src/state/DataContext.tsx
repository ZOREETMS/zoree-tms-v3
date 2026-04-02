import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react';
import { DbApi } from '../lib/api';
import { useAuth } from './AuthContext';

export interface TmsData {
  orders: any[];
  shipments: any[];
  carriers: any[];
  lanePreferences: any[];
  items: any[];
  locations: any[];
  packagingUnits: any[];
  rates: any[];
  drivers: any[];
  invoices: any[];
  routeTemplates: any[];
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
  lanePreferences: [],
  items: [],
  locations: [],
  packagingUnits: [],
  rates: [],
  drivers: [],
  invoices: [],
  routeTemplates: [],
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
        lanePreferences,
        items,
        locations,
        packagingUnits,
        rates,
        drivers,
        invoices,
        routeTemplates,
      ] = await Promise.all([
        DbApi.orders(),
        DbApi.shipments(),
        DbApi.carriers(),
        DbApi.lanePreferences().catch(() => []),
        DbApi.items().catch(() => []),
        DbApi.locations().catch(() => []),
        DbApi.packagingUnits().catch(() => []),
        DbApi.rates().catch(() => []),
        DbApi.drivers().catch(() => []),
        DbApi.invoices().catch(() => []),
        DbApi.routeTemplates().catch(() => []),
      ]);

      setData({
        orders: Array.isArray(orders) ? orders : [],
        shipments: Array.isArray(shipments) ? shipments : [],
        carriers: Array.isArray(carriers) ? carriers : [],
        lanePreferences: Array.isArray(lanePreferences) ? lanePreferences : [],
        items: Array.isArray(items) ? items : [],
        locations: Array.isArray(locations) ? locations : [],
        packagingUnits: Array.isArray(packagingUnits) ? packagingUnits : [],
        rates: Array.isArray(rates) ? rates : [],
        drivers: Array.isArray(drivers) ? drivers : [],
        invoices: Array.isArray(invoices) ? invoices : [],
        routeTemplates: Array.isArray(routeTemplates) ? routeTemplates : [],
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
