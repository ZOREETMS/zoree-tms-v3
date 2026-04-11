/**
 * Item Master Service — CRUD operations via DbApi.
 */

import { DbApi } from '../../lib/api';

/**
 * Save (create or update) an item.
 * @param {object} item - The item data
 * @param {string|null} originalId - If editing, the original ID; null for new items
 */
export async function saveItem(item, originalId = null) {
  const payload = {
    id: (item.id || '').toUpperCase().trim(),
    description: (item.description || item.desc || '').trim(),
    customer: (item.customer || '').toUpperCase().trim(),
    item_class: item.item_class || item.class || 'General',
    nmfc: (item.nmfc || '').trim(),
    freight_class: item.freight_class || item.fclass || '70',
    weight_unit: parseFloat(item.weight_unit) || 0,
    value_unit: parseFloat(item.value_unit) || 0,
    len: parseFloat(item.len) || 0,
    wid: parseFloat(item.wid) || 0,
    hgt: parseFloat(item.hgt) || 0,
    units_per_pallet: parseInt(item.units_per_pallet) || 0,
    pkg: item.pkg || 'Carton',
    stack: parseInt(item.stack) || 1,
    hazmat: !!item.hazmat,
    fragile: !!item.fragile,
    temp_ctrl: !!item.temp_ctrl,
    top_load: !!item.top_load,
    un: (item.un || '').trim(),
    haz_class: (item.haz_class || '').trim(),
    status: item.status || 'Active',
  };

  if (!payload.id) throw new Error('Item ID is required');
  if (!payload.description) throw new Error('Description is required');

  if (originalId) {
    return DbApi.patch('items', originalId, payload);
  }
  return DbApi.upsert('items', payload);
}

/**
 * Delete an item by ID.
 */
export async function deleteItem(id) {
  return DbApi.remove('items', id);
}

/**
 * Toggle item status between Active and Inactive.
 */
export async function toggleItemStatus(item) {
  const newStatus = item.status === 'Active' ? 'Inactive' : 'Active';
  return DbApi.patch('items', item.id, { status: newStatus });
}
