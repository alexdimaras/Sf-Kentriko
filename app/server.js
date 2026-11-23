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

const VERSION = '1.6.0';
// Render (free cloud host) tells the program its port in PORT
const PORT0 = Number(process.env.RENDER && process.env.PORT ? process.env.PORT : process.env.SFK_PORT) || 17321;
const MODE = process.env.SFK_MODE === 'server' ? 'server' : 'local';
const SERVER = MODE === 'server';
const BIND = process.env.SFK_HOST || (SERVER ? '0.0.0.0' : '127.0.0.1');
// server mode: the addresses people type (e.g. kentro.example.gr); empty = any (shop network)
const ALLOWED_HOSTS = String(process.env.SFK_ALLOWED_HOSTS || '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
// GitHub Codespaces forwards the port under its own https name: that one address is also accepted (and shown for the phone)
const CODESPACE_HOST = process.env.CODESPACE_NAME ? `${process.env.CODESPACE_NAME}-${PORT0}.${process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN || 'app.github.dev'}`.toLowerCase() : '';
// Render: its own https name (e.g. sf-kentro.onrender.com) is accepted the same way
const PLATFORM_HOST = CODESPACE_HOST || String(process.env.RENDER_EXTERNAL_HOSTNAME || '').toLowerCase();
const TRUST_PROXY = process.env.SFK_TRUST_PROXY === '1' || !!process.env.RENDER; // behind Caddy / nginx: trust X-Forwarded-For / -Proto
// a small machine (free cloud: 512 MB): heavy work one piece at a time
const SMALL = typeof process.constrainedMemory === 'function' && process.constrainedMemory() > 0 && process.constrainedMemory() < 1.5e9 || process.env.SFK_SMALL === '1';
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
// the live copy of the data: the shared database when it is set (SFK_DATABASE_URL), else the private GitHub repository
const cloudsave = process.env.SFK_DATABASE_URL ? require('./lib/pgsave') : require('./lib/cloudsave');
const coord = require('./lib/coord');
const jobtypes = require('./lib/jobtypes');
const audit = require('./lib/audit');
const events = require('./lib/events'); // one log of what went wrong, from every part (lib/events.js)
const engine = require('./lib/engine');
const bg = require('./lib/bg');
const U = require('./lib/util');
const { AsyncLocalStorage } = require('async_hooks');
const reqCtx = new AsyncLocalStorage(); // which browser tab caused a change (so it is not told about its own changes)

const TOKEN = crypto.randomBytes(18).toString('hex');
try { process.title = 'SF Kentro'; } catch (_) { /* ignore */ }
const PUBLIC = path.join(__dirname, 'public');
const MIME = { '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.csv': 'text/csv; charset=utf-8', '.webmanifest': 'application/manifest+json; charset=utf-8' };
let port = PORT0;

// ---------- helpers ----------
function send(res, code, body, type, extra) {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
  res.writeHead(code, Object.assign({ 'Content-Type': type || 'application/json; charset=utf-8', 'Content-Length': buf.length, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY' }, extra || {}));
  res.end(buf);
}
const BIG_BODY = new Set(['POST /api/backup/upload', 'POST /api/csv/detect', 'POST /api/csv/import', 'POST /api/pricelist/preview', 'POST /api/pricelist/import']);
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
  const m = String(name).match(/^(.*?)((?:\.json)?\.[a-z0-9]+)?$/i); // "x.json.gz" keeps both endings
  const base = m[1], ext = m[2] || '.csv';
  let fname = base + '-' + stamp + ext;
  for (let i = 2; fs.existsSync(store.exportPath(fname)); i++) fname = base + '-' + stamp + '-' + i + ext;
  const p = store.exportPath(fname);
  if (content && content.fromFile) fs.renameSync(content.fromFile, p); else fs.writeFileSync(p, content);
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
// how many products each supplier has: 17.000 products are matched once per change of the catalogs or the suppliers
let supCounts = null;
function supplierCounts() {
  const key = [catalog.bothVer(), store.ver('suppliers')];
  if (supCounts && supCounts.key.every((x, i) => x === key[i])) return supCounts.counts;
  const counts = {};
  for (const site of ['sf', 'st']) for (const p of catalog.load(site).products) {
    if (p.type === 'variation') continue;
    const s = suppliers.forProduct(p);
    if (s) { counts[s.id] = counts[s.id] || { sf: 0, st: 0 }; counts[s.id][site]++; }
  }
  supCounts = { key, counts };
  return counts;
}
async function stateView(ctx) { return { version: VERSION, mode: MODE, user: ctx.user || null, dataDir: SERVER ? '' : store.dir(), summary: catalog.summary(), settings: settings.all(), jobs: jobs.running().concat(coordReady ? (await coord.live()).filter((j) => j.type !== 'codes.web' && j.type !== 'market.shop') : []), workers: coordReady && SERVER ? await coord.stats() : null, strategies: settings.STRATEGIES, platform: process.platform, instances: SERVER ? [] : otherInstances(), cloud: cloudsave.status(), engine: engine.status() }; }

// ---------- API ----------
const routes = {
  // where the data is kept and whether everything is in: for the sign on every screen
  'GET /api/build': () => buildInfo(),
  'GET /api/save-status': () => { const c = cloudsave.status(); return { enabled: !!c.enabled, where: c.where || (c.enabled ? 'GitHub' : 'δίσκος'), savedAt: c.savedAt || null, loadedAt: c.loadedAt || null, pending: !!c.pending, error: c.error || '', blocked: !!c.blocked, now: new Date().toISOString() }; },
  'POST /api/save-now': async () => { const r = await cloudsave.save('χειροκίνητα'); const c = cloudsave.status(); return { ok: !(r && r.error) && !c.error, error: (r && r.error) || c.error || '', savedAt: c.savedAt || null, pending: !!c.pending, where: c.where || 'GitHub', enabled: !!c.enabled, sent: r && r.sent != null ? r.sent : null }; },
  'GET /api/state': async (q, _, ctx) => { if (!store.read('catalog-meta', null)) await engine.loaded(); return await stateView(ctx); },
  'GET /api/dashboard': () => dashboard.build(),

  // Sync
  'POST /api/sync': (b, _q, _ctx, o) => {
    // the site never read (or read longest ago) first: a restart in the middle never leaves the same one behind twice
    const sum0 = catalog.summary();
    const age = (x) => { const t = sum0[x] && sum0[x].syncedAt ? new Date(sum0[x].syncedAt).getTime() : 0; return t; };
    const sites = (b.sites && b.sites.length ? b.sites : ['sf', 'st']).filter((x) => catalog.SITES.includes(x)).sort((x, y) => age(x) - age(y));
    return jobs.start('sync', b.full ? 'Πλήρης ανάγνωση προϊόντων' : 'Ανάγνωση προϊόντων', async (job) => {
      const out = {};
      await engine.ready();
      const progress = catalog.makeProgress(job);
      // both shops at the same time: the total time is that of the bigger shop (one after the other on a small cloud machine: half the memory)
      const one = async (site) => {
        // each shop has its own record: when it was read, how many products, whether it finished or failed
        catalog.readStarted(site, !!b.full);
        try {
          out[site] = await catalog.syncSite(site, job, { full: !!b.full, progress });
          catalog.readEnded(site, out[site], null, !out[site]);
          if (out[site]) job.log(`${settings.all().sites[site].name}: έτοιμο.`);
          // free cloud: each shop is kept in GitHub as soon as it is read (whatever happens next, it is not read again)
          if (out[site] && cloudsave.status().enabled) { const sv = await cloudsave.save('ανάγνωση ' + site); if (sv && sv.error) job.log('Φύλαξη στο GitHub: ' + sv.error); }
        } catch (e) {
          const stopped = job.cancelled() || (e && e.cancelled);
          catalog.readEnded(site, null, e, stopped);
          out[site] = { error: stopped ? 'Σταμάτησε πριν τελειώσει.' : e.message }; job.log(`${settings.all().sites[site].name}: ${out[site].error}`);
        }
      };
      engine.hold(); // nothing is rebuilt while the shops are being read; once, at the end
      try { if (SMALL) { for (const site of sites) { if (job.cancelled()) { catalog.readEnded(site, null, null, true); out[site] = { error: 'Σταμάτησε πριν ξεκινήσει.' }; continue; } await one(site); } } else await Promise.all(sites.map(one)); } finally { engine.release(); }
      checks.invalidate(); suppliers.resetIndex(); fixes.invalidate();
      if (job.cancelled()) return out;
      if (sites.every((s) => out[s] && out[s].error)) throw new Error(sites.map((s) => `${settings.all().sites[s].name}: ${out[s].error}`).join(' / '));
      // free cloud: what was read is kept in GitHub at once, before anything else can go wrong
      if (cloudsave.status().enabled) { job.progress(null, null, 'Φύλαξη στο GitHub…'); const sv = await cloudsave.save('ανάγνωση sites'); if (sv && sv.error) job.log('Φύλαξη στο GitHub: ' + sv.error); else job.log('Φυλάχτηκαν στο GitHub.'); }
      // checks, fixes and the work flow are built again in the background, in slices; the job ends when they are ready
      await engine.settle((stepText) => job.progress(null, null, stepText));
      job.progress(null, null, 'Τιμές αγοράς…');
      await market.recomputeAsync();
      if (cloudsave.status().enabled) await cloudsave.save('έλεγχοι');
      return out;
    }, { heavy: true, auto: !!(o && o.auto) });
  },
  'POST /api/probe': async (b) => catalog.probe(b.site),
  'POST /api/csv/detect': (b) => { const d = catalog.csvDetect(U.decodeText(Buffer.from(b.base64 || '', 'base64'))); delete d.sample; return d; },
  'POST /api/csv/import': (b) => { const r = catalog.csvImport(b.site === 'st' ? 'st' : 'sf', U.decodeText(Buffer.from(b.base64 || '', 'base64')), b.mapping); checks.invalidate(); fixes.invalidate(); market.recompute(); return r; },
  'GET /api/history': () => store.read('history', []),

  // Products
  'GET /api/products': (q) => catalog.productsView(q),
  'GET /api/product': (q) => {
    const site = q.site === 'st' ? 'st' : 'sf';
    const d = catalog.productDetail(site, q.id);
    if (!d) return Promise.reject(new Error('Δεν βρέθηκε το προϊόν.'));
    // what this product still needs, in one list: the steps of the work flow and the ready changes waiting for a yes
    try {
      const id = Number(q.id);
      const row = require('./lib/flow').compute().rows.get(site + ':' + id);
      const fx = fixes.compute().items.filter((c) => c.site === site && c.pid === id && c.status === 'pending');
      d.todo = {
        stage: row ? row.stage : 5,
        problems: row ? row.problems.filter((x) => x.state !== 'done').map((x) => ({ stage: x.stage, text: x.text, state: x.state, hint: x.hint || '', field: x.field || '' })) : [],
        fixes: fx.map((c) => ({ id: c.id, field: c.field, label: c.label, level: c.level, confidence: c.confidence || 0, why: String(c.why || '').slice(0, 300), to: typeof c.to === 'string' ? c.to.slice(0, 200) : c.field === 'images' ? `${(c.to || []).length} φωτογραφίες` : c.field === 'desc' ? 'νέα περιγραφή' : '' })),
      };
    } catch (e) { d.todo = null; }
    return d;
  },
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
  'POST /api/checks/ignore': (b) => { checks.setIgnored(b.id, (b.keys || []).map(String), b.on !== false); return { ok: true }; },

  // Fixes waiting for approval: everything the program can correct by itself, filled in here (never on the sites)
  'GET /api/fixes': (q) => fixes.view(q),
  'POST /api/fixes/decide': (b, _, ctx) => fixes.decide(b.ids || [], b.status, ctx.user ? ctx.user.name : '', b.edited),
  'POST /api/fixes/approve-sure': (b, _, ctx) => fixes.approveSure(b.site === 'st' ? 'st' : b.site === 'sf' ? 'sf' : '', b.group || '', ctx.user ? ctx.user.name : ''),
  'POST /api/fixes/export': (b, _, ctx) => { const site = b.site === 'st' ? 'st' : 'sf'; const r = fixes.exportFile(site, ctx.user ? ctx.user.name : ''); return Object.assign({ count: r.count, products: r.products, changes: r.changes, site, gtin: r.gtin }, saveExport(r.name, r.csv)); },
  'POST /api/fixes/find': (b) => jobs.start('fixes', 'Αναζήτηση στοιχείων στους αντιπροσώπους', (job) => heldWhile(() => fixes.findSources(job, { maxPages: Math.min(1000, Number(b.maxPages) || 150) })), { heavy: true }),
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
    const counts = supplierCounts();
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
  'POST /api/supplierfind/run': (b) => {
    const brands = Array.isArray(b.brands) && b.brands.length ? b.brands.slice(0, 20) : null;
    if (brands) return jobs.start('supplierfind-one', 'Αναζήτηση αντιπροσώπου' + (brands.length === 1 ? '' : ` (${brands.length} μάρκες)`), (job) => supplierfind.run(job, { brands, limit: brands.length }));
    return jobs.start('supplierfind', 'Αναζήτηση αντιπροσώπων', (job) => supplierfind.run(job, { limit: Math.min(400, Number(b.limit) || 40), yieldTo: 'supplierfind-one' }), { heavy: true });
  },
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
  'POST /api/market/run': async (b, _q, ctx) => {
    const targets = (b.targets || []).filter((t) => t && catalog.SITES.includes(t.site));
    if (!targets.length && !b.skipDownload && await useWorkers()) return jobs.start('market', 'Έρευνα τιμών για όλα τα προϊόντα (στους υπολογιστές)', (job) => heldWhile(() => distributedResearch(job, { by: ctx && ctx.user ? ctx.user.name : '' })), { heavy: true });
    return jobs.start('market', targets.length ? 'Έρευνα τιμών (' + targets.length + ')' : 'Έρευνα τιμών για όλα τα προϊόντα', (job) => heldWhile(() => market.run(targets.length ? targets : null, job, { skipDownload: !!b.skipDownload })), { heavy: !targets.length });
  },
  'GET /api/market': (q) => market.overview(q.site === 'st' ? 'st' : 'sf', q),
  // codes (SKU / EAN) from the internet: one product now, or the next ones without a code
  'POST /api/codes/find': (b) => {
    const cf = require('./lib/codefind');
    if (b.site && b.id) {
      const p = catalog.byId(b.site === 'st' ? 'st' : 'sf').get(Number(b.id));
      if (!p) throw new Error('Δεν βρέθηκε το προϊόν.');
      // «Πλήρης έρευνα Internet» (mode full): the whole plan, also for a product that has its code and EAN
      const mode = b.mode === 'full' ? 'full' : '';
      const items = cf.itemsFor([(b.site === 'st' ? 'st' : 'sf') + ':' + p.id], mode);
      const label = (mode ? 'Πλήρης έρευνα Internet: ' : 'Έρευνα στο internet: ') + p.name.slice(0, 60);
      return (async () => {
        // a computer that searches is on: it goes first in its queue (a person is waiting); else it is done here
        const ws = coordReady ? (await coord.workersView()).filter((w) => w.online && (w.caps.types || []).includes('codes.web') && workerActive(w)) : [];
        if (ws.length) { const j = await coord.enqueue('codes.web', webPayload(items), { priority: 40, label, by: 'person' }); return coord.job(j.id); }
        return jobs.start('codes', label, (job) => webCodes(job, { items }));
      })();
    }
    if (Array.isArray(b.keys) && b.keys.length) {
      // chosen products (e.g. «Χωρίς στοιχεία»): to the computers first in the queue, or here when there is none
      const items = cf.itemsFor(b.keys.slice(0, 400));
      if (!items.length) throw new Error('Κανένα προϊόν.');
      return (async () => {
        const ws = coordReady ? (await coord.workersView()).filter((w) => w.online && (w.caps.types || []).includes('codes.web')) : [];
        if (ws.length) {
          for (let i = 0; i < items.length; i += 10) await coord.enqueue('codes.web', webPayload(items.slice(i, i + 10)), { dedupKey: 'codes.web:pick:' + items[i].k + ':' + Date.now(), priority: 20, auto: true });
          await feedWebResearch();
          return { queued: items.length, computers: ws.length };
        }
        return jobs.start('codes', `Έρευνα στο internet (${items.length})`, (job) => webCodes(job, { items: items.slice(0, 60) }));
      })();
    }
    return jobs.start('codes', 'Κωδικοί από το internet', (job) => webCodes(job, { max: Math.min(200, Number(b.max) || 25) }));
  },
  'GET /api/codes': () => { const cf = require('./lib/codefind'); return Object.assign(cf.status(), { shops: cf.suggestedShops(3) }); },
  // families: the same model sold as separate products, one per colour — proposals, a yes, then the files of the change
  'GET /api/families': (q) => require('./lib/families').list(q.site === 'st' ? 'st' : 'sf'),
  'GET /api/families/of': (q) => require('./lib/families').ofProduct(q.site === 'st' ? 'st' : 'sf', q.id) || { none: true },
  'POST /api/families/decide': (b, _, ctx) => require('./lib/families').decide(b.site === 'st' ? 'st' : 'sf', String(b.key || ''), String(b.answer || ''), ctx && ctx.user ? ctx.user.name : ''),
  'POST /api/families/export': (b) => {
    const r = require('./lib/families').exportFiles(b.site === 'st' ? 'st' : 'sf', String(b.key || ''), { parentSku: b.parentSku, variantSkus: b.variantSkus });
    return { title: r.family.title, mode: r.mode, parentSku: r.parentSku, notes: r.notes, files: r.files.map((f) => Object.assign({ what: f.what }, saveExport(f.name, f.csv))) };
  },
  // a person's question to the AI about one product: better title / features / category, from its real facts only
  'POST /api/ai/suggest': async (b) => {
    const site = b.site === 'st' ? 'st' : 'sf';
    const p = catalog.byId(site).get(Number(b.id));
    if (!p) throw new Error('Δεν βρέθηκε το προϊόν.');
    const cf = require('./lib/codefind');
    const key = site === 'st' && catalog.links().stToSf.has(p.id) ? 'sf:' + catalog.links().stToSf.get(p.id) : site + ':' + p.id;
    const hits = cf.hitsFor(key);
    const facts = [`Τίτλος: ${p.name}`, p.brand ? `Μάρκα: ${p.brand}` : '', p.sku ? `Κωδικός: ${p.sku}` : '', ...(p.attrs || []).map((a) => `${a.name}: ${a.terms.join(', ')}`), U.stripTags(p.desc || '').slice(0, 1500), ...hits.slice(0, 4).map((h) => `Σε κατάστημα (${h.host}): ${h.name}`)].filter(Boolean).join('\n');
    return require('./lib/airesearch').suggestFor(p, facts);
  },
  // the live page of a product as Google reads it: what the site already produces, what is missing, how to fix it
  'GET /api/seo/audit': async (q) => { const site = q.site === 'st' ? 'st' : 'sf'; const r = await require('./lib/seoaudit').audit(site, q.id); try { require('./lib/quality').saveSeo(site, Number(q.id), r); } catch (_) { /* kept next time */ } return r; },
  // the quality report of a product: what is here + the last saved research / SEO check (nothing is searched from here)
  'GET /api/quality': async (q) => {
    const site = q.site === 'st' ? 'st' : 'sf';
    const r = require('./lib/quality').report(site, q.id);
    // no real code and no recent research: the research on the internet starts by itself (once: the queue keeps one
    // per product; the normal plan, not the full one — that stays a person's button)
    if (r.autoResearch && coordReady) {
      try {
        const cf = require('./lib/codefind');
        const items = cf.itemsFor([site + ':' + r.id], '');
        if (items.length) { await coord.enqueue('codes.web', webPayload(items), { dedupKey: 'codes.web:open:' + site + ':' + r.id, priority: 30, auto: true, label: 'Έρευνα στο internet: ' + String(r.name).slice(0, 60) }); r.statuses.research.autoQueued = true; }
      } catch (e) { r.statuses.research.autoError = e.message; }
    }
    return r;
  },
  // a person's own change on the product's page (title, short text, description): counts as approved
  'POST /api/fixes/manual': (b, _, ctx) => fixes.setManual(b.site === 'st' ? 'st' : 'sf', Number(b.id), String(b.field || ''), b.value, ctx.user ? ctx.user.name : ''),
  'GET /api/ai/log': () => { const d = store.read('ai-log', null) || {}; return { totals: d.totals || {}, items: (d.items || []).slice(-30).reverse() }; },
  // a site of the internet: approved (its prices count) / rejected / nothing; the list of sites by kind
  'POST /api/codes/shop': (b) => require('./lib/codefind').decideShop(b.host, b.answer),
  'GET /api/codes/sites': (q) => require('./lib/codefind').sites(q),
  'GET /api/search-keys': () => require('./lib/searchkeys').view(),
  'POST /api/search-keys': (b) => require('./lib/searchkeys').save(b),
  // what the internet research did for one product: searches, engines, pages opened, why each was kept or left out
  'GET /api/codes/trace': (q) => {
    const site = q.site === 'st' ? 'st' : 'sf';
    const id = Number(q.id);
    let key = site + ':' + id;
    if (site === 'st') { const sfId = catalog.links().stToSf.get(id); if (sfId != null) key = 'sf:' + sfId; }
    return require('./lib/codefind').traceFor(key, q) || { status: 'never' };
  },
  'GET /api/flow': (q) => require('./lib/flow').view(q),
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
    // only from the facts of the product; what the AI adds of its own (numbers not in the facts) is taken out and said
    const r = b.kind === 'translate' ? await localai.translateFull(d.descOfficial) : await localai.describeFull(d);
    return Object.assign(drafts.update(d.id, { descAI: r.html, descMode: 'ai' }), { aiNotes: r.notes || [], aiModel: r.model || '' });
  },
  'GET /api/ai/status': () => localai.status(),
  // the real test: Ollama found, the models, the chosen model, and a real answer (step by step)
  'POST /api/ai/test': () => localai.test(),
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
  'GET /api/jobs': async () => jobs.recent().concat(coordReady ? await coord.recent(10) : []).sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0)).slice(0, 15),
  'POST /api/jobs/cancel': (b) => (String(b.id || '').startsWith('q') && coordReady ? coord.cancel(b.id) : jobs.cancel(b.id)),
  // the computers of the shops (administrators)
  'GET /api/workers': async () => {
    const ws = (await coord.workersView()).map((w) => { const l = workerLoad.get(w.id); return Object.assign({}, w, { active: workerActive(w), load: l && Date.now() - l.at < 20000 ? l : null }); });
    const lq = await coord.liveOf('codes.web');
    return { workers: ws, stats: await coord.stats(), queue: { waiting: lq.filter((j) => j.status === 'queued').length, running: lq.filter((j) => j.status !== 'queued').length }, workerRev: WORKER_REV, download: workerZip(), research: researchView(ws.filter((w) => w.load).map((w) => w.load)), store: storeName() };
  },
  'POST /api/workers/pair': (b, _q, ctx) => coord.newPairing(ctx.user ? ctx.user.name : ''),
  // the one-click installer of a computer: a .cmd with this program's address and a one-time code (valid 24 hours)
  'POST /api/workers/installer': async (b, _q, ctx) => {
    const pr = await coord.newPairing(ctx.user ? ctx.user.name : '', 24 * 60);
    const until = new Date(Date.now() + pr.minutes * 60000).toLocaleString('el-GR', { timeZone: 'Europe/Athens' });
    return { name: 'SF-Kentro-Egkatastasi.cmd', text: require('./lib/installer').cmdText({ server: ctx.origin, code: pr.code, zip: workerZip(), until }), until, hours: pr.minutes / 60 };
  },
  // the whole system in one look (and one check): the program, its data, the computers, the AI, the research
  'GET /api/system/status': () => systemStatus(),
  // the safe self-repairs: which exist, and one run at once by a person (the same limits, checked again after)
  'GET /api/system/repairs': () => require('./lib/repair').list(),
  // the internet research measured for real on a computer of the shop (its result comes back: Σύστημα, Συμβάντα)
  'POST /api/system/measure': async (b) => {
    if (!coordReady) throw new Error('Το πρόγραμμα ξεκινάει· δοκίμασε σε λίγο.');
    const ws = (await coord.workersView()).filter((w) => w.online && (w.caps.types || []).includes('research.measure') && (w.caps.rev || '') >= '2026-11-23c');
    if (!ws.length) throw new Error('Κανένας υπολογιστής με την τρέχουσα έκδοση δεν είναι ανοιχτός τώρα (ενημερώνεται μόνος του σε λίγα λεπτά μετά από νέα έκδοση).');
    const j = await coord.enqueue('research.measure', { n: Math.max(5, Math.min(100, Number(b.n) || 30)) }, { dedupKey: 'research.measure', priority: 25, by: 'person', label: 'Μέτρηση της έρευνας internet (' + (Number(b.n) || 30) + ' προϊόντα)' });
    return coord.job(j.id);
  },
  'POST /api/system/repair': (b, _q, ctx) => require('./lib/repair').run(String(b.id || ''), repairDeps(), { force: true, by: ctx.user ? 'διαχειριστή' : '' }),
  // the program's log of what went wrong (lib/events.js) and the «πακέτο διάγνωσης για AI» (lib/diagnostics.js)
  'GET /api/diagnostics': (q) => ({ events: events.query({ severity: q.severity, service: q.service, code: q.code, limit: q.limit }), summary: events.summary() }),
  'GET /api/diagnostics/bundle': async () => {
    events.flush();
    const status = await systemStatus();
    return require('./lib/diagnostics').bundle({
      build: buildInfo(), workerRev: WORKER_REV, status, health: require('./lib/health').view(),
      workers: coordReady ? await coord.workersView() : [], queue: coordReady ? await coord.healthOf() : null,
      failed: coordReady ? (await coord.recent(80)).filter((j) => j.status === 'failed') : [], settings: settings.all(),
    });
  },
  'POST /api/system/check': () => systemCheck(),
  'POST /api/workers/mode': async (b) => ({ ok: await coord.setMode(String(b.id || ''), String(b.mode || '')) }),
  'POST /api/workers/perf': async (b) => ({ ok: await coord.setPerf(String(b.id || ''), String(b.profile || '')) }),
  'POST /api/workers/revoke': async (b) => ({ ok: await coord.revoke(String(b.id || '')) }),
  'GET /api/audit': (q) => audit.list(Math.min(1000, Number(q.n) || 200)),
  'POST /api/shutdown': () => { if (SERVER) throw new Error('Ο διακομιστής δεν κλείνει από εδώ.'); setTimeout(() => process.exit(0), 300); return { ok: true }; },

  // Users and sessions (server mode)
  'GET /api/session': (q, _, ctx) => ({ mode: MODE, version: VERSION, user: ctx.user || null, csrf: ctx.csrf || '', setup: SERVER && !users.count() }),
  'POST /api/login': (b, _, ctx) => { const r = users.login(b.user, b.password, ctx.ip, ctx.ua, b.remember === true); ctx.setCookie(r.sid); return { user: r.user, csrf: r.csrf }; },
  'POST /api/setup': (b, _, ctx) => { const r = users.setup(b, ctx.ip, ctx.ua); ctx.setCookie(r.sid); return { user: r.user, csrf: r.csrf }; },
  'POST /api/logout': async (b, _, ctx) => { if (ctx.sid) users.end(ctx.sid); ctx.setCookie(''); return { ok: true, saved: await sessionsSaved() }; },
  'GET /api/users': (q, _, ctx) => ({ users: users.list(), sessions: users.active(ctx.sessionKey) }),
  'POST /api/users/session-end': async (b) => { users.endById(b.id); return { ok: true, saved: await sessionsSaved() }; },
  'POST /api/users': (b) => (b.id ? users.update(b.id, b) : users.create(b)),
  'POST /api/users/delete': (b, _, ctx) => { if (ctx.user && b.id === ctx.user.id) throw new Error('Δεν διαγράφεις τον εαυτό σου.'); users.remove(b.id); return { ok: true }; },
  'POST /api/users/logout-all': async (b, _, ctx) => { users.endAll(); ctx.setCookie(''); return { ok: true, saved: await sessionsSaved() }; },

  // Phones and other PCs: the addresses to type (or scan) and a QR code for each
  'GET /api/connect': () => ({ mode: MODE, port, urls: connectUrls() }),
  'GET /api/qr': (q) => qrMatrix(q.text),
  // the whole data folder in one file (download / upload): a copy to keep somewhere else
  'POST /api/backup/make': async () => { const tmp = store.exportPath('.pack-' + crypto.randomBytes(6).toString('hex')); const r = await store.pack({ file: tmp }); const name = `sf-kentro-antigrafo-${crypto.randomBytes(6).toString('hex')}.json.gz`; const f = saveExport(name, { fromFile: tmp }); if (SERVER) setTimeout(() => { try { fs.unlinkSync(store.exportPath(f.name)); } catch (_) { /* gone */ } }, 15 * 60 * 1000).unref(); return Object.assign({ files: r.files, size: r.size }, f); },
  'POST /api/cloud/save': () => cloudsave.save('χειροκίνητα'),
  'POST /api/backup/upload': async (b) => { const r = await store.restoreFile(Buffer.from(String(b.base64 || ''), 'base64')); checks.invalidate(); suppliers.resetIndex(); fixes.invalidate(); return r; },
  'POST /api/me/password': (b, _, ctx) => { users.login(ctx.user.user, b.current, ctx.ip, ctx.ua); users.update(ctx.user.id, { password: b.password }); const r = users.startSession(users.byId(ctx.user.id), ctx.ip, ctx.ua); ctx.setCookie(r.sid); return { csrf: r.csrf }; },
};
// server mode: open without a session / only for administrators
const PUBLIC_ROUTES = new Set(['GET /api/session', 'POST /api/login', 'POST /api/setup', 'POST /api/logout']);
const ADMIN_ROUTES = new Set(['GET /api/search-keys', 'POST /api/search-keys', 'POST /api/workers/mode', 'POST /api/workers/perf', 'POST /api/workers/installer', 'POST /api/system/check', 'GET /api/diagnostics', 'GET /api/diagnostics/bundle', 'GET /api/system/repairs', 'POST /api/system/repair', 'POST /api/system/measure', 'GET /api/workers', 'POST /api/workers/pair', 'POST /api/workers/revoke', 'GET /api/audit', 'POST /api/cloud/save', 'POST /api/backup/make', 'POST /api/backup/upload', 'POST /api/unlock', 'POST /api/settings', 'POST /api/backups/restore', 'POST /api/security/pin', 'POST /api/security/remove', 'POST /api/security/minutes', 'GET /api/users', 'POST /api/users', 'POST /api/users/delete', 'POST /api/users/session-end', 'POST /api/users/logout-all', 'POST /api/competitors/delete']);

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
const QUIET_KEYS = /^(sessions|security|accents|types|market-meta|competitors-meta|catalog-meta|derived-checks|derived-fixes|derived-words|derived-meta)$|^comp-/;
store.onWrite((name) => {
  if (QUIET_KEYS.test(name) || !streams.size) return;
  const by = (reqCtx.getStore() || {}).client || '';
  if (!pendingKeys.has(name)) pendingKeys.set(name, new Set());
  pendingKeys.get(name).add(by);
  if (!flushTimer) flushTimer = setTimeout(flushEvents, 400);
});
jobs.onChange(() => { for (const st of [...streams]) if (alive(st)) sse(st.res, { jobs: true }); });
let coordTell = null;
coord.onChange(() => { if (coordTell) return; coordTell = setTimeout(() => { coordTell = null; for (const st of [...streams]) if (alive(st)) sse(st.res, { jobs: true }); }, 1000); });
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

// ---------- phones: where to connect ----------
/** Addresses other devices can use: the public name(s) when set, else this PC on the shop network / Tailscale. */
function connectUrls() {
  const out = [];
  for (const host of ALLOWED_HOSTS) out.push({ kind: 'internet', url: `https://${host}/` });
  if (PLATFORM_HOST && !ALLOWED_HOSTS.includes(PLATFORM_HOST)) out.push({ kind: 'internet', url: `https://${PLATFORM_HOST}/` });
  if (out.length) return out;
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const a of list || []) {
      if (a.family !== 'IPv4' || a.internal) continue;
      const ts = /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(a.address); // 100.64.0.0/10: Tailscale
      const lan = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a.address);
      if (ts || lan) out.push({ kind: ts ? 'tailscale' : 'lan', url: `http://${a.address}:${port}/`, name });
    }
  }
  return out.sort((x, y) => (x.kind === 'lan' ? 0 : 1) - (y.kind === 'lan' ? 0 : 1));
}
/** A QR code as rows of 0/1 (the screen draws it), only for http(s) addresses. */
function qrMatrix(text) {
  const t = String(text || '');
  if (!/^https?:\/\/[^\s]{3,200}$/.test(t)) throw new Error('Λάθος διεύθυνση.');
  const qrcode = require('qrcode-generator');
  const qr = (qrcode.default || qrcode)(0, 'M');
  qr.addData(t); qr.make();
  const n = qr.getModuleCount();
  const rows = [];
  for (let r = 0; r < n; r++) { let line = ''; for (let c = 0; c < n; c++) line += qr.isDark(r, c) ? '1' : '0'; rows.push(line); }
  return { size: n, rows };
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

// ---------- the computers of the shops: their own door ----------
// No session and no cookie: each computer has its own token (made with a pairing code, kept only as a fingerprint
// here, removable at any time). A computer can only ask for work, report progress and hand in results of ITS jobs.
let coordReady = false;
const pairTries = new Map(); // ip -> { n, at }
const AUDITED = {
  'POST /api/fixes/decide': 'απόφαση για διορθώσεις', 'POST /api/fixes/manual': 'αλλαγή με το χέρι στο προϊόν', 'POST /api/fixes/approve-sure': 'έγκριση όλων των σίγουρων', 'POST /api/fixes/export': 'αρχείο διορθώσεων',
  'POST /api/codes/find': 'αναζήτηση κωδικών στο internet', 'POST /api/codes/shop': 'έγκριση / απόρριψη καταστήματος του internet', 'POST /api/families/decide': 'οικογένεια προϊόντων (έγκριση)', 'POST /api/families/export': 'αρχεία οικογένειας προϊόντων', 'POST /api/search-keys': 'κλειδιά αναζήτησης', 'POST /api/market/export': 'αρχείο νέων τιμών', 'POST /api/market/decide': 'ίδιο / όχι ίδιο προϊόν', 'POST /api/drafts/export': 'αρχείο νέων προϊόντων',
  'POST /api/settings': 'ρυθμίσεις', 'POST /api/users': 'χρήστης (νέος / αλλαγή)', 'POST /api/users/delete': 'διαγραφή χρήστη', 'POST /api/users/session-end': 'αποσύνδεση συσκευής',
  'POST /api/workers/pair': 'κωδικός σύζευξης υπολογιστή', 'POST /api/workers/revoke': 'αφαίρεση υπολογιστή', 'POST /api/suppliers': 'αντιπρόσωπος', 'POST /api/suppliers/delete': 'διαγραφή αντιπροσώπου',
  'POST /api/backups/restore': 'επαναφορά αντιγράφου', 'POST /api/backup/upload': 'επαναφορά από αρχείο',
};
// ---------- a session taken away stays away after a restart ----------
// Every sign-out / removed device / new password is saved outside this machine at once (not with the hourly save of
// the sessions), and again every 15 seconds until it is confirmed.
let sessionsSave = null, sessionsRetry = null;
function saveSessionsNow() {
  if (!SERVER || !cloudsave.status().enabled) return Promise.resolve(true);
  sessionsSave = (async () => {
    try { const r = await cloudsave.save('ανάκληση σύνδεσης'); const ok = !(r && r.error) && !cloudsave.status().error; if (!ok) throw new Error((r && r.error) || cloudsave.status().error); clearTimeout(sessionsRetry); sessionsRetry = null; return true; } catch (e) {
      console.error('sessions save:', e.message);
      clearTimeout(sessionsRetry); sessionsRetry = setTimeout(() => { saveSessionsNow(); }, 15000); if (sessionsRetry.unref) sessionsRetry.unref();
      return false;
    }
  })();
  return sessionsSave;
}
users.whenEnded(() => { saveSessionsNow(); });
async function sessionsSaved() { return sessionsSave ? sessionsSave : true; }

// how hard each computer works right now (kept in memory only: it changes every 3 seconds)
const workerLoad = new Map();
const lnum = (v, max) => { const n = Number(v); return Number.isFinite(n) ? Math.max(0, Math.min(max, Math.round(n))) : 0; };
function cleanLoad(l) {
  l = l && typeof l === 'object' ? l : {};
  const ph = l.perHour && typeof l.perHour === 'object' ? l.perHour : {};
  const eng = l.engines && typeof l.engines === 'object' ? l.engines : {};
  return {
    at: Date.now(), cpu: lnum(l.cpu, 100), ram: lnum(l.ram, 100), ramTotalMB: lnum(l.ramTotalMB, 1e7), procMB: lnum(l.procMB, 1e6),
    runners: lnum(l.runners, 64), slots: lnum(l.slots, 64), busy: lnum(l.busy, 64), battery: !!l.battery,
    jobs: (Array.isArray(l.jobs) ? l.jobs : []).slice(0, 16).map((x) => String(x || '').slice(0, 80)),
    perHour: { products: lnum(ph.products, 1e6), pages: lnum(ph.pages, 1e6), searches: lnum(ph.searches, 1e6), jobs: lnum(ph.jobs, 1e6) },
    engines: { ddg: eng.ddg === 'paused' ? 'paused' : 'ok', bing: eng.bing === 'paused' ? 'paused' : 'ok', yahoo: eng.yahoo === 'paused' ? 'paused' : 'ok' }, dormant: !!l.dormant,
    ...(l.perf && typeof l.perf === 'object' ? { perf: { profile: ['gentle', 'normal', 'boost'].includes(l.perf.profile) ? l.perf.profile : 'normal', used: ['gentle', 'normal', 'boost'].includes(l.perf.used) ? l.perf.used : 'normal', label: String(l.perf.label || '').slice(0, 20), slots: lnum(l.perf.slots, 64), max: lnum(l.perf.max, 64), pages: lnum(l.perf.pages, 10), domainGap: lnum(l.perf.domainGap, 60000), down: !!l.perf.down, reason: String(l.perf.reason || '').slice(0, 160) } } : {}),
  };
}
function storeName() { return (() => { const c = cloudsave.status(); return !c.enabled ? 'στον φάκελο του διακομιστή' : c.where === 'βάση δεδομένων' ? 'στη βάση δεδομένων (και αντίγραφο στο GitHub κάθε μέρα)' : 'στο ιδιωτικό αποθετήριο GitHub'; })(); }
let researchMemo = { at: 0, v: null };
/** The research on the internet as a whole: how many products are left, how fast the computers go, how long it takes. */
function researchView(loads) {
  if (Date.now() - researchMemo.at > 30000 || !researchMemo.v) { try { researchMemo = { at: Date.now(), v: require('./lib/codefind').status() }; } catch (_) { researchMemo = { at: Date.now(), v: { looked: 0, withCode: 0, waiting: 0 } }; } }
  const st = researchMemo.v;
  const perHour = loads.reduce((a, l) => a + (l.perHour.products || 0), 0);
  return { looked: st.looked || 0, found: st.withCode || 0, waiting: st.waiting || 0, perHour, hoursLeft: perHour > 0 ? Math.round((st.waiting / perHour) * 10) / 10 : null };
}
let updatePack = null;
const staleSince = new Map(); // worker id → since when it reports an older revision
async function handleWorker(req, res, url, q, key0) {
  if (!SERVER || !coordReady) return send(res, 404, { error: 'Δεν υπάρχει εδώ.' });
  try {
    if (key0 === 'POST /api/worker/pair') {
      const ip = clientIp(req), t = pairTries.get(ip) || { n: 0, at: Date.now() };
      if (Date.now() - t.at > 3600e3) { t.n = 0; t.at = Date.now(); }
      if (t.n >= 10) return send(res, 429, { error: 'Πολλές προσπάθειες. Δοκίμασε σε μία ώρα.' });
      t.n++; pairTries.set(ip, t);
      const b = await readBody(req, 64 * 1024);
      const r = await coord.pair(b.code, b.name, b.caps);
      audit.record('υπολογιστής ' + r.name, 'σύζευξη υπολογιστή', r.id, null).catch(() => {});
      return send(res, 200, r);
    }
    const tok = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    const w = await coord.workerByToken(tok);
    if (!w) return send(res, 401, { error: 'Άγνωστος υπολογιστής.' });
    if (key0 === 'GET /api/worker/pack') {
      const pk = await jobtypes.packFor();
      if (q.have && q.have === pk.v) return send(res, 200, Buffer.alloc(0), 'application/gzip', { ETag: pk.v });
      return send(res, 200, pk.gz, 'application/gzip', { ETag: pk.v });
    }
    // the worker's own files, for its update by itself (only for a paired computer; built once per start of the program)
    // (a worker of an older revision gets a pack it can take: without the files it does not know yet)
    if (key0 === 'GET /api/worker/update') {
      const su = require('./lib/selfupdate');
      const old = String((w.caps && w.caps.rev) || '') < su.ROOT_FROM;
      updatePack = updatePack || {};
      const k = old ? 'old' : 'new';
      if (!updatePack[k]) updatePack[k] = su.build(__dirname, { forRev: (w.caps && w.caps.rev) || '' });
      return send(res, 200, updatePack[k].buf, 'application/gzip', { 'X-Worker-Rev': updatePack[k].rev });
    }
    // the optional search APIs of the research (keys opened only here, for a paired computer; never in a job)
    if (key0 === 'GET /api/worker/search-keys') return send(res, 200, { apis: require('./lib/searchkeys').config() });
    if (key0 === 'GET /api/worker/comp') {
      const j = await coord.rawJob(String(q.job || ''));
      if (!j || j.workerId !== w.id) return send(res, 403, { error: 'Δεν είναι δική σου εργασία.' });
      const gz = jobtypes.compFor(j, String(q.id || ''));
      return gz ? send(res, 200, gz, 'application/gzip') : send(res, 200, Buffer.alloc(0), 'application/gzip');
    }
    const b = req.method === 'POST' ? await readBody(req, key0 === 'POST /api/worker/complete' ? 30 * 1024 * 1024 : key0 === 'POST /api/worker/heartbeat' ? 2 * 1024 * 1024 : 256 * 1024) : {};
    // (rev: the worker's revision here — an older worker fetches /api/worker/update and starts again by itself)
    if (key0 === 'POST /api/worker/hello') {
      // a computer that stays on an older worker (its update failed by itself): said in the log after 20 minutes
      const rv = String((b.caps && b.caps.rev) || '');
      if (rv && rv < WORKER_REV) { const t = staleSince.get(w.id) || Date.now(); staleSince.set(w.id, t); if (Date.now() - t > 20 * 60000) events.record({ severity: 'warn', service: 'worker', code: 'WORKER_NOT_UPDATING', message: `${w.name}: μένει στην έκδοση ${rv} (τρέχουσα ${WORKER_REV}) — η αυτόματη ενημέρωση δεν πέρασε· λύση: «Αρχείο εγκατάστασης υπολογιστή» μία φορά` }); } else staleSince.delete(w.id);
      await coord.hello(w.id, b.caps); return send(res, 200, { ok: true, version: VERSION, name: w.name, mode: w.mode || 'off', perf: w.perf || 'normal', active: workerActive(w), rev: WORKER_REV }); }
    // what went wrong on a computer, into the program's log (said with the computer's name; never trusted as more than text)
    if (key0 === 'POST /api/worker/event') {
      const sv = ['worker', 'search', 'ai'].includes(b.service) ? b.service : 'worker';
      events.record({ severity: ['info', 'warn', 'error'].includes(b.severity) ? b.severity : 'warn', service: sv, code: String(b.code || 'WORKER').slice(0, 40), message: `${w.name}: ${String(b.message || '').slice(0, 300)}` });
      return send(res, 200, { ok: true });
    }
    if (key0 === 'POST /api/worker/load') { workerLoad.set(w.id, cleanLoad(b.load)); return send(res, 200, { ok: true }); }
    // a question to its AI is answered whatever the mode; other work only when it is on
    if (key0 === 'POST /api/worker/claim') { const quick = Array.isArray(b.types) && b.types.length === 1 && b.types[0] === 'ai.call'; if (!quick && !workerActive(w)) return send(res, 200, { jobs: [], paused: true, mode: w.mode || 'off' }); return send(res, 200, { jobs: await coord.claim(w.id, b.max, b.types) }); }
    if (key0 === 'POST /api/worker/heartbeat') return send(res, 200, await coord.heartbeat(w.id, String(b.id || ''), b.progress, b.log, b.partial));
    if (key0 === 'POST /api/worker/complete') { const done = bg.request(); try { return send(res, 200, await coord.complete(w.id, String(b.id || ''), String(b.idem || ''), b.result)); } finally { done(); } }
    if (key0 === 'POST /api/worker/fail') return send(res, 200, await coord.fail(w.id, String(b.id || ''), b.error, b.retryable !== false));
    return send(res, 404, { error: 'Άγνωστη λειτουργία.' });
  } catch (e) {
    return send(res, e.status || 400, { error: e.message || String(e) });
  }
}
/** Are there computers of the shops (paired, not removed)? Then the research is handed to them. */
/**
 * Codes (SKU / EAN) of products without one, from the internet: on the shops' computers when there are any (groups
 * of 20 products, they search from their own connection), else here, a few a day.
 */
async function webCodes(job, opts) {
  const o = opts || {};
  const cf = require('./lib/codefind');
  if (!o.items && await useWorkers()) {
    // (never a product that is already waiting in the queue: the same product twice was searched twice)
    const busy = new Set((await coord.liveOf('codes.web')).flatMap((j) => ((j.payload && j.payload.items) || []).map((x) => x.k)));
    const items = cf.candidates((o.max || 200) + busy.size).filter((x) => !busy.has(x.k)).slice(0, o.max || 200);
    const day = market.localDay(new Date());
    let n = 0;
    for (let i = 0; i < items.length; i += 20) { await coord.enqueue('codes.web', webPayload(items.slice(i, i + 20)), { dedupKey: `codes.web:${day}:${i / 20}`, auto: !!o.auto, priority: o.auto ? 0 : 5 }); n++; }
    job && job.log(`Κωδικοί από το internet: ${items.length} προϊόντα σε ${n} ομάδες, στους υπολογιστές των μαγαζιών.`);
    return { queued: items.length };
  }
  return cf.run(job, { max: o.max || 25, items: o.items });
}
/**
 * A group of products for the research on the internet, with what the computer needs to class the sites and to stay
 * within the limits of the settings (no key of a search API: those it asks for on its own line).
 */
function webPayload(items) {
  const cf = require('./lib/codefind');
  const s = settings.all();
  const ch = cf.contextHosts();
  return { items, own: [...cf.ownHosts()], compHosts: ch.compHosts, supplierHosts: ch.supplierHosts, limits: s.webResearch, ai: !!(s.localAI && s.localAI.enabled && s.localAI.research !== false), aiModel: (s.localAI && s.localAI.model) || '' };
}
/**
 * The free AI (Ollama) in server mode: the cloud has none, so a question goes to a shop's computer that has it
 * (first in its queue) and the answer comes back here. Only a computer that has the model asked for takes it
 * (jobtypes «ai.call» canTake). No computer with Ollama on: said plainly, with what is missing.
 */
async function aiWorkers() {
  if (!coordReady) return [];
  return (await coord.workersView()).filter((w) => w.online && w.caps && (w.caps.types || []).includes('ai.call')).map((w) => ({ id: w.id, name: w.name, models: w.caps.ollama || [], busy: w.jobs.some((j) => j.type === 'ai.call') }));
}
/** Why the AI of the computers can / cannot answer now → { ok, text } */
async function aiWhy() {
  if (!coordReady) return { ok: false, state: 'starting', text: 'Το πρόγραμμα ξεκινάει· δοκίμασε σε λίγο.' };
  const all = (await coord.workersView());
  const online = all.filter((w) => w.online);
  const ai = await aiWorkers();
  if (ai.length) return { ok: true, state: 'ok', text: `Υπολογιστής με Ollama: ${ai.map((w) => w.name + (w.models.length ? ' (' + w.models.slice(0, 3).join(', ') + ')' : '')).join(' · ')}.` };
  // a computer is on but its worker is older than this program: it is the folder, not Ollama
  const stale = online.filter((w) => !w.caps.ollamaInfo || (w.caps.rev && w.caps.rev < WORKER_REV));
  if (online.length && stale.length === online.length) return { ok: false, state: 'stale_worker', text: `Ο υπολογιστής ${stale.map((w) => w.name).join(', ')} τρέχει παλιά έκδοση του worker (${stale.map((w) => w.caps.rev || 'πολύ παλιά').join(', ')}· τρέχουσα ${WORKER_REV}): κατέβασε ξανά τον φάκελο και ξεκίνα τον SF-Kentro-Worker από εκεί. Το Ollama μάλλον είναι εντάξει.` };
  if (!all.length) return { ok: false, state: 'no_worker', text: 'Δεν υπάρχει υπολογιστής που βοηθά. Το Ollama είναι στο PC σου, όχι στο cloud: Ρυθμίσεις → Υπολογιστές → σύζευξη του PC με το Ollama (SF-Kentro-Worker).' };
  if (!online.length) return { ok: false, state: 'offline', text: `Κανένας υπολογιστής δεν είναι ανοιχτός τώρα (${all.map((w) => w.name).join(', ')}). Άνοιξε το PC με το Ollama και τον SF-Kentro-Worker.` };
  const info = online.map((w) => { const i = w.caps.ollamaInfo; return `${w.name}: ${i ? (i.ok ? i.error || 'χωρίς μοντέλο' : i.error || 'δεν βρέθηκε το Ollama') : 'παλιά έκδοση του worker (δεν ελέγχει το Ollama)'}`; });
  const noModel = online.some((w) => w.caps.ollamaInfo && w.caps.ollamaInfo.ok);
  return { ok: false, state: noModel ? 'no_model' : 'unreachable', text: 'Ο υπολογιστής που βοηθά δεν μπορεί να απαντήσει: ' + info.join(' · ') + '. Στο PC: άνοιξε το Ollama, περίμενε 1 λεπτό και ξαναδοκίμασε (στο PC: «node worker.js ai-test» δείχνει όλα τα βήματα).' };
}
/** One look at everything (fast, nothing is run): → { items: [{ id, label, ok, state, text }] } */
async function systemStatus() {
  const items = [];
  const add = (id, label, ok, state, text) => items.push({ id, label, ok, state, text });
  const m = process.memoryUsage();
  add('cloud', 'Πρόγραμμα (cloud)', true, 'ok', `Έκδοση ${VERSION}${build.sha ? ' · ' + build.sha.slice(0, 7) : ''} · μνήμη ${Math.round(m.rss / 1048576)} MB · σε λειτουργία ${Math.round(process.uptime() / 60)}′`);
  // the data: proved by the last real checks (the database answers and writes, the saving, the daily copy, the queue)
  const H = require('./lib/health').view();
  const HL = { db: 'Βάση δεδομένων', save: 'Αποθήκευση δεδομένων', backup: 'Ημερήσιο αντίγραφο (GitHub)', queue: 'Ουρά εργασιών' };
  for (const id of ['db', 'save', 'backup', 'queue']) {
    const r = H[id];
    if (!r) { add(id, HL[id], false, 'unknown', 'Δεν έχει ελεγχθεί ακόμα (γίνεται μόνο του σε λίγο, ή πάτα «Έλεγχος όλων»).'); continue; }
    if (id === 'db' && r.level === 'unknown' && !process.env.SFK_DATABASE_URL) continue; // no database here: nothing to say
    add(id, HL[id], r.level === 'ok', r.level, r.text + (r.at ? ` (έλεγχος ${new Date(r.at).toLocaleTimeString('el-GR', { timeZone: 'Europe/Athens' })})` : ''));
  }
  const ws = coordReady ? await coord.workersView() : [];
  const on = ws.filter((w) => w.online);
  if (!ws.length) add('computer', 'Υπολογιστής', false, 'none', 'Κανένας υπολογιστής δεν έχει συνδεθεί. Η δουλειά γίνεται αργά στο cloud. «Αρχείο εγκατάστασης» → διπλό κλικ στο PC.');
  else if (!on.length) add('computer', 'Υπολογιστής', false, 'offline', `${ws.map((w) => w.name).join(', ')}: κλειστός τώρα (ανοίγει μόνος του με τα Windows).`);
  else {
    const old = on.filter((w) => (w.caps.rev || '') < WORKER_REV);
    const act = on.filter((w) => workerActive(w));
    add('computer', 'Υπολογιστής', !old.length, old.length ? 'updating' : act.length ? 'working' : 'stopped',
      on.map((w) => `${w.name}: ${workerActive(w) ? 'δουλεύει' : w.mode === 'app' ? 'περιμένει (δουλεύει μόνο με ανοιχτό πρόγραμμα)' : 'σταματημένος — δεν χρησιμοποιεί πόρους'}${(w.caps.rev || '') < WORKER_REV ? ' · ενημερώνεται μόνος του' : ''}`).join(' · '));
  }
  const s = settings.all();
  if (!(s.localAI && s.localAI.enabled)) add('ai', 'AI (Ollama)', false, 'disabled', 'Κλειστό (Ρυθμίσεις → AI → «Ενεργό»).');
  else { const w = await aiWhy(); add('ai', 'AI (Ollama)', w.ok, w.state || (w.ok ? 'ok' : 'error'), w.text); }
  const loads = [...workerLoad.values()].filter((l) => Date.now() - l.at < 60000);
  const paused = loads.flatMap((l) => Object.entries(l.engines || {}).filter(([, v]) => v === 'paused').map(([k]) => k));
  const rv = researchView(loads);
  const meas = store.read('research-measure', null);
  if (meas && meas.at) add('measure', 'Μέτρηση έρευνας', meas.stats && meas.stats.wrongColour === 0, meas.stats && meas.stats.wrongColour === 0 ? 'ok' : 'warn', `${new Date(meas.at).toLocaleDateString('el-GR', { timeZone: 'Europe/Athens' })}${meas.worker ? ' · ' + meas.worker : ''}: ${meas.summary}`);
  add('research', 'Έρευνα internet', !paused.length, paused.length ? 'paused' : 'ok', `${rv.waiting} προϊόντα μένουν · ${rv.perHour} / ώρα${paused.length ? ' · σε παύση: ' + [...new Set(paused)].join(', ') + ' (ξαναδοκιμάζει μόνη της)' : ''}${act0(ws) ? '' : ' · τη δουλειά την κάνει το cloud (αργά)'}`);
  // one level per line (ok / warn / crit / unknown) and the whole: never green only because nothing was written down
  const LEVEL = { ok: 'ok', working: 'ok', stopped: 'ok', disabled: 'ok', none: 'warn', offline: 'warn', updating: 'warn', paused: 'warn', warn: 'warn', error: 'crit', crit: 'crit', unknown: 'unknown', unreachable: 'crit', no_model: 'warn', model_missing: 'warn', stale_worker: 'warn', no_worker: 'warn', generation_failed: 'crit', starting: 'unknown' };
  for (const x of items) x.level = LEVEL[x.state] || (x.ok ? 'ok' : 'warn');
  // a line a safe self-repair can help: its button (the same action runs by itself every 15 minutes)
  try { const R = require('./lib/repair').ACTIONS; const d = repairDeps(); for (const x of items) for (const [id, a] of Object.entries(R)) if (a.check === x.id && a.when(H, d)) x.repair = { id, label: a.label }; } catch (_) { /* fine */ }
  const level = require('./lib/health').worst(items.map((x) => x.level));
  return { at: new Date().toISOString(), level, ok: level === 'ok', items };
}
function act0(ws) { return ws.some((w) => w.online && workerActive(w)); }
/** The check of everything, for real: the data store answers, the AI writes an answer through the computer. */
/** The real checks of the data (lib/health.js): the database, the saving, the daily copy, the queue. */
async function healthProbe() {
  const health = require('./lib/health');
  const pgOn = !!process.env.SFK_DATABASE_URL;
  const pool = pgOn && cloudsave.poolNow ? await cloudsave.poolNow().catch(() => null) : null;
  if (pgOn && !pool) health.set('db', 'crit', 'Δεν γίνεται σύνδεση με τη βάση δεδομένων.');
  const gh = require('./lib/cloudsave').status();
  const H = await health.probe({ pool: pgOn ? pool : null, saveStatus: cloudsave.status(), ghEnabled: pgOn && gh.enabled, coord: coordReady ? coord : null });
  // GitHub alone (no database): every save is the copy
  if (!pgOn && gh.enabled) health.set('backup', gh.savedAt ? 'ok' : 'unknown', gh.savedAt ? 'Τα δεδομένα σώζονται στο GitHub (τελευταία ' + new Date(gh.savedAt).toLocaleTimeString('el-GR', { timeZone: 'Europe/Athens' }) + ').' : 'Δεν έχει γίνει ακόμα αποθήκευση στο GitHub.');
  return health.view();
}
/** What the safe self-repairs may use (lib/repair.js): only the program's own running parts. */
function repairDeps() {
  const health = require('./lib/health');
  return {
    probe: () => healthProbe(), view: () => health.view(),
    // the database again, three times, waiting longer each time (a paused / restarting database comes back by itself)
    dbReconnect: async () => { for (const wait of [5000, 15000, 30000]) { const p = cloudsave.poolNow ? await cloudsave.poolNow().catch(() => null) : null; if (p) { try { await p.query('SELECT 1'); return; } catch (_) { /* again */ } } await new Promise((r) => setTimeout(r, wait)); } throw new Error('η βάση δεν απάντησε σε 3 προσπάθειες'); },
    saveNow: async () => { const r = await cloudsave.save('αυτοεπισκευή'); if (r && r.error) throw new Error(r.error); },
    sweepQueue: async () => { if (coordReady) await coord.sweep(); },
    backupNow: async () => { const r = cloudsave.backupNow ? await cloudsave.backupNow() : await cloudsave.save('αντίγραφο (αυτοεπισκευή)'); if (r && (r.error || r.ok === false)) throw new Error(r.error || 'δεν έγινε'); },
    rebuild: async () => { engine.mark('checks'); },
    engineError: () => engine.status().error || '',
  };
}
async function systemCheck() {
  const st = {};
  const steps = [];
  const t0 = Date.now();
  // the real checks first (the database answers and writes, the saving, the daily copy, the queue), then the screen
  const H = await healthProbe();
  for (const [id, label] of [['db', 'Βάση'], ['save', 'Αποθήκευση'], ['backup', 'Αντίγραφο GitHub'], ['queue', 'Ουρά']]) {
    const r = H[id];
    if (!r || (id === 'db' && !process.env.SFK_DATABASE_URL)) continue;
    steps.push({ id, ok: r.level === 'ok', state: r.level, text: `${label}: ${r.text}` });
  }
  const s = settings.all();
  if (s.localAI && s.localAI.enabled) {
    const t = await localai.test();
    steps.push({ id: 'ai', ok: t.ok, state: t.state, text: t.ok ? `AI: πραγματική απάντηση από ${t.model} σε ${(t.ms / 1000).toFixed(1)}″ μέσω του υπολογιστή` + (t.metrics && t.metrics.tokPerSec ? ` (${t.metrics.tokPerSec} tokens/″)` : '') : 'AI: ' + ((t.steps.find((x) => !x.ok) || {}).text || t.state), steps: t.steps });
  } else steps.push({ id: 'ai', ok: false, state: 'disabled', text: 'AI: κλειστό (δεν ελέγχθηκε)' });
  Object.assign(st, await systemStatus());
  return Object.assign(st, { checked: true, ms: Date.now() - t0, steps });
}
async function askComputerAI(pathName, body, timeout, meta) {
  if (!coordReady) throw new Error('Το πρόγραμμα ξεκινάει· δοκίμασε σε λίγο.');
  const ws = await aiWorkers();
  if (!ws.length) throw Object.assign(new Error((await aiWhy()).text), { code: 'no_worker' });
  const model = (meta && meta.model) || '';
  // a computer that has the model; the least busy first
  const can = model ? ws.filter((w) => !w.models.length || w.models.includes(model)) : ws;
  if (!can.length) throw Object.assign(new Error(`Κανένας υπολογιστής δεν έχει το μοντέλο ${model} (έχουν: ${[...new Set(ws.flatMap((w) => w.models))].join(', ') || 'κανένα'}). Στο PC: ollama pull ${model}`), { code: 'model_missing' });
  const target = can.slice().sort((a, b) => Number(a.busy) - Number(b.busy))[0];
  const wait = timeout || 300000;
  const j = await coord.enqueue('ai.call', { path: pathName, body: body || null, model, worker: can.length === 1 ? target.id : '', timeout: wait }, { priority: 50, label: 'Τοπικό AI (Ollama)' });
  // the computer must take it soon (its AI lane asks every 1,5″): a question nobody takes is said, not waited for
  const takeBy = Date.now() + 45000;
  const until = Date.now() + wait + 60000;
  for (;;) {
    const v = await coord.job(j.id);
    if (v && v.status === 'completed') return v.result || {};
    if (v && (v.status === 'failed' || v.status === 'cancelled')) throw new Error(v.error || 'Το AI του υπολογιστή δεν απάντησε.');
    if (v && v.queued && Date.now() > takeBy) { await coord.cancel(j.id).catch(() => {}); throw new Error(`Ο υπολογιστής ${target.name} δεν πήρε την ερώτηση σε 45″ (παλιά έκδοση του φακέλου SF-Kentro-Worker, ή κλειστή η λωρίδα του AI). Ξεκίνα ξανά τον worker.`); }
    if (Date.now() > until) { await coord.cancel(j.id).catch(() => {}); throw new Error('Το AI του υπολογιστή άργησε πολύ. Δοκίμασε ξανά ή διάλεξε μικρότερο μοντέλο.'); }
    await new Promise((x) => setTimeout(x, 1000));
  }
}
if (SERVER) localai.setRemote({ call: askComputerAI, models: aiWorkers, why: aiWhy });

async function feedWebResearch() {
  if (!coordReady) return;
  const live = await coord.liveOf('codes.web');
  // the screens show which products wait for the search
  market.setQueuedWeb(live.flatMap((j) => ((j.payload && j.payload.items) || []).map((x) => x.k)));
  if (settings.all().webResearchAuto === false) return;
  const ws = (await coord.workersView()).filter((w) => w.online && w.caps && (w.caps.types || []).includes('codes.web') && !w.caps.battery && workerActive(w));
  if (!ws.length) return;
  // every runner of every computer busy, and two groups more waiting for each computer
  const want = ws.reduce((n, w) => n + (Number(w.caps.slots) || 1) + 2, 0) - live.length;
  if (want <= 0) return;
  const busy = new Set();
  for (const j of live) for (const it of (j.payload && j.payload.items) || []) busy.add(it.k);
  const cf = require('./lib/codefind');
  const items = cf.candidates(400).filter((x) => !busy.has(x.k)).slice(0, want * 20);
  if (!items.length) return;
  for (let i = 0; i < items.length; i += 20) await coord.enqueue('codes.web', webPayload(items.slice(i, i + 20)), { dedupKey: 'codes.web:' + items[i].k + ':' + Date.now(), auto: true, priority: 0 });
}
async function useWorkers() { return SERVER && coordReady && (await coord.workersView()).length > 0; }
/**
 * The price research through the shared queue: one job per competitor (a shop's computer takes it; the cloud only
 * when none can). This job waits for them, shows how far they are, and marks the day done when all are in.
 */
async function distributedResearch(job, opts) {
  const o = opts || {};
  if (job.waitingOnQueue) job.waitingOnQueue(true); // the cloud may take a shop meanwhile, when no computer can
  const research = require('./lib/research');
  const undetected = market.competitors().filter((c) => c.enabled !== false && (c.kind === 'auto' || !c.kind));
  if (undetected.length) { job.progress(0, 0, 'Έλεγχος ανταγωνιστών…'); await market.detectAll(null, (c) => undetected.some((u) => u.id === c.id)); }
  const comps = market.readable();
  if (!comps.length) throw new Error('Κανένας ανταγωνιστής δεν διαβάζεται αυτόματα.');
  const prog = research.progressNote(false);
  const day = market.localDay(new Date());
  const budget = Math.max(20, Number(settings.all().sitemapPages) || 300);
  const ids = [];
  for (const c of comps) {
    if (prog.done[c.id] != null) continue; // already in today (a stop or a restart loses nothing)
    const j = await coord.enqueue('market.shop', { comp: { id: c.id, name: c.name, url: c.url, kind: c.kind, sitemaps: c.sitemaps || [], foreign: !!c.foreign }, budget },
      { dedupKey: `market.shop:${c.id}:${day}`, priority: o.auto ? 0 : 5, auto: !!o.auto, by: o.by || '', label: 'Τιμές: ' + c.name });
    ids.push(j.id);
  }
  job.log(`${comps.length} καταστήματα· ${ids.length} μπήκαν στη σειρά για τους υπολογιστές${comps.length - ids.length ? ', ' + (comps.length - ids.length) + ' είχαν ήδη γίνει σήμερα' : ''}.`);
  const END = new Set(['completed', 'failed', 'cancelled']);
  for (;;) {
    const st = await Promise.all(ids.map((id) => coord.job(id)));
    const ended = st.filter((x) => x && END.has(x.status));
    const run = st.filter((x) => x && !END.has(x.status) && !x.queued).map((x) => `${x.label.replace(/^Τιμές: /, '')} (${x.worker || '…'})`);
    job.progress(ended.length, ids.length, run.length ? 'Τώρα: ' + run.slice(0, 3).join(' · ') : ended.length < ids.length ? 'Περιμένουν υπολογιστή…' : 'Ολοκλήρωση…');
    if (job.cancelled()) { for (const id of ids) await coord.cancel(id); const m = store.read('market-meta', {}); m.pausedUntil = new Date(Date.now() + 2 * 36e5).toISOString(); store.write('market-meta', m); return { stopped: true }; }
    if (ended.length === ids.length) {
      const bad = st.filter((x) => x && x.status === 'failed');
      for (const x of bad) job.log(`${x.label}: ${x.error || 'απέτυχε'}`);
      const meta = store.read('market-meta', {}); meta.errors = bad.map((x) => ({ name: x.label.replace(/^Τιμές: /, ''), error: x.error || '' })); store.write('market-meta', meta);
      break;
    }
    await new Promise((x) => setTimeout(x, 3000));
  }
  const fin = await research.finishDay();
  job.progress(1, 1, fin.complete ? `Έτοιμο: ${fin.withData.toLocaleString('el-GR')} από ${fin.compared.toLocaleString('el-GR')} προϊόντα έχουν τιμές αγοράς.` : `Ολοκληρώθηκαν ${fin.done} από ${fin.of} καταστήματα· τα υπόλοιπα στην επόμενη έρευνα.`);
  return Object.assign({ distributed: true }, fin);
}

async function handleApi(req, res, url) {
  if (starting) return send(res, 503, { error: 'Το πρόγραμμα ξεκινάει (φέρνει τα δεδομένα)… δοκίμασε σε λίγο.', starting: true }, null, { 'Retry-After': '3' });
  const q = Object.fromEntries(url.searchParams);
  const key0 = req.method + ' ' + url.pathname;
  if (url.pathname.startsWith('/api/worker/')) return handleWorker(req, res, url, q, key0);
  // the program is open somewhere (a screen asks something): the computers set to «only while the program is open» work
  if (SERVER && key0 !== 'GET /api/events') lastUiAt = Date.now();
  if (key0 === 'GET /api/events') return serveEvents(req, res, url);
  if (req.method === 'GET' && url.pathname.startsWith('/api/export/')) {
    const sess = sessionOf(req, false);
    if (SERVER ? !sess : !safeEq(q.t, TOKEN)) return send(res, 403, { error: 'Απαγορεύεται.' });
    if (!SERVER && security.isLocked()) return send(res, 423, { error: 'Το πρόγραμμα είναι κλειδωμένο.', locked: true });
    const name = decodeURIComponent(url.pathname.slice('/api/export/'.length));
    // a copy of all the data only for administrators (it is made only by them, too)
    if (SERVER && /^sf-kentro-antigrafo/.test(path.basename(name)) && sess.user.role !== 'admin') return send(res, 403, { error: 'Μόνο για διαχειριστές.' });
    const p = store.exportPath(path.basename(name));
    if (!fs.existsSync(p)) return send(res, 404, { error: 'Δεν βρέθηκε το αρχείο.' });
    return send(res, 200, fs.readFileSync(p), MIME[path.extname(p).toLowerCase()] || 'application/octet-stream', { 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(path.basename(p))}` });
  }
  const ctx = { ip: clientIp(req), ua: String(req.headers['user-agent'] || ''), client: String(req.headers['x-client'] || '').slice(0, 40), cookies: [],
    // the address people use for this program (for the installer of a computer)
    origin: String(process.env.RENDER_EXTERNAL_URL || '').replace(/\/+$/, '') || `${String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() || 'http'}://${String(req.headers.host || '').replace(/[^\w.:-]/g, '')}` };
  ctx.setCookie = (sid) => ctx.cookies.push(sessionCookie(req, sid));
  if (SERVER) {
    // every call needs a logged-in user and the session's own token; settings and users only for administrators
    const sid = cookieOf(req, 'sfk_sid');
    const sess = users.session(sid, req.headers['x-active'] === '1');
    if (sess) Object.assign(ctx, { sid, sessionKey: sess.key, user: sess.user, csrf: sess.csrf });
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
    const id = url.pathname.slice(10);
    const j = jobs.get(id) || (coordReady && id.startsWith('q') ? await coord.job(id) : null);
    return j ? send(res, 200, j) : send(res, 404, { error: 'Η εργασία δεν υπάρχει πια.' });
  }
  const fn = routes[key0];
  if (!fn) return send(res, 404, { error: 'Άγνωστη λειτουργία.' });
  let done = () => {};
  const rid = crypto.randomBytes(4).toString('hex'); // the request's id: an error on the screen and in the log share it
  const cpu0 = process.cpuUsage();
  const timing = () => { const c = process.cpuUsage(cpu0); return { 'Server-Timing': `cpu;dur=${((c.user + c.system) / 1000).toFixed(1)}` }; };
  try {
    // the data of the screens is loaded once at start, in the background: the first requests wait for it (seconds)
    if (!NO_DATA.test(url.pathname)) await engine.ready();
    // (counted only now: a request waiting for that work must not slow the very work it waits for)
    done = bg.request(); // the background work steps aside while somebody waits for an answer
    // before login only small bodies are read
    // bodies: small before login; a few MB for everything else; files (copies, CSV, supplier lists) up to 60 MB
    const limit = SERVER && !ctx.user ? 64 * 1024 : BIG_BODY.has(key0) ? 60 * 1024 * 1024 : 4 * 1024 * 1024;
    const body = req.method === 'POST' ? await readBody(req, limit) : {};
    const out = await reqCtx.run({ client: ctx.client }, () => fn(req.method === 'GET' ? q : body, q, ctx, null));
    if (AUDITED[key0]) audit.record(ctx.user ? ctx.user.name : (SERVER ? '' : 'αυτός ο υπολογιστής'), AUDITED[key0], '', audit.summary(body)).catch(() => {});
    send(res, 200, out === undefined ? { ok: true } : out, null, Object.assign(timing(), ctx.cookies.length ? { 'Set-Cookie': ctx.cookies } : null));
  } catch (e) {
    // an error of the program (not a message for the person): into the log with the request's id, said on the screen
    if (!(e && (e.status || e.network)) && !/^[Α-Ωα-ωΆ-ώ]/.test(String(e && e.message))) {
      console.error('[api]', rid, key0, e);
      events.record({ severity: 'error', service: 'server', code: 'API_ERROR', message: `${key0}: ${e && e.message ? e.message : e}`, rid, detail: e && e.stack ? String(e.stack).split('\n').slice(1, 4).join(' | ') : '' });
      return send(res, 400, { error: (e && e.message ? e.message : String(e)) + ` (κωδικός σφάλματος ${rid})`, rid }, null, Object.assign({ 'X-Request-Id': rid }, ctx.cookies.length ? { 'Set-Cookie': ctx.cookies } : null));
    }
    send(res, 400, { error: e && e.message ? e.message : String(e) }, null, ctx.cookies.length ? { 'Set-Cookie': ctx.cookies } : null);
  } finally { done(); }
}
// what never needs the products in memory (sign-in, settings, jobs, phones)
const NO_DATA = /^\/api\/(session|login|logout|setup|state|jobs|users|me\/|connect|qr|lock|unlock|security|settings$|events|cloud)/;

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
    if (origin) { let oh = ''; try { oh = new URL(origin).host.toLowerCase(); } catch (_) { /* bad origin */ } if (oh !== host && !(PLATFORM_HOST && oh === PLATFORM_HOST)) return send(res, 403, 'Forbidden', 'text/plain'); }
    if (isHttps(req)) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
  } else {
    if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host)) return send(res, 403, 'Forbidden', 'text/plain');
    const origin = req.headers.origin;
    if (origin && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin)) return send(res, 403, 'Forbidden', 'text/plain');
  }
  const url = new URL(req.url, 'http://127.0.0.1');
  if (url.pathname === '/ping') { const e = engine.status(); return send(res, 200, { app: 'sf-kentro', version: VERSION, sha: build.sha.slice(0, 12), branch: build.branch, workerRev: WORKER_REV, up: Math.round(process.uptime()), starting, ready: e.ready, busy: e.busy, step: e.step || '', buildMs: e.buildMs || 0, bootMs: e.bootMs, mem: Math.round(process.memoryUsage().rss / 1048576), heap: Math.round(process.memoryUsage().heapUsed / 1048576), ext: Math.round(process.memoryUsage().external / 1048576), lag: lagMax(), store: (() => { const c = cloudsave.status(); return !c.enabled ? 'disk' : c.where === 'βάση δεδομένων' ? (c.error ? 'db-error' : c.loadedAt ? 'db' : 'db-starting') : 'github'; })() }); }
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
    if (SERVER) return cloudData().then(() => {
      const code = users.ensureAdmin();
      if (code) { console.log(''); console.log('  FIRST START: open the program in a browser and use this setup code: ' + code); console.log('  ΠΡΩΤΗ ΕΚΚΙΝΗΣΗ: άνοιξε το πρόγραμμα στον browser και γράψε τον κωδικό: ' + code); }
      const others = connectUrls();
      if (others.length) { console.log(''); console.log('  Phones and other PCs / Κινητά και άλλοι υπολογιστές:'); for (const u of others) console.log('    ' + u.url + (u.kind === 'lan' ? '   (shop Wi-Fi / Wi-Fi του μαγαζιού)' : '')); console.log('  (QR codes: Settings → Phone / Ρυθμίσεις → Κινητό)'); }
      console.log('');
      // a shop PC started with SF-Kentro-Server.cmd is also a working PC: open the program on it
      if (process.platform === 'win32' && !process.env.SFK_NO_OPEN) openDefault(url);
      return afterStart();
    }).catch(fatal);
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
let lastUiAt = 0;
// the newest worker (app/worker.js REV): an older one on a computer is said so in Ρυθμίσεις → Υπολογιστές
const WORKER_REV = require('./lib/workerrev');
// The worker's folder: the zip of exactly the code this server runs (Render says which repository and branch).
function workerZip() {
  const slug = /^[\w.-]+\/[\w.-]+$/.test(process.env.RENDER_GIT_REPO_SLUG || '') ? process.env.RENDER_GIT_REPO_SLUG : 'alexdimaras/Sf-Kentriko';
  const branch = /^[\w./-]+$/.test(process.env.RENDER_GIT_BRANCH || '') ? process.env.RENDER_GIT_BRANCH : 'claude/friendly-sagan-bfjrkj';
  return `https://github.com/${slug}/archive/refs/heads/${branch}.zip`;
}
/** Should this computer work now? 'off' (the default: a new computer uses nothing until it is switched on) · 'app': while a screen of the program was open in the last 2 minutes · 'always'. */
function workerActive(w) { const m = (w && w.mode) || 'off'; return m === 'off' ? false : m === 'app' ? Date.now() - lastUiAt < 120000 : true; }
// which change of the code runs here: from the host (Render gives the commit), its title and date from GitHub (public)
const build = { version: VERSION, sha: String(process.env.RENDER_GIT_COMMIT || process.env.SFK_GIT_COMMIT || '').slice(0, 40), branch: process.env.RENDER_GIT_BRANCH || '', startedAt: new Date(STARTED_AT).toISOString(), message: '', committedAt: '' };
function buildInfo() { return Object.assign({}, build, { url: build.sha ? 'https://github.com/alexdimaras/Sf-Kentriko/commit/' + build.sha : '' }); }
if (build.sha) {
  setTimeout(() => {
    fetch('https://api.github.com/repos/alexdimaras/Sf-Kentriko/commits/' + build.sha, { headers: { 'User-Agent': 'sf-kentro', Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(15000) })
      .then((r) => (r.ok ? r.json() : null)).then((j) => { if (j && j.commit) { build.message = String(j.commit.message || '').split('\n')[0].slice(0, 300); build.committedAt = j.commit.committer && j.commit.committer.date || ''; } }).catch(() => {});
  }, 5000).unref();
}
// how long the program could not answer, at worst, in the last minute (a small cloud machine shows its limits here)
const lags = [];
let lagAt = Date.now();
setInterval(() => { const now = Date.now(); lags.push([now, Math.max(0, now - lagAt - 500)]); lagAt = now; while (lags.length && now - lags[0][0] > 60000) lags.shift(); }, 500).unref();
function lagMax() { let m = 0; for (const [, v] of lags) if (v > m) m = v; return m; }

/**
 * A long job that changes what the screens show (research, sources): nothing is built again while it runs, and the
 * fixes are built ONCE at its end — two builds at the same time took the small cloud machine over its 512 MB.
 */
async function heldWhile(fn) {
  engine.hold();
  try { return await fn(); } finally { engine.release(); }
}

function afterStart() {
  cloudsave.start();
  // the shared queue: in the database when there is one, else in the data folder
  (async () => {
    const pool = cloudsave.poolNow ? await cloudsave.poolNow().catch((e) => { console.error('database:', e.message); return null; }) : null;
    coord.use(pool ? require('./lib/db').coordBackend(pool) : require('./lib/coord-store').fileBackend());
    if (pool) audit.usePool(Promise.resolve(pool));
    jobtypes.register();
    // what the cloud itself was doing when it stopped goes back to the queue now (not after an hour)
    try { const n = await coord.recoverCloud(); if (n) console.log(`queue: ${n} εργασίες του cloud ξανά στη σειρά μετά την επανεκκίνηση`); } catch (e) { console.error('queue recover:', e.message); }
    coord.setActiveCheck(workerActive); // a stopped computer never keeps work from the cloud
    coordReady = true;
    setInterval(() => { coord.sweep().catch((e) => console.error('queue:', e.message)); }, 15000).unref();
    // the cloud takes a waiting job only when no computer of the shops can (one at a time, in this program)
    if (SERVER) setInterval(() => { coord.cloudTick({ canRun: () => !jobs.heavyWorking() }).catch((e) => console.error('queue (cloud):', e.message)); }, 10000).unref();
    // While a shop's computer that can search is switched on, the research on the internet never stops: a group of 20
    // products for each of its runners and two more waiting, fed again as they are taken (like a clock, not once a day).
    if (SERVER) setInterval(() => { feedWebResearch().catch((e) => console.error('internet research:', e.message)); }, Number(process.env.SFK_FEED_MS) || 30000).unref();
  })().catch((e) => console.error('queue start:', e.message));
  jobs.setHeavyLimit(SMALL ? 1 : 2);
  catalog.closeOpenReads(); // a reading that was running when the program stopped did not finish: say so
  // everything the screens need is loaded (or calculated) now, in the background, in slices
  const t0 = Date.now();
  engine.start().then(() => console.log(`Ready: the screens' data prepared in ${Math.round((Date.now() - t0) / 1000)} s.`));
  engine.onChange(() => { for (const st of [...streams]) if (alive(st)) sse(st.res, { keys: ['derived-meta'] }); });
  if (SERVER) {
    // free cloud plan (Render): it sleeps after 15 minutes without visits and then needs a minute or more to wake
    // up — a visit to itself every 10 minutes keeps it awake (one program stays within the free monthly hours)
    const self = String(process.env.RENDER_EXTERNAL_URL || '').replace(/\/+$/, '');
    if (self && process.env.SFK_KEEP_AWAKE !== '0') setInterval(() => { fetch(self + '/ping').catch(() => {}); }, 10 * 60 * 1000).unref();
  }
  // the daily copy of the data — not on a free cloud host: its disk is erased at every restart, the copy that counts
  // is the one in the private GitHub repository (and compressing 60 MB there would take all the processor for a minute)
  const dailyCopy = () => { if (!cloudsave.status().enabled) store.backupAsync(14).catch((e) => console.error('backup:', e.message)); };
  engine.ready().then(dailyCopy);
  if (!SERVER) { heartbeat(); setInterval(heartbeat, 60 * 1000).unref(); process.on('exit', () => { try { fs.unlinkSync(instanceFile()); } catch (_) { /* gone */ } }); }
  setInterval(dailyCopy, 3600 * 1000).unref();
  events.setRev(build.sha ? build.sha.slice(0, 7) : VERSION);
  setInterval(() => { try { events.flush(); } catch (e) { console.error('events:', e.message); } }, 60 * 1000).unref();
  // the real checks of the data every 15 minutes (so «Σύστημα» is never green only because nothing was checked)
  if (SERVER) { setTimeout(() => healthProbe().catch(() => {}), 20 * 1000).unref(); setInterval(() => { healthProbe().then(() => require('./lib/repair').auto(repairDeps())).catch((e) => console.error('health:', e.message)); }, 15 * 60000).unref(); }
  // a competitor's price written by hand stops counting at its end date, also when no research runs meanwhile
  setInterval(() => { try { if (market.manualExpired()) market.recomputeAsync().catch((e) => console.error('market recompute:', e.message)); } catch (_) { /* next hour */ } }, 3600 * 1000).unref();
  engine.ready().then(async () => {
    // after an update with new market rules (e.g. out-of-stock offers no longer count): recalculate the saved results once
    try {
      const meta = store.read('market-meta', {});
      if ((meta.logic || 0) < market.LOGIC_VERSION) { await market.recomputeAsync(); store.write('market-meta', Object.assign({}, store.read('market-meta', {}), { logic: market.LOGIC_VERSION })); }
    } catch (e) { console.error('market recompute:', e.message); }
    const s = settings.all();
    const sum = catalog.summary();
    const stale = ['sf', 'st'].filter((site) => sum[site].source === 'api' && s.autoSyncHours && (!sum[site].syncedAt || (Date.now() - new Date(sum[site].syncedAt)) / 36e5 > s.autoSyncHours));
    if (stale.length && !process.env.SFK_NO_AUTOSYNC) routes['POST /api/sync']({ sites: stale }, null, null, { auto: true });
  });
  // daily competitor research: the first time the program is open each day, after the products are read
  if (!process.env.SFK_NO_AUTOSYNC) {
    const tick = () => {
      try {
        if (!engine.status().ready) return;
        const busy = jobs.running().some((j) => j.heavy);
        if (busy) return;
        // once a week, after the daily research: look for suppliers of brands without one (for approval)
        if (!market.dailyDue()) {
          if (settings.all().supplierFindAuto !== false && supplierfind.weeklyDue() && catalog.load('sf').products.length) jobs.start('supplierfind', 'Μηνιαία αναζήτηση αντιπροσώπων', (job) => supplierfind.run(job, { limit: 40, auto: true, yieldTo: 'supplierfind-one' }), { heavy: true, auto: true });
          return;
        }
        if (!catalog.load('sf').products.length) return;
        // B2B passwords sealed with the PIN: wait for the first unlock (up to 3 hours), so the B2B prices are read too
        const sealed = pricelist.autoSources().some((x) => x.catalogMode === 'b2b' && String(x.b2bPass || '').startsWith('vault:'));
        if (sealed && !security.status().vaultOpen && Date.now() - STARTED_AT < 3 * 36e5) return;
        console.log('daily market research');
        jobs.start('market', 'Ημερήσια ενημέρωση (αντιπρόσωποι και τιμές αγοράς)', (job) => heldWhile(async () => {
          // 1. suppliers with a feed / catalog / B2B: fresh prices and costs
          for (const s of pricelist.autoSources()) {
            if (job.cancelled()) return null;
            try { const r = await pricelist.refresh(s.id, job); job.log(`${s.name}: ${r ? r.items + ' κωδικοί, ' + r.changed + ' αλλαγές τιμής' : 'διακόπηκε'}`); } catch (e) { job.log(`${s.name}: ${e.message}`); }
          }
          // 2. competitor prices for every product (on the computers of the shops when there are any)
          const res = (await useWorkers()) ? await distributedResearch(job, { auto: true }) : await market.run(null, job, { auto: true });
          // 3. missing descriptions / photos / brands: sources from the suppliers, for approval (a few pages a day)
          if (!job.cancelled()) { try { const f = await fixes.findSources(job, { maxPages: 60, viaQueue: await useWorkers() }); if (f) job.log(`Διορθώσεις: πηγές για ${f.found} προϊόντα (${f.pages} σελίδες αντιπροσώπων).`); } catch (e) { job.log('Διορθώσεις: ' + e.message); } }
          // 4. codes (SKU / EAN) of products without one, from the shops of the internet with the same product
          if (!job.cancelled()) { try { const c = await webCodes(job, { auto: true, max: 25 }); if (c && c.looked != null) job.log(`Κωδικοί από το internet: ${c.looked} προϊόντα, κάτι βρέθηκε για ${c.withCode}.`); } catch (e) { job.log('Κωδικοί από το internet: ' + e.message); } }
          return res;
        }), { heavy: true, auto: true });
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

process.on('uncaughtException', (e) => { console.error('Error:', e && e.stack ? e.stack : e); try { events.record({ severity: 'error', service: 'server', code: 'UNCAUGHT', message: e && e.message ? e.message : String(e), detail: e && e.stack ? String(e.stack).split('\n').slice(1, 4).join(' | ') : '' }); } catch (_) { /* fine */ } });
// on a cloud host the data is saved before it stops (at most 20 seconds)
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, async () => { try { users.flush(); } catch (_) { /* ignore */ } try { events.flush(); } catch (_) { /* ignore */ } try { await Promise.race([cloudsave.save('κλείσιμο'), new Promise((x) => setTimeout(x, 20000))]); } catch (_) { /* ignore */ } process.exit(0); });
process.on('unhandledRejection', (e) => { console.error('Error:', e && e.stack ? e.stack : e); try { events.record({ severity: 'error', service: 'server', code: 'UNHANDLED_REJECTION', message: e && e.message ? e.message : String(e), detail: e && e.stack ? String(e.stack).split('\n').slice(1, 4).join(' | ') : '' }); } catch (_) { /* fine */ } });

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
/**
 * Free cloud host: the data saved in the private GitHub repository is read right after the program opens its door.
 * Until it is back nothing is answered from the (empty) disk: the screens say "starting" and try again by themselves.
 */
let starting = cloudsave.status().enabled;
function cloudData() {
  if (!cloudsave.status().enabled) return Promise.resolve();
  return cloudsave.restore().then((r) => console.log(r && r.first ? 'Cloud data: first start (nothing saved yet).' : `Cloud data: ${r ? r.files : 0} files restored${r && r.ms ? ' in ' + Math.round(r.ms / 1000) + ' s' : ''}.`))
    .catch((e) => console.error('Cloud data could not be read:', e.message)).finally(() => { starting = false; });
}
main();
