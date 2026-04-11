/**
 * Location Master constants — shared across Location screens.
 */

export const EMPTY_LOCATION = {
  id: '',
  name: '',
  type: 'Warehouse',
  customer: '',
  address: '',
  city: '',
  state: '',
  zip: '',
  country: 'US',
  lat: '',
  lng: '',
  contact_name: '',
  contact_phone: '',
  contact_email: '',
  ahphone: '',
  hours: '',
  dock_doors: '',
  trailer: 53,
  liftgate: 'No',
  appt: false,
  hazmat: false,
  resi: false,
  inside_delivery: false,
  sort_segregate: false,
  twic: false,
  notes: '',
  status: 'Active',
};

export const LOCATION_TYPES = [
  'Warehouse',
  'Distribution Center',
  'Customer',
  'Carrier',
  'Shipper',
  'Consignee',
  'Cross-Dock',
  'Port',
  'Rail Yard',
];

/** Color map for location type badges */
export const TYPE_COLORS = {
  Warehouse:            { bg: 'rgba(59,130,246,0.1)', text: '#2563EB' },
  'Distribution Center':{ bg: 'rgba(99,102,241,0.1)', text: '#6366F1' },
  Customer:             { bg: 'rgba(16,185,129,0.1)', text: '#059669' },
  Carrier:              { bg: 'rgba(245,158,11,0.1)', text: '#D97706' },
  Shipper:              { bg: 'rgba(14,165,233,0.1)', text: '#0EA5E9' },
  Consignee:            { bg: 'rgba(168,85,247,0.1)', text: '#A855F7' },
  'Cross-Dock':         { bg: 'rgba(239,68,68,0.1)',  text: '#DC2626' },
  Port:                 { bg: 'rgba(107,114,128,0.1)', text: '#64748B' },
  'Rail Yard':          { bg: 'rgba(107,114,128,0.1)', text: '#64748B' },
};
