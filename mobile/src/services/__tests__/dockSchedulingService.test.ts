/**
 * Unit tests for mobile/src/services/dockSchedulingService.ts.
 * DbApi is mocked.
 */

import {
  APPT_STATUSES,
  APPT_TYPES,
  DOCK_DOORS,
  DOCK_HOURS,
  DURATION_OPTIONS,
  buildAppointmentFormFromRow,
  buildAppointmentPayload,
  buildBlankAppointment,
  computeDockStats,
  deleteAppointment,
  fetchAppointments,
  generateAppointmentId,
  groupByDoor,
  saveAppointment,
  validateAppointmentForm,
} from '../dockSchedulingService';
import { DbApi } from '../../lib/api';

jest.mock('../../lib/api', () => ({
  DbApi: {
    dockAppointments: jest.fn(),
    upsert: jest.fn(),
    remove: jest.fn(),
  },
}));

describe('exports', () => {
  it('exposes the canonical door / hour / type / status / duration enums', () => {
    expect(DOCK_DOORS).toEqual(expect.arrayContaining(['Door 1', 'Door 6']));
    expect(DOCK_HOURS).toContain('06:00');
    expect(DOCK_HOURS).toContain('20:00');
    expect(APPT_TYPES).toEqual(expect.arrayContaining(['Outbound', 'Inbound', 'Cross-Dock']));
    expect(APPT_STATUSES).toContain('Scheduled');
    expect(DURATION_OPTIONS.map((o) => o.value)).toEqual(
      expect.arrayContaining([30, 60, 90, 120, 150, 180]),
    );
  });
});

