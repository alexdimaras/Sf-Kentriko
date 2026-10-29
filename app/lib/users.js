'use strict';
// Users and sessions for the shared (server / cloud) mode: every PC opens the same program in a browser,
// each person with their own name and password.
//  • Passwords are never stored: only a slow scrypt hash with salt (like the PIN).
//  • Wrong passwords: after 5 tries a wait of 1 minute, doubling each time, per user and per address.
//  • Sessions: a random id in an HttpOnly, SameSite=Strict cookie; only its hash is kept on disk, so a copy of
//    the data folder cannot be used to log in. A session ends after the idle minutes of Settings → Security.
//  • Every call also needs the session's own CSRF token in a header (a page of another site cannot send it).
const crypto = require('crypto');
const store = require('./store');
const U = require('./util');

const N = 1 << 15;
const kdf = (pw, salt) => crypto.scryptSync(String(pw), Buffer.from(salt, 'base64'), 32, { N, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');

function all() { return store.read('users', []); }
function publicView(u) { return u ? { id: u.id, user: u.user, name: u.name, role: u.role, createdAt: u.createdAt, lastLoginAt: u.lastLoginAt || null } : null; }
function list() { return all().map(publicView); }
function count() { return all().length; }
function byId(id) { return all().find((u) => u.id === id) || null; }

function cleanUser(s) {
  const v = String(s || '').trim().toLowerCase();
  if (!/^[a-z0-9._-]{3,32}$/.test(v)) throw new Error('Το όνομα χρήστη θέλει 3–32 λατινικά γράμματα ή αριθμούς (π.χ. alex, piraeus2).');
  return v;
}
function validPassword(pw) {
  const s = String(pw || '');
  if (s.length < 10) throw new Error('Ο κωδικός θέλει τουλάχιστον 10 χαρακτήρες.');
  if (s.length > 128) throw new Error('Πολύ μεγάλος κωδικός.');
  if (/^(.)\1+$/.test(s) || /^(0123456789|1234567890|password|qwerty)/i.test(s)) throw new Error('Πολύ εύκολος κωδικός. Διάλεξε άλλον.');
  return s;
}
function hashPw(pw) { const salt = crypto.randomBytes(16).toString('base64'); return { salt, hash: kdf(pw, salt).toString('base64') }; }

function create(input) {
  const user = cleanUser(input.user);
  const pw = validPassword(input.password);
  const list0 = all();
  if (list0.some((u) => u.user === user)) throw new Error('Υπάρχει ήδη χρήστης με αυτό το όνομα.');
  const u = { id: U.uid('u'), user, name: U.collapse(input.name || user), role: input.role === 'admin' || !list0.length ? 'admin' : 'staff', pass: hashPw(pw), createdAt: U.nowIso() };
  list0.push(u);
  store.write('users', list0);
  return publicView(u);
}
function update(id, patch) {
  const list0 = all();
  const u = list0.find((x) => x.id === id);
  if (!u) throw new Error('Δεν βρέθηκε ο χρήστης.');
  if (patch.name !== undefined) u.name = U.collapse(patch.name) || u.user;
  if (patch.role !== undefined) {
    const role = patch.role === 'admin' ? 'admin' : 'staff';
    if (u.role === 'admin' && role !== 'admin' && list0.filter((x) => x.role === 'admin').length < 2) throw new Error('Πρέπει να μείνει τουλάχιστον ένας διαχειριστής.');
    u.role = role;
  }
  if (patch.password) { u.pass = hashPw(validPassword(patch.password)); endSessionsOf(u.id); }
  store.write('users', list0);
  return publicView(u);
}
function remove(id) {
  const list0 = all();
  const u = list0.find((x) => x.id === id);
  if (!u) return;
  if (u.role === 'admin' && list0.filter((x) => x.role === 'admin').length < 2) throw new Error('Πρέπει να μείνει τουλάχιστον ένας διαχειριστής.');
  store.write('users', list0.filter((x) => x.id !== id));
  endSessionsOf(id);
}

// ---------- login throttling (per user name and per address) ----------
const fails = new Map(); // key -> { n, until }
function blockedFor(key) { const f = fails.get(key); return f && f.until > Date.now() ? Math.ceil((f.until - Date.now()) / 1000) : 0; }
function noteFail(key) {
  const f = fails.get(key) || { n: 0, until: 0 };
  f.n++;
  if (f.n % 5 === 0) f.until = Date.now() + 60000 * Math.pow(2, f.n / 5 - 1);
  fails.set(key, f);
}

// a fixed hash, so a wrong user name costs the same time as a wrong password (nothing tells which one was wrong)
const DUMMY = hashPw(crypto.randomBytes(12).toString('hex'));
/** remember: stay signed in on this device (phone): 12 hours without use instead of the idle minutes. */
function login(userName, password, ip, ua, remember) {
  const user = String(userName || '').trim().toLowerCase();
  const wait = Math.max(blockedFor('u:' + user), blockedFor('ip:' + ip));
  if (wait) throw new Error(`Πολλές λάθος προσπάθειες. Δοκίμασε ξανά σε ${wait} δευτερόλεπτα.`);
  const u = all().find((x) => x.user === user);
  const p = u ? u.pass : DUMMY;
  const ok = crypto.timingSafeEqual(kdf(password || '', p.salt), Buffer.from(p.hash, 'base64')) && !!u;
  if (!ok) { noteFail('u:' + user); noteFail('ip:' + ip); throw new Error('Λάθος όνομα χρήστη ή κωδικός.'); }
  fails.delete('u:' + user); fails.delete('ip:' + ip);
  store.update('users', [], (l) => { const x = l.find((y) => y.id === u.id); if (x) x.lastLoginAt = U.nowIso(); return l; });
  return startSession(u, ip, ua, remember);
}

// ---------- sessions ----------
const MAX_AGE_DAYS = 30;
let sessions = null; // sha(sid) -> { uid, csrf, createdAt, lastSeen, ip, ua }
let dirty = false;
function load() {
  if (sessions) return sessions;
  sessions = new Map(Object.entries(store.read('sessions', {})));
  return sessions;
}
function flush() { if (!dirty || !sessions) return; dirty = false; store.write('sessions', Object.fromEntries(sessions)); }
setInterval(flush, 5 * 60 * 1000).unref();

const REMEMBER_MINUTES = 12 * 60;
function startSession(u, ip, ua, remember) {
  load();
  const sid = crypto.randomBytes(32).toString('base64url');
  const s = { uid: u.id, csrf: crypto.randomBytes(24).toString('base64url'), createdAt: Date.now(), lastSeen: Date.now(), ip: String(ip || ''), ua: String(ua || '').slice(0, 160), long: !!remember };
  sessions.set(sha(sid), s);
  dirty = true; flush();
  return { sid, csrf: s.csrf, user: publicView(u) };
}
function idleMinutes() { return require('./security').status().lockMinutes || 30; }
/** The session of a cookie value, or null (expired, ended, user removed). */
function session(sid, touch) {
  if (!sid) return null;
  load();
  const k = sha(sid);
  const s = sessions.get(k);
  if (!s) return null;
  const now = Date.now();
  const u = byId(s.uid);
  const idle = s.long ? Math.max(idleMinutes(), REMEMBER_MINUTES) : idleMinutes();
  if (!u || now - s.createdAt > MAX_AGE_DAYS * 864e5 || now - s.lastSeen > idle * 60000) { sessions.delete(k); dirty = true; return null; }
  if (touch) { s.lastSeen = now; dirty = true; }
  return { key: k, csrf: s.csrf, user: publicView(u), uid: u.id };
}
function end(sid) { load(); if (sessions.delete(sha(sid))) { dirty = true; flush(); } }
function endSessionsOf(uid) { load(); for (const [k, s] of sessions) if (s.uid === uid) sessions.delete(k); dirty = true; flush(); }
function endAll() { load(); sessions.clear(); dirty = true; flush(); }
/** One device signed out (e.g. a lost phone), by the short id the list shows. */
function endById(id) {
  load();
  const keys = [...sessions.keys()].filter((k) => id && String(id).length === 12 && k.startsWith(String(id)));
  if (keys.length !== 1) throw new Error('Η σύνδεση δεν βρέθηκε (ίσως έχει ήδη κλείσει).');
  sessions.delete(keys[0]); dirty = true; flush();
}
/** Open sessions; `current` marks the one of the caller ("this device"). */
function active(currentKey) {
  load();
  const out = [];
  for (const [k, s] of sessions) { const u = byId(s.uid); if (u) out.push({ id: k.slice(0, 12), user: u.name, since: new Date(s.createdAt).toISOString(), lastSeen: new Date(s.lastSeen).toISOString(), ip: s.ip, ua: s.ua, remembered: !!s.long, current: k === currentKey }); }
  return out.sort((a, b) => b.lastSeen.localeCompare(a.lastSeen));
}

// ---------- first start: the first administrator ----------
// Either SFK_ADMIN_USER / SFK_ADMIN_PASSWORD (e.g. in the cloud setup), or a one-time code printed in the black
// window / log, typed on the first screen together with the new user name and password.
let setupCode = null;
function ensureAdmin() {
  if (count()) return null;
  if (process.env.SFK_ADMIN_USER && process.env.SFK_ADMIN_PASSWORD) {
    create({ user: process.env.SFK_ADMIN_USER, password: process.env.SFK_ADMIN_PASSWORD, name: process.env.SFK_ADMIN_NAME || process.env.SFK_ADMIN_USER, role: 'admin' });
    return null;
  }
  if (!setupCode) setupCode = crypto.randomBytes(6).toString('hex').toUpperCase().match(/.{4}/g).join('-');
  return setupCode;
}
function setup(input, ip, ua) {
  if (count()) throw new Error('Η αρχική ρύθμιση έχει ήδη γίνει.');
  const wait = blockedFor('ip:' + ip);
  if (wait) throw new Error(`Πολλές λάθος προσπάθειες. Δοκίμασε ξανά σε ${wait} δευτερόλεπτα.`);
  const given = String(input.code || '').trim().toUpperCase();
  if (!setupCode || given.length !== setupCode.length || !crypto.timingSafeEqual(Buffer.from(given), Buffer.from(setupCode))) { noteFail('ip:' + ip); throw new Error('Λάθος κωδικός αρχικής ρύθμισης (γράφεται στο παράθυρο / στο log του διακομιστή).'); }
  const u = create({ user: input.user, password: input.password, name: input.name, role: 'admin' });
  setupCode = null;
  return startSession(all().find((x) => x.id === u.id), ip, ua);
}

module.exports = { list, count, create, update, remove, login, session, startSession, end, endAll, endById, endSessionsOf, active, ensureAdmin, setup, flush, publicView, byId };
