import { z } from 'zod';

export const pointTypes = {
  START: 'Старт', STOP: 'Остановка', FOOD: 'Еда', FUEL: 'Заправка', REST: 'Отдых',
  HOTEL: 'Отель', ATTRACTION: 'Достопримечательность', PARKING: 'Парковка', CUSTOM: 'Другое', FINISH: 'Финиш',
} as const;
export type PointType = keyof typeof pointTypes;
export const providers = ['Yandex', 'Google', 'Apple', 'Other'] as const;
export interface User { id: string; email: string }
export interface Point {
  id: string; tripId: string; title: string; description: string; address: string;
  latitude: number | null; longitude: number | null; type: PointType; order: number;
  duration: number; notes: string; externalLinks: string[]; arrivalTime: string; departureTime: string;
}
export interface Segment {
  id: string; tripId: string; fromPointId: string; toPointId: string; distance: number;
  duration: number; navigationUrl: string; navigationProvider: typeof providers[number]; notes: string; order: number;
}
export interface Trip {
  id: string; title: string; description: string; notes: string; startDate: string;
  status: 'active' | 'archived'; ownerId: string; createdAt: string; updatedAt: string;
  points: Point[]; segments: Segment[];
}
const id = z.string().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/);
const text = z.string().max(20_000);
const duration = z.number().finite().min(0).max(10_000_000);
const order = z.number().int().min(0).max(1_000_000);
const url = z.string().max(2048).refine(value => {
  try { return ['http:', 'https:'].includes(new URL(value).protocol); } catch { return false; }
}, 'Expected an absolute HTTP(S) URL');
const pointSchema = z.object({
  id, tripId: id, title: z.string().max(500), description: text, address: z.string().max(2000),
  latitude: z.number().finite().min(-90).max(90).nullable(), longitude: z.number().finite().min(-180).max(180).nullable(),
  type: z.enum(['START', 'STOP', 'FOOD', 'FUEL', 'REST', 'HOTEL', 'ATTRACTION', 'PARKING', 'CUSTOM', 'FINISH']),
  order, duration, notes: text, externalLinks: z.array(url).max(30), arrivalTime: z.string().max(100), departureTime: z.string().max(100),
}).strict().refine(p => (p.latitude === null) === (p.longitude === null), 'Coordinates must both be present or null');
const segmentSchema = z.object({
  id, tripId: id, fromPointId: id, toPointId: id, distance: duration, duration,
  navigationUrl: z.union([z.literal(''), url]), navigationProvider: z.enum(providers), notes: text, order,
}).strict();
export const tripSchema = z.object({
  id, title: z.string().min(1).max(500), description: text, notes: text, startDate: z.string().max(100),
  status: z.enum(['active', 'archived']), ownerId: id,
  createdAt: z.string().datetime({ offset: true }), updatedAt: z.string().datetime({ offset: true }),
  points: z.array(pointSchema).max(500), segments: z.array(segmentSchema).max(1000),
}).strict().superRefine((trip, ctx) => {
  const fail = (message: string) => ctx.addIssue({ code: 'custom', message });
  const points = [...trip.points].sort((a, b) => a.order - b.order);
  const segments = [...trip.segments].sort((a, b) => a.order - b.order);
  if (new Set(points.map(p => p.id)).size !== points.length) fail('Duplicate point IDs');
  if (new Set(segments.map(s => s.id)).size !== segments.length) fail('Duplicate segment IDs');
  if (new Set(points.map(p => p.order)).size !== points.length) fail('Duplicate point order');
  if (new Set(segments.map(s => s.order)).size !== segments.length) fail('Duplicate segment order');
  if (points.some(p => p.tripId !== trip.id) || segments.some(s => s.tripId !== trip.id)) fail('Invalid trip reference');
  if (segments.length !== Math.max(0, points.length - 1)) fail('Expected exactly one segment per adjacent point pair');
  segments.forEach((s, i) => {
    if (s.fromPointId !== points[i]?.id || s.toPointId !== points[i + 1]?.id) fail('Invalid directed route graph');
  });
});

