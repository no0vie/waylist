import { describe, expect, it } from 'vitest';
import { credentialsSchema, putTripSchema, tripSchema } from './schema.js';
const point = (id: string, order: number) => ({ id, tripId: 'trip', title: '', description: '', address: '', latitude: null, longitude: null, type: 'STOP' as const, order, duration: 0, notes: '', externalLinks: [], arrivalTime: '', departureTime: '' });
const trip = () => ({ id: 'trip', ownerId: 'user', title: 'Trip', description: '', notes: '', startDate: '', status: 'active' as const, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', points: [point('a', 0), point('b', 1)], segments: [{ id: 'segment', tripId: 'trip', fromPointId: 'a', toPointId: 'b', distance: 1, duration: 1, navigationUrl: 'https://maps.google.com/', navigationProvider: 'Google' as const, notes: '', order: 0 }] });
describe('trip validation', () => {
  it('accepts a complete graph and null creation version', () => { expect(putTripSchema.safeParse({ trip: trip(), baseUpdatedAt: null }).success).toBe(true); });
  it('rejects missing endpoints', () => { const t = trip(); t.segments[0].toPointId = 'missing'; expect(tripSchema.safeParse(t).success).toBe(false); });
  it('rejects foreign children', () => { const t = trip(); t.points[0].tripId = 'other'; expect(tripSchema.safeParse(t).success).toBe(false); });
  it('rejects duplicate IDs and orders', () => { const t = trip(); t.points.push(t.points[0]); expect(tripSchema.safeParse(t).success).toBe(false); });
  it('rejects unsafe navigation URLs', () => { const t = trip(); t.segments[0].navigationUrl = 'javascript:alert(1)'; expect(tripSchema.safeParse(t).success).toBe(false); });
  it('rejects self edges', () => { const t = trip(); t.segments[0].toPointId = 'a'; expect(tripSchema.safeParse(t).success).toBe(false); });
  it('rejects unknown fields', () => { expect(tripSchema.safeParse({ ...trip(), admin: true }).success).toBe(false); });
  it('rejects excessive graphs', () => { const t = trip(); t.points = Array.from({ length: 501 }, (_, i) => point(`p${i}`, i)); expect(tripSchema.safeParse(t).success).toBe(false); });
});
describe('credentials', () => {
  it('normalizes email', () => { expect(credentialsSchema.parse({ email: ' Test@Example.com ', password: 'long-password' }).email).toBe('test@example.com'); });
  it('rejects bcrypt byte truncation', () => { expect(credentialsSchema.safeParse({ email: 'a@example.com', password: 'é'.repeat(37) }).success).toBe(false); });
});
