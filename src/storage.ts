import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { get, set, del } from 'idb-keyval';
import type { Trip, User } from './model';

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...init, credentials: 'same-origin', signal: init.signal ?? AbortSignal.timeout(25_000),
    headers: { 'Content-Type': 'application/json', ...init.headers },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new ApiError(response.status, body.error || `Ошибка сервера (${response.status})`);
  }
  return response.status === 204 ? undefined as T : response.json();
}
export const rememberUser = (user: User) => set('last-user', user);
export const cachedUser = () => get<User>('last-user');
export const forgetUser = () => del('last-user');

type Change = { trip: Trip | null; baseUpdatedAt: string | null };
type Cache = { trips: Trip[]; changes: Record<string, Change> };
type Snapshot = Cache & { loading: boolean; error: string; conflicts: string[]; syncing: boolean };

export class TripStore {
  private state: Snapshot = { trips: [], changes: {}, loading: true, error: '', conflicts: [], syncing: false };
  private listeners = new Set<() => void>();
  private chain: Promise<unknown> = Promise.resolve();
  private syncTask: Promise<void> | null = null;
  constructor(private userId: string) {}
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  snapshot = () => this.state;
  private publish(patch: Partial<Snapshot>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach(fn => fn());
  }
  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.chain.then(fn);
    this.chain = next.catch(() => undefined);
    return next;
  }
  private async commit(cache: Cache) {
    await set(`trips:${this.userId}`, cache);
    this.publish(cache);
  }
  load = () => this.enqueue(async () => {
    try {
      const data = await get<Cache>(`trips:${this.userId}`);
      if (data) this.publish(data);
    } catch { this.publish({ error: 'Локальное хранилище недоступно. Разрешите хранение данных в браузере.' }); }
    finally { this.publish({ loading: false }); }
  });
  save = async (trip: Trip) => {
    await this.enqueue(async () => {
      if (trip.ownerId !== this.userId) throw new Error('Неверный владелец поездки');
      const previous = this.state.trips.find(t => t.id === trip.id);
      const change = this.state.changes[trip.id];
      const local = { ...trip, updatedAt: new Date().toISOString() };
      await this.commit({
        trips: [local, ...this.state.trips.filter(t => t.id !== trip.id)],
        changes: { ...this.state.changes, [trip.id]: { trip: local, baseUpdatedAt: change ? change.baseUpdatedAt : previous?.updatedAt ?? null } },
      });
    });
    void this.sync();
  };
  remove = async (id: string) => {
    await this.enqueue(async () => {
      const previous = this.state.trips.find(t => t.id === id);
      const changes = { ...this.state.changes };
      if (changes[id]?.baseUpdatedAt === null) delete changes[id];
      else changes[id] = { trip: null, baseUpdatedAt: changes[id]?.baseUpdatedAt ?? previous?.updatedAt ?? null };
      await this.commit({ trips: this.state.trips.filter(t => t.id !== id), changes });
    });
    void this.sync();
  };
  sync = (): Promise<void> => {
    if (this.syncTask) return this.syncTask;
    this.syncTask = this.enqueue(async () => {
      if (!navigator.onLine) return;
      this.publish({ syncing: true, error: '', conflicts: [] });
      const conflicts: string[] = [];
      try {
        const remote = await api<{ trips: Trip[] }>('/trips');
        const server = new Map(remote.trips.map(t => [t.id, t]));
        for (const [id, change] of Object.entries(this.state.changes)) {
          try {
            if ((server.get(id)?.updatedAt ?? null) !== change.baseUpdatedAt) {
              // A repeated delete is already complete. All other collisions require a decision.
              if (change.trip !== null || server.has(id)) { conflicts.push(id); continue; }
            }
            let saved: Trip | undefined;
            if (change.trip) {
              saved = (await api<{ trip: Trip }>(`/trips/${id}`, {
                method: 'PUT', body: JSON.stringify({ trip: change.trip, baseUpdatedAt: change.baseUpdatedAt }),
              })).trip;
            } else if (server.has(id)) {
              await api(`/trips/${id}`, { method: 'DELETE', body: JSON.stringify({ baseUpdatedAt: change.baseUpdatedAt }) });
            }
            const changes = { ...this.state.changes }; delete changes[id];
            await this.commit({ trips: saved ? [saved, ...this.state.trips.filter(t => t.id !== id)] : this.state.trips.filter(t => t.id !== id), changes });
            if (saved) server.set(id, saved); else server.delete(id);
          } catch (error) {
            if (error instanceof ApiError && error.status === 409) { conflicts.push(id); continue; }
            throw error;
          }
        }
        const merged = new Map(server);
        for (const [id, change] of Object.entries(this.state.changes)) {
          if (change.trip) merged.set(id, change.trip); else merged.delete(id);
        }
        await this.commit({ trips: [...merged.values()], changes: this.state.changes });
        this.publish({ conflicts, error: conflicts.length ? 'Маршрут изменён на другом устройстве. Выберите версию ниже; локальные правки сохранены.' : '' });
      } catch (error) {
        this.publish({ conflicts, error: error instanceof ApiError ? error.message : 'Нет связи с сервером. Локальные изменения сохранены; повторим синхронизацию позже.' });
      } finally { this.publish({ syncing: false }); }
    }).finally(() => { this.syncTask = null; });
    return this.syncTask;
  };
  resolveConflict = async (id: string, choice: 'server' | 'local') => {
    await this.enqueue(async () => {
      const remote = (await api<{ trips: Trip[] }>('/trips')).trips.find(t => t.id === id);
      const changes = { ...this.state.changes };
      let trips = this.state.trips;
      if (choice === 'server') {
        delete changes[id]; trips = trips.filter(t => t.id !== id);
        if (remote) trips = [remote, ...trips];
      } else if (changes[id]) changes[id] = { ...changes[id], baseUpdatedAt: remote?.updatedAt ?? null };
      await this.commit({ trips, changes });
      this.publish({ conflicts: this.state.conflicts.filter(value => value !== id) });
    });
    await this.sync();
  };
}

export function useTrips(userId: string) {
  const store = useMemo(() => new TripStore(userId), [userId]);
  const state = useSyncExternalStore(store.subscribe, store.snapshot);
  useEffect(() => {
    let mounted = true;
    void store.load().then(() => { if (mounted) void store.sync(); });
    const sync = () => { void store.sync(); };
    window.addEventListener('online', sync);
    const interval = window.setInterval(sync, 60_000);
    return () => { mounted = false; window.removeEventListener('online', sync); clearInterval(interval); };
  }, [store]);
  return { ...state, pending: Object.keys(state.changes).length, save: store.save, remove: store.remove, sync: store.sync, resolveConflict: store.resolveConflict };
}
