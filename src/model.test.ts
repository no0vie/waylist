import { describe, it, expect } from 'vitest';
import { newTrip, newPoint, reconcileSegments, affectedSegments, totals, duplicateTrip, parseImport, tripSchema, formatDuration } from './model';

describe('route model', () => {
  it('creates a valid manual route with a segment and stable IDs', () => {
    const trip = newTrip('owner', 'Отпуск', 'Москва', 'Тверь');
    expect(tripSchema.parse(trip)).toEqual(trip);
    expect(trip.segments).toHaveLength(1);
    expect(trip.segments[0].fromPointId).toBe(trip.points[0].id);
    expect(reconcileSegments(trip, trip.points).segments).toEqual(trip.segments);
  });
  it('preserves directed pairs, warns before populated edges are lost, never reuses reverse navigation', () => {
    let trip = newTrip('owner', 'Route', 'A', 'D');
    trip = reconcileSegments(trip, [trip.points[0], newPoint(trip.id), newPoint(trip.id), trip.points[1]]);
    trip.segments.forEach(s => { s.distance = 20; s.navigationUrl = 'https://maps.example/route'; });
    const reordered = [trip.points[1], trip.points[0], trip.points[2], trip.points[3]];
    expect(affectedSegments(trip, reordered)).toBe(2);
    const next = reconcileSegments(trip, reordered);
    expect(next.segments[2]).toEqual(trip.segments[2]);
    expect(next.segments[0].navigationUrl).toBe('');
    expect(next.segments[0].distance).toBe(0);
    expect(next.points.map(p => p.order)).toEqual([0, 1, 2, 3]);
    expect(tripSchema.safeParse(next).success).toBe(true);
  });
  it('calculates driving and stops separately', () => {
    const trip = newTrip('owner', 'Route', 'A', 'B');
    trip.segments[0].distance = 178; trip.segments[0].duration = 140; trip.points[1].duration = 20;
    expect(totals(trip)).toMatchObject({ distance: 178, driving: 140, stops: 20, total: 160, segmentCount: 1, pointCount: 2 });
    expect(formatDuration(140)).toBe('2 ч 20 мин');
  });
  it('duplicates all identities without mutating the original', () => {
    const trip = newTrip('owner', 'Route', 'A', 'B');
    const copy = duplicateTrip(trip, 'another-owner');
    expect(copy.id).not.toBe(trip.id);
    expect(copy.ownerId).toBe('another-owner');
    expect(copy.points[0].id).not.toBe(trip.points[0].id);
    expect(copy.segments[0].fromPointId).toBe(copy.points[0].id);
    expect(tripSchema.safeParse(copy).success).toBe(true);
    copy.points[0].externalLinks.push('https://example.com');
    expect(trip.points[0].externalLinks).toEqual([]);
  });
  it('roundtrips exports and rejects malicious URLs and corrupt graphs', () => {
    const trip = newTrip('owner', 'Route', 'A', 'B');
    expect(parseImport(JSON.stringify(trip), 'other').title).toBe('Route');
    trip.segments[0].navigationUrl = 'javascript:alert(1)';
    expect(() => parseImport(JSON.stringify(trip), 'other')).toThrow();
    trip.segments[0].navigationUrl = '';
    trip.segments[0].toPointId = 'missing';
    expect(() => parseImport(JSON.stringify(trip), 'other')).toThrow();
  });
  it('rejects negative distances, unpaired coordinates and duplicate IDs', () => {
    const trip = newTrip('owner', 'Route', 'A', 'B');
    trip.segments[0].distance = -1;
    expect(tripSchema.safeParse(trip).success).toBe(false);
    trip.segments[0].distance = 0; trip.points[0].latitude = 42;
    expect(tripSchema.safeParse(trip).success).toBe(false);
    expect(() => reconcileSegments(trip, [trip.points[0], trip.points[0]])).toThrow();
  });
});
