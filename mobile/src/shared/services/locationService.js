/**
 * Location Master Service — CRUD operations via DbApi.
 */

import { DbApi } from '../../lib/api';

/**
 * Save (create or update) a location.
 * @param {object} loc - The location data
 * @param {string|null} originalId - If editing, the original ID; null for new
 */
export async function saveLocation(loc, originalId = null) {
  const payload = {
    id: (loc.id || '').toUpperCase().trim(),
    name: (loc.name || '').trim(),
    type: loc.type || 'Warehouse',
    customer: (loc.customer || '').trim(),
    address: (loc.address || '').trim(),
    city: (loc.city || '').trim(),
    state: (loc.state || '').toUpperCase().trim(),
    zip: (loc.zip || '').trim(),
    country: (loc.country || 'US').toUpperCase().trim(),
    lat: parseFloat(loc.lat) || null,
    lng: parseFloat(loc.lng) || null,
    contact_name: (loc.contact_name || '').trim(),
    contact_phone: (loc.contact_phone || '').trim(),
    contact_email: (loc.contact_email || '').toLowerCase().trim(),
    ahphone: (loc.ahphone || '').trim(),
    hours: (loc.hours || '').trim(),
    dock_doors: parseInt(loc.dock_doors) || 0,
    trailer: parseInt(loc.trailer) || 53,
    liftgate: loc.liftgate || 'No',
    appt: !!loc.appt,
    hazmat: !!loc.hazmat,
    resi: !!loc.resi,
    inside_delivery: !!loc.inside_delivery,
    sort_segregate: !!loc.sort_segregate,
    twic: !!loc.twic,
    notes: (loc.notes || '').trim(),
    status: loc.status || 'Active',
  };

  if (!payload.id) throw new Error('Location ID is required');
  if (!payload.name) throw new Error('Location name is required');

  if (originalId) {
    return DbApi.patch('locations', originalId, payload);
  }
  return DbApi.upsert('locations', payload);
}

/**
 * Delete a location by ID.
 */
export async function deleteLocation(id) {
  return DbApi.remove('locations', id);
}

/**
 * Toggle location status between Active and Inactive.
 */
export async function toggleLocationStatus(loc) {
  const newStatus = loc.status === 'Active' ? 'Inactive' : 'Active';
  return DbApi.patch('locations', loc.id, { status: newStatus });
}
