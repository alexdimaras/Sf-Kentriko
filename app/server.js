'use strict';
// SF Κέντρο — back-office app.
//  • Local mode (default): a small web server on this PC only (127.0.0.1); the screen opens in Edge app mode.
//    Close the black window to exit.
//  • Server mode (SFK_MODE=server): one copy of the program, in the cloud or on one shop PC, and every PC opens
//    it in a browser with its own user name and password. All PCs see the same data at once (live updates).
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn, execFile } = require('child_process');

const VERSION = '1.3.0';
const PORT0 = Number(process.env.SFK_PORT) || 17321;
const MODE = process.env.SFK_MODE === 'server' ? 'server' : 'local';
const SERVER = MODE === 'server';
const BIND = process.env.SFK_HOST || (SERVER ? '0.0.0.0' : '127.0.0.1');
// server mode: the addresses people type (e.g. kentro.example.gr); empty = any (shop network)
const ALLOWED_HOSTS = String(process.env.SFK_ALLOWED_HOSTS || '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
const TRUST_PROXY = process.env.SFK_TRUST_PROXY === '1'; // behind Caddy / nginx: trust X-Forwarded-For / -Proto
const LOCAL_HOST = /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/i;

const store = require('./lib/store');
const settings = require('./lib/settings');
const catalog = require('./lib/catalog');
const checks = require('./lib/checks');
const jobs = require('./lib/jobs');
const suppliers = require('./lib/suppliers');
const pricelist = require('./lib/pricelist');
const market = require('./lib/market');
const drafts = require('./lib/drafts');
const extract = require('./lib/extract');
const wooexport = require('./lib/wooexport');
const localai = require('./lib/localai');
const dashboard = require('./lib/dashboard');
const reports = require('./lib/reports');
const supplierinfo = require('./lib/supplierinfo');
const security = require('./lib/security');
const supplierfind = require('./lib/supplierfind');
const users = require('./lib/users');
const fixes = require('./lib/fixes');
const U = require('./lib/util');
const { AsyncLocalStorage } = require('async_hooks');
const reqCtx = new AsyncLocalStorage(); // which browser tab caused a change (so it is not told about its own changes)

const TOKEN = crypto.randomBytes(18).toString('hex');
try { process.title = 'SF Kentro'; } catch (_) { /* ignore */ }
const PUBLIC = path.join(__dirname, 'public');
const MIME = { '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.csv': 'text/csv; charset=utf-8' };
let port = PORT0;

// ---------- helpers ----------
function send(res, code, body, type, extra) {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
  res.writeHead(code, Object.assign({ 'Content-Type': type || 'application/json; charset=utf-8', 'Content-Length': buf.length, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY' }, extra || {}));
  res.end(buf);
}
function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', (c) => { size += c.length; if (size > limit) { reject(new Error('Το αρχείο είναι πολύ μεγάλο.')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch (e) { reject(new Error('Λάθος δεδομένα.')); }
    });
    req.on('error', reject);
  });
}
function saveExport(name, content) {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  const m = String(name).match(/^(.*?)(\.[a-z0-9]+)?$/i);
  const base = m[1], ext = m[2] || '.csv';
  let fname = base + '-' + stamp + ext;
  for (let i = 2; fs.existsSync(store.exportPath(fname)); i++) fname = base + '-' + stamp + '-' + i + ext;
  const p = store.exportPath(fname);
  fs.writeFileSync(p, content);
  return { file: SERVER ? '' : p, name: fname, url: `/api/export/${encodeURIComponent(fname)}` + (SERVER ? '' : `?t=${TOKEN}`) };
}
function openPath(target, select) {
  if (SERVER) return; // nothing opens on the server: files are downloaded in the browser
  const opt = { detached: true, stdio: 'ignore', windowsHide: true };
  if (process.platform === 'win32') {
    const quoted = '"' + String(target).replace(/"/g, '') + '"';
    if (/^https?:\/\//i.test(target)) spawn('rundll32.exe', ['url.dll,FileProtocolHandler', target], opt).unref();
    else if (select) spawn('explorer.exe', ['/select,' + quoted], Object.assign({ windowsVerbatimArguments: true }, opt)).unref();
    else spawn('explorer.exe', [quoted], Object.assign({ windowsVerbatimArguments: true }, opt)).unref();
  } else if (process.platform === 'darwin') spawn('open', select ? ['-R', target] : [target], opt).unref();
  else spawn('xdg-open', [select ? path.dirname(target) : target], opt).on('error', () => {}).unref();
}
/** A web page in a tab of the person's Chrome (Edge or the default browser if Chrome is not installed). */
function openBrowser(url) {
  if (process.env.SFK_NO_OPEN || SERVER) return;
  try { url = new URL(url).href; } catch (_) { return; }
  if (!/^https?:\/\//i.test(url)) return;
  if (process.platform === 'win32') {
    const candidates = [
      path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    ];
    const exe = candidates.find((p) => { try { return fs.existsSync(p); } catch (_) { return false; } });
    if (exe) {
      try { spawn(exe, [url], { detached: true, stdio: 'ignore' }).on('error', () => openDefault(url)).unref(); return; } catch (_) { /* fall back */ }
    }
    return openDefault(url);
  }
  openDefault(url);
}
const reportKeys = new Map(); // report file -> key for its link

function openDefault(url) {
  try {
    if (process.platform === 'win32') spawn('rundll32.exe', ['url.dll,FileProtocolHandler', url], { detached: true, stdio: 'ignore', windowsHide: true }).on('error', (e) => console.error('open browser:', e.message)).unref();
    else spawn(process.platform === 'darwin' ? 'open' : 'xdg-open', [url], { detached: true, stdio: 'ignore' }).on('error', () => {}).unref();
  } catch (e) { console.error('open browser:', e.message); }
}
function openApp(url) {
  if (process.env.SFK_NO_OPEN || SERVER) return;
  if (process.platform === 'win32') {
    const candidates = [
      path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    ];
    const exe = candidates.find((p) => { try { return fs.existsSync(p); } catch (_) { return false; } });
    if (exe) {
      const profile = path.join(store.appConfigDir(), 'window');
      try {
        spawn(exe, ['--app=' + url, '--window-size=1440,920', '--user-data-dir=' + profile, '--no-first-run', '--no-default-browser-check', '--disable-features=Translate'], { detached: true, stdio: 'ignore' })
          .on('error', (e) => { console.error('Edge:', e.message); openDefault(url); }).unref();
      } catch (e) { console.error('Edge:', e.message); openDefault(url); }
    } else openDefault(url);
  } else if (process.platform === 'darwin') spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
  else spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).on('error', () => {}).unref();
}
const num = (v) => Number(v) || 0;

// ---------- API ----------
const routes = {
  'GET /api/state': (q, _, ctx) => ({ version: VERSION, mode: MODE, user: ctx.user || null, dataDir: SERVER ? '' : store.dir(), summary: catalog.summary(), settings: settings.all(), jobs: jobs.running(), strategies: settings.STRATEGIES, platform: process.platform, instances: SERVER ? [] : otherInstances() }),
  'GET /api/dashboard': () => dashboard.build(),

  // Sync
  'POST /api/sync': (b) => {
    const sites = (b.sites && b.sites.length ? b.sites : ['sf', 'st']).filter((x) => catalog.SITES.includes(x));
    return jobs.start('sync', b.full ? 'Πλήρης ανάγνωση προϊόντων' : 'Ανάγνωση προϊόντων', async (job) => {
      const out = {};
      const progress = catalog.makeProgress(job);
      // both shops at the same time: the total time is that of the bigger shop
      await Promise.all(sites.map(async (site) => {
        try { out[site] = await catalog.syncSite(site, job, { full: !!b.full, progress }); if (out[site]) job.log(`${settings.all().sites[site].name}: έτοιμο.`); } catch (e) { out[site] = { error: e.message }; job.log(`${settings.all().sites[site].name}: ${e.message}`); }
      }));
      checks.invalidate(); suppliers.resetIndex(); fixes.invalidate();
      if (sites.every((s) => out[s] && out[s].error)) throw new Error(sites.map((s) => out[s].error).join(' / '));
      market.recompute();
      return out;
    });
  },
  'POST /api/probe': async (b) => catalog.probe(b.site),
  'POST /api/csv/detect': (b) => { const d = catalog.csvDetect(U.decodeText(Buffer.from(b.base64 || '', 'base64'))); delete d.sample; return d; },
  'POST /api/csv/import': (b) => { const r = catalog.csvImport(b.site === 'st' ? 'st' : 'sf', U.decodeText(Buffer.from(b.base64 || '', 'base64')), b.mapping); checks.invalidate(); fixes.invalidate(); market.recompute(); return r; },
  'GET /api/history': () => store.read('history', []),

  // Products
  'GET /api/products': (q) => catalog.productsView(q),
  'GET /api/product': (q) => catalog.productDetail(q.site === 'st' ? 'st' : 'sf', q.id) || Promise.reject(new Error('Δεν βρέθηκε το προϊόν.')),
  'POST /api/link': (b) => { catalog.setManualLink(num(b.sfId), b.stId === null ? null : num(b.stId)); checks.invalidate(); fixes.invalidate(); return { ok: true }; },
  'GET /api/categories': (q) => { const site = q.site === 'st' ? 'st' : 'sf'; const idx = catalog.categoryIndex(site); const lv = catalog.categoryAdLevels(site); return idx.cats.map((c) => ({ id: c.id, name: c.name, parent: c.parent, count: c.count, path: idx.pathOf(c.id).join(' › '), ads: lv.get(c.id) || 'ok', regulated: lv.get(c.id) === 'banned' })).sort((a, b) => a.path.localeCompare(b.path, 'el')); },
  'GET /api/brands': () => catalog.brandsList(),
  'GET /api/attributes': (q) => catalog.attributeNames(q.site === 'st' ? 'st' : 'sf'),
  'GET /api/search-other': (q) => {
    const site = q.site === 'st' ? 'st' : 'sf';
    const term = U.foldKey(q.q || '').split(' ').filter(Boolean);
    if (!term.length) return [];
    return catalog.load(site).products.filter((p) => p.type !== 'variation').filter((p) => { const h = U.foldKey(p.name + ' ' + p.sku); return term.every((t) => h.includes(t)); }).slice(0, 15).map((p) => ({ id: p.id, name: p.name, sku: p.sku, price: p.price }));
  },

  // Checks
  'GET /api/checks': (q) => { const r = checks.cached(q.force === '1'); return { counts: r.counts, at: r.at, checks: r.checks.map((c) => Object.assign({}, c, { items: c.items.slice(0, Number(q.limit) || 400), total: c.items.length })) }; },
  'GET /api/check': (q) => { const r = checks.cached(); const c = r.checks.find((x) => x.id === q.id); if (!c) throw new Error('Δεν βρέθηκε ο έλεγχος.'); return c; },
  'POST /api/checks/fix': (b) => { const r = checks.fixFile(b.id, b.ids, b.overrides); const f = saveExport(r.name, r.csv); return Object.assign({ count: r.count, site: r.site, skipped: r.skipped || [], newCategories: r.newCategories || [], note: r.note || '' }, f); },
  'POST /api/checks/ignore': (b) => { checks.setIgnored(b.id, (b.keys || []).map(String), b.on !== false); checks.invalidate(); fixes.invalidate(); return { ok: true }; },

  // Fixes waiting for approval: everything the program can correct by itself, filled in here (never on the sites)
  'GET /api/fixes': (q) => fixes.view(q),
  'POST /api/fixes/decide': (b, _, ctx) => fixes.decide(b.ids || [], b.status, ctx.user ? ctx.user.name : '', b.edited),
  'POST /api/fixes/approve-sure': (b, _, ctx) => fixes.approveSure(b.site === 'st' ? 'st' : b.site === 'sf' ? 'sf' : '', b.group || '', ctx.user ? ctx.user.name : ''),
  'POST /api/fixes/export': (b, _, ctx) => { const site = b.site === 'st' ? 'st' : 'sf'; const r = fixes.exportFile(site, ctx.user ? ctx.user.name : ''); return Object.assign({ count: r.count, products: r.products, changes: r.changes, site, gtin: r.gtin }, saveExport(r.name, r.csv)); },
  'POST /api/fixes/find': (b) => jobs.start('fixes', 'Αναζήτηση στοιχείων στους αντιπροσώπους', (job) => fixes.findSources(job, { maxPages: Math.min(1000, Number(b.maxPages) || 150) })),
  'POST /api/fixes/page': (b) => fixes.fromPage(b.site === 'st' ? 'st' : 'sf', b.id, b.url),
  'POST /api/fixes/translate': (b) => fixes.translate(b.site === 'st' ? 'st' : 'sf', b.id),
  'GET /api/checks/ignored': (q) => checks.ignoredItems(q.id),
  // Reports: interactive page (HTML) and formatted Excel
  'POST /api/report': async (b) => {
    const rep = reports.build(b.kind, b);
    const fmt = b.format === 'xlsx' ? 'xlsx' : 'html';
    const content = fmt === 'xlsx' ? await reports.xlsx(rep) : reports.html(rep);
    const f = saveExport((rep.file || 'anafora') + '.' + fmt, content);
    let view = '';
    if (fmt === 'html') {
      // shown in a browser tab, with a one-off key for this page only
      const k = crypto.randomBytes(18).toString('hex');
      reportKeys.set(f.name, k);
      view = `/r/${encodeURIComponent(f.name)}?k=${k}`;
      if (b.open) openBrowser(`http://127.0.0.1:${port}${view}`);
    } else if (b.open) openPath(f.file);
    return Object.assign({ rows: rep.rows.length, format: fmt, view }, f);
  },

  // Suppliers
  'GET /api/suppliers': () => {
    const list = suppliers.list();
    const counts = {};
    for (const site of ['sf', 'st']) for (const p of catalog.load(site).products) {
      if (p.type === 'variation') continue;
      const s = suppliers.forProduct(p);
      if (s) { counts[s.id] = counts[s.id] || { sf: 0, st: 0 }; counts[s.id][site]++; }
    }
    const updates = store.read('supplier-updates', []);
    return { suppliers: list.map((s) => Object.assign(suppliers.view(s), { products: counts[s.id] || { sf: 0, st: 0 }, pricelist: pricelist.info(s.id), lastUpdate: updates.find((u) => u.supplierId === s.id) || null })), clashes: suppliers.brandClashes(list), brands: catalog.brandsList() };
  },
  // "fill in from the website": contact details, brands, feeds, B2B, catalog
  'POST /api/suppliers/lookup': (b) => supplierinfo.lookup(b.website),
  'POST /api/suppliers/b2b-test': async (b) => {
    const s = suppliers.get(b.id);
    if (!s) throw new Error('Δεν βρέθηκε ο αντιπρόσωπος.');
    const base = U.normUrl(s.b2bUrl || s.website);
    if (!base) throw new Error('Δώσε τη διεύθυνση του B2B.');
    await require('./lib/b2b').wpLogin(new URL(base).origin, s.b2bUser, require('./lib/secrets').reveal(s.b2bPass));
    return { ok: true };
  },
  'POST /api/suppliers/refresh': (b) => {
    const s = suppliers.get(b.id);
    if (!s) throw new Error('Δεν βρέθηκε ο αντιπρόσωπος.');
    return jobs.start('supplier-' + s.id, 'Ενημέρωση από ' + s.name, async (job) => { const r = await pricelist.refresh(s.id, job); checks.invalidate(); fixes.invalidate(); return r; });
  },
  // automatic search for suppliers, for approval
  'GET /api/supplierfind': () => supplierfind.view(),
  'POST /api/supplierfind/run': (b) => jobs.start('supplierfind', 'Αναζήτηση αντιπροσώπων', (job) => supplierfind.run(job, { brands: Array.isArray(b.brands) && b.brands.length ? b.brands : null, limit: Math.min(400, Number(b.limit) || 40) })),
  'POST /api/supplierfind/approve': (b) => { const r = supplierfind.approve(b.key, b.host); checks.invalidate(); fixes.invalidate(); return r; },
  'POST /api/supplierfind/reject': (b) => supplierfind.reject(b.key, b.host, !!b.never),
  'POST /api/supplierfind/dismiss': (b) => supplierfind.dismiss(b.key, !!b.undo),
  'POST /api/suppliers': (b) => { const r = suppliers.save(b); checks.invalidate(); fixes.invalidate(); return r; },
  'POST /api/suppliers/delete': (b) => { suppliers.remove(b.id); return { ok: true }; },
  'GET /api/orders': () => suppliers.orders(),
  'POST /api/orders': (b) => suppliers.saveOrder(b),
  'POST /api/orders/status': (b) => suppliers.setOrderStatus(b.id, b.status),
  'POST /api/orders/delete': (b) => { suppliers.removeOrder(b.id); return { ok: true }; },
  'GET /api/orders/email': (q) => { const o = suppliers.orders().find((x) => x.id === q.id); if (!o) throw new Error('Δεν βρέθηκε.'); return suppliers.orderEmail(o); },

  // Price lists
  'POST /api/pricelist/preview': (b) => pricelist.preview(b.supplierId, b),
  'POST /api/pricelist/import': (b) => { const r = pricelist.importList(b.supplierId, b); fixes.invalidate(); return r; },
  'GET /api/pricelist/compare': (q) => pricelist.compare(q.supplierId, q.site) || Promise.reject(new Error('Δεν έχει φορτωθεί τιμοκατάλογος για αυτόν τον αντιπρόσωπο.')),
  'POST /api/pricelist/export': (b) => {
    const cmp = pricelist.compare(b.supplierId, b.site);
    if (!cmp) throw new Error('Δεν υπάρχει τιμοκατάλογος.');
    const want = new Set(b.keys || []);
    const cat = catalog.load(cmp.site);
    const rows = [];
    for (const r of cmp.rows) {
      if (!want.has(r.key) || !r.match || !(r.retail > 0)) continue;
      const p = cat.products.find((x) => x.id === r.match.id);
      if (p && p.type === 'variable') {
        for (const v of cat.products.filter((x) => x.type === 'variation' && x.parent === p.id)) rows.push({ ID: v.id, 'Regular price': r.retail.toFixed(2) });
      } else rows.push({ ID: r.match.id, 'Regular price': r.retail.toFixed(2) });
    }
    if (!rows.length) throw new Error('Δεν επιλέχθηκαν προϊόντα με αντιστοίχιση.');
    const f = saveExport(`times-antiprosopou-${cmp.site}.csv`, wooexport.updateFile(rows, ['Regular price']));
    return Object.assign({ count: rows.length }, f);
  },
  'POST /api/pricelist/costs': (b) => ({ count: pricelist.storeCosts(b.supplierId, b.site === 'st' ? 'st' : 'sf') }),
  'POST /api/pricelist/drafts': (b) => {
    const items = pricelist.rawItems(b.supplierId).filter((i) => (b.keys || []).includes(i.key));
    if (!items.some((i) => /^https?:\/\//i.test(i.url || ''))) { const d = drafts.fromPricelist(b.supplierId, b.keys || []); return { created: d.length }; }
    return jobs.start('drafts-' + b.supplierId, 'Νέα προϊόντα από ' + ((suppliers.get(b.supplierId) || {}).name || 'αντιπρόσωπο'), (job) => drafts.fromPricelistRich(b.supplierId, b.keys || [], job));
  },
  'POST /api/pricelist/refresh': (b) => jobs.start('supplier-' + b.supplierId, 'Ενημέρωση τιμοκαταλόγου', (job) => pricelist.refresh(b.supplierId, job)),
  'POST /api/pricelist/report': (b) => {
    const cmp = pricelist.compare(b.supplierId, b.site);
    if (!cmp) throw new Error('Δεν υπάρχει τιμοκατάλογος.');
    const csv = U.toCSV(cmp.rows, [
      { key: 'code', label: 'Κωδικός' }, { key: 'name', label: 'Όνομα αντιπροσώπου' }, { key: 'supplierPrice', label: 'Τιμή αντιπροσώπου' }, { key: 'prevPrice', label: 'Προηγούμενη τιμή' },
      { key: 'retail', label: 'Προτεινόμενη λιανική' }, { key: 'm', label: 'Δικό μας προϊόν', get: (r) => (r.match ? r.match.name : '') }, { key: 'mp', label: 'Δική μας τιμή', get: (r) => (r.match ? r.match.price : '') },
      { key: 'margin', label: 'Περιθώριο %' }, { key: 'status', label: 'Κατάσταση', get: (r) => ({ new: 'Νέο', diff: 'Διαφορά τιμής', same: 'Ίδια τιμή', loss: 'Κάτω από κόστος' }[r.status]) },
    ], { sep: ';', excel: true });
    return saveExport('timokatalogos-' + (cmp.supplier ? U.slugify(cmp.supplier.name) : 'x') + '.csv', csv);
  },

  // Competitors & market
  'GET /api/competitors': () => market.competitorsView(),
  'POST /api/competitors': (b) => market.saveCompetitor(b),
  'POST /api/competitors/delete': (b) => { market.removeCompetitor(b.id); return { ok: true }; },
  'POST /api/competitors/detect': () => jobs.start('detect', 'Έλεγχος ανταγωνιστών', (job) => market.detectAll(job)),
  // research for every product (or only the given ones): refresh competitor catalogs, compare locally
  'POST /api/market/run': (b) => {
    const targets = (b.targets || []).filter((t) => t && catalog.SITES.includes(t.site));
    return jobs.start('market', targets.length ? 'Έρευνα τιμών (' + targets.length + ')' : 'Έρευνα τιμών για όλα τα προϊόντα', (job) => market.run(targets.length ? targets : null, job, { skipDownload: !!b.skipDownload }));
  },
  'GET /api/market': (q) => market.overview(q.site === 'st' ? 'st' : 'sf', q),
  'POST /api/market/manual': (b) => market.addManual(b.site, b.id, b),
  'POST /api/market/ignore': (b) => market.toggleIgnore(b.site, b.id, b.url),
  'POST /api/market/decide': (b) => market.decide(b.site === 'st' ? 'st' : 'sf', b.id, String(b.url || ''), b.answer),
  'POST /api/market/export': (b) => {
    const site = b.site === 'st' ? 'st' : 'sf';
    const ov = market.overview(site);
    const want = new Set((b.ids || []).map(Number));
    const cat = catalog.load(site);
    const rows = [];
    const picked = [];
    // a big drop (>20%) based on a single shop is not exported without a clear yes
    const careful = ov.rows.filter((r) => want.has(r.id) && r.suggested > 0 && r.careful);
    if (careful.length && b.includeCareful == null) return { needConfirm: true, careful: careful.slice(0, 12).map((r) => ({ id: r.id, name: r.name, ourPrice: r.ourPrice, suggested: r.suggested })), carefulCount: careful.length };
    const skip = new Set(b.includeCareful ? [] : careful.map((r) => r.id));
    for (const r of ov.rows) {
      if (!want.has(r.id) || !(r.suggested > 0) || skip.has(r.id)) continue;
      picked.push(r);
      if (r.type === 'variable') { for (const v of cat.products.filter((x) => x.type === 'variation' && x.parent === r.id)) rows.push({ ID: v.id, 'Regular price': r.suggested.toFixed(2), 'Sale price': '' }); } else rows.push({ ID: r.id, 'Regular price': r.suggested.toFixed(2), 'Sale price': '' });
    }
    if (!rows.length) throw new Error('Δεν επιλέχθηκαν προϊόντα με προτεινόμενη τιμή.');
    const main = Object.assign({ count: rows.length, skipped: skip.size }, saveExport('nees-times-' + site + '.csv', wooexport.updateFile(rows, ['Regular price', 'Sale price'])));
    // the same new prices for the products that are also on the ads site (SpecialForces is the reference price)
    if (site === 'sf') {
      const L = catalog.links();
      const st = catalog.load('st');
      const rows2 = [];
      for (const r of picked) {
        const stId = L.sfToSt.get(r.id);
        if (!stId) continue;
        const p = st.products.find((x) => x.id === stId);
        if (!p) continue;
        if (p.type === 'variable') { for (const v of st.products.filter((x) => x.type === 'variation' && x.parent === p.id)) rows2.push({ ID: v.id, 'Regular price': r.suggested.toFixed(2), 'Sale price': '' }); } else rows2.push({ ID: p.id, 'Regular price': r.suggested.toFixed(2), 'Sale price': '' });
      }
      if (rows2.length) main.extra = Object.assign({ count: rows2.length, site: 'st' }, saveExport('nees-times-st-idies-me-sf.csv', wooexport.updateFile(rows2, ['Regular price', 'Sale price'])));
    }
    return main;
  },
  'POST /api/cost': (b) => { market.setCost(b.site, b.id, b.cost, 'manual'); market.recompute(); return { ok: true }; },
  'GET /api/links/search': (q) => ({ skroutz: 'https://www.skroutz.gr/search?keyphrase=' + encodeURIComponent(q.q || ''), bestprice: 'https://www.bestprice.gr/search?q=' + encodeURIComponent(q.q || ''), google: 'https://www.google.com/search?tbm=shop&hl=el&gl=gr&q=' + encodeURIComponent(q.q || ''), competitors: market.competitors().filter((c) => c.enabled !== false).map((c) => ({ name: c.name, kind: c.kind, url: market.searchUrlFor(c, q.q || '') })) }),

  // New products
  'GET /api/drafts': () => drafts.list().map((d) => ({ id: d.id, title: d.title, displayTitle: d.displayTitle, price: d.price, img: (d.images || [])[0] || '', status: d.status, checks: d.checks, exported: d.exported, sites: d.sites, regulated: d.regulated, ads: d.ads, adsWhy: d.adsWhy, createdAt: d.createdAt, source: d.source, variations: (d.variations || []).length, supplierId: d.supplierId })),
  'GET /api/draft': (q) => drafts.get(q.id) || Promise.reject(new Error('Δεν βρέθηκε.')),
  'POST /api/drafts/new': async (b) => {
    if (b.url) { const x = await extract.fromUrl(b.url); return drafts.fromExtract(x, { supplierId: b.supplierId }); }
    return drafts.create(b.input || {});
  },
  'POST /api/draft/update': (b) => drafts.update(b.id, b.patch || {}),
  'POST /api/drafts/delete': (b) => { drafts.remove(b.ids || []); return { ok: true }; },
  'POST /api/drafts/export': (b) => { const site = b.site === 'st' ? 'st' : 'sf'; const r = drafts.exportDrafts(b.ids || [], site); return Object.assign({ count: r.count, skipped: r.skipped, site }, saveExport('nea-proionta-' + site + '.csv', r.csv)); },
  'GET /api/draft/categories': (q) => { const d = drafts.get(q.id); return d ? drafts.suggestCategories(d, q.site === 'st' ? 'st' : 'sf') : []; },
  'GET /api/typesuggest': () => drafts.typeSuggestions(),
  'POST /api/draft/market': (b) => {
    const d = drafts.get(b.id);
    if (!d) throw new Error('Δεν βρέθηκε.');
    return jobs.start('draft-market', 'Έρευνα τιμής νέου προϊόντος', async (job) => {
      const comps = market.readable();
      if (!comps.length) throw new Error('Δεν υπάρχουν ανταγωνιστές που διαβάζονται αυτόματα. Πάτα «Έλεγχος» στη σελίδα Ανταγωνισμός.');
      job.progress(0, 1, 'Αναζήτηση σε ' + comps.length + ' καταστήματα…');
      const r = await market.researchOne({ name: d.title, brand: d.fields.brand, sku: d.code, price: d.price }, comps, settings.all().competitorGap);
      const s = settings.all();
      const st = market.stats(r.competitors.map((c) => Object.assign(c, { country: /\.gr$/.test(U.hostOf(c.url)) ? 'GR' : 'other' })), { ours: d.price, costVat: d.cost > 0 ? U.r2(d.cost * (1 + s.vat / 100)) : 0 });
      const floor = d.cost > 0 ? U.roundPrice(d.cost * (1 + s.floorMargin / 100) * (1 + s.vat / 100), s.rounding) : 0;
      const sug = market.suggest(st, floor);
      const res = { at: U.nowIso(), competitors: r.competitors, stats: st, suggested: sug.price, floor, raised: sug.raised, errors: r.errors.slice(0, 5) };
      const all = store.read('drafts', []);
      const x = all.find((y) => y.id === d.id);
      if (x) { x.market = res; store.write('drafts', all); }
      job.progress(1, 1, 'Έτοιμο');
      return res;
    });
  },
  'POST /api/draft/ai': async (b) => {
    const d = drafts.get(b.id);
    if (!d) throw new Error('Δεν βρέθηκε.');
    if (b.kind === 'translate') { const html = await localai.translate(d.descOfficial); return drafts.update(d.id, { descAI: html, descMode: 'ai' }); }
    const html = await localai.describe(d);
    return drafts.update(d.id, { descAI: html, descMode: 'ai' });
  },
  'GET /api/ai/status': () => localai.status(),
  'POST /api/extract': async (b) => extract.fromUrl(b.url),

  // Transfer between shops
  'POST /api/transfer': (b) => { const r = wooexport.transfer('sf', 'st', b.ids || []); const f = r.products ? saveExport('metafora-sto-st.csv', r.csv) : {}; return Object.assign({ count: r.products, skipped: r.skipped, newCategories: r.newCategories }, f); },
  'GET /api/catmap': (q) => {
    const from = q.from === 'st' ? 'st' : 'sf', to = from === 'sf' ? 'st' : 'sf';
    const map = wooexport.categoryMap(from, to);
    const A = catalog.categoryIndex(from), B = catalog.categoryIndex(to);
    const lv = catalog.categoryAdLevels(from);
    return { rows: A.cats.map((c) => ({ id: c.id, path: A.pathOf(c.id).join(' › '), count: c.count, to: map[c.id].to, toPath: map[c.id].to ? B.pathOf(map[c.id].to).join(' › ') : '', how: map[c.id].how, ads: lv.get(c.id) || 'ok', regulated: lv.get(c.id) === 'banned' })).sort((a, b) => a.path.localeCompare(b.path, 'el')), targets: B.cats.map((c) => ({ id: c.id, path: B.pathOf(c.id).join(' › ') })).sort((a, b) => a.path.localeCompare(b.path, 'el')) };
  },
  'POST /api/catmap': (b) => { wooexport.saveCategoryMap(b.from === 'st' ? 'st' : 'sf', b.from === 'st' ? 'sf' : 'st', b.pairs); return { ok: true }; },

  // Advertising rules (Google / Meta) and how many products each level catches
  'GET /api/adrules': () => {
    const adrules = require('./lib/adrules');
    const counts = {};
    const L = catalog.links();
    for (const site of catalog.SITES) {
      const other = site === 'sf' ? 'st' : 'sf';
      const oc = new Map(catalog.load(other).products.map((p) => [p.id, p]));
      const map = site === 'sf' ? L.sfToSt : L.stToSf;
      const c = { banned: 0, google: 0, caution: 0, meta18: 0, ok: 0 };
      for (const p of catalog.load(site).products) {
        if (p.type === 'variation') continue;
        const oid = map.get(p.id);
        c[catalog.adStatus(site, p, oid ? oc.get(oid) : null, other).level]++;
      }
      counts[site] = c;
    }
    const cur = settings.all().adRules;
    return { rules: Array.isArray(cur) && cur.length ? cur : adrules.DEFAULT_RULES, custom: Array.isArray(cur) && cur.length > 0, levels: adrules.LEVELS, counts };
  },
  // App lock (PIN)
  'GET /api/lock': () => security.status(),
  'POST /api/unlock': (b) => { security.unlock(b.pin); return security.status(); },
  'POST /api/lock': () => { security.lock(); return security.status(); },
  'POST /api/security/pin': (b) => { security.setPin(b.pin, b.current); return security.status(); },
  'POST /api/security/remove': (b) => { security.removePin(b.current); return security.status(); },
  'POST /api/security/minutes': (b) => { security.setLockMinutes(b.minutes); return security.status(); },
  'GET /api/security/audit': () => {
    const list = suppliers.list();
    const withPass = list.filter((x) => x.b2bPass);
    return Object.assign(security.status(), { b2b: { total: withPass.length, sealed: withPass.filter((x) => String(x.b2bPass).startsWith('vault:')).length } });
  },
  // Settings & data
  'GET /api/settings': () => settings.all(),
  'POST /api/settings': (b) => { const before = settings.all(); if ('adRules' in b) { b = Object.assign({}, b); if (Array.isArray(b.adRules)) b.adRules = b.adRules.filter((x) => x && x.match && ['cat', 'type', 'word'].includes(x.kind) && ['banned', 'google', 'caution', 'meta18', 'ok'].includes(x.level)).map((x) => ({ kind: x.kind, match: String(x.match).trim(), level: x.level, why: String(x.why || '').trim() })); else b.adRules = null; } const r = settings.save(b); checks.invalidate(); fixes.invalidate(); if (before.strategy !== r.strategy || before.percent !== r.percent || before.rounding !== r.rounding || before.floorMargin !== r.floorMargin || before.vat !== r.vat || before.marketGreekOnly !== r.marketGreekOnly || before.minShops !== r.minShops || before.suspectPct !== r.suspectPct) market.recompute(); if (JSON.stringify(before.newProduct) !== JSON.stringify(r.newProduct)) drafts.refreshAll(); return r; },
  'POST /api/datadir': (b) => { if (SERVER) throw new Error('Στη λειτουργία διακομιστή ο φάκελος δεδομένων ορίζεται στη ρύθμιση του διακομιστή (SFK_DATA).'); return store.setDataDir(b.path); },
  'GET /api/backups': () => store.listBackups(),
  'POST /api/backups/restore': (b) => { store.restoreBackup(b.day); checks.invalidate(); suppliers.resetIndex(); fixes.invalidate(); return { ok: true }; },
  'POST /api/open': (b) => {
    if (SERVER) { if (b.kind === 'url' && /^https?:\/\//i.test(b.url || '')) return { url: b.url }; throw new Error('Στη λειτουργία διακομιστή τα αρχεία κατεβαίνουν από τον browser.'); }
    if (b.kind === 'url' && /^https?:\/\//i.test(b.url || '')) openBrowser(b.url);
    else if (b.kind === 'data') openPath(store.dir());
    else if (b.kind === 'exports') openPath(path.join(store.dir(), 'exports'));
    else if (b.kind === 'file' && b.path && path.resolve(b.path).startsWith(path.resolve(store.dir()))) openPath(b.path, true);
    else if (b.kind === 'show' && b.path && path.resolve(b.path).startsWith(path.resolve(store.dir()))) openPath(b.path, false);
    else throw new Error('Δεν επιτρέπεται.');
    return { ok: true };
  },
  'GET /api/jobs': () => jobs.recent(),
  'POST /api/jobs/cancel': (b) => jobs.cancel(b.id),
  'POST /api/shutdown': () => { if (SERVER) throw new Error('Ο διακομιστής δεν κλείνει από εδώ.'); setTimeout(() => process.exit(0), 300); return { ok: true }; },

  // Users and sessions (server mode)
  'GET /api/session': (q, _, ctx) => ({ mode: MODE, version: VERSION, user: ctx.user || null, csrf: ctx.csrf || '', setup: SERVER && !users.count() }),
  'POST /api/login': (b, _, ctx) => { const r = users.login(b.user, b.password, ctx.ip, ctx.ua); ctx.setCookie(r.sid); return { user: r.user, csrf: r.csrf }; },
  'POST /api/setup': (b, _, ctx) => { const r = users.setup(b, ctx.ip, ctx.ua); ctx.setCookie(r.sid); return { user: r.user, csrf: r.csrf }; },
  'POST /api/logout': (b, _, ctx) => { if (ctx.sid) users.end(ctx.sid); ctx.setCookie(''); return { ok: true }; },
  'GET /api/users': () => ({ users: users.list(), sessions: users.active() }),
  'POST /api/users': (b) => (b.id ? users.update(b.id, b) : users.create(b)),
  'POST /api/users/delete': (b, _, ctx) => { if (ctx.user && b.id === ctx.user.id) throw new Error('Δεν διαγράφεις τον εαυτό σου.'); users.remove(b.id); return { ok: true }; },
  'POST /api/users/logout-all': (b, _, ctx) => { users.endAll(); ctx.setCookie(''); return { ok: true }; },
  'POST /api/me/password': (b, _, ctx) => { users.login(ctx.user.user, b.current, ctx.ip, ctx.ua); users.update(ctx.user.id, { password: b.password }); const r = users.startSession(users.byId(ctx.user.id), ctx.ip, ctx.ua); ctx.setCookie(r.sid); return { csrf: r.csrf }; },
};
// server mode: open without a session / only for administrators
const PUBLIC_ROUTES = new Set(['GET /api/session', 'POST /api/login', 'POST /api/setup', 'POST /api/logout']);
const ADMIN_ROUTES = new Set(['POST /api/unlock', 'POST /api/settings', 'POST /api/backups/restore', 'POST /api/security/pin', 'POST /api/security/remove', 'POST /api/security/minutes', 'GET /api/users', 'POST /api/users', 'POST /api/users/delete', 'POST /api/users/logout-all', 'POST /api/competitors/delete']);

const OPEN_WHEN_LOCKED = new Set(['GET /api/lock', 'POST /api/unlock', 'POST /api/shutdown', 'GET /api/session']);
function safeEq(a, b) { a = Buffer.from(String(a || '')); b = Buffer.from(String(b || '')); return a.length === b.length && crypto.timingSafeEqual(a, b); }

// ---------- server mode helpers ----------
function cookieOf(req, name) {
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return '';
}
function isHttps(req) { return !!(req.socket && req.socket.encrypted) || (TRUST_PROXY && /^https$/i.test(String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim())); }
function clientIp(req) { const f = TRUST_PROXY ? String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() : ''; return f || (req.socket && req.socket.remoteAddress) || ''; }
function sessionCookie(req, sid) {
  const secure = isHttps(req) || process.env.SFK_SECURE_COOKIE === '1';
  return `sfk_sid=${sid ? encodeURIComponent(sid) : ''}; Path=/; HttpOnly; SameSite=Strict${secure ? '; Secure' : ''}; Max-Age=${sid ? 30 * 86400 : 0}`;
}
function sessionOf(req, touch) { return SERVER ? users.session(cookieOf(req, 'sfk_sid'), touch) : null; }

// ---------- live updates: every open screen hears about changes (Server-Sent Events) ----------
const streams = new Set(); // { res, client }
let pendingKeys = new Map(); // store key -> Set of tabs that caused it ('' = the program itself)
let flushTimer = null;
const QUIET_KEYS = /^(sessions|security|accents|types|market-meta|competitors-meta)$|^comp-/;
store.onWrite((name) => {
  if (QUIET_KEYS.test(name) || !streams.size) return;
  const by = (reqCtx.getStore() || {}).client || '';
  if (!pendingKeys.has(name)) pendingKeys.set(name, new Set());
  pendingKeys.get(name).add(by);
  if (!flushTimer) flushTimer = setTimeout(flushEvents, 400);
});
jobs.onChange(() => { for (const st of [...streams]) if (alive(st)) sse(st.res, { jobs: true }); });
jobs.setRunner((fn) => reqCtx.exit(fn));
function flushEvents() {
  flushTimer = null;
  const pend = pendingKeys; pendingKeys = new Map();
  for (const st of [...streams]) {
    if (!alive(st)) continue;
    // a tab is not told about changes only it made (it already shows them)
    const keys = [...pend.entries()].filter(([, by]) => [...by].some((b) => b !== st.client)).map(([k]) => k);
    if (keys.length) sse(st.res, { keys });
  }
}
function sse(res, data) { try { res.write(`data: ${JSON.stringify(data)}\n\n`); } catch (_) { /* closed */ } }
// a stream whose session ended (logout, idle) is closed: nothing more is told to it
function alive(st) { if (!SERVER || users.session(st.sid, false)) return true; streams.delete(st); try { st.res.end(); } catch (_) { /* closed */ } return false; }
function serveEvents(req, res, url) {
  if (SERVER) { if (!sessionOf(req, false)) return send(res, 401, { error: 'Χρειάζεται σύνδεση.', login: true }); }
  else if (!safeEq(url.searchParams.get('t'), TOKEN)) return send(res, 403, { error: 'Απαγορεύεται.' });
  res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no', 'X-Content-Type-Options': 'nosniff' });
  res.write('retry: 4000\n\n');
  const st = { res, client: String(url.searchParams.get('c') || '').slice(0, 40), sid: SERVER ? cookieOf(req, 'sfk_sid') : '' };
  streams.add(st);
  const ping = setInterval(() => { try { res.write(': ping\n\n'); } catch (_) { /* closed */ } }, 25000);
  req.on('close', () => { clearInterval(ping); streams.delete(st); });
}

// ---------- the same data folder used by another PC at the same time (e.g. OneDrive) ----------
// Two copies writing the same files lose each other's changes. Each copy leaves a small "I am here" note
// in the folder every minute; the screen warns when another PC's note is fresh.
const os = require('os');
const INSTANCE = { host: os.hostname(), pid: process.pid, startedAt: new Date().toISOString() };
function instanceFile() { return path.join(store.dir(), '.instance-' + INSTANCE.host.replace(/[^a-z0-9_-]+/gi, '_') + '.json'); }
function heartbeat() { try { fs.writeFileSync(instanceFile(), JSON.stringify(Object.assign({ at: new Date().toISOString() }, INSTANCE))); } catch (_) { /* optional */ } }
function otherInstances() {
  try {
    return fs.readdirSync(store.dir()).filter((f) => /^\.instance-.+\.json$/.test(f)).map((f) => { try { return JSON.parse(fs.readFileSync(path.join(store.dir(), f), 'utf8')); } catch (_) { return null; } })
      .filter((x) => x && x.host !== INSTANCE.host && Date.now() - new Date(x.at).getTime() < 5 * 60000).map((x) => ({ host: x.host, at: x.at }));
  } catch (_) { return []; }
}

/** A report page in a browser tab: only with its own key, never while the program is locked. */
function serveReport(req, res, url) {
  const name = path.basename(decodeURIComponent(url.pathname.slice(3)));
  if (SERVER && !sessionOf(req, false)) return send(res, 401, '<!doctype html><meta charset="utf-8"><p style="font:16px system-ui;padding:40px">Συνδέσου πρώτα στο πρόγραμμα και άνοιξε ξανά την αναφορά.</p>', 'text/html; charset=utf-8');
  const k = reportKeys.get(name);
  if (!k || !safeEq(url.searchParams.get('k'), k)) return send(res, 403, '<!doctype html><meta charset="utf-8"><p style="font:16px system-ui;padding:40px">Ο σύνδεσμος της αναφοράς έληξε. Άνοιξέ την ξανά από το πρόγραμμα.</p>', 'text/html; charset=utf-8');
  if (!SERVER && security.isLocked()) return send(res, 423, '<!doctype html><meta charset="utf-8"><p style="font:16px system-ui;padding:40px">Το πρόγραμμα είναι κλειδωμένο. Βάλε το PIN στο πρόγραμμα και άνοιξε ξανά την αναφορά.</p>', 'text/html; charset=utf-8');
  const p = store.exportPath(name);
  if (!fs.existsSync(p)) return send(res, 404, 'Δεν βρέθηκε.', 'text/plain; charset=utf-8');
  const nonce = crypto.randomBytes(16).toString('base64');
  const html = fs.readFileSync(p, 'utf8').split('nonce="__NONCE__"').join(`nonce="${nonce}"`);
  return send(res, 200, html, 'text/html; charset=utf-8', {
    'Content-Security-Policy': `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; img-src * data: blob:; connect-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`,
    'Referrer-Policy': 'no-referrer',
  });
}

async function handleApi(req, res, url) {
  const q = Object.fromEntries(url.searchParams);
  const key0 = req.method + ' ' + url.pathname;
  if (key0 === 'GET /api/events') return serveEvents(req, res, url);
  if (req.method === 'GET' && url.pathname.startsWith('/api/export/')) {
    if (SERVER ? !sessionOf(req, false) : !safeEq(q.t, TOKEN)) return send(res, 403, { error: 'Απαγορεύεται.' });
    if (!SERVER && security.isLocked()) return send(res, 423, { error: 'Το πρόγραμμα είναι κλειδωμένο.', locked: true });
    const name = decodeURIComponent(url.pathname.slice('/api/export/'.length));
    const p = store.exportPath(path.basename(name));
    if (!fs.existsSync(p)) return send(res, 404, { error: 'Δεν βρέθηκε το αρχείο.' });
    return send(res, 200, fs.readFileSync(p), MIME[path.extname(p).toLowerCase()] || 'application/octet-stream', { 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(path.basename(p))}` });
  }
  const ctx = { ip: clientIp(req), ua: String(req.headers['user-agent'] || ''), client: String(req.headers['x-client'] || '').slice(0, 40), cookies: [] };
  ctx.setCookie = (sid) => ctx.cookies.push(sessionCookie(req, sid));
  if (SERVER) {
    // every call needs a logged-in user and the session's own token; settings and users only for administrators
    const sid = cookieOf(req, 'sfk_sid');
    const sess = users.session(sid, req.headers['x-active'] === '1');
    if (sess) Object.assign(ctx, { sid, user: sess.user, csrf: sess.csrf });
    if (!PUBLIC_ROUTES.has(key0)) {
      if (!sess) return send(res, 401, { error: 'Η σύνδεση έληξε. Συνδέσου ξανά.', login: true });
      if (!safeEq(req.headers['x-sfk'], sess.csrf)) return send(res, 403, { error: 'Απαγορεύεται.' });
      if (ADMIN_ROUTES.has(key0) && sess.user.role !== 'admin') return send(res, 403, { error: 'Μόνο για διαχειριστές.' });
    } else if (req.method === 'POST' && key0 !== 'POST /api/logout' && sess && key0 !== 'POST /api/login') {
      return send(res, 400, { error: 'Είσαι ήδη συνδεδεμένος.' });
    }
  } else {
    if (!safeEq(req.headers['x-sfk'], TOKEN)) return send(res, 403, { error: 'Απαγορεύεται.' });
    // the lock is enforced here, for every call: without the PIN nothing can be read or changed
    if (security.isLocked() && !OPEN_WHEN_LOCKED.has(key0)) return send(res, 423, { error: 'Το πρόγραμμα είναι κλειδωμένο. Βάλε το PIN.', locked: true });
    if (req.headers['x-active'] === '1') security.touch();
  }
  if (req.method === 'GET' && url.pathname.startsWith('/api/jobs/') && url.pathname.length > 10) {
    const j = jobs.get(url.pathname.slice(10));
    return j ? send(res, 200, j) : send(res, 404, { error: 'Η εργασία δεν υπάρχει πια.' });
  }
  const fn = routes[key0];
  if (!fn) return send(res, 404, { error: 'Άγνωστη λειτουργία.' });
  try {
    // before login only small bodies are read
    const limit = SERVER && !ctx.user ? 64 * 1024 : 120 * 1024 * 1024;
    const body = req.method === 'POST' ? await readBody(req, limit) : {};
    const out = await reqCtx.run({ client: ctx.client }, () => fn(req.method === 'GET' ? q : body, q, ctx));
    send(res, 200, out === undefined ? { ok: true } : out, null, ctx.cookies.length ? { 'Set-Cookie': ctx.cookies } : null);
  } catch (e) {
    if (!(e && (e.status || e.network)) && !/^[Α-Ωα-ωΆ-ώ]/.test(String(e && e.message))) console.error('[api]', key0, e);
    send(res, 400, { error: e && e.message ? e.message : String(e) }, null, ctx.cookies.length ? { 'Set-Cookie': ctx.cookies } : null);
  }
}

function serveStatic(req, res, url) {
  let p = url.pathname === '/' ? '/index.html' : url.pathname;
  p = path.normalize(p).replace(/^([/\\])+/, '');
  const file = path.join(PUBLIC, p);
  if (!file.startsWith(PUBLIC)) return send(res, 403, 'no', 'text/plain');
  fs.readFile(file, (err, data) => {
    if (err) return send(res, 404, 'Not found', 'text/plain');
    const ext = path.extname(file);
    if (ext === '.html') {
      // server mode: the page carries the token of the logged-in session (none before login)
      const sess = SERVER ? sessionOf(req, false) : null;
      data = Buffer.from(String(data).replace('__SFK_TOKEN__', SERVER ? (sess ? sess.csrf : '') : TOKEN).replace('__SFK_VERSION__', VERSION).replace('__SFK_MODE__', MODE));
    }
    send(res, 200, data, MIME[ext] || 'application/octet-stream', ext === '.woff2' ? { 'Cache-Control': 'max-age=31536000' } : { 'Content-Security-Policy': "default-src 'self'; img-src * data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; font-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'" });
  });
}

const server = http.createServer((req, res) => {
  const host = String(req.headers.host || '').toLowerCase();
  if (SERVER) {
    if (ALLOWED_HOSTS.length && !ALLOWED_HOSTS.includes(host.replace(/:\d+$/, '')) && !LOCAL_HOST.test(host)) return send(res, 403, 'Forbidden', 'text/plain');
    // requests from web pages of other sites are refused (protection against cross-site requests)
    const origin = req.headers.origin;
    if (origin) { let oh = ''; try { oh = new URL(origin).host.toLowerCase(); } catch (_) { /* bad origin */ } if (oh !== host) return send(res, 403, 'Forbidden', 'text/plain'); }
    if (isHttps(req)) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
  } else {
    if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host)) return send(res, 403, 'Forbidden', 'text/plain');
    const origin = req.headers.origin;
    if (origin && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin)) return send(res, 403, 'Forbidden', 'text/plain');
  }
  const url = new URL(req.url, 'http://127.0.0.1');
  if (url.pathname === '/ping') return send(res, 200, { app: 'sf-kentro', version: VERSION });
  if (url.pathname.startsWith('/r/')) return serveReport(req, res, url);
  if (url.pathname.startsWith('/api/')) { uiSeen = true; return handleApi(req, res, url); }
  if (url.pathname === '/') uiSeen = true;
  return serveStatic(req, res, url);
});

function listen(p, tries) {
  server.once('error', async (e) => {
    if (e.code === 'EADDRINUSE') {
      // Already running? Then just open the window and leave.
      try {
        const r = await fetch(`http://127.0.0.1:${p}/ping`);
        const j = await r.json();
        if (j.app === 'sf-kentro') { console.log('SF Kentro is already running. Opening the window...'); openApp(`http://127.0.0.1:${p}/`); setTimeout(() => process.exit(0), 4000); return; }
      } catch (_) { /* some other program */ }
      if (tries > 0) return listen(p + 1, tries - 1);
    }
    fatal(new Error('Cannot listen on port ' + p + ': ' + e.message));
  });
  server.listen(p, BIND, () => {
    port = p;
    const url = `http://127.0.0.1:${p}/`;
    console.log('');
    console.log('  SF Kentro ' + VERSION + (SERVER ? ' — server mode (shared by every PC)' : ''));
    console.log('  Running at ' + url + (SERVER ? '  (listening on ' + BIND + ':' + p + ')' : ''));
    console.log('  Data folder: ' + store.dir());
    if (SERVER) {
      const code = users.ensureAdmin();
      if (code) { console.log(''); console.log('  FIRST START: open the program in a browser and use this setup code: ' + code); console.log('  ΠΡΩΤΗ ΕΚΚΙΝΗΣΗ: άνοιξε το πρόγραμμα στον browser και γράψε τον κωδικό: ' + code); }
      if (!ALLOWED_HOSTS.length) console.log('  Tip: set SFK_ALLOWED_HOSTS to the address people use (e.g. kentro.example.gr).');
      console.log('');
      return afterStart();
    }
    console.log('  Keep this window open while you work. Close it to exit.');
    console.log('  If no window appears, open this address in your browser: ' + url);
    console.log('');
    openApp(url);
    // If no window connects (Edge blocked, missing, etc.), open the default browser instead.
    if (!process.env.SFK_NO_OPEN) setTimeout(() => {
      if (uiSeen) return;
      console.log('  The app window did not open. Opening your default browser at ' + url);
      openDefault(url);
    }, 15000).unref();
    afterStart();
  });
}

const STARTED_AT = Date.now();
function afterStart() {
  try { store.backup(14); } catch (e) { console.error('backup:', e.message); }
  if (!SERVER) { heartbeat(); setInterval(heartbeat, 60 * 1000).unref(); process.on('exit', () => { try { fs.unlinkSync(instanceFile()); } catch (_) { /* gone */ } }); }
  setInterval(() => { try { store.backup(14); } catch (e) { console.error('backup:', e.message); } }, 3600 * 1000).unref();
  // after an update with new market rules (e.g. out-of-stock offers no longer count): recalculate the saved results once
  try {
    const meta = store.read('market-meta', {});
    if ((meta.logic || 0) < market.LOGIC_VERSION) { market.recompute(); store.write('market-meta', Object.assign({}, store.read('market-meta', {}), { logic: market.LOGIC_VERSION })); }
  } catch (e) { console.error('market recompute:', e.message); }
  const s = settings.all();
  const sum = catalog.summary();
  const stale = ['sf', 'st'].filter((site) => sum[site].source === 'api' && s.autoSyncHours && (!sum[site].syncedAt || (Date.now() - new Date(sum[site].syncedAt)) / 36e5 > s.autoSyncHours));
  if (stale.length && !process.env.SFK_NO_AUTOSYNC) routes['POST /api/sync']({ sites: stale });
  // daily competitor research: the first time the program is open each day, after the products are read
  if (!process.env.SFK_NO_AUTOSYNC) {
    const tick = () => {
      try {
        const busy = jobs.running().some((j) => j.type === 'sync' || j.type === 'market' || j.type === 'supplierfind');
        if (busy) return;
        // once a week, after the daily research: look for suppliers of brands without one (for approval)
        if (!market.dailyDue()) {
          if (settings.all().supplierFindAuto !== false && supplierfind.weeklyDue() && catalog.load('sf').products.length) jobs.start('supplierfind', 'Εβδομαδιαία αναζήτηση αντιπροσώπων', (job) => supplierfind.run(job, { limit: 40 }));
          return;
        }
        if (!catalog.load('sf').products.length) return;
        // B2B passwords sealed with the PIN: wait for the first unlock (up to 3 hours), so the B2B prices are read too
        const sealed = pricelist.autoSources().some((x) => x.catalogMode === 'b2b' && String(x.b2bPass || '').startsWith('vault:'));
        if (sealed && !security.status().vaultOpen && Date.now() - STARTED_AT < 3 * 36e5) return;
        console.log('daily market research');
        jobs.start('market', 'Ημερήσια ενημέρωση (αντιπρόσωποι και τιμές αγοράς)', async (job) => {
          // 1. suppliers with a feed / catalog / B2B: fresh prices and costs
          for (const s of pricelist.autoSources()) {
            if (job.cancelled()) return null;
            try { const r = await pricelist.refresh(s.id, job); job.log(`${s.name}: ${r ? r.items + ' κωδικοί, ' + r.changed + ' αλλαγές τιμής' : 'διακόπηκε'}`); } catch (e) { job.log(`${s.name}: ${e.message}`); }
          }
          // 2. competitor prices for every product
          const res = await market.run(null, job, { auto: true });
          // 3. missing descriptions / photos / brands: sources from the suppliers, for approval (a few pages a day)
          if (!job.cancelled()) { try { const f = await fixes.findSources(job, { maxPages: 60 }); if (f) job.log(`Διορθώσεις: πηγές για ${f.found} προϊόντα (${f.pages} σελίδες αντιπροσώπων).`); } catch (e) { job.log('Διορθώσεις: ' + e.message); } }
          return res;
        });
      } catch (e) {
        // the same problem is written once an hour, not every minute
        const msg = e && e.message ? e.message : String(e);
        if (msg !== tickErr.msg || Date.now() - tickErr.at > 36e5) { console.error('daily research:', e && e.stack ? e.stack : msg); tickErr.msg = msg; tickErr.at = Date.now(); }
      }
    };
    const tickErr = { msg: '', at: 0 };
    setTimeout(tick, 20000).unref();
    setInterval(tick, 60 * 1000).unref();
  }
}

process.on('uncaughtException', (e) => { console.error('Error:', e && e.stack ? e.stack : e); });
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { try { users.flush(); } catch (_) { /* ignore */ } process.exit(0); });
process.on('unhandledRejection', (e) => { console.error('Error:', e && e.stack ? e.stack : e); });

void execFile;

// ---------- start-up with a log file and a window that stays open on errors ----------
let logFile = null;
function setupLog() {
  try {
    fs.mkdirSync(store.appConfigDir(), { recursive: true });
    logFile = path.join(store.appConfigDir(), 'log.txt');
    try { if (fs.statSync(logFile).size > 2 * 1024 * 1024) fs.renameSync(logFile, logFile + '.old'); } catch (_) { /* new file */ }
    const write = (lvl, args) => { try { fs.appendFileSync(logFile, `[${new Date().toISOString()}] ${lvl} ${args.map((a) => (a && a.stack) || (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')}\n`); } catch (_) { /* ignore */ } };
    const ol = console.log.bind(console), oe = console.error.bind(console);
    console.log = (...a) => { write('INFO', a); ol(...a); };
    console.error = (...a) => { write('ERROR', a); oe(...a); };
  } catch (_) { /* logging is optional */ }
}
function fatal(e) {
  console.error('');
  console.error('  SF Kentro could not start / Το πρόγραμμα δεν μπόρεσε να ξεκινήσει:');
  console.error('  ' + (e && e.message ? e.message : String(e)));
  if (logFile) console.error('  Log: ' + logFile);
  console.error('  Close this window to exit.');
  setTimeout(() => process.exit(1), 10 * 60 * 1000);
}
let uiSeen = false;
function main() {
  setupLog();
  console.log('Starting SF Kentro ' + VERSION + ' on ' + process.platform + ' ' + process.arch + ', node ' + process.version);
  try { store.init(); } catch (e) { return fatal(e); }
  listen(PORT0, 5);
}
main();
