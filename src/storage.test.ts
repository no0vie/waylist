import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { newTrip } from './model';
const cache = vi.hoisted(() => new Map<string, unknown>());
vi.mock('idb-keyval', () => ({
  get: vi.fn(async (key: string) => structuredClone(cache.get(key))),
  set: vi.fn(async (key: string, value: unknown) => { cache.set(key, structuredClone(value)); }),
  del: vi.fn(async (key: string) => { cache.delete(key); }),
}));
import { TripStore } from './storage';
const fetchMock = vi.fn();
const response = (data: unknown, status = 200) => new Response(status === 204 ? null : JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
beforeEach(() => { cache.clear(); fetchMock.mockReset(); vi.stubGlobal('navigator', { onLine: false }); vi.stubGlobal('fetch', fetchMock); });
afterEach(() => vi.unstubAllGlobals());
it('persists offline edits across reloads and isolates accounts', async () => {
  const store = new TripStore('owner'); await store.load();
  const trip = newTrip('owner', 'Offline', 'A', 'B'); await store.save(trip); await store.sync();
  const next = new TripStore('owner'); await next.load();
  expect(next.snapshot().trips[0].title).toBe('Offline');
  expect(next.snapshot().changes[trip.id].baseUpdatedAt).toBe(null);
  const other = new TripStore('other'); await other.load(); expect(other.snapshot().trips).toEqual([]);
  expect(fetchMock).not.toHaveBeenCalled();
});
it('sends an offline-created route and clears its queue only after successful persistence', async () => {
  const store = new TripStore('owner'); await store.load();
  const trip = newTrip('owner', 'Offline', 'A', 'B'); await store.save(trip); await store.sync();
  vi.stubGlobal('navigator', { onLine: true });
  const saved = { ...trip, updatedAt: '2026-09-23T12:00:00.000Z' };
  fetchMock.mockResolvedValueOnce(response({ trips: [] })).mockResolvedValueOnce(response({ trip: saved }));
  await store.sync();
  expect(store.snapshot().changes).toEqual({}); expect(store.snapshot().trips[0].updatedAt).toBe(saved.updatedAt);
  expect(JSON.parse(fetchMock.mock.calls[1][1].body).baseUpdatedAt).toBe(null);
});
it('preserves local edits on failed requests', async () => {
  const store = new TripStore('owner'); await store.load();
  const trip = newTrip('owner', 'Keep me', 'A', 'B'); await store.save(trip); await store.sync();
  vi.stubGlobal('navigator', { onLine: true }); fetchMock.mockRejectedValue(new TypeError('offline'));
  await store.sync();
  expect(store.snapshot().trips[0].title).toBe('Keep me'); expect(store.snapshot().changes[trip.id]).toBeDefined();
});
it('does not overwrite concurrent server changes without an explicit choice', async () => {
  const original = newTrip('owner', 'Original', 'A', 'B');
  cache.set('trips:owner', { trips: [original], changes: {} });
  const store = new TripStore('owner'); await store.load(); await store.save({ ...original, title: 'Local' }); await store.sync();
  const server = { ...original, title: 'Remote', updatedAt: '2099-01-01T00:00:00.000Z' };
  vi.stubGlobal('navigator', { onLine: true }); fetchMock.mockImplementation(async () => response({ trips: [server] }));
  await store.sync();
  expect(store.snapshot().conflicts).toEqual([original.id]); expect(store.snapshot().trips[0].title).toBe('Local');
  expect(fetchMock).toHaveBeenCalledTimes(1);
  await store.resolveConflict(original.id, 'server');
  expect(store.snapshot().trips[0].title).toBe('Remote'); expect(store.snapshot().changes).toEqual({});
});
it('offline deletion of a never-synced trip needs no server operation', async () => {
  const store = new TripStore('owner'); await store.load();
  const trip = newTrip('owner', 'Delete', 'A', 'B'); await store.save(trip); await store.remove(trip.id); await store.sync();
  expect(store.snapshot().trips).toEqual([]); expect(store.snapshot().changes).toEqual({});
});