describe('buildBlankAppointment / buildAppointmentFormFromRow', () => {
  it('returns sensible defaults', () => {
    const f = buildBlankAppointment();
    expect(f.type).toBe('Outbound');
    expect(f.door).toBe('Door 1');
    expect(f.start).toBe('06:00');
    expect(f.duration).toBe('120');
    expect(f.status).toBe('Scheduled');
    expect(f.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('seeds from a snake_case row', () => {
    const f = buildAppointmentFormFromRow({
      id: 'APPT-1',
      type: 'Inbound',
      door: 'Door 3',
      date: '2026-04-30',
      start: '08:00',
      duration: 90,
      carrier: 'XPO',
      shipment_id: 'SHP-2026-1234',
      status: 'Confirmed',
      notes: 'shipper handoff at noon',
    });
    expect(f.id).toBe('APPT-1');
    expect(f.shipmentId).toBe('SHP-2026-1234');
    expect(f.duration).toBe('90');
  });
});

describe('validateAppointmentForm', () => {
  const base = buildBlankAppointment();

  it('rejects missing required fields', () => {
    expect(validateAppointmentForm({ ...base, type: '' }).ok).toBe(false);
    expect(validateAppointmentForm({ ...base, door: '' }).ok).toBe(false);
    expect(validateAppointmentForm({ ...base, date: '' }).ok).toBe(false);
    expect(validateAppointmentForm({ ...base, start: '' }).ok).toBe(false);
  });

  it('rejects out-of-range duration', () => {
    expect(validateAppointmentForm({ ...base, duration: '0' }).ok).toBe(false);
    expect(validateAppointmentForm({ ...base, duration: '700' }).ok).toBe(false);
    expect(validateAppointmentForm({ ...base, duration: 'abc' }).ok).toBe(false);
  });

  it('accepts a populated form', () => {
    expect(validateAppointmentForm(base).ok).toBe(true);
  });
});

describe('generateAppointmentId / buildAppointmentPayload', () => {
  it('generateAppointmentId encodes the date', () => {
    expect(generateAppointmentId('2026-04-30')).toMatch(/^APPT-20260430-\d{4}$/);
  });

  it('buildAppointmentPayload coerces numerics + nulls optional fields', () => {
    const base = buildBlankAppointment();
    const p = buildAppointmentPayload({
      ...base,
      type: 'Inbound',
      duration: '90',
      carrier: '',
      shipmentId: '',
      notes: '',
    });
    expect(p.duration).toBe(90);
    expect(p.carrier).toBeNull();
    expect(p.shipment_id).toBeNull();
    expect(p.notes).toBeNull();
    expect(p.id).toMatch(/^APPT-/);
  });

  it('preserves existing id on edit', () => {
    const base = buildBlankAppointment();
    const p = buildAppointmentPayload({ ...base, id: 'APPT-1' });
    expect(p.id).toBe('APPT-1');
  });
});

describe('mutations', () => {
  beforeEach(() => jest.clearAllMocks());

  it('fetchAppointments returns rows or [] on error', async () => {
    (DbApi.dockAppointments as jest.Mock).mockResolvedValue([{ id: 'A1' }]);
    expect(await fetchAppointments()).toHaveLength(1);
    (DbApi.dockAppointments as jest.Mock).mockRejectedValue(new Error('500'));
    expect(await fetchAppointments()).toEqual([]);
    (DbApi.dockAppointments as jest.Mock).mockResolvedValue(null);
    expect(await fetchAppointments()).toEqual([]);
  });

  it('fetchAppointments forwards date filter', async () => {
    (DbApi.dockAppointments as jest.Mock).mockResolvedValue([]);
    await fetchAppointments('2026-04-30');
    expect(DbApi.dockAppointments).toHaveBeenCalledWith('2026-04-30');
  });

  it('saveAppointment validates then upserts', async () => {
    const base = buildBlankAppointment();
    await expect(saveAppointment({ ...base, type: '' })).rejects.toThrow(/type/i);
    expect(DbApi.upsert).not.toHaveBeenCalled();

    (DbApi.upsert as jest.Mock).mockResolvedValue({ ok: true });
    await saveAppointment(base);
    expect(DbApi.upsert).toHaveBeenCalledWith(
      'dock_appointments',
      expect.objectContaining({ type: 'Outbound', door: 'Door 1' }),
    );
  });

  it('deleteAppointment requires id and removes', async () => {
    await expect(deleteAppointment('')).rejects.toThrow(/id is required/);
    (DbApi.remove as jest.Mock).mockResolvedValue({ ok: true });
    await deleteAppointment('APPT-1');
    expect(DbApi.remove).toHaveBeenCalledWith('dock_appointments', 'APPT-1');
  });
});

describe('groupByDoor', () => {
  it('groups by door and orders chronologically', () => {
    const appts = [
      { id: 'a', door: 'Door 1', start: '08:00' },
      { id: 'b', door: 'Door 1', start: '06:00' },
      { id: 'c', door: 'Door 3', start: '14:00' },
    ];
    const out = groupByDoor(appts);
    const door1 = out.find(([d]) => d === 'Door 1')![1];
    const door3 = out.find(([d]) => d === 'Door 3')![1];
    expect(door1.map((a) => a.id)).toEqual(['b', 'a']);
    expect(door3.map((a) => a.id)).toEqual(['c']);
    // Empty doors are still present
    const door5 = out.find(([d]) => d === 'Door 5')![1];
    expect(door5).toEqual([]);
  });

  it('appends non-canonical doors at the end', () => {
    const appts = [{ id: 'x', door: 'Door 9', start: '06:00' }];
    const out = groupByDoor(appts);
    expect(out[out.length - 1][0]).toBe('Door 9');
  });
});

describe('computeDockStats', () => {
  it('counts total + status breakdown', () => {
    const s = computeDockStats([
      { status: 'Scheduled' },
      { status: 'Confirmed' },
      { status: 'In Progress' },
      { status: 'Completed' },
      { status: 'Completed' },
      { status: 'Cancelled' },
    ]);
    expect(s.total).toBe(6);
    expect(s.scheduled).toBe(2);
    expect(s.inProgress).toBe(1);
    expect(s.completed).toBe(2);
  });
});
