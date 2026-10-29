/* SF Κέντρο — core: DOM helpers, API, router, dialogs, jobs. */
'use strict';
const App = window.App = { views: {}, state: null, badges: {} };
let TOKEN = document.querySelector('meta[name="sfk-token"]').content;
// server mode: one program for every PC, each person logs in (local mode: this PC only)
const MODE = (document.querySelector('meta[name="sfk-mode"]') || {}).content === 'server' ? 'server' : 'local';
// this browser tab, so it is not told about its own changes
const CLIENT = Math.random().toString(36).slice(2) + Date.now().toString(36);

// ---------- DOM ----------
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  if (attrs && (typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs))) { kids.unshift(attrs); attrs = null; }
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k === 'value' && (tag === 'input' || tag === 'textarea' || tag === 'select')) el.value = v;
    else if (k === 'checked' || k === 'disabled' || k === 'selected' || k === 'multiple' || k === 'required' || k === 'readOnly') el[k] = !!v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  add(el, kids);
  return el;
}
function add(el, kids) {
  for (const k of kids.flat(Infinity)) {
    if (k == null || k === false || k === '') continue;
    el.appendChild(k instanceof Node ? k : document.createTextNode(String(k)));
  }
  return el;
}
function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }
const $ = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => [...(r || document).querySelectorAll(s)];

const ICONS = {
  today: 'M4 5h16M4 5v14h16V5M8 3v4M16 3v4M8 12h3M8 16h6',
  products: 'M3 7l9-4 9 4-9 4-9-4zm0 0v10l9 4 9-4V7M12 11v10',
  checks: 'M9 12l2 2 4-4M12 3l7 3v5c0 5-3 8-7 10-4-2-7-5-7-10V6z',
  new: 'M12 5v14M5 12h14',
  suppliers: 'M3 21h18M5 21V8l7-4 7 4v13M9 21v-6h6v6M9 11h.01M15 11h.01',
  market: 'M4 19V5M4 19h16M8 15l3-4 3 2 5-6',
  settings: 'M12 15a3 3 0 100-6 3 3 0 000 6zm7.4-3a7.4 7.4 0 00-.1-1.2l2-1.6-2-3.4-2.4 1a7 7 0 00-2-1.2L14.5 3h-4l-.4 2.6a7 7 0 00-2 1.2l-2.4-1-2 3.4 2 1.6a7.4 7.4 0 000 2.4l-2 1.6 2 3.4 2.4-1a7 7 0 002 1.2l.4 2.6h4l.4-2.6a7 7 0 002-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2z',
  sync: 'M4 4v6h6M20 20v-6h-6M5.6 15a7 7 0 0011.8 2.4L20 14M18.4 9A7 7 0 006.6 6.6L4 10',
  x: 'M6 6l12 12M18 6L6 18',
  file: 'M14 3H6v18h12V7zM14 3v4h4M9 13h6M9 17h6',
  folder: 'M3 6h6l2 2h10v11H3z',
  ext: 'M14 4h6v6M20 4l-9 9M18 14v6H4V6h6',
  edit: 'M4 20h4L20 8l-4-4L4 16zM14 6l4 4',
  search: 'M11 18a7 7 0 110-14 7 7 0 010 14zM20 20l-4-4',
  link: 'M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13',
  download: 'M12 4v11M7 10l5 5 5-5M5 20h14',
  upload: 'M12 20V9M7 14l5-5 5 5M5 4h14',
  mail: 'M3 6h18v12H3zM3 6l9 7 9-7',
  copy: 'M9 9h11v11H9zM5 15H4V4h11v1',
  arrow: 'M5 12h14M13 6l6 6-6 6',
  check: 'M5 12l5 5L20 7',
  power: 'M12 3v8M6.3 6.3a8 8 0 1011.4 0',
  info: 'M12 8h.01M11 12h1v5h1M12 21a9 9 0 110-18 9 9 0 010 18z',
  bolt: 'M13 3L5 14h6l-1 7 8-11h-6z',
  lock: 'M6 11h12v9H6zM8 11V8a4 4 0 018 0v3M12 15v2',
  shield: 'M12 3l7 3v5c0 5-3 8-7 10-4-2-7-5-7-10V6z',
  alert: 'M12 3l10 18H2zM12 10v5M12 18h.01',
  fixes: 'M14.7 6.3a4 4 0 00-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 005.4-5.4l-2.6 2.6-2.4-.6-.6-2.4z',
  menu: 'M4 7h16M4 12h16M4 17h16',
  phone: 'M8 3h8a1 1 0 011 1v16a1 1 0 01-1 1H8a1 1 0 01-1-1V4a1 1 0 011-1zM11 18h2',
  user: 'M12 12a4 4 0 100-8 4 4 0 000 8zM4 21a8 8 0 0116 0',
  logout: 'M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10',
};
function icon(name, cls) {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor');
  s.setAttribute('stroke-width', '1.8'); s.setAttribute('stroke-linecap', 'round'); s.setAttribute('stroke-linejoin', 'round'); s.setAttribute('aria-hidden', 'true');
  if (cls) s.setAttribute('class', cls);
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path'); p.setAttribute('d', ICONS[name] || ''); s.appendChild(p);
  return s;
}
function btn(label, opts, onClick) {
  if (typeof opts === 'function') { onClick = opts; opts = {}; }
  opts = opts || {};
  return h('button', { type: 'button', class: 'btn ' + (opts.cls || ''), onclick: onClick, disabled: opts.disabled, title: opts.title }, opts.icon ? icon(opts.icon) : null, label);
}

