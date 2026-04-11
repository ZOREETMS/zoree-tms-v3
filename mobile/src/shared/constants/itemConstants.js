/**
 * Item Master constants — shared across Item screens.
 */

export const EMPTY_ITEM = {
  id: '',
  description: '',
  customer: '',
  item_class: 'General',
  nmfc: '',
  freight_class: '70',
  weight_unit: '',
  value_unit: '',
  len: '',
  wid: '',
  hgt: '',
  units_per_pallet: '',
  pkg: 'Carton',
  stack: 1,
  hazmat: false,
  fragile: false,
  temp_ctrl: false,
  top_load: false,
  un: '',
  haz_class: '',
  status: 'Active',
};

export const ITEM_CLASSES = ['General', 'Electronics', 'Industrial', 'Perishable', 'Hazmat'];

export const FREIGHT_CLASSES = [
  '50', '55', '60', '65', '70', '77.5', '85', '92.5',
  '100', '110', '125', '150', '175', '200', '250', '300', '400', '500',
];

export const PKG_TYPES = ['Carton', 'Pallet', 'Drum', 'Crate', 'Tote', 'Bag', 'IBC'];

/** Color map for item class badges */
export const CLASS_COLORS = {
  Electronics: { bg: 'rgba(59,130,246,0.1)', text: '#2563EB' },
  Industrial:  { bg: 'rgba(245,158,11,0.1)', text: '#D97706' },
  Perishable:  { bg: 'rgba(16,185,129,0.1)', text: '#059669' },
  Hazmat:      { bg: 'rgba(239,68,68,0.1)',  text: '#DC2626' },
  General:     { bg: 'rgba(107,114,128,0.1)', text: '#64748B' },
};
