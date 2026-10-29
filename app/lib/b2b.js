'use strict';
// Logging in to a supplier's B2B shop, to read the catalog with OUR prices (wholesale / dealer prices).
// Works with B2B shops built on WordPress/WooCommerce (the most common in Greece): the program logs in
// like a browser and then reads the catalog as that customer. Other B2B systems: download their Excel/PDF.
const http = require('./http');
const U = require('./util');

function cookieJar() {
  const jar = new Map();
  return {
    take(res) { for (const c of (res.headers.getSetCookie ? res.headers.getSetCookie() : [])) { const [kv] = c.split(';'); const i = kv.indexOf('='); if (i > 0) { const k = kv.slice(0, i).trim(), v = kv.slice(i + 1).trim(); if (v && v !== 'deleted') jar.set(k, v); else jar.delete(k); } } },
    header() { return [...jar.entries()].map(([k, v]) => k + '=' + v).join('; '); },
    has(re) { return [...jar.keys()].some((k) => re.test(k)); },
  };
}

async function req(url, opts, jar) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 30000);
  try {
    const headers = Object.assign({ 'User-Agent': http.UA, Accept: 'text/html,application/json,*/*', 'Accept-Language': 'el-GR,el;q=0.9' }, opts.headers || {});
    const ck = jar.header();
    if (ck) headers.Cookie = ck;
    let res = await fetch(url, { method: opts.method || 'GET', headers, body: opts.body, redirect: 'manual', signal: ctl.signal });
    jar.take(res);
    // follow redirects by hand so every cookie on the way is kept
    for (let i = 0; i < 5 && res.status >= 300 && res.status < 400 && res.headers.get('location'); i++) {
      const next = new URL(res.headers.get('location'), url).toString();
      // never carry the login cookies to another site
      if (new URL(next).origin !== new URL(url).origin) break;
      const h2 = Object.assign({}, headers, { Cookie: jar.header() });
      res = await fetch(next, { headers: h2, redirect: 'manual', signal: ctl.signal });
      jar.take(res);
      url = next;
    }
    const text = await res.text();
    return { status: res.status, text, url };
  } finally { clearTimeout(t); }
}

/**
 * Log in to a WordPress / WooCommerce shop. Returns headers to send with every catalog request
 * ({ Cookie, X-WP-Nonce }), so prices come as this customer sees them.
 */
async function wpLogin(base, user, pass) {
  base = String(base).replace(/\/+$/, '');
  if (!user || !pass) throw new Error('Δώσε όνομα χρήστη και κωδικό του B2B.');
  const u = new URL(base);
  // the password only travels encrypted (https); plain http is refused, except on this PC for tests
  if (u.protocol !== 'https:' && !/^(127\.0\.0\.1|localhost)$/.test(u.hostname)) throw new Error('Το B2B δεν έχει ασφαλή σύνδεση (https). Ο κωδικός δεν στέλνεται χωρίς κρυπτογράφηση.');
  const jar = cookieJar();
  const first = await req(base + '/wp-login.php', {}, jar);
  if (first.status === 404) throw new Error('Το B2B δεν έχει την κλασική σελίδα σύνδεσης WordPress. Κατεβάστε τον τιμοκατάλογο από το B2B (Excel/PDF) και ρίξτε τον στο πρόγραμμα.');
  const body = new URLSearchParams({ log: user, pwd: pass, 'wp-submit': 'Log In', redirect_to: base + '/wp-admin/', testcookie: '1', rememberme: 'forever' });
  if (!jar.has(/^wordpress_test_cookie$/)) jar.take({ headers: { getSetCookie: () => ['wordpress_test_cookie=WP%20Cookie%20check'] } });
  await req(base + '/wp-login.php', { method: 'POST', body: body.toString(), headers: { 'Content-Type': 'application/x-www-form-urlencoded', Referer: base + '/wp-login.php' } }, jar);
  if (!jar.has(/^wordpress_logged_in_/)) throw new Error('Η σύνδεση στο B2B απέτυχε: λάθος όνομα χρήστη ή κωδικός, ή το site ζητάει επιπλέον έλεγχο (captcha).');
  // REST nonce of the logged-in user: without it WordPress treats the API calls as a visitor
  const n = await req(base + '/wp-admin/admin-ajax.php?action=rest-nonce', {}, jar);
  const nonce = /^[a-f0-9]{10}$/i.test(n.text.trim()) ? n.text.trim() : '';
  return { Cookie: jar.header(), 'X-WP-Nonce': nonce, at: U.nowIso() };
}

module.exports = { wpLogin };
