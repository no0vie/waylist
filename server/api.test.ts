import { afterAll, beforeAll, expect, it } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';
const directory = dirname(fileURLToPath(import.meta.url));
const temporary = mkdtempSync(resolve(tmpdir(), 'waylist-test-'));
let child: ChildProcess;
let base: string;
let logs = '';

beforeAll(async () => {
  const reservation = createServer();
  await new Promise<void>(resolve => reservation.listen(0, '127.0.0.1', resolve));
  const port = (reservation.address() as { port: number }).port;
  await new Promise<void>(resolve => reservation.close(() => resolve()));
  base = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, ['--import', 'tsx', resolve(directory, 'index.ts')], {
    cwd: directory, env: { ...process.env, PORT: String(port), NODE_ENV: 'test', APP_URL: base, DATABASE_PATH: resolve(temporary, 'test.sqlite'), SMTP_HOST: '', SMTP_FROM: '' }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout?.on('data', data => { logs += data; });
  child.stderr?.on('data', data => { logs += data; });
  for (let attempt = 0; attempt < 100; attempt++) {
    if (child.exitCode !== null) throw new Error(logs);
    try { if ((await fetch(`${base}/api/auth/me`)).ok) return; } catch { /* Wait for listener. */ }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Server failed to start: ${logs}`);
}, 15_000);

afterAll(async () => {
  if (child && child.exitCode === null) {
    const exited = new Promise(resolve => child.once('exit', resolve));
    child.kill('SIGTERM'); await exited;
  }
  rmSync(temporary, { recursive: true, force: true });
});

async function request(path: string, method = 'GET', body?: unknown, cookie = '', origin = base) {
  return fetch(`${base}/api${path}`, { method, headers: { 'Content-Type': 'application/json', cookie, origin }, body: body === undefined ? undefined : JSON.stringify(body) });
}

it('enforces authentication, ownership, concurrency, live shares, SMTP failure and logout', async () => {
  expect(await (await request('/auth/me')).json()).toEqual({ user: null });
  expect((await request('/trips')).status).toBe(401);
  const registration = await request('/auth/register', 'POST', { email: 'one@example.com', password: 'safe-password' });
  expect(registration.status).toBe(201);
  const cookie = registration.headers.get('set-cookie')!.split(';')[0];
  const { user } = await registration.json();
  expect(await (await request('/auth/me', 'GET', undefined, cookie)).json()).toEqual({ user });
  const trip = { id: 'trip', ownerId: user.id, title: 'First', description: '', notes: '', startDate: '', status: 'active', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', points: [], segments: [] };
  const created = await request('/trips/trip', 'PUT', { trip, baseUpdatedAt: null }, cookie);
  expect(created.status).toBe(200);
  const saved = (await created.json()).trip;
  expect((await request('/trips/trip', 'PUT', { trip, baseUpdatedAt: null }, cookie)).status).toBe(409);
  const other = await request('/auth/register', 'POST', { email: 'two@example.com', password: 'safe-password' });
  const otherCookie = other.headers.get('set-cookie')!.split(';')[0];
  expect((await request('/trips/trip', 'DELETE', undefined, otherCookie)).status).toBe(404);
  expect((await request('/trips/trip/share', 'POST', {}, otherCookie)).status).toBe(404);
  expect((await request('/trips/trip', 'PUT', { trip, baseUpdatedAt: saved.updatedAt }, otherCookie)).status).toBe(403);
  const share = await (await request('/trips/trip/share', 'POST', {}, cookie)).json();
  expect(await (await request('/trips/trip/share', 'POST', {}, cookie)).json()).toEqual(share);
  const token = new URL(share.url).pathname.split('/').pop();
  expect((await (await request(`/shares/${token}`)).json()).trip.title).toBe('First');
  const updates = await Promise.all(['Second', 'Third'].map(title => request('/trips/trip', 'PUT', { trip: { ...saved, title }, baseUpdatedAt: saved.updatedAt }, cookie)));
  expect(updates.map(r => r.status).sort()).toEqual([200, 409]);
  expect((await (await request(`/shares/${token}`)).json()).trip.title).not.toBe('First');
  expect((await request('/trips/trip/email', 'POST', { email: 'recipient@example.com' }, cookie)).status).toBe(503);
  expect((await request('/auth/magic/request', 'POST', { email: 'one@example.com' })).status).toBe(503);
  expect((await request('/auth/magic/verify', 'POST', { token: 'a'.repeat(64) })).status).toBe(400);
  expect((await request('/auth/logout', 'POST', {}, cookie, 'https://evil.example')).status).toBe(403);
  expect((await request('/trips/trip', 'DELETE', { baseUpdatedAt: saved.updatedAt }, cookie)).status).toBe(409);
  const latest = (await (await request(`/shares/${token}`)).json()).trip;
  expect((await request('/trips/trip', 'DELETE', { baseUpdatedAt: latest.updatedAt }, cookie)).status).toBe(204);
  expect((await request(`/shares/${token}`)).status).toBe(404);
  expect((await request('/auth/logout', 'POST', {}, cookie)).status).toBe(204);
  expect(await (await request('/auth/me', 'GET', undefined, cookie)).json()).toEqual({ user: null });
  expect((await request('/auth/login', 'POST', { email: 'one@example.com', password: 'wrong-password' })).status).toBe(401);
  expect((await request('/auth/login', 'POST', { email: 'one@example.com', password: 'safe-password' })).status).toBe(200);
}, 15_000);
