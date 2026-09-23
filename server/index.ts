import express, { type Request, type Response, type NextFunction } from 'express';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';
import { createEmailService } from './email.js';
import { config } from '../src/config.js';
import { ZodError } from 'zod';
import { credentialsSchema, emailSchema, putTripSchema, tokenSchema, type Trip } from './schema.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const production = process.env.NODE_ENV === 'production';
const appUrl = new URL(process.env.APP_URL || 'http://localhost:5173');
if (!['http:', 'https:'].includes(appUrl.protocol) || appUrl.username || appUrl.password || (production && appUrl.protocol !== 'https:')) throw new Error('APP_URL must be an HTTP(S) URL (HTTPS in production)');
const dbPath = resolve(root, process.env.DATABASE_PATH || 'data/waylist.sqlite');
mkdirSync(dirname(dbPath), { recursive: true });
const db = new DatabaseSync(dbPath);
db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, password_hash TEXT);
CREATE TABLE IF NOT EXISTS sessions (hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS magic_tokens (hash TEXT PRIMARY KEY, email TEXT NOT NULL, expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS trips (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, updated_at TEXT NOT NULL, json TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS trips_owner ON trips(owner_id);
CREATE TABLE IF NOT EXISTS shares (token TEXT PRIMARY KEY, trip_id TEXT NOT NULL UNIQUE REFERENCES trips(id) ON DELETE CASCADE);
CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires);
CREATE INDEX IF NOT EXISTS magic_expiry ON magic_tokens(expires);`);
const app = express();
app.disable('x-powered-by');
// Set to the exact proxy hop count only behind a trusted reverse proxy.
if (process.env.TRUST_PROXY_HOPS) app.set('trust proxy', Number(process.env.TRUST_PROXY_HOPS));
const cookieName = production ? '__Host-waylist' : 'waylist';
const lifetime = 30 * 24 * 60 * 60 * 1000;
const hash = (token: string) => createHash('sha256').update(token).digest('hex');
const randomToken = () => randomBytes(32).toString('hex');
class HttpError extends Error { constructor(public status: number, message: string) { super(message); } }
type User = { id: string; email: string };
const wrap = (fn: (req: Request, res: Response) => Promise<unknown> | unknown) => (req: Request, res: Response, next: NextFunction) => { Promise.resolve().then(() => fn(req, res)).catch(next); };
function sessionToken(req: Request) {
  const value = req.headers.cookie?.split(';').map(s => s.trim()).find(s => s.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1);
  return value && /^[a-f0-9]{64}$/.test(value) ? value : null;
}
function user(req: Request): User | null {
  const token = sessionToken(req);
  return token ? (db.prepare('SELECT users.id, users.email FROM sessions JOIN users ON users.id=sessions.user_id WHERE hash=? AND expires>?').get(hash(token), Date.now()) as User | undefined) ?? null : null;
}
function requireUser(req: Request) { const value = user(req); if (!value) throw new HttpError(401, 'Authentication required'); return value; }
function issueSession(req: Request, res: Response, id: string) {
  const old = sessionToken(req);
  if (old) db.prepare('DELETE FROM sessions WHERE hash=?').run(hash(old));
  const token = randomToken();
  db.prepare('INSERT INTO sessions VALUES (?, ?, ?)').run(hash(token), id, Date.now() + lifetime);
  res.cookie(cookieName, token, { httpOnly: true, secure: production, sameSite: 'lax', path: '/', maxAge: lifetime });
}
function owned(req: Request) {
  const account = requireUser(req);
  const row = db.prepare('SELECT json, updated_at FROM trips WHERE id=? AND owner_id=?').get(String(req.params.id), account.id) as { json: string; updated_at: string } | undefined;
  if (!row) throw new HttpError(404, 'Trip not found');
  return row;
}
function transaction<T>(fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try { const result = fn(); db.exec('COMMIT'); return result; } catch (error) { db.exec('ROLLBACK'); throw error; }
}
const emailService = createEmailService(process.env);
async function send(to: string, subject: string, text: string) {
  try { await emailService.send({ to, subject, text }); }
  catch (error) { throw new HttpError(503, error instanceof Error ? error.message : 'Email delivery failed'); }
}
function shareUrl(id: string) {
  db.prepare('INSERT INTO shares (token, trip_id) VALUES (?, ?) ON CONFLICT(trip_id) DO NOTHING').run(randomToken(), id);
  const row = db.prepare('SELECT token FROM shares WHERE trip_id=?').get(id) as { token: string };
  return new URL(`/share/${row.token}`, appUrl).href;
}
// Bounded in-memory limits complement deployment-level throttling; never trust forwarded IPs by default.
const buckets = new Map<string, { count: number; until: number }>();
function limit(key: string, maximum: number, window = 15 * 60_000) {
  const now = Date.now();
  let bucket = buckets.get(key);
  if (!bucket || bucket.until <= now) {
    if (buckets.size >= 50_000) throw new HttpError(429, 'Too many requests');
    bucket = { count: 0, until: now + window }; buckets.set(key, bucket);
  }
  if (++bucket.count > maximum) throw new HttpError(429, 'Too many requests; try again later');
}
const cleanup = setInterval(() => {
  const now = Date.now();
  for (const [key, value] of buckets) if (value.until <= now) buckets.delete(key);
  db.prepare('DELETE FROM sessions WHERE expires<=?').run(now);
  db.prepare('DELETE FROM magic_tokens WHERE expires<=?').run(now);
}, 60_000);
cleanup.unref();
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  if (req.path.startsWith('/api/')) res.setHeader('Cache-Control', 'no-store');
  next();
});
app.use('/api', (req, _res, next) => {
  try {
  limit(`all:${req.ip}`, 600, 60_000);
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    if (req.headers['sec-fetch-site'] === 'cross-site' || (req.headers.origin && req.headers.origin !== appUrl.origin)) throw new HttpError(403, 'Untrusted request origin');
    const bodyless = req.method === 'DELETE' || req.path === '/auth/logout' || /^\/trips\/[^/]+\/share$/.test(req.path);
    const hasBody = Number(req.headers['content-length'] || 0) > 0 || !!req.headers['transfer-encoding'];
    if ((!bodyless || hasBody) && req.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') throw new HttpError(415, 'Expected application/json');
  }
  next();
  } catch (error) { next(error); }
});
app.use('/api', express.json({ limit: '2mb' }));
app.use('/api/auth', (req, _res, next) => {
  try { if (req.method === 'POST') limit(`auth:${req.ip}`, 30); next(); } catch (error) { next(error); }
});
app.get('/api/auth/me', wrap((req, res) => res.json({ user: user(req) })));
app.post('/api/auth/register', wrap(async (req, res) => {
  const input = credentialsSchema.parse(req.body);
  const passwordHash = await bcrypt.hash(input.password, 12);
  const account = { id: randomUUID(), email: input.email };
  const inserted = db.prepare('INSERT INTO users VALUES (?, ?, ?) ON CONFLICT(email) DO NOTHING').run(account.id, account.email, passwordHash);
  if (!inserted.changes) throw new HttpError(409, 'Email already registered; sign in or request a magic link');
  issueSession(req, res, account.id);
  res.status(201).json({ user: account });
}));
const dummyHash = bcrypt.hashSync(randomToken(), 12);
app.post('/api/auth/login', wrap(async (req, res) => {
  const input = credentialsSchema.parse(req.body);
  limit(`login:${input.email}`, 30);
  const account = db.prepare('SELECT * FROM users WHERE email=?').get(input.email) as (User & { password_hash: string | null }) | undefined;
  const valid = await bcrypt.compare(input.password, account?.password_hash || dummyHash);
  if (!account || !account.password_hash || !valid) throw new HttpError(401, 'Invalid email or password');
  issueSession(req, res, account.id);
  res.json({ user: { id: account.id, email: account.email } });
}));
app.post('/api/auth/logout', wrap((req, res) => {
  const token = sessionToken(req);
  if (token) db.prepare('DELETE FROM sessions WHERE hash=?').run(hash(token));
  res.clearCookie(cookieName, { httpOnly: true, secure: production, sameSite: 'lax', path: '/' });
  res.status(204).end();
}));
app.post('/api/auth/magic/request', wrap(async (req, res) => {
  const { email } = emailSchema.parse(req.body);
  limit(`magic:${email}`, 5);
  if (!emailService.available) throw new HttpError(503, 'Email unavailable: configure SMTP_HOST and SMTP_FROM');
  const token = randomToken();
  db.prepare('INSERT INTO magic_tokens VALUES (?, ?, ?)').run(hash(token), email, Date.now() + 15 * 60_000);
  // Fragment keeps the bearer token out of HTTP request logs and referrers.
  const link = new URL('/auth/magic', appUrl); link.hash = `token=${token}`;
  try { await send(email, `Sign in to ${config.name}`, `Sign in to ${config.name}:\n${link.href}\n\nThis single-use link expires in 15 minutes. Ignore this message if you did not request it.`); }
  catch (error) { db.prepare('DELETE FROM magic_tokens WHERE hash=?').run(hash(token)); throw error; }
  res.json({ ok: true });
}));
app.post('/api/auth/magic/verify', wrap((req, res) => {
  const { token } = tokenSchema.parse(req.body);
  const account = transaction(() => {
    const entry = db.prepare('DELETE FROM magic_tokens WHERE hash=? AND expires>? RETURNING email').get(hash(token), Date.now()) as { email: string } | undefined;
    if (!entry) throw new HttpError(400, 'Invalid or expired magic link');
    db.prepare('INSERT INTO users (id, email) VALUES (?, ?) ON CONFLICT(email) DO NOTHING').run(randomUUID(), entry.email);
    const account = db.prepare('SELECT id, email FROM users WHERE email=?').get(entry.email) as User;
    issueSession(req, res, account.id);
    return account;
  });
  res.json({ user: account });
}));
app.get('/api/trips', wrap((req, res) => {
  const account = requireUser(req);
  const rows = db.prepare('SELECT json FROM trips WHERE owner_id=? ORDER BY updated_at DESC').all(account.id) as { json: string }[];
  res.json({ trips: rows.map(row => JSON.parse(row.json)) });
}));
app.put('/api/trips/:id', wrap((req, res) => {
  const account = requireUser(req);
  const { trip, baseUpdatedAt } = putTripSchema.parse(req.body);
  if (trip.id !== req.params.id) throw new HttpError(400, 'Trip ID must match URL');
  if (trip.ownerId !== account.id) throw new HttpError(403, 'Invalid trip owner');
  const saved = transaction(() => {
    const existing = db.prepare('SELECT owner_id, updated_at, json FROM trips WHERE id=?').get(trip.id) as { owner_id: string; updated_at: string; json: string } | undefined;
    if (existing && existing.owner_id !== account.id) throw new HttpError(404, 'Trip not found');
    if ((existing?.updated_at ?? null) !== baseUpdatedAt) throw new HttpError(409, 'Trip changed; reload before saving');
    if (!existing) {
      const total = db.prepare('SELECT COUNT(*) AS count FROM trips WHERE owner_id=?').get(account.id) as { count: number };
      if (total.count >= 100) throw new HttpError(422, 'Trip limit reached (100)');
    }
    const now = new Date(Math.max(Date.now(), existing ? Date.parse(existing.updated_at) + 1 : 0)).toISOString();
    const value: Trip = { ...trip, createdAt: existing ? (JSON.parse(existing.json) as Trip).createdAt : now, updatedAt: now };
    db.prepare('INSERT INTO trips VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET updated_at=excluded.updated_at, json=excluded.json').run(value.id, account.id, now, JSON.stringify(value));
    return value;
  });
  res.json({ trip: saved });
}));
app.delete('/api/trips/:id', wrap((req, res) => {
  transaction(() => {
    const row = owned(req);
    if (req.body?.baseUpdatedAt !== row.updated_at) throw new HttpError(409, 'Trip changed; reload before deleting');
    db.prepare('DELETE FROM trips WHERE id=?').run(String(req.params.id));
  });
  res.status(204).end();
}));
app.post('/api/trips/:id/share', wrap((req, res) => {
  owned(req); res.json({ url: shareUrl(String(req.params.id)) });
}));
app.post('/api/trips/:id/email', wrap(async (req, res) => {
  const row = owned(req);
  const { email } = emailSchema.parse(req.body);
  limit(`email:${requireUser(req).id}`, 10);
  if (!emailService.available) throw new HttpError(503, 'Email unavailable: configure SMTP_HOST and SMTP_FROM');
  const trip = JSON.parse(row.json) as Trip;
  const distance = trip.segments.reduce((sum, segment) => sum + segment.distance, 0);
  const minutes = trip.segments.reduce((sum, segment) => sum + segment.duration, 0) + trip.points.reduce((sum, point) => sum + point.duration, 0);
  await send(email, `A ${config.name} trip shared with you`, `${requireUser(req).email} shared a trip with you:\n\n${trip.title}\n${trip.startDate}\n${distance} km · ${minutes} minutes · ${trip.points.length} points\n\n${trip.description}\n\nView the live, read-only trip:\n${shareUrl(trip.id)}`);
  res.json({ ok: true });
}));
app.get('/api/shares/:token', wrap((req, res) => {
  const token = String(req.params.token);
  if (!/^[a-f0-9]{64}$/.test(token)) throw new HttpError(404, 'Share not found');
  const row = db.prepare('SELECT trips.json FROM shares JOIN trips ON trips.id=shares.trip_id WHERE shares.token=?').get(token) as { json: string } | undefined;
  if (!row) throw new HttpError(404, 'Share not found');
  res.json({ trip: JSON.parse(row.json) });
}));
app.use('/api', (_req, res) => { res.status(404).json({ error: 'Endpoint not found' }); });
if (production) {
  const dist = resolve(root, 'dist');
  if (!existsSync(resolve(dist, 'index.html'))) throw new Error('Production requires dist/index.html; build the frontend first');
  app.use(express.static(dist, { index: false }));
  app.use((req, res, next) => {
    if (req.method !== 'GET' || !req.accepts('html')) return next();
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(resolve(dist, 'index.html'));
  });
}
app.use((_req, res) => { res.status(404).json({ error: 'Not found' }); });
app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (error instanceof ZodError) { res.status(400).json({ error: 'Validation failed', issues: error.issues }); return; }
  if (error instanceof HttpError) { if (error.status === 429) res.setHeader('Retry-After', '900'); res.status(error.status).json({ error: error.message }); return; }
  const status = (error as { status?: number })?.status;
  if (status === 400 || status === 413 || status === 415) { res.status(status).json({ error: status === 413 ? 'Request too large' : 'Invalid JSON request' }); return; }
  console.error('Unhandled server error:', error instanceof Error ? error.message : 'Unknown error');
  res.status(500).json({ error: 'Internal server error' });
});
const port = Number(process.env.PORT || 3001);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT');
const server = app.listen(port, () => console.log(`${config.name} API listening on port ${port}`));
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => {
  server.close(() => { clearInterval(cleanup); db.close(); process.exit(0); });
  setTimeout(() => process.exit(1), 10_000).unref();
});