export function newPoint(tripId: string, type: PointType = 'STOP'): Point {
  return { id: crypto.randomUUID(), tripId, title: pointTypes[type], description: '', address: '', latitude: null,
    longitude: null, type, order: 0, duration: 0, notes: '', externalLinks: [], arrivalTime: '', departureTime: '' };
}
const pair = (from: string, to: string) => JSON.stringify([from, to]);
export function reconcileSegments(trip: Trip, points: Point[]): Trip {
  if (new Set(points.map(p => p.id)).size !== points.length) throw new Error('Duplicate point IDs');
  const previous = new Map(trip.segments.map(s => [pair(s.fromPointId, s.toPointId), s]));
  const normalized = points.map((p, order) => ({ ...p, tripId: trip.id, order, externalLinks: [...p.externalLinks] }));
  const segments = normalized.slice(1).map((p, order): Segment => {
    const fromPointId = normalized[order].id;
    const old = previous.get(pair(fromPointId, p.id));
    return old ? { ...old, tripId: trip.id, order } : {
      id: crypto.randomUUID(), tripId: trip.id, fromPointId, toPointId: p.id,
      distance: 0, duration: 0, navigationUrl: '', navigationProvider: 'Yandex', notes: '', order,
    };
  });
  return { ...trip, points: normalized, segments };
}
export function newTrip(ownerId: string, title: string, startTitle: string, finishTitle: string): Trip {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const trip: Trip = { id, ownerId, title, description: '', notes: '', startDate: '', status: 'active',
    createdAt: now, updatedAt: now, points: [], segments: [] };
  return reconcileSegments(trip, [{ ...newPoint(id, 'START'), title: startTitle }, { ...newPoint(id, 'FINISH'), title: finishTitle }]);
}
export function affectedSegments(trip: Trip, points: Point[]): number {
  const retained = new Set(points.slice(1).map((p, i) => pair(points[i].id, p.id)));
  return trip.segments.filter(s => !retained.has(pair(s.fromPointId, s.toPointId)) &&
    (s.distance !== 0 || s.duration !== 0 || s.navigationUrl !== '' || s.notes !== '' || s.navigationProvider !== 'Yandex')).length;
}
export function totals(trip: Trip) {
  const distance = trip.segments.reduce((n, s) => n + s.distance, 0);
  const driving = trip.segments.reduce((n, s) => n + s.duration, 0);
  const stops = trip.points.reduce((n, p) => n + p.duration, 0);
  return { distance, driving, stops, total: driving + stops, pointCount: trip.points.length,
    segmentCount: trip.segments.length, stopCount: trip.points.filter(p => p.type !== 'START' && p.type !== 'FINISH').length };
}
export function formatDuration(min: number): string {
  const minutes = Number.isFinite(min) ? Math.max(0, Math.round(min)) : 0;
  const hours = Math.floor(minutes / 60);
  return hours ? `${hours} ч${minutes % 60 ? ` ${minutes % 60} мин` : ''}` : `${minutes} мин`;
}
export function duplicateTrip(trip: Trip, ownerId: string): Trip {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const ids = new Map(trip.points.map(p => [p.id, crypto.randomUUID()]));
  return { ...trip, id, ownerId, createdAt: now, updatedAt: now,
    points: [...trip.points].sort((a, b) => a.order - b.order).map(p => ({ ...p, id: ids.get(p.id)!, tripId: id, externalLinks: [...p.externalLinks] })),
    segments: [...trip.segments].sort((a, b) => a.order - b.order).map(s => ({ ...s, id: crypto.randomUUID(), tripId: id,
      fromPointId: ids.get(s.fromPointId)!, toPointId: ids.get(s.toPointId)! })),
  };
}
export function parseImport(text: string, ownerId: string): Trip {
  id.parse(ownerId);
  if (new TextEncoder().encode(text).length > 2_000_000) throw new Error('Файл превышает 2 МБ');
  return duplicateTrip(tripSchema.parse(JSON.parse(text)), ownerId);
}