// ---------- format ----------
const fmt = {
  money(n) { n = Number(n) || 0; return n.toLocaleString('el-GR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €'; },
  num(n) { return (Number(n) || 0).toLocaleString('el-GR'); },
  date(iso) { return iso ? new Date(iso).toLocaleDateString('el-GR', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'; },
  dateTime(iso) { return iso ? new Date(iso).toLocaleString('el-GR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'; },
  ago(iso) {
    if (!iso) return 'ποτέ';
    const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
    if (m < 1) return 'μόλις τώρα';
    if (m < 60) return `πριν ${m} λεπτά`;
    const hrs = Math.round(m / 60);
    if (hrs < 24) return `πριν ${hrs} ${hrs === 1 ? 'ώρα' : 'ώρες'}`;
    const d = Math.round(hrs / 24);
    return `πριν ${d} ${d === 1 ? 'μέρα' : 'μέρες'}`;
  },
  plural(n, one, many) { return `${fmt.num(n)} ${n === 1 ? one : many}`; },
};
const SITE_SHORT = { sf: 'SF', st: 'ΣΤ' };
function siteName(site) { return (App.state && App.state.settings.sites[site].name) || site; }
function sitePill(site) { return h('span', { class: 'pill ' + site, title: siteName(site) }, siteName(site)); }

// ---------- activity (for the automatic lock) ----------
let lastInput = Date.now();
for (const ev of ['mousedown', 'keydown', 'wheel', 'touchstart']) document.addEventListener(ev, () => { lastInput = Date.now(); }, { passive: true, capture: true });

// ---------- API ----------
async function api(method, path, body) {
  const opt = { method, headers: { 'X-SFK': TOKEN, 'X-Client': CLIENT, 'X-Active': Date.now() - lastInput < 60000 ? '1' : '0' }, credentials: 'same-origin' };
  if (body !== undefined) { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); }
  let res;
  try { res = await fetch(path, opt); } catch (e) { throw new Error('Το πρόγραμμα δεν απαντά. Μήπως έκλεισε το μαύρο παράθυρο; Άνοιξέ το ξανά.'); }
  let data = null;
  try { data = await res.json(); } catch (_) { data = null; }
  if (res.status === 423) { showLock(); const e = new Error('Το πρόγραμμα είναι κλειδωμένο.'); e.locked = true; throw e; }
  if (res.status === 401 && data && data.login) { showLogin(); const e = new Error(data.error || 'Χρειάζεται σύνδεση.'); e.locked = true; throw e; }
  if (!res.ok) throw new Error((data && data.error) || ('Σφάλμα ' + res.status));
  return data;
}

// ---------- lock screen (PIN) ----------
let lockShown = false;
let lockWaiters = [];
function showLock(msg) {
  if (lockShown) return;
  lockShown = true;
  try { drawer.close(); modal.close(); } catch (_) { /* not ready yet */ }
  const err = h('div', { class: 'lock-err', role: 'alert' }, msg || '');
  const pin = h('input', { type: 'password', inputmode: 'numeric', autocomplete: 'current-password', placeholder: 'PIN', 'aria-label': 'PIN', autofocus: true });
  const go = async () => {
    err.textContent = '';
    const v = pin.value; pin.value = '';
    if (!v) { pin.focus(); return; }
    try {
      const r = await fetch('/api/unlock', { method: 'POST', headers: { 'X-SFK': TOKEN, 'Content-Type': 'application/json', 'X-Active': '1' }, body: JSON.stringify({ pin: v }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { err.textContent = d.error || 'Λάθος PIN.'; pin.focus(); return; }
      App.lockInfo = d;
      lastInput = Date.now();
      box.remove(); lockShown = false;
      const w = lockWaiters; lockWaiters = []; w.forEach((f) => f());
      if (App.state) { refreshState().then(() => App.route()).catch(() => {}); }
    } catch (e) { err.textContent = 'Το πρόγραμμα δεν απαντά.'; }
  };
  pin.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
  const box = h('div', { id: 'lock', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Κλειδωμένο' },
    h('div', { class: 'lock-card' },
      h('div', { class: 'lock-icon' }, icon('lock')),
      h('h1', null, 'SF Κέντρο'),
      h('p', null, 'Το πρόγραμμα είναι κλειδωμένο. Βάλε το PIN για να συνεχίσεις.'),
      pin, err,
      btn('Ξεκλείδωμα', { cls: 'primary block' }, go),
      h('p', { class: 'hint' }, 'Οι αυτόματες εργασίες (ανάγνωση, έρευνα τιμών) συνεχίζουν κανονικά όσο είναι κλειδωμένο.')));
  document.body.appendChild(box);
  setTimeout(() => pin.focus(), 50);
}
function whenUnlocked() { return lockShown ? new Promise((r) => lockWaiters.push(r)) : Promise.resolve(); }

// ---------- login (server mode) ----------
/** The login card; with setup = true, the very first start: create the administrator with the code from the server window. */
function showLogin(setup) {
  if (lockShown) return;
  lockShown = true;
  try { drawer.close(); modal.close(); } catch (_) { /* not ready yet */ }
  const err = h('div', { class: 'lock-err', role: 'alert' });
  const field = (label, attrs) => { const i = h('input', attrs); return [h('label', { class: 'field' }, label, i), i]; };
  const [fCode, code] = field('Κωδικός αρχικής ρύθμισης', { type: 'text', autocomplete: 'off', placeholder: 'XXXX-XXXX-XXXX' });
  const [fName, name] = field('Ονοματεπώνυμο', { type: 'text', autocomplete: 'name' });
  const [fUser, user] = field('Όνομα χρήστη', { type: 'text', autocomplete: 'username', autocapitalize: 'none', spellcheck: 'false' });
  const [fPass, pass] = field('Κωδικός', { type: 'password', autocomplete: setup ? 'new-password' : 'current-password' });
  const [fPass2, pass2] = field('Ξανά ο κωδικός', { type: 'password', autocomplete: 'new-password' });
  const remember = h('input', { type: 'checkbox' });
  const fRemember = h('label', { class: 'check', title: 'Για το κινητό σου: η σύνδεση κρατάει 12 ώρες χωρίς χρήση αντί για τα λεπτά της ασφάλειας. Όχι σε κοινόχρηστο υπολογιστή.' }, remember, 'Μείνε συνδεδεμένος σε αυτή τη συσκευή');
  const go = async () => {
    err.textContent = '';
    if (setup && pass.value !== pass2.value) { err.textContent = 'Οι δύο κωδικοί δεν είναι ίδιοι.'; return; }
    try {
      const r = await fetch(setup ? '/api/setup' : '/api/login', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-Client': CLIENT }, body: JSON.stringify(setup ? { code: code.value, name: name.value, user: user.value, password: pass.value } : { user: user.value, password: pass.value, remember: remember.checked }) });
      const d = await r.json().catch(() => ({}));
      pass.value = ''; pass2.value = '';
      if (!r.ok) { err.textContent = d.error || 'Δεν έγινε σύνδεση.'; (setup ? code : pass).focus(); return; }
      TOKEN = d.csrf; App.me = d.user; lastInput = Date.now();
      box.remove(); lockShown = false;
      const w = lockWaiters; lockWaiters = []; w.forEach((f) => f());
      if (App.state) { refreshState().then(() => App.route()).catch(() => {}); }
      live.start();
    } catch (e) { err.textContent = 'Ο διακομιστής δεν απαντά.'; }
  };
  for (const i of [code, name, user, pass, pass2]) i.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
  const box = h('div', { id: 'lock', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Σύνδεση' },
    h('form', { class: 'lock-card login', onsubmit: (e) => { e.preventDefault(); go(); } },
      h('div', { class: 'lock-icon' }, icon(setup ? 'shield' : 'lock')),
      h('h1', null, 'SF Κέντρο'),
      h('p', null, setup ? 'Πρώτη ρύθμιση: φτιάξε τον λογαριασμό του διαχειριστή. Ο κωδικός αρχικής ρύθμισης φαίνεται στο παράθυρο / στο log του διακομιστή.' : 'Συνδέσου με τον λογαριασμό σου. Τα δεδομένα είναι κοινά για όλους τους υπολογιστές.'),
      setup ? fCode : null, setup ? fName : null, fUser, fPass, setup ? fPass2 : null, setup ? null : fRemember, err,
      h('button', { type: 'submit', class: 'btn primary block' }, setup ? 'Δημιουργία και σύνδεση' : 'Σύνδεση'),
      h('p', { class: 'hint' }, setup ? 'Ο κωδικός θέλει τουλάχιστον 10 χαρακτήρες. Μετά, από τις Ρυθμίσεις → Χρήστες, προσθέτεις τους υπόλοιπους.' : 'Η σύνδεση λήγει μόνη της μετά από αδράνεια (Ρυθμίσεις → Ασφάλεια).')));
  document.body.appendChild(box);
  setTimeout(() => (setup ? code : user).focus(), 50);
}
async function logout() {
  try { await POST('/api/logout'); } catch (_) { /* already out */ }
  TOKEN = ''; App.me = null; live.stop();
  showLogin(false);
}

// ---------- live updates: what another PC (or the program itself) changes shows up here ----------
// Each view lists the data it shows; when it changes, the screen refreshes by itself — but never while
// you type, or while a window is open: then a small bar offers the refresh.
const VIEW_KEYS = {
  today: /./, products: /^(catalog-|links$|costs$|market$)/, checks: /^(catalog-|ignored$|links$|settings$)/, new: /^(drafts$|catalog-)/,
  suppliers: /^(suppliers$|orders$|pricelist-|supplier-)/, market: /^(market$|market-decisions$|competitors$|costs$|catalog-)/, settings: /^(settings$|users$)/, fixes: /^(fixes$|catalog-|enrich-cache$|pricelist-|links$|ignored$)/, flow: /^(fixes$|catalog-|market$|links$|ignored$|enrich-cache$)/,
};
const live = {
  es: null, pendingKeys: new Set(), bar: null, timer: null,
  start() {
    if (typeof EventSource === 'undefined') return;
    if (this.es && this.es.readyState !== 2) return; // 2 = closed (e.g. the session ended): open a new one
    this.es = null;
    const url = '/api/events?c=' + encodeURIComponent(CLIENT) + (MODE === 'server' ? '' : '&t=' + encodeURIComponent(TOKEN));
    this.es = new EventSource(url);
    // after a gap (phone asleep, Wi-Fi lost, server restarted) changes may have been missed: refresh once
    let opened = false;
    this.es.onopen = () => { if (opened) this.catchUp(); opened = true; };
    this.es.onmessage = (ev) => {
      let d; try { d = JSON.parse(ev.data); } catch (_) { return; }
      if (d.jobs) { clearTimeout(this.jt); this.jt = setTimeout(() => refreshState().catch(() => {}), 300); }
      if (d.keys && d.keys.length) { d.keys.forEach((k) => this.pendingKeys.add(k)); clearTimeout(this.timer); this.timer = setTimeout(() => this.apply(), 600); }
    };
  },
  stop() { if (this.es) { this.es.close(); this.es = null; } },
  /** Bring the screen up to date after a gap: the open view, the menu numbers, the running jobs. */
  catchUp() {
    refreshState().catch(() => {});
    this.pendingKeys.add('*');
    clearTimeout(this.timer); this.timer = setTimeout(() => this.apply(), 300);
  },
  busy() {
    const a = document.activeElement;
    return drawer.isOpen() || modal.isOpen() || lockShown || (a && a.matches && a.matches('input, textarea, select, [contenteditable]')) || Date.now() - lastInput < 2500 || !!document.querySelector('.bulkbar:not(.hidden)');
  },
  apply() {
    const keys = [...this.pendingKeys];
    if (!keys.length) return;
    const view = parseHash().view;
    const re = keys.includes('*') ? /./ : VIEW_KEYS[view] || VIEW_KEYS.today;
    refreshBadges();
    if (keys.some((k) => /^(settings|catalog-)/.test(k))) refreshState().catch(() => {});
    if (!keys.some((k) => re.test(k))) { this.pendingKeys.clear(); return; }
    if (this.busy()) { this.showBar(); clearTimeout(this.timer); this.timer = setTimeout(() => this.apply(), 4000); return; }
    this.pendingKeys.clear(); this.hideBar();
    const y = window.scrollY;
    App.route().then(() => window.scrollTo(0, y));
  },
  showBar() {
    if (this.bar) return;
    this.bar = h('div', { class: 'livebar', role: 'status' }, icon('sync'), h('span', null, 'Υπάρχουν νέα στοιχεία (από άλλον υπολογιστή ή αυτόματη εργασία).'),
      h('button', { type: 'button', class: 'btn sm', onclick: () => { this.pendingKeys.clear(); this.hideBar(); const y = window.scrollY; App.route().then(() => window.scrollTo(0, y)); } }, 'Ανανέωση'));
    document.body.appendChild(this.bar);
  },
  hideBar() { if (this.bar) { this.bar.remove(); this.bar = null; } },
};

// back to the program (phone unlocked, tab shown again): catch up after a pause of 30 s or more, and make
// sure the live connection is there (phones close it while asleep)
let hiddenAt = 0;
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { hiddenAt = Date.now(); return; }
  if (!App.state || lockShown) return;
  live.start();
  if (hiddenAt && Date.now() - hiddenAt > 30000) live.catchUp();
});

// Android/Chrome over https offers "install": kept for the button in Settings → Phone
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); App.installPrompt = e; });
window.addEventListener('appinstalled', () => { App.installPrompt = null; });
/** Opened from the home screen (installed), not in a browser tab. */
function installed() { return !!(window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true; }

/** A QR code (rows of 0/1 from the program) as a crisp SVG, with the white border scanners need. */
function qrSvg(m, px) {
  const NS = 'http://www.w3.org/2000/svg', q = 4, n = m.size + q * 2;
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${n} ${n}`); svg.setAttribute('width', px || 200); svg.setAttribute('height', px || 200);
  svg.setAttribute('shape-rendering', 'crispEdges'); svg.setAttribute('class', 'qr'); svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', 'QR');
  const bg = document.createElementNS(NS, 'rect'); bg.setAttribute('width', n); bg.setAttribute('height', n); bg.setAttribute('fill', '#fff'); svg.appendChild(bg);
  let d = '';
  m.rows.forEach((row, y) => { for (let x = 0; x < row.length; x++) if (row[x] === '1') d += `M${x + q} ${y + q}h1v1h-1z`; });
  const path = document.createElementNS(NS, 'path'); path.setAttribute('d', d); path.setAttribute('fill', '#111'); svg.appendChild(path);
  return svg;
}

/** A web page (shop, supplier, report): in a new tab. Local mode: the program opens it in Chrome. */
function openUrl(url) {
  if (!url) return Promise.resolve();
  if (MODE === 'server') { window.open(url, '_blank', 'noopener,noreferrer'); return Promise.resolve(); }
  return POST('/api/open', { kind: 'url', url }).catch(fail);
}
/** A file the program made: local mode shows it in its folder, server mode downloads it. */
function openFile(r) {
  if (MODE === 'server' || !r.file) { const a = h('a', { href: r.url, download: r.name || '' }); document.body.appendChild(a); a.click(); a.remove(); return Promise.resolve(); }
  return POST('/api/open', { kind: 'file', path: r.file }).catch(fail);
}
// lock by itself after the chosen minutes without mouse/keyboard (the program enforces the same limit)
setInterval(() => {
  const li = App.lockInfo;
  if (MODE === 'server' || !li || !li.pin || lockShown) return;
  if (Date.now() - lastInput > (li.lockMinutes || 30) * 60000) { POST('/api/lock').catch(() => {}); showLock(); }
}, 20000);
const GET = (p, q) => api('GET', p + (q ? '?' + new URLSearchParams(Object.entries(q).filter(([, v]) => v !== '' && v != null)).toString() : ''));
const POST = (p, b) => api('POST', p, b || {});

// ---------- toasts ----------
function toast(msg, opts) {
  opts = opts || {};
  const t = h('div', { class: 'toast' + (opts.err ? ' err' : '') }, h('div', { class: 't-body' }, msg), opts.action ? h('button', { onclick: () => { opts.action.fn(); t.remove(); }, style: { opacity: 1, fontWeight: 650, textDecoration: 'underline' } }, opts.action.label) : null, h('button', { onclick: () => t.remove(), 'aria-label': 'Κλείσιμο' }, '✕'));
  $('#toasts').appendChild(t);
  setTimeout(() => t.remove(), opts.err ? 9000 : (opts.ms || 4500));
}
function fail(e) { if (e && e.locked) return; toast(e && e.message ? e.message : String(e), { err: true }); }

// ---------- drawer / modal ----------
function layer(id) {
  const root = $('#' + id);
  const panel = root.querySelector('section');
  return {
    open(content, o) {
      clear(panel); panel.className = (id === 'drawer' ? 'drawer-panel' : 'modal-panel') + (o && o.wide ? ' wide' : '');
      add(panel, [content]); root.setAttribute('aria-hidden', 'false'); document.body.style.overflow = 'hidden';
      this.onClose = o && o.onClose;
      setTimeout(() => { const f = panel.querySelector('[autofocus], input, select, textarea, button'); if (f) f.focus(); }, 30);
    },
    close() { root.setAttribute('aria-hidden', 'true'); clear(panel); if (!$('#drawer[aria-hidden="false"]') && !$('#modal[aria-hidden="false"]')) document.body.style.overflow = ''; const cb = this.onClose; this.onClose = null; if (cb) cb(); },
    isOpen() { return root.getAttribute('aria-hidden') === 'false'; },
    panel,
  };
}
const drawer = layer('drawer');
const modal = layer('modal');
document.addEventListener('click', (e) => {
  if (e.target.matches('#drawer [data-close]')) drawer.close();
  if (e.target.matches('#modal [data-close]')) modal.close();
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { if (modal.isOpen()) modal.close(); else if (drawer.isOpen()) drawer.close(); } });
function dlgHead(title, sub, which) {
  return h('div', { class: 'dlg-head' }, h('div', null, h('h2', null, title), sub ? h('p', { class: 'muted', style: { margin: '4px 0 0' } }, sub) : null), h('button', { class: 'x', 'aria-label': 'Κλείσιμο', onclick: () => (which || modal).close() }, icon('x')));
}
function confirmBox(title, text, okLabel, danger) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    modal.open(h('div', null, dlgHead(title), text ? h('p', { class: 'muted' }, text) : null,
      h('div', { class: 'dlg-foot' }, btn('Άκυρο', () => { modal.close(); }), btn(okLabel || 'Εντάξει', { cls: danger ? 'primary danger' : 'primary' }, () => { finish(true); modal.close(); }))), { onClose: () => finish(false) });
  });
}

/** After a WooCommerce file is created: where it is and how to import it. */
function fileReady(r, opts) {
  opts = opts || {};
  const site = opts.site || r.site;
  const base = App.state.settings.sites[site] ? App.state.settings.sites[site].url.replace(/\/+$/, '') : '';
  const update = opts.kind !== 'new';
  const importUrl = base ? base + '/wp-admin/edit.php?post_type=product&page=product_importer' : '';
  modal.open(h('div', null,
    dlgHead(opts.title || 'Το αρχείο είναι έτοιμο', `${fmt.plural(r.count || 0, 'γραμμή', 'γραμμές')} · για το ${siteName(site)}`),
    h('div', { class: 'note ok' }, MODE === 'server' ? ['Έτοιμο: ', h('b', null, r.name), ' — πάτα «Λήψη» για να το κατεβάσεις σε αυτόν τον υπολογιστή.'] : ['Αποθηκεύτηκε: ', h('span', { class: 'mono' }, r.file)]),
    opts.report ? null : h('div', { style: { marginTop: '14px' } },
      h('h3', { style: { fontSize: '15px', marginBottom: '8px' } }, 'Ανέβασμα στο WooCommerce'),
      h('ol', { class: 'steps' },
        h('li', null, 'Άνοιξε ', importUrl ? h('a', { href: '#', onclick: (e) => { e.preventDefault(); App.openUrl(importUrl); } }, 'Προϊόντα → Εισαγωγή') : 'Προϊόντα → Εισαγωγή', ' στο ' + siteName(site) + '.'),
        h('li', null, 'Επίλεξε το αρχείο από τον φάκελο που άνοιξε.'),
        update ? h('li', null, h('b', null, 'Τσέκαρε «Ενημέρωση υπαρχόντων προϊόντων»'), ' (αλλιώς θα φτιαχτούν διπλά).') : h('li', null, 'Μην τσεκάρεις «Ενημέρωση υπαρχόντων προϊόντων».'),
        h('li', null, 'Συνέχεια → Εκτέλεση. Μετά πάτα «Ανάγνωση» εδώ για να φανούν οι αλλαγές.'))),
    r.skipped && r.skipped.length ? h('div', { class: 'note warn', style: { marginTop: '14px' } }, h('b', null, `Παραλείφθηκαν ${r.skipped.length}:`), h('ul', { style: { margin: '6px 0 0', paddingLeft: '18px' } }, r.skipped.slice(0, 12).map((s) => h('li', null, s.name + ' — ' + s.why)))) : null,
    r.newCategories && r.newCategories.length ? h('div', { class: 'note', style: { marginTop: '10px' } }, h('b', null, 'Θα δημιουργηθούν νέες κατηγορίες: '), r.newCategories.slice(0, 10).join(', '), r.newCategories.length > 10 ? '…' : '', h('div', { class: 'hint' }, 'Αν υπάρχουν με άλλο όνομα, αντιστοίχισέ τες στις Ρυθμίσεις → Κατηγορίες και φτιάξε ξανά το αρχείο.')) : null,
    h('div', { class: 'dlg-foot' },
      MODE === 'server' ? null : btn('Άνοιγμα φακέλου', { icon: 'folder' }, () => openFile(r)),
      h('a', { class: 'btn', href: r.url, download: r.name }, icon('download'), 'Λήψη'),
      btn('Κλείσιμο', { cls: 'primary' }, () => modal.close()))), { wide: false });
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] || '');
    r.onerror = () => reject(new Error('Δεν διαβάστηκε το αρχείο.'));
    r.readAsDataURL(file);
  });
}
function dropZone(text, accept, onFile) {
  const input = h('input', { type: 'file', accept, class: 'sr', onchange: () => { if (input.files[0]) onFile(input.files[0]); } });
  const z = h('label', { class: 'drop' }, input, h('div', null, icon('upload')), h('div', null, text), h('div', { class: 'hint' }, 'Σύρε το αρχείο εδώ ή πάτα για επιλογή'));
  z.addEventListener('dragover', (e) => { e.preventDefault(); z.classList.add('over'); });
  z.addEventListener('dragleave', () => z.classList.remove('over'));
  z.addEventListener('drop', (e) => { e.preventDefault(); z.classList.remove('over'); if (e.dataTransfer.files[0]) onFile(e.dataTransfer.files[0]); });
  return z;
}
function thumb(src, cls) {
  if (!src) return h('div', { class: 'thumb none ' + (cls || '') }, '—');
  const i = h('img', { class: 'thumb ' + (cls || ''), src, loading: 'lazy', alt: '', referrerpolicy: 'no-referrer' });
  i.onerror = () => i.replaceWith(h('div', { class: 'thumb none ' + (cls || '') }, '—'));
  return i;
}
function sandboxPreview(html) {
  const f = h('iframe', { class: 'preview', sandbox: '', title: 'Προεπισκόπηση' });
  f.srcdoc = '<!doctype html><meta charset="utf-8"><style>body{font:14px/1.6 "Segoe UI",system-ui,sans-serif;color:#222;margin:14px;}h2{font-size:18px}ul{padding-left:20px}table{border-collapse:collapse}td,th{border:1px solid #ddd;padding:4px 8px}</style>' + (html || '<p style="color:#999">Χωρίς περιγραφή</p>');
  return f;
}
function copyText(t) {
  if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(t).then(() => toast('Αντιγράφηκε.'), () => toast('Δεν έγινε αντιγραφή.', { err: true }));
  // plain http inside the shop network: the browser has no clipboard API there, so the old way
  const ta = h('textarea', { readOnly: true, style: { position: 'fixed', top: '0', opacity: '0' } }, t);
  document.body.appendChild(ta); ta.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch (_) { /* not allowed */ }
  ta.remove();
  toast(ok ? 'Αντιγράφηκε.' : 'Δεν έγινε αντιγραφή.', ok ? null : { err: true });
  return Promise.resolve();
}
function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
function select(options, value, onchange, attrs) {
  const s = h('select', Object.assign({ onchange: (e) => onchange && onchange(e.target.value) }, attrs || {}), options.map((o) => (Array.isArray(o) ? h('option', { value: o[0] }, o[1]) : h('option', { value: o }, o))));
  s.value = value == null ? '' : value;
  return s;
}
function seg(options, value, onchange) {
  const wrap = h('div', { class: 'seg', role: 'group' });
  for (const [v, label] of options) wrap.appendChild(h('button', { type: 'button', 'aria-pressed': String(v === value), onclick: () => { $$('button', wrap).forEach((b) => b.setAttribute('aria-pressed', 'false')); wrap.querySelector(`[data-v="${v}"]`).setAttribute('aria-pressed', 'true'); onchange(v); }, dataset: { v } }, label));
  return wrap;
}
function pageHead(title, sub, actions) {
  return h('div', { class: 'page-head' }, h('div', null, h('h1', null, title), sub ? h('p', null, sub) : null), actions ? h('div', { class: 'page-actions' }, actions) : null);
}

// ---------- jobs ----------
const watching = new Map();
function watchJob(job, handlers) {
  handlers = handlers || {};
  if (!job || !job.id) return;
  if (watching.has(job.id)) { Object.assign(watching.get(job.id).h, handlers); return; }
  watching.set(job.id, { job, h: handlers });
  renderJobs();
  const tick = async () => {
    let j;
    try { j = await GET('/api/jobs/' + job.id); } catch (e) { watching.delete(job.id); renderJobs(); return; }
    const w = watching.get(job.id);
    if (!w) return;
    w.job = j; renderJobs();
    if (w.h.progress) w.h.progress(j);
    if (j.status === 'running') { setTimeout(tick, 800); return; }
    watching.delete(job.id); renderJobs();
    if (j.status === 'done') { w.h.done ? w.h.done(j.result, j) : toast(j.label + ': ολοκληρώθηκε.'); }
    else if (j.status === 'cancelled') toast(j.label + ': σταμάτησε.');
    else { if (w.h.error) w.h.error(j.error); else toast(j.label + ': ' + j.error, { err: true }); }
    if (w.h.always) w.h.always(j);
  };
  setTimeout(tick, 500);
}
function renderJobs() {
  const box = $('#jobs');
  clear(box);
  try { renderNav(parseHash().view); } catch (_) { /* before start */ }
  for (const { job } of watching.values()) {
    const pct = job.total ? Math.min(100, Math.round(job.done / job.total * 100)) : 0;
    box.appendChild(h('div', { class: 'jobcard' },
      h('div', { class: 'row', style: { justifyContent: 'space-between' } }, h('b', null, job.label), h('button', { class: 'x', style: { color: 'inherit', padding: '2px' }, title: 'Διακοπή', onclick: () => POST('/api/jobs/cancel', { id: job.id }) }, icon('x'))),
      h('div', { class: 'progress' + (job.total ? '' : ' indet') }, h('i', { style: { width: pct + '%' } })),
      h('div', { class: 'msg', title: job.msg }, job.total ? `${job.done}/${job.total} · ${job.msg}` : job.msg)));
  }
}

/** Report buttons: the interactive page opens in a Chrome tab; Excel for exports. */
function reportButtons(kind, params, label) {
  const run = (format) => {
    // server mode: the tab opens now (on the click), the page goes into it when ready — no popup blocker
    const win = MODE === 'server' && format === 'html' ? window.open('about:blank', '_blank') : null;
    return POST('/api/report', Object.assign({ kind, format, open: MODE !== 'server' }, params || {})).then((r) => {
      if (MODE === 'server') {
        if (format === 'html') { if (win) { win.opener = null; win.location.href = r.view; } else window.open(r.view, '_blank', 'noopener'); toast(`Η σελίδα άνοιξε σε νέα καρτέλα (${fmt.plural(r.rows, 'γραμμή', 'γραμμές')}).`); }
        else { openFile(r); toast(`Το Excel κατεβαίνει (${fmt.plural(r.rows, 'γραμμή', 'γραμμές')}).`); }
        return;
      }
      if (format === 'html') toast(`Η σελίδα άνοιξε σε καρτέλα του browser (${fmt.plural(r.rows, 'γραμμή', 'γραμμές')}).`, { ms: 9000, action: { label: 'Δεν άνοιξε; Πάτα εδώ', fn: () => { const w = window.open(r.view, '_blank', 'noopener'); if (!w) App.openUrl(r.view); } } });
      else toast(`Το Excel άνοιξε (${fmt.plural(r.rows, 'γραμμή', 'γραμμές')}).`, { action: { label: 'Φάκελος', fn: () => openFile(r) } });
    }).catch((e) => { if (win) win.close(); fail(e); });
  };
  return h('div', { class: 'repbtns', role: 'group' },
    h('button', { type: 'button', class: 'main', title: (label && label !== 'Λήψη' && label !== 'Λίστα' ? label + ': ' : '') + 'ανοίγει σε καρτέλα του Chrome, με φωτογραφίες, φίλτρα, αναζήτηση και λεπτομέρειες', onclick: () => run('html') }, icon('ext'), 'Άνοιγμα σελίδας'),
    h('button', { type: 'button', title: 'Excel με μορφοποίηση, φίλτρα και συνδέσμους (για εξαγωγή)', onclick: () => run('xlsx') }, 'Excel'));
}
const AD = { banned: 'Όχι διαφήμιση', google: 'Όχι Google', caution: 'Προσοχή', meta18: 'Meta 18+', ok: 'Διαφήμιση ΟΚ' };
function adPill(level, why) { return level && level !== 'ok' ? h('span', { class: 'ad ' + level, title: why || '' }, AD[level] || level) : null; }

function startSync(sites, full) {
  return POST('/api/sync', { sites, full: !!full }).then((job) => {
    watchJob(job, {
      done: (res) => {
        const errs = Object.entries(res || {}).filter(([, v]) => v && v.error);
        const ok = Object.entries(res || {}).filter(([, v]) => v && !v.error);
        if (ok.length) toast('Διαβάστηκαν: ' + ok.map(([s, v]) => `${siteName(s)} ${fmt.num(v.count)} προϊόντα`).join(', '));
        for (const [s, v] of errs) toast(`${siteName(s)}: ${v.error}`, { err: true, action: { label: 'Εισαγωγή CSV', fn: () => App.csvImport(s) } });
        refreshState().then(() => App.route());
      },
      error: (e) => { toast(e, { err: true, action: { label: 'Εισαγωγή CSV', fn: () => App.csvImport('sf') } }); refreshState(); },
    });
  }).catch(fail);
}

// ---------- router & shell ----------
const NAV = [
  ['today', 'Σήμερα', 'today'], ['flow', 'Ροή εργασίας', 'bolt'], ['fixes', 'Διορθώσεις', 'fixes'], ['products', 'Προϊόντα', 'products'], ['checks', 'Έλεγχοι καταλόγου', 'checks'], ['new', 'Νέα προϊόντα', 'new'],
  ['suppliers', 'Αντιπρόσωποι', 'suppliers'], ['market', 'Τιμές αγοράς', 'market'], ['settings', 'Ρυθμίσεις', 'settings'],
];
function parseHash() {
  const raw = location.hash.replace(/^#\/?/, '');
  const [view, qs] = raw.split('?');
  return { view: view || 'today', params: Object.fromEntries(new URLSearchParams(qs || '')) };
}
function go(view, params) {
  const qs = params ? new URLSearchParams(Object.entries(params).filter(([, v]) => v !== '' && v != null)).toString() : '';
  const target = '#/' + view + (qs ? '?' + qs : '');
  if (location.hash === target) App.route(); else location.hash = target;
}
// phone: the four screens used most, at the bottom; everything else in the menu sheet (the sidebar)
const TABS = ['today', 'flow', 'fixes', 'market'];
const SHORT = { today: 'Σήμερα', flow: 'Ροή', fixes: 'Διορθώσεις', market: 'Τιμές', products: 'Προϊόντα' };
function renderNav(active) {
  const nav = clear($('#nav'));
  for (const [id, label, ic] of NAV) {
    const b = App.badges[id];
    nav.appendChild(h('a', { class: 'nav-item', href: '#/' + id, 'aria-current': id === active ? 'page' : null }, icon(ic), h('span', null, label), b ? h('span', { class: 'badge ' + (b.cls || '') }, b.n) : null));
  }
  const tb = $('#tabbar');
  if (tb) {
    clear(tb);
    for (const id of TABS) {
      const item = NAV.find((x) => x[0] === id);
      const b = App.badges[id];
      tb.appendChild(h('a', { href: '#/' + id, 'aria-current': id === active ? 'page' : null }, h('span', { class: 'ic' }, icon(item[2]), b ? h('span', { class: 'badge ' + (b.cls || '') }, b.n) : null), h('span', null, SHORT[id])));
    }
    const other = NAV.filter(([id]) => !TABS.includes(id)).some(([id]) => id === active);
    const moreBadge = NAV.filter(([id]) => !TABS.includes(id)).map(([id]) => App.badges[id]).find(Boolean);
    tb.appendChild(h('button', { type: 'button', 'aria-current': other ? 'page' : null, 'aria-label': 'Όλο το μενού', onclick: () => menu.toggle() }, h('span', { class: 'ic' }, icon('menu'), moreBadge ? h('span', { class: 'badge dot ' + (moreBadge.cls || '') }) : null), h('span', null, 'Μενού')));
  }
  const mb = $('#mbar');
  if (mb) {
    const item = NAV.find((x) => x[0] === active) || NAV[0];
    const running = [...watching.values()].length;
    clear(mb).appendChild(h('div', { class: 'mbar-in' },
      h('button', { type: 'button', class: 'x', 'aria-label': 'Μενού', onclick: () => menu.toggle() }, icon('menu')),
      h('b', null, item[1]),
      running ? h('button', { type: 'button', class: 'mjob', title: 'Εργασίες σε εξέλιξη', onclick: () => menu.open() }, h('i', { class: 'spin' }), String(running)) : null,
      App.MODE === 'server' && App.state && App.state.user ? h('button', { type: 'button', class: 'mme', title: App.state.user.name, onclick: () => menu.open() }, (App.state.user.name || '?').trim().charAt(0).toUpperCase()) : null));
  }
}
// the sidebar as a sheet on phones
const menu = {
  open() { document.body.classList.add('menu-open'); },
  close() { document.body.classList.remove('menu-open'); },
  toggle() { document.body.classList.toggle('menu-open'); },
};
document.addEventListener('click', (e) => { if (e.target.matches('[data-close-menu]') || e.target.closest('#nav a')) menu.close(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') menu.close(); });
function renderSyncBox() {
  const box = clear($('#syncbox'));
  if (!App.state) return;
  const s = App.state.summary;
  box.appendChild(h('div', { class: 'syncbox' },
    ['sf', 'st'].map((site) => h('div', { class: 'site' }, h('b', null, s[site].name), h('span', { title: fmt.dateTime(s[site].syncedAt) }, s[site].syncedAt ? fmt.ago(s[site].syncedAt) : 'όχι ακόμα'))),
    MODE === 'server' && App.state.user ? h('div', { class: 'whoami' }, icon('user'), h('span', null, App.state.user.name, App.state.user.role === 'admin' ? h('small', null, ' · διαχειριστής') : null), h('button', { type: 'button', class: 'x', title: 'Αποσύνδεση', onclick: logout }, icon('logout'))) : null,
    MODE !== 'server' && App.lockInfo && App.lockInfo.pin ? btn('Κλείδωμα τώρα', { cls: 'sm block', icon: 'lock', title: 'Κλειδώνει το πρόγραμμα· ξεκλειδώνει με το PIN' }, () => POST('/api/lock').then(() => showLock()).catch(() => showLock())) : null,
    btn('Ανάγνωση από τα sites', { cls: 'sm block', icon: 'sync', title: 'Διαβάζει μόνο ό,τι άλλαξε (δευτερόλεπτα). Μία φορά την εβδομάδα γίνεται μόνη της πλήρης ανάγνωση.' }, () => startSync()),
    h('button', { type: 'button', class: 'linkish', title: 'Ξαναδιαβάζει όλα τα προϊόντα και τις παραλλαγές (λίγα λεπτά)', onclick: () => startSync(null, true) }, 'πλήρης ανάγνωση')));
}
async function refreshState() {
  App.state = await GET('/api/state');
  App.me = App.state.user || null;
  renderSyncBox();
  renderInstanceWarning();
  for (const j of App.state.jobs || []) watchJob(j, j.type === 'sync' ? { done: () => refreshState().then(() => App.route()) } : {});
  return App.state;
}
/** Local mode: the same data folder open on another PC right now (e.g. OneDrive) loses changes — say so. */
function renderInstanceWarning() {
  const old = $('#instwarn'); if (old) old.remove();
  const other = (App.state && App.state.instances) || [];
  if (!other.length) return;
  document.body.appendChild(h('div', { id: 'instwarn', class: 'livebar warn', role: 'alert' }, icon('alert'),
    h('span', null, `Ο ίδιος φάκελος δεδομένων είναι ανοιχτός και στον υπολογιστή «${other.map((x) => x.host).join(', ')}». Έτσι χάνονται αλλαγές. Κράτα το πρόγραμμα ανοιχτό σε έναν υπολογιστή ή χρησιμοποίησε τη λειτουργία διακομιστή (κοινή για όλους).`)));
}
async function refreshBadges() {
  try {
    const d = await GET('/api/dashboard');
    App.badges = {};
    if (d.kpi.critical) App.badges.checks = { n: d.kpi.critical, cls: 'crit' };
    else if (d.kpi.high) App.badges.checks = { n: d.kpi.high };
    if (d.kpi.drafts) App.badges.new = { n: d.kpi.drafts };
    if (d.kpi.fixes) App.badges.fixes = { n: d.kpi.fixes, cls: 'coy' };
    if (d.kpi.flowOpen) App.badges.flow = { n: d.kpi.flowOpen };
    renderNav(parseHash().view);
    return d;
  } catch (_) { return null; }
}
App.route = async function () {
  const { view, params } = parseHash();
  const v = App.views[view] || App.views.today;
  menu.close();
  renderNav(view);
  // a fresh <main> for every screen: a screen still loading (slow call) never draws over the one opened after it
  const main = h('main', { id: 'main', tabindex: '-1' });
  $('#main').replaceWith(main);
  if (drawer.isOpen()) drawer.close();
  if (modal.isOpen()) modal.close(); // a dialog of the previous screen never stays over the new one
  try { await v.render(main, params); } catch (e) { main.appendChild(h('div', { class: 'note crit' }, e.message)); console.error(e); }
  if (main.isConnected) main.focus({ preventScroll: true });
};

Object.assign(App, { qrSvg, installed, menu, MODE, live, showLogin, logout, openUrl, openFile, showLock, whenUnlocked, reportButtons, adPill, AD, h, add, clear, $, $$, icon, btn, fmt, api, GET, POST, toast, fail, drawer, modal, dlgHead, confirmBox, fileReady, fileToBase64, dropZone, thumb, sandboxPreview, copyText, debounce, select, seg, pageHead, watchJob, startSync, go, refreshState, refreshBadges, siteName, sitePill, SITE_SHORT, parseHash });
