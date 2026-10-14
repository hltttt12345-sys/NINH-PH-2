'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { URL, URLSearchParams } = require('url');

function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const i = line.indexOf('='); if (i <= 0) continue;
    const k = line.slice(0, i).trim(); const v = line.slice(i + 1).trim();
    if (process.env[k] === undefined) process.env[k] = v;
  }
}
loadEnv(path.join(__dirname, '.env'));

const PORT = Number(process.env.PORT || 3000);
const BIND = process.env.BIND || '0.0.0.0';
const DATA_DIR = path.resolve(__dirname, process.env.DATA_DIR || './data');
const SESSION_SECRET = process.env.SESSION_SECRET || '';
const SCADA_API_KEY = process.env.SCADA_API_KEY || '';
const SCADA_SOURCE = process.env.SCADA_SOURCE || 'NINH_PHU_2_JWF1520_14';
const SESSION_HOURS = Math.max(1, Number(process.env.SESSION_HOURS || 12));
const COOKIE_SECURE = process.env.COOKIE_SECURE === '1';
const PUBLIC = path.join(__dirname, 'public');
const LATEST_FILE = path.join(DATA_DIR, 'latest.json');
const HISTORY_FILE = path.join(DATA_DIR, 'shift_history.json');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';

fs.mkdirSync(DATA_DIR, { recursive: true });
function hashPassword(pw) { const salt = crypto.randomBytes(16); const hash = crypto.scryptSync(pw, salt, 64); return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`; }
if (!SESSION_SECRET || !SCADA_API_KEY) { console.error('Missing SESSION_SECRET or SCADA_API_KEY environment variable.'); process.exit(1); }
if (!fs.existsSync(USERS_FILE)) {
  if (!ADMIN_PASSWORD || ADMIN_PASSWORD.length < 10) { console.error('Missing ADMIN_PASSWORD (minimum 10 characters).'); process.exit(1); }
  fs.writeFileSync(USERS_FILE, JSON.stringify([{ username: ADMIN_USERNAME, passwordHash: hashPassword(ADMIN_PASSWORD), enabled: true }], null, 2));
  console.log(`Created initial web user: ${ADMIN_USERNAME}`);
}

const sseClients = new Set();
const loginAttempts = new Map();
function readJson(file, fallback) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } }
function writeJsonAtomic(file, value) { const temp = `${file}.tmp`; fs.writeFileSync(temp, JSON.stringify(value, null, 2)); fs.renameSync(temp, file); }
function setSecurityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('X-Frame-Options', 'DENY'); res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'");
}
function json(res, code, value) { const body = Buffer.from(JSON.stringify(value)); setSecurityHeaders(res); res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': body.length, 'Cache-Control': 'no-store' }); res.end(body); }
function text(res, code, value, type = 'text/plain; charset=utf-8') { const body = Buffer.from(value); setSecurityHeaders(res); res.writeHead(code, { 'Content-Type': type, 'Content-Length': body.length, 'Cache-Control': 'no-store' }); res.end(body); }
function redirect(res, location) { setSecurityHeaders(res); res.writeHead(302, { Location: location, 'Cache-Control': 'no-store' }); res.end(); }
function serveFile(res, file, type, cache = false) { try { const body = fs.readFileSync(file); setSecurityHeaders(res); res.writeHead(200, { 'Content-Type': type, 'Content-Length': body.length, 'Cache-Control': cache ? 'public, max-age=3600' : 'no-store' }); res.end(body); } catch { text(res, 404, 'Not found'); } }
function parseCookies(req) { const out = {}; for (const item of String(req.headers.cookie || '').split(';')) { const i = item.indexOf('='); if (i > 0) out[item.slice(0, i).trim()] = decodeURIComponent(item.slice(i + 1).trim()); } return out; }
function b64url(input) { return Buffer.from(input).toString('base64url'); }
function sign(payload) { return crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('base64url'); }
function createSession(username) { const payload = b64url(JSON.stringify({ u: username, exp: Date.now() + SESSION_HOURS * 3600_000 })); return `${payload}.${sign(payload)}`; }
function getSession(req) {
  const token = parseCookies(req).pp2_session; if (!token) return null; const parts = token.split('.'); if (parts.length !== 2) return null;
  const expected = sign(parts[0]); const a = Buffer.from(parts[1]); const b = Buffer.from(expected); if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try { const d = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')); if (!d.u || !d.exp || d.exp < Date.now()) return null; return d; } catch { return null; }
}
function setSessionCookie(res, token) { const attrs = [`pp2_session=${encodeURIComponent(token)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${SESSION_HOURS * 3600}`]; if (COOKIE_SECURE) attrs.push('Secure'); res.setHeader('Set-Cookie', attrs.join('; ')); }
function clearSessionCookie(res) { const attrs = ['pp2_session=', 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0']; if (COOKIE_SECURE) attrs.push('Secure'); res.setHeader('Set-Cookie', attrs.join('; ')); }
function verifyPassword(password, encoded) { try { const [kind, saltHex, hashHex] = String(encoded).split('$'); if (kind !== 'scrypt') return false; const actual = crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), 64); const expected = Buffer.from(hashHex, 'hex'); return actual.length === expected.length && crypto.timingSafeEqual(actual, expected); } catch { return false; } }
function safeEqualString(a, b) { const aa = Buffer.from(String(a)); const bb = Buffer.from(String(b)); return aa.length === bb.length && crypto.timingSafeEqual(aa, bb); }
function clientIp(req) { return String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim(); }
function loginAllowed(ip) { const now = Date.now(); const arr = (loginAttempts.get(ip) || []).filter(t => now - t < 10 * 60_000); loginAttempts.set(ip, arr); return arr.length < 10; }
function loginFailed(ip) { const arr = loginAttempts.get(ip) || []; arr.push(Date.now()); loginAttempts.set(ip, arr); }
function readBody(req, limit = 1024 * 1024) { return new Promise((resolve, reject) => { const chunks = []; let size = 0; req.on('data', c => { size += c.length; if (size > limit) { reject(new Error('Body too large')); req.destroy(); } else chunks.push(c); }); req.on('end', () => resolve(Buffer.concat(chunks))); req.on('error', reject); }); }
function authOrRedirect(req, res) { const s = getSession(req); if (!s) { redirect(res, '/login'); return null; } return s; }
function authApi(req, res) { const s = getSession(req); if (!s) { json(res, 401, { error: 'unauthorized' }); return null; } return s; }
function num(v) { return Number.isFinite(Number(v)) ? Number(v) : 0; }
function str(v, n = 200) { return String(v ?? '').slice(0, n); }

function normalizeIngest(body) {
  if (!body || body.source !== SCADA_SOURCE || !body.shift || !Array.isArray(body.machines)) throw new Error('Invalid payload');
  const shift = { key: str(body.shift.key, 64), name: str(body.shift.name, 32), start: str(body.shift.start, 64), end: str(body.shift.end, 64) };
  if (!shift.key || !shift.start || !shift.end) throw new Error('Invalid shift');
  const machines = body.machines.map(m => {
    const number = Number(m.number); if (!Number.isInteger(number) || number < 9 || number > 22) throw new Error('Invalid machine');
    return {
      number, connected: !!m.connected, runState: m.runState === true ? true : m.runState === false ? false : null,
      realtimeCode: str(m.realtimeCode, 32), status: str(m.status, 300), currentM: num(m.currentM), aCurrentM: num(m.aCurrentM), bCurrentM: num(m.bCurrentM), totalM: num(m.totalM),
      spindle: num(m.spindle), roller: num(m.roller), frequencyHz: num(m.frequencyHz), currentLengthM: num(m.currentLengthM), fullBobbinM: num(m.fullBobbinM),
      runtimeSeconds: num(m.runtimeSeconds), stoptimeSeconds: num(m.stoptimeSeconds), lastAt: m.lastAt ? str(m.lastAt, 64) : null
    };
  }).sort((a,b)=>a.number-b.number);
  const history = (Array.isArray(body.history) ? body.history : []).slice(-2000).map(r => {
    const machine = Number(r.machine); if (!Number.isInteger(machine) || machine < 9 || machine > 22) throw new Error('Invalid history machine');
    return { key: str(r.key, 120), machine, workDate: str(r.workDate, 32), shift: str(r.shift, 32), start: str(r.start, 64), end: str(r.end, 64), productionM: num(r.productionM), totalM: num(r.totalM), runtimeSeconds: num(r.runtimeSeconds), stoptimeSeconds: num(r.stoptimeSeconds), savedAt: r.savedAt ? str(r.savedAt, 64) : null };
  });
  return { source: body.source, sentAt: str(body.sentAt || new Date().toISOString(), 64), receivedAt: new Date().toISOString(), reading: body.reading !== false, shift, machines, history };
}
function updateHistory(snapshot) {
  const db = readJson(HISTORY_FILE, { records: {} }); if (!db.records || typeof db.records !== 'object') db.records = {};
  for (const r of snapshot.history || []) { const key = r.key || `${r.workDate}/${r.shift}/${r.machine}`; db.records[key] = { ...r, key }; }
  writeJsonAtomic(HISTORY_FILE, db);
}
function summaryFromLatest(latest) {
  if (!latest || !Array.isArray(latest.machines)) return { connected: 0, running: 0, stopped: 0, currentM: 0 };
  let connected = 0, running = 0, stopped = 0, currentM = 0;
  for (const m of latest.machines) { if (m.connected) connected++; if (m.connected && m.runState === true) running++; else stopped++; currentM += num(m.currentM); }
  return { connected, running, stopped, currentM };
}
function broadcast(snapshot) { const payload = `event: snapshot\ndata: ${JSON.stringify({ latest: snapshot, summary: summaryFromLatest(snapshot) })}\n\n`; for (const res of sseClients) { try { res.write(payload); } catch { sseClients.delete(res); } } }

const server = http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url, `http://${req.headers.host || 'localhost'}`); const p = u.pathname;
    if (req.method === 'GET' && p === '/healthz') return text(res, 200, 'ok');
    if (req.method === 'GET' && p === '/favicon.ico') return serveFile(res, path.join(PUBLIC, 'favicon.ico'), 'image/x-icon', true);
    if (req.method === 'GET' && p === '/styles.css') return serveFile(res, path.join(PUBLIC, 'styles.css'), 'text/css; charset=utf-8', true);
    if (req.method === 'GET' && p === '/dashboard.js') return serveFile(res, path.join(PUBLIC, 'dashboard.js'), 'application/javascript; charset=utf-8', true);
    if (req.method === 'GET' && p === '/login') { if (getSession(req)) return redirect(res, '/'); return serveFile(res, path.join(PUBLIC, 'login.html'), 'text/html; charset=utf-8'); }
    if (req.method === 'POST' && p === '/login') {
      const ip = clientIp(req); if (!loginAllowed(ip)) return text(res, 429, 'Too many login attempts');
      const raw = await readBody(req, 64 * 1024); const form = new URLSearchParams(raw.toString('utf8')); const username = str(form.get('username'), 100); const password = String(form.get('password') || '');
      const users = readJson(USERS_FILE, []); const user = users.find(x => x.enabled !== false && x.username === username);
      if (!user || !verifyPassword(password, user.passwordHash)) { loginFailed(ip); return redirect(res, '/login?error=1'); }
      loginAttempts.delete(ip); setSessionCookie(res, createSession(username)); return redirect(res, '/');
    }
    if (req.method === 'POST' && p === '/logout') { clearSessionCookie(res); return redirect(res, '/login'); }
    if (req.method === 'POST' && p === '/api/ingest') {
      const key = req.headers['x-api-key']; if (!key || !safeEqualString(key, SCADA_API_KEY)) return json(res, 401, { error: 'invalid api key' });
      const raw = await readBody(req, 1024 * 1024); const snapshot = normalizeIngest(JSON.parse(raw.toString('utf8')));
      writeJsonAtomic(LATEST_FILE, snapshot); updateHistory(snapshot); broadcast(snapshot); return json(res, 200, { ok: true, receivedAt: snapshot.receivedAt });
    }
    if (req.method === 'GET' && p === '/api/latest') { if (!authApi(req, res)) return; const latest = readJson(LATEST_FILE, null); return json(res, 200, { latest, summary: summaryFromLatest(latest), serverTime: new Date().toISOString() }); }
    if (req.method === 'GET' && p === '/api/history') {
      if (!authApi(req, res)) return; const days = Math.min(365, Math.max(1, Number(u.searchParams.get('days') || 14))); const machine = Number(u.searchParams.get('machine') || 0); const cutoff = Date.now() - days * 24 * 3600_000;
      const db = readJson(HISTORY_FILE, { records: {} }); let records = Object.values(db.records || {}).filter(r => Date.parse(r.start || r.savedAt || 0) >= cutoff); if (machine >= 9 && machine <= 22) records = records.filter(r => r.machine === machine);
      records.sort((a,b)=>Date.parse(b.start||0)-Date.parse(a.start||0) || a.machine-b.machine); return json(res, 200, { records: records.slice(0, 2000) });
    }
    if (req.method === 'GET' && p === '/api/events') { if (!authApi(req, res)) return; setSecurityHeaders(res); res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive' }); res.write(': connected\n\n'); sseClients.add(res); req.on('close', () => sseClients.delete(res)); return; }
    if (req.method === 'GET' && p === '/') { if (!authOrRedirect(req, res)) return; return serveFile(res, path.join(PUBLIC, 'index.html'), 'text/html; charset=utf-8'); }
    return text(res, 404, 'Not found');
  } catch (err) { console.error(err); return json(res, 500, { error: 'server_error' }); }
});
setInterval(() => { for (const res of sseClients) { try { res.write(': keepalive\n\n'); } catch { sseClients.delete(res); } } }, 25_000).unref();
server.listen(PORT, BIND, () => console.log(`Ninh Phu 2 SCADA Web listening on http://${BIND}:${PORT}`));
