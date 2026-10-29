'use strict';
// App lock with a PIN, and a vault for passwords that is sealed with that PIN.
//  • The PIN itself is never stored: only a slow scrypt hash (with salt).
//  • Wrong PINs: after 5 tries a wait of 1 minute, doubling each time (kept on disk, so a restart does not reset it).
//  • The app locks itself after N minutes without use; the lock is enforced by the program, not only the screen.
//  • B2B passwords are encrypted by Windows (DPAPI) AND with a key derived from the PIN. Without the PIN, a copy of
//    the data folder or of a backup is useless, even on the same PC. The key lives only in memory while the program
//    runs, after the first unlock (so the daily automatic update can still log in to B2B).
const crypto = require('crypto');
const store = require('./store');

const N = 1 << 15; // scrypt cost (≈100 ms per try)
const kdf = (pin, salt) => crypto.scryptSync(String(pin), Buffer.from(salt, 'base64'), 32, { N, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });

function cfg() { return store.read('security', () => ({ lockMinutes: 30 })); }
function save(c) { store.write('security', c); }
function hasPin() { const c = cfg(); return !!(c.pin && c.pin.hash); }

let vaultKey = null;   // in memory only
let unlocked = false;
let lastActive = 0;

function lockMinutes() { return Math.max(1, Math.min(480, Number(cfg().lockMinutes) || 30)); }
function isLocked() {
  if (!hasPin()) return false;
  if (!unlocked) return true;
  if (Date.now() - lastActive > lockMinutes() * 60000) { unlocked = false; return true; }
  return false;
}
function touch() { if (unlocked) lastActive = Date.now(); }
function lock() { unlocked = false; }

function validPin(pin) {
  const s = String(pin || '');
  if (s.length < 6 || s.length > 32) throw new Error('Το PIN θέλει τουλάχιστον 6 ψηφία ή χαρακτήρες.');
  if (/^(\d)\1+$/.test(s) || '0123456789012345678909876543210'.includes(s)) throw new Error('Πολύ εύκολο PIN (π.χ. 111111 ή 123456). Διάλεξε άλλο.');
  return s;
}

function verify(pin) {
  const c = cfg();
  if (!c.pin) return false;
  const h = kdf(pin, c.pin.salt);
  return crypto.timingSafeEqual(h, Buffer.from(c.pin.hash, 'base64'));
}

function unlock(pin) {
  const c = cfg();
  if (!hasPin()) return true;
  const now = Date.now();
  if (c.blockedUntil && now < c.blockedUntil) throw new Error(`Πολλές λάθος προσπάθειες. Δοκίμασε ξανά σε ${Math.ceil((c.blockedUntil - now) / 1000)} δευτερόλεπτα.`);
  if (!verify(pin)) {
    c.fails = (c.fails || 0) + 1;
    c.lastFailAt = new Date().toISOString();
    if (c.fails % 5 === 0) c.blockedUntil = now + 60000 * Math.pow(2, c.fails / 5 - 1);
    save(c);
    throw new Error('Λάθος PIN.' + (c.fails % 5 ? ` (${5 - (c.fails % 5)} προσπάθειες ακόμα πριν την αναμονή)` : ''));
  }
  if (c.fails || c.blockedUntil) { c.fails = 0; c.blockedUntil = 0; save(c); }
  vaultKey = kdf(pin, c.vault.salt);
  unlocked = true;
  lastActive = now;
  return true;
}

// ---------- vault ----------
function seal(inner, key) {
  const iv = crypto.randomBytes(12);
  const ci = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([ci.update(inner, 'utf8'), ci.final()]);
  return 'vault:' + Buffer.concat([iv, ci.getAuthTag(), enc]).toString('base64');
}
function open(blob, key) {
  const raw = Buffer.from(String(blob).slice(6), 'base64');
  const d = crypto.createDecipheriv('aes-256-gcm', key, raw.slice(0, 12));
  d.setAuthTag(raw.slice(12, 28));
  return Buffer.concat([d.update(raw.slice(28)), d.final()]).toString('utf8');
}
/** Wrap an already Windows-protected secret with the PIN key (if a PIN is set). */
function wrap(inner) {
  if (!hasPin() || !inner) return inner;
  if (!vaultKey) throw new Error('Ξεκλείδωσε το πρόγραμμα με το PIN για να αποθηκευτεί ο κωδικός.');
  return seal(inner, vaultKey);
}
function unwrap(blob) {
  if (!String(blob || '').startsWith('vault:')) return blob;
  if (!vaultKey) throw new Error('Οι κωδικοί είναι κλειδωμένοι με το PIN: άνοιξε το πρόγραμμα και βάλε το PIN.');
  return open(blob, vaultKey);
}
/** Re-encrypt every stored secret (when the PIN is set, changed or removed). */
function rewrapAll(fromKey, toKey) {
  store.update('suppliers', [], (list) => {
    for (const s of list) {
      if (!s.b2bPass) continue;
      let inner = s.b2bPass;
      if (inner.startsWith('vault:')) inner = open(inner, fromKey);
      s.b2bPass = toKey ? seal(inner, toKey) : inner;
    }
    return list;
  });
}

function setPin(newPin, currentPin) {
  const pin = validPin(newPin);
  const c = cfg();
  const oldKey = hasPin() ? (() => { if (!verify(currentPin)) throw new Error('Λάθος τρέχον PIN.'); return kdf(currentPin, c.vault.salt); })() : null;
  const salt = crypto.randomBytes(16).toString('base64');
  const vsalt = crypto.randomBytes(16).toString('base64');
  const newKey = kdf(pin, vsalt);
  rewrapAll(oldKey, newKey);
  c.pin = { salt, hash: kdf(pin, salt).toString('base64'), setAt: new Date().toISOString() };
  c.vault = { salt: vsalt };
  c.fails = 0; c.blockedUntil = 0;
  save(c);
  vaultKey = newKey; unlocked = true; lastActive = Date.now();
}
function removePin(currentPin) {
  const c = cfg();
  if (!hasPin()) return;
  if (!verify(currentPin)) throw new Error('Λάθος PIN.');
  rewrapAll(kdf(currentPin, c.vault.salt), null);
  delete c.pin; delete c.vault; c.fails = 0; c.blockedUntil = 0;
  save(c);
  vaultKey = null; unlocked = false;
}
function setLockMinutes(m) { const c = cfg(); c.lockMinutes = Math.max(1, Math.min(480, Math.round(Number(m) || 30))); save(c); }

function status() {
  const c = cfg();
  return { pin: hasPin(), locked: isLocked(), lockMinutes: lockMinutes(), blockedFor: c.blockedUntil && c.blockedUntil > Date.now() ? Math.ceil((c.blockedUntil - Date.now()) / 1000) : 0, failsSinceUnlock: c.fails || 0, lastFailAt: c.lastFailAt || null, vaultOpen: !!vaultKey };
}

module.exports = { hasPin, isLocked, touch, lock, unlock, setPin, removePin, setLockMinutes, status, wrap, unwrap };
