import { z } from 'zod';

const id = z.string().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/);
const text = z.string().max(20_000);
const timestamp = z.string().datetime({ offset: true });
const url = z.string().max(2048).refine(value => {
  try { return ['http:', 'https:'].includes(new URL(value).protocol); } catch { return false; }
}, 'Expected an absolute HTTP(S) URL');
const count = z.number().int().min(0).max(1_000_000);
const duration = z.number().finite().min(0).max(10_000_000);
const point = z.object({
  id, tripId: id, title: z.string().max(500), description: text, address: z.string().max(2000),
  latitude: z.number().finite().min(-90).max(90).nullable(),
  longitude: z.number().finite().min(-180).max(180).nullable(),
  type: z.enum(['START', 'STOP', 'FOOD', 'FUEL', 'REST', 'HOTEL', 'ATTRACTION', 'PARKING', 'CUSTOM', 'FINISH']),
  order: count, duration, notes: text, externalLinks: z.array(url).max(30),
  arrivalTime: z.string().max(100), departureTime: z.string().max(100),
}).strict().refine(p => (p.latitude === null) === (p.longitude === null), 'Coordinates must both be present or null');
const segment = z.object({
  id, tripId: id, fromPointId: id, toPointId: id,
  distance: z.number().finite().min(0).max(10_000_000), duration,
  navigationUrl: z.union([z.literal(''), url]), navigationProvider: z.enum(['Yandex', 'Google', 'Apple', 'Other']),
  notes: text, order: count,
}).strict();
export const tripSchema = z.object({
  id, title: z.string().min(1).max(500), description: text, notes: text,
  startDate: z.string().max(100), status: z.enum(['active', 'archived']), ownerId: id,
  createdAt: timestamp, updatedAt: timestamp, points: z.array(point).max(500), segments: z.array(segment).max(1000),
}).strict().superRefine((trip, ctx) => {
  const fail = (message: string) => ctx.addIssue({ code: 'custom', message });
  const points = new Set(trip.points.map(p => p.id));
  if (points.size !== trip.points.length) fail('Duplicate point IDs');
  if (new Set(trip.segments.map(s => s.id)).size !== trip.segments.length) fail('Duplicate segment IDs');
  if (new Set(trip.points.map(p => p.order)).size !== trip.points.length) fail('Duplicate point order');
  if (new Set(trip.segments.map(s => s.order)).size !== trip.segments.length) fail('Duplicate segment order');
  for (const p of trip.points) if (p.tripId !== trip.id) fail('Point belongs to a different trip');
  const orderedPoints = [...trip.points].sort((a, b) => a.order - b.order);
  const orderedSegments = [...trip.segments].sort((a, b) => a.order - b.order);
  if (orderedSegments.length !== Math.max(0, orderedPoints.length - 1)) fail('Expected one segment per adjacent point pair');
  orderedSegments.forEach((segment, i) => {
    if (segment.fromPointId !== orderedPoints[i]?.id || segment.toPointId !== orderedPoints[i + 1]?.id) fail('Invalid directed route graph');
  });
  const edges = new Set<string>();
  for (const s of trip.segments) {
    if (s.tripId !== trip.id) fail('Segment belongs to a different trip');
    if (!points.has(s.fromPointId) || !points.has(s.toPointId)) fail('Segment references missing point');
    if (s.fromPointId === s.toPointId) fail('Self-referencing segment');
    const edge = JSON.stringify([s.fromPointId, s.toPointId]);
    if (edges.has(edge)) fail('Duplicate segment connection');
    edges.add(edge);
  }
});
export type Trip = z.infer<typeof tripSchema>;
export const putTripSchema = z.object({ trip: tripSchema, baseUpdatedAt: timestamp.nullable() }).strict();
export const emailSchema = z.object({ email: z.string().trim().email().max(254).transform(s => s.toLowerCase()) }).strict();
export const credentialsSchema = emailSchema.extend({ password: z.string().min(10).max(72).refine(s => Buffer.byteLength(s, 'utf8') <= 72, 'Password must be at most 72 UTF-8 bytes') });
export const tokenSchema = z.object({ token: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
