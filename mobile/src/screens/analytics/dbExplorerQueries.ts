/**
 * dbExplorerQueries — canned, mobile-friendly "saved queries" for the
 * mobile DB Explorer (QA #297).
 *
 * Context: QA P207 (2026-05-11) made the mobile DB Explorer a landing
 * page rather than a raw SQL editor (raw SQL on a phone is impractical).
 * QA #297 (2026-05-14) re-raised the gap: planners want SOME way to see
 * table-level data on mobile without round-tripping to the web app.
 *
 * Compromise: a small library of mobile-friendly canned queries that
 * run as plain JS filters against the data the DataContext has already
 * loaded. No SQL parser, no server round-trips, no syntax highlighting
 * — just a button per query and a row-list result view.
 *
 * Adding a new query:
 *   1. Add an entry to SAVED_QUERIES.
 *   2. `columns` controls the displayed columns + their headers.
 *   3. `run(data)` receives the DataContext payload and returns rows.
 */

export interface SavedQueryColumn {
  key: string;
  header: string;
  /** Optional derivation when the row doesn't carry the field directly. */
  value?: (row: any) => any;
}

export interface SavedQuery {
  id: string;
  label: string;
  description: string;
  table: string;
  columns: SavedQueryColumn[];
  /** Run the query against the loaded DataContext payload. */
  run: (data: any) => any[];
}

const fmtMoney = (v: any) =>
  v == null
    ? '—'
    : `$${Number(v).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

export const SAVED_QUERIES: SavedQuery[] = [
  {
    id: 'unplanned-orders',
    label: 'Unplanned Orders',
    description: 'Orders awaiting planning, oldest first.',
    table: 'orders',
    columns: [
      { key: 'id',        header: 'Order' },
      { key: 'customer',  header: 'Customer' },
      { key: 'origin',    header: 'Origin' },
      { key: 'dest',      header: 'Dest', value: (r) => r.dest || r.destination },
      { key: 'weight',    header: 'Weight' },
      { key: 'created_at', header: 'Created', value: (r) => (r.created_at || '').slice(0, 10) },
    ],
    run: (data) =>
      (data.orders || [])
        .filter((o: any) => (o.status || '').toLowerCase() === 'unplanned')
        .sort(
          (a: any, b: any) =>
            new Date(a.created_at || 0).getTime() -
            new Date(b.created_at || 0).getTime(),
        ),
  },
  {
    id: 'in-transit-shipments',
    label: 'In-Transit Shipments',
    description: 'All shipments currently moving.',
    table: 'shipments',
    columns: [
      { key: 'id',           header: 'Shipment' },
      { key: 'carrier',      header: 'Carrier', value: (r) => r.carrier_name || r.carrier },
      { key: 'origin',       header: 'Origin',  value: (r) => r.origin_city || r.origin },
      { key: 'destination',  header: 'Dest',    value: (r) => r.destination_city || r.destination },
      { key: 'pickup_date',  header: 'Pickup',  value: (r) => (r.pickup_date || r.pickupDate || '').slice(0, 10) },
      { key: 'total_cost',   header: 'Cost',    value: (r) => fmtMoney(r.total_cost) },
    ],
    run: (data) =>
      (data.shipments || []).filter(
        (s: any) => (s.status || '').toLowerCase() === 'in transit',
      ),
  },
  {
    id: 'top-lanes-by-volume',
    label: 'Top Lanes by Volume',
    description: 'Most-shipped origin→destination pairs (top 10).',
    table: 'shipments',
    columns: [
      { key: 'lane',       header: 'Lane' },
      { key: 'count',      header: 'Shipments' },
      { key: 'totalCost',  header: 'Total Spend', value: (r) => fmtMoney(r.totalCost) },
    ],
    run: (data) => {
      const groups: Record<string, { lane: string; count: number; totalCost: number }> = {};
      for (const s of data.shipments || []) {
        const lane = `${s.origin_city || s.origin || '—'} → ${s.destination_city || s.destination || '—'}`;
        if (!groups[lane]) groups[lane] = { lane, count: 0, totalCost: 0 };
        groups[lane].count += 1;
        groups[lane].totalCost += parseFloat(s.total_cost) || 0;
      }
      return Object.values(groups)
        .sort((a, b) => b.count - a.count)
        .slice(0, 10);
    },
  },
  {
    id: 'active-rates',
    label: 'Active Rates',
    description: 'Rates with status = Active (no expiry filter applied).',
    table: 'rates',
    columns: [
      { key: 'lane',    header: 'Lane' },
      { key: 'carrier', header: 'Carrier' },
      { key: 'mode',    header: 'Mode' },
      { key: 'rate',    header: 'Rate',   value: (r) => fmtMoney(r.rate || r.rate_per_mile) },
      { key: 'exp',     header: 'Expiry', value: (r) => r.exp || r.expiry_date || '—' },
    ],
    run: (data) =>
      (data.rates || []).filter(
        (r: any) => (r.status || 'Active').toLowerCase() === 'active',
      ),
  },
  {
    id: 'disputed-invoices',
    label: 'Disputed Invoices',
    description: 'Invoices flagged for review.',
    table: 'invoices',
    columns: [
      { key: 'num',     header: 'Invoice' },
      { key: 'carrier', header: 'Carrier' },
      { key: 'shipId',  header: 'Shipment', value: (r) => r.shipId || r.shipment_id },
      { key: 'amount',  header: 'Amount',   value: (r) => fmtMoney(r.amount || r.invoiced_amount) },
      { key: 'status',  header: 'Status' },
    ],
    run: (data) =>
      (data.invoices || []).filter((i: any) => {
        const s = (i.status || '').toLowerCase();
        return s === 'disputed' || s === 'on hold' || s === 'pending';
      }),
  },
  {
    id: 'driver-roster',
    label: 'Driver Roster',
    description: 'All drivers with CDL + assigned vehicle.',
    table: 'drivers',
    columns: [
      { key: 'id',         header: 'ID' },
      { key: 'name',       header: 'Name' },
      { key: 'cdl',        header: 'CDL',     value: (r) => r.cdl || r.cdl_number },
      { key: 'cdlClass',   header: 'Class',   value: (r) => r.cdlClass || r.cdl_class },
      { key: 'vehicle',    header: 'Vehicle', value: (r) => r.vehicle || r.assigned_vehicle },
      { key: 'status',     header: 'Status' },
    ],
    run: (data) => data.drivers || [],
  },
];
