'use strict';
// Reports: an interactive page that opens in a Chrome tab (product cards with photos, filters, search,
// sorting, details, selection, copy, CSV, print) and a formatted Excel file for exports.
// WooCommerce import files stay CSV — these are for looking, checking and sharing.
const settings = require('./settings');
const U = require('./util');

const PILLS = {
  severity: { critical: ['Κρίσιμο', 'crit'], high: ['Σημαντικό', 'warn'], medium: ['Μέτριο', 'mid'], low: ['Χαμηλό', 'low'], info: ['Πληροφορία', 'info'] },
  verdict: { lower: ['Μείωσε', 'warn'], raise: ['Μπορείς να ανεβάσεις', 'info'], hold: ['Σωστή τιμή', 'ok'], watch: ['Μόνο ενημέρωση', 'mid'], nodata: ['Χωρίς στοιχεία', 'low'] },
  flag: { used: ['Μετράει', 'ok'], suspect: ['Ύποπτη τιμή', 'crit'], out: ['Εξαντλημένο', 'low'], stale: ['Παλιά τιμή', 'low'], high: ['Πολύ ακριβό', 'low'], foreign: ['Εξωτερικό', 'low'], similar: ['Παρόμοιο;', 'mid'], ignored: ['Δεν μετράει', 'low'] },
  match: { exact: ['Ίδιο', 'ok'], similar: ['Παρόμοιο;', 'mid'] },
  stock: { true: ['Διαθέσιμο', 'ok'], false: ['Εξαντλημένο', 'low'] },
  ads: { banned: ['Όχι διαφήμιση', 'crit'], google: ['Όχι Google', 'warn'], caution: ['Προσοχή', 'mid'], meta18: ['Meta 18+', 'info'], ok: ['Διαφήμιση ΟΚ', 'ok'] },
  plstatus: { new: ['Νέο για εμάς', 'info'], diff: ['Άλλη τιμή', 'warn'], same: ['Ίδια τιμή', 'ok'], loss: ['Κάτω από κόστος', 'crit'] },
  confidence: { high: ['3+ καταστήματα', 'ok'], medium: ['2 καταστήματα', 'mid'], low: ['1 κατάστημα', 'warn'] },
};
const pillText = (map, v) => { const x = PILLS[map] && PILLS[map][String(v)]; return x ? x[0] : (v == null ? '' : String(v)); };

// ---------- Report definitions ----------
function siteName(site) { return (settings.all().sites[site] || {}).name || site; }
function productMap(site) {
  const catalog = require('./catalog');
  return new Map(catalog.load(site).products.map((p) => [p.id, p]));
}
const full = (p) => (p && p.images && p.images[0]) || '';

function checkReport(id) {
  const checks = require('./checks');
  const r = checks.cached();
  const c = r.checks.find((x) => x.id === id);
  if (!c) throw new Error('Δεν βρέθηκε ο έλεγχος.');
  const hasFix = c.items.some((i) => typeof i.fix === 'string' && i.fix);
  const hasWhy = c.items.some((i) => i.why);
  const pm = c.site ? productMap(c.site) : new Map();
  const catalog = require('./catalog');
  return {
    title: c.title, subtitle: siteName(c.site) + ' · ' + pillText('severity', c.severity) + ' · ' + c.items.length.toLocaleString('el-GR') + ' προϊόντα', help: c.help,
    columns: [
      { key: 'img', label: '', type: 'img' },
      { key: 'name', label: 'Προϊόν', type: 'name', width: 46 },
      { key: 'sku', label: 'Κωδικός', type: 'code', width: 14 },
      { key: 'brand', label: 'Μάρκα', type: 'text', facet: true, width: 16 },
      { key: 'price', label: 'Τιμή', type: 'money', width: 11 },
      { key: 'stock', label: 'Απόθεμα', type: 'pill', map: 'stock', facet: true, width: 12 },
      { key: 'cats', label: 'Κατηγορίες', type: 'text', width: 30, facetSplit: true },
      hasWhy ? { key: 'why', label: 'Τι βρέθηκε', type: 'text', width: 40, facet: c.items.length > 20 } : null,
      hasFix ? { key: 'fix', label: 'Πρόταση', type: 'text', width: 46 } : null,
    ].filter(Boolean),
    card: { img: 'img', full: 'imgFull', title: 'name', sub: ['brand', 'sku'], price: 'price', badges: ['stock'], note: 'why', fix: 'fix', tags: 'cats' },
    rows: c.items.map((i) => {
      const p = pm.get(i.id);
      return { img: i.img, imgFull: full(p), name: i.name, url: i.url, sku: i.sku, brand: i.brand, price: i.price, stock: p ? p.inStock : null, cats: p ? (p.catNames || []).join(', ') : '', why: i.why || '', fix: typeof i.fix === 'string' ? i.fix : '', ads: p && /ads/.test(id) ? catalog.adStatus(c.site, p).level : undefined };
    }),
    file: 'elegxos-' + id,
  };
}

function checksReport() {
  const checks = require('./checks');
  const r = checks.cached();
  const rows = r.checks.filter((c) => c.items.length).map((c) => ({
    severity: c.severity, title: c.title, site: siteName(c.site || ''), count: c.items.length, help: c.help,
    detail: c.items.slice(0, 1000).map((i) => ({ img: i.img, name: i.name, url: i.url, sku: i.sku, price: i.price, why: i.why || '', fix: typeof i.fix === 'string' ? i.fix : '' })),
  }));
  const order = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
  rows.sort((a, b) => order[a.severity] - order[b.severity] || b.count - a.count);
  return {
    title: 'Έλεγχοι καταστημάτων', subtitle: rows.length + ' έλεγχοι με ευρήματα',
    summary: ['critical', 'high', 'medium', 'low'].map((k) => ({ label: pillText('severity', k), value: rows.filter((x) => x.severity === k).reduce((a, x) => a + x.count, 0), tone: PILLS.severity[k][1], filter: { key: 'severity', value: pillText('severity', k) } })),
    columns: [
      { key: 'severity', label: 'Σοβαρότητα', type: 'pill', map: 'severity', facet: true, width: 14 },
      { key: 'title', label: 'Έλεγχος', type: 'text', width: 40 },
      { key: 'site', label: 'Site', type: 'text', facet: true, width: 18 },
      { key: 'count', label: 'Προϊόντα', type: 'num', width: 10 },
      { key: 'help', label: 'Γιατί μετράει', type: 'text', width: 60 },
    ],
    detail: { label: 'Προϊόντα', columns: [{ key: 'img', label: '', type: 'img' }, { key: 'name', label: 'Προϊόν', type: 'name' }, { key: 'sku', label: 'Κωδικός', type: 'code' }, { key: 'price', label: 'Τιμή', type: 'money' }, { key: 'why', label: 'Τι βρέθηκε', type: 'text' }, { key: 'fix', label: 'Πρόταση', type: 'text' }] },
    rows, file: 'elegxoi',
  };
}

function marketReport(site, q) {
  const market = require('./market');
  const ov = market.overview(site, Object.assign({}, q || {}, { per: 0 }));
  const pm = productMap(site);
  const rows = ov.rows.map((r) => ({
    img: r.img, imgFull: full(pm.get(r.id)), name: r.name, url: r.url, sku: r.sku, brand: r.brand, ourPrice: r.ourPrice,
    min: r.stats.min || null, minShop: r.stats.minShop || '', median: r.stats.median || null, max: r.stats.max || null, count: r.stats.count, similar: r.stats.similar || 0, suspect: r.stats.suspect || 0,
    suggested: r.suggested || null, diff: r.suggested && r.ourPrice ? U.r2(r.suggested - r.ourPrice) : null,
    diffPct: r.vsMedian, rank: r.rank ? r.rank + 'ος από ' + r.of : '',
    verdict: r.action, confidence: r.stats.confidence || '', master: r.master ? 'από ' + siteName('sf') : '',
    why: (r.careful ? 'Μεγάλη πτώση: έλεγξε πριν αλλάξεις. ' : '') + (r.reason || ''),
    detail: r.competitors.filter((o) => !o.ignored).sort((a, b) => a.price - b.price).map((o) => ({ shop: o.shop, name: o.name, url: o.url, price: o.price, vsUs: r.ourPrice ? U.r2((o.price - r.ourPrice) / r.ourPrice) : null, prevPrice: o.prevPrice || null, stock: o.inStock !== false, flag: o.flag || (o.match === 'exact' ? 'used' : 'similar'), why: o.note || o.why || (o.manual ? 'καταχωρήθηκε με το χέρι' : ''), img: o.img || '' })),
  }));
  const m = ov.meta || {};
  const pill = (k) => ({ key: 'verdict', value: pillText('verdict', k) });
  return {
    title: 'Τιμές αγοράς · ' + siteName(site),
    subtitle: (m.lastRun ? 'Έρευνα ' + new Date(m.lastRun).toLocaleString('el-GR') + ' · ' : '') + rows.length.toLocaleString('el-GR') + ' προϊόντα με στοιχεία από ' + (m.competitors || '?') + ' καταστήματα',
    help: `Μετράνε μόνο τα «Ίδια» προϊόντα που είναι διαθέσιμα στο άλλο κατάστημα. Εξαντλημένα, παλιές τιμές και ύποπτες τιμές (κάτω από το κόστος μας ή πολύ κάτω από τους άλλους) δεν μετράνε. Αλλαγή τιμής προτείνεται μόνο όταν συμφωνούν τουλάχιστον ${settings.all().minShops || 2} καταστήματα.`,
    summary: [
      { label: 'Μείωσε (ακριβότερα από την αγορά)', value: ov.counts.lower, tone: 'warn', filter: pill('lower') },
      { label: 'Μπορείς να ανεβάσεις', value: ov.counts.raise, tone: 'info', filter: pill('raise') },
      { label: 'Μόνο ενημέρωση (1 κατάστημα / ύποπτη τιμή)', value: ov.counts.watch, tone: 'mid', filter: pill('watch') },
      { label: 'Σωστή τιμή', value: ov.counts.hold, tone: 'ok', filter: pill('hold') },
    ],
    columns: [
      { key: 'img', label: '', type: 'img' },
      { key: 'name', label: 'Προϊόν', type: 'name', width: 44 },
      { key: 'sku', label: 'Κωδικός', type: 'code', width: 12 },
      { key: 'brand', label: 'Μάρκα', type: 'text', facet: true, width: 14 },
      { key: 'ourPrice', label: 'Δική μας', type: 'money', width: 11, strong: true },
      { key: 'min', label: 'Φθηνότερη', type: 'money', width: 11 },
      { key: 'minShop', label: 'Φθηνότερο κατάστημα', type: 'text', facet: true, width: 16 },
      { key: 'median', label: 'Μέση αγοράς', type: 'money', width: 11 },
      { key: 'max', label: 'Ακριβότερη', type: 'money', width: 11 },
      { key: 'diffPct', label: 'Εμείς vs μέση', type: 'pct', width: 11 },
      { key: 'rank', label: 'Θέση μας', type: 'text', width: 10 },
      { key: 'verdict', label: 'Απόφαση', type: 'pill', map: 'verdict', facet: true, width: 16 },
      { key: 'suggested', label: 'Νέα τιμή', type: 'money', width: 12, strong: true },
      { key: 'diff', label: 'Αλλαγή', type: 'diff', width: 10 },
      { key: 'why', label: 'Γιατί', type: 'text', width: 50 },
      { key: 'count', label: 'Καταστ.', type: 'num', width: 8 },
      { key: 'confidence', label: 'Σιγουριά', type: 'pill', map: 'confidence', facet: true, width: 14 },
      site === 'st' ? { key: 'master', label: 'Τιμή', type: 'text', facet: true, width: 14 } : null,
    ].filter(Boolean),
    card: { img: 'img', full: 'imgFull', title: 'name', sub: ['brand', 'sku'], price: 'ourPrice', priceLabel: 'Δική μας', price2: 'suggested', price2Label: 'Νέα τιμή', badges: ['verdict', 'confidence'], note: 'why', range: true },
    detail: { label: 'Ανταγωνιστές', columns: [{ key: 'img', label: '', type: 'img' }, { key: 'shop', label: 'Κατάστημα', type: 'text' }, { key: 'name', label: 'Προϊόν τους', type: 'name' }, { key: 'price', label: 'Τιμή', type: 'money' }, { key: 'vsUs', label: 'vs εμάς', type: 'pct' }, { key: 'prevPrice', label: 'Πριν', type: 'money' }, { key: 'stock', label: 'Απόθεμα', type: 'pill', map: 'stock' }, { key: 'flag', label: 'Μετράει;', type: 'pill', map: 'flag' }, { key: 'why', label: 'Σημείωση', type: 'text' }] },
    rows, file: 'times-agoras-' + site,
  };
}

function changesReport() {
  const store = require('./store');
  const list = store.read('market-changes', []);
  return {
    title: 'Αλλαγές τιμών ανταγωνιστών', subtitle: list.length + ' αλλαγές από τις τελευταίες έρευνες',
    columns: [
      { key: 'at', label: 'Ημερομηνία', type: 'date', width: 16 },
      { key: 'name', label: 'Δικό μας προϊόν', type: 'text', width: 44 },
      { key: 'shop', label: 'Κατάστημα', type: 'text', facet: true, width: 16 },
      { key: 'from', label: 'Από', type: 'money', width: 10 },
      { key: 'to', label: 'Σε', type: 'money', width: 10 },
      { key: 'change', label: 'Μεταβολή', type: 'pct', width: 10 },
      { key: 'ours', label: 'Δική μας', type: 'money', width: 10 },
      { key: 'url', label: 'Σελίδα τους', type: 'link', width: 30 },
    ],
    rows: list.map((c) => ({ at: c.at, name: c.name, shop: c.shop, from: c.from, to: c.to, change: c.from ? U.r2((c.to - c.from) / c.from) : null, ours: c.ours, url: c.url })),
    file: 'allages-timon',
  };
}

function pricelistReport(supplierId, site) {
  const pricelist = require('./pricelist');
  const cmp = pricelist.compare(supplierId, site);
  if (!cmp) throw new Error('Δεν υπάρχει τιμοκατάλογος.');
  const name = cmp.supplier ? cmp.supplier.name : 'Αντιπρόσωπος';
  return {
    title: 'Τιμοκατάλογος · ' + name, subtitle: (cmp.fileName || '') + ' · ' + cmp.rows.length.toLocaleString('el-GR') + ' κωδικοί · σύγκριση με ' + siteName(cmp.site),
    summary: [
      { label: 'Νέα για εμάς', value: cmp.counts.new, tone: 'info', filter: { key: 'status', value: pillText('plstatus', 'new') } },
      { label: 'Άλλη τιμή', value: cmp.counts.diff, tone: 'warn', filter: { key: 'status', value: pillText('plstatus', 'diff') } },
      { label: 'Κάτω από κόστος', value: cmp.counts.loss, tone: 'crit', filter: { key: 'status', value: pillText('plstatus', 'loss') } },
      { label: 'Άλλαξαν από την προηγούμενη λίστα', value: cmp.counts.changed, tone: 'mid' },
    ],
    columns: [
      { key: 'img', label: '', type: 'img' },
      { key: 'code', label: 'Κωδικός', type: 'code', width: 14 },
      { key: 'name', label: 'Όνομα αντιπροσώπου', type: 'name', width: 40 },
      { key: 'brand', label: 'Μάρκα', type: 'text', facet: true, width: 14 },
      { key: 'supplierPrice', label: 'Τιμή αντιπρ.', type: 'money', width: 11 },
      { key: 'prevPrice', label: 'Πριν', type: 'money', width: 10 },
      { key: 'retail', label: 'Προτ. λιανική', type: 'money', width: 12, strong: true },
      { key: 'ours', label: 'Δικό μας προϊόν', type: 'text', width: 40 },
      { key: 'ourPrice', label: 'Δική μας τιμή', type: 'money', width: 11 },
      { key: 'margin', label: 'Περιθώριο', type: 'pctv', width: 10 },
      { key: 'status', label: 'Κατάσταση', type: 'pill', map: 'plstatus', facet: true, width: 14 },
    ],
    card: { img: 'img', title: 'name', sub: ['brand', 'code'], price: 'supplierPrice', priceLabel: 'Τιμή αντιπροσώπου', price2: 'retail', price2Label: 'Προτεινόμενη λιανική', badges: ['status'], note: 'ours', noteLabel: 'Δικό μας: ' },
    rows: cmp.rows.map((r) => ({ img: r.image, code: r.code, name: r.name, url: r.url || '', brand: r.brand, supplierPrice: r.supplierPrice, prevPrice: r.changed ? r.prevPrice : null, retail: r.retail, ours: r.match ? r.match.name : '', ourPrice: r.match ? r.match.price : null, margin: r.margin, status: r.status })),
    file: 'timokatalogos-' + U.slugify(name),
  };
}

function productsReport(q) {
  const catalog = require('./catalog');
  const site = q.site === 'st' ? 'st' : 'sf';
  const all = [];
  for (let page = 1; ; page++) {
    const v = catalog.productsView(Object.assign({}, q, { per: 500, page }));
    all.push(...v.rows);
    if (all.length >= v.total || !v.rows.length) break;
  }
  const pm = productMap(site);
  const other = site === 'sf' ? 'st' : 'sf';
  const ONLY = { missing: 'λείπουν από ' + siteName(other), both: 'και στα δύο sites', sale: 'σε προσφορά', noimg: 'χωρίς φωτογραφία', out: 'εξαντλημένα', nosku: 'χωρίς κωδικό', noads: 'απαγορεύονται στις διαφημίσεις', nogoogle: 'όχι στο Google' };
  return {
    title: 'Προϊόντα · ' + siteName(site),
    subtitle: all.length.toLocaleString('el-GR') + ' προϊόντα' + (q.only && ONLY[q.only] ? ' · ' + ONLY[q.only] : '') + (q.brand ? ' · ' + q.brand : '') + (q.search ? ' · αναζήτηση «' + q.search + '»' : ''),
    summary: [
      { label: 'Όχι διαφήμιση', value: all.filter((r) => r.ads === 'banned').length, tone: 'crit', filter: { key: 'ads', value: pillText('ads', 'banned') } },
      { label: 'Όχι Google', value: all.filter((r) => r.ads === 'google').length, tone: 'warn', filter: { key: 'ads', value: pillText('ads', 'google') } },
      { label: 'Εξαντλημένα', value: all.filter((r) => !r.inStock).length, tone: 'low', filter: { key: 'stock', value: pillText('stock', false) } },
      { label: 'Χωρίς φωτογραφία', value: all.filter((r) => !r.imgCount).length, tone: 'mid' },
    ],
    columns: [
      { key: 'img', label: '', type: 'img' },
      { key: 'name', label: 'Προϊόν', type: 'name', width: 48 },
      { key: 'sku', label: 'Κωδικός', type: 'code', width: 14 },
      { key: 'brand', label: 'Μάρκα', type: 'text', facet: true, width: 16 },
      { key: 'price', label: 'Τιμή', type: 'money', width: 11 },
      { key: 'otherPrice', label: 'Τιμή στο ' + siteName(other), type: 'money', width: 12 },
      { key: 'stock', label: 'Απόθεμα', type: 'pill', map: 'stock', facet: true, width: 12 },
      { key: 'ads', label: 'Διαφημίσεις', type: 'pill', map: 'ads', facet: true, width: 14 },
      { key: 'adsWhy', label: 'Γιατί', type: 'text', width: 30 },
      { key: 'cats', label: 'Κατηγορίες', type: 'text', width: 30, facetSplit: true },
      { key: 'supplier', label: 'Αντιπρόσωπος', type: 'text', facet: true, width: 16 },
    ],
    card: { img: 'img', full: 'imgFull', title: 'name', sub: ['brand', 'sku'], price: 'price', badges: ['ads', 'stock'], note: 'adsWhy', tags: 'cats' },
    rows: all.map((r) => ({ img: r.img, imgFull: full(pm.get(r.id)), name: r.name, url: r.url, sku: r.sku, brand: r.brand, price: r.price, otherPrice: r.other ? r.other.price : null, stock: r.inStock, ads: r.ads, adsWhy: r.ads === 'ok' ? '' : r.adsWhy, cats: (r.cats || []).join(', '), supplier: r.supplier })),
    file: 'proionta-' + site,
  };
}

function build(kind, p) {
  const rep = buildRaw(kind, p || {});
  if (rep && !rep.kind) rep.kind = kind;
  return rep;
}
function buildRaw(kind, p) {
  if (kind === 'check') return checkReport(p.id);
  if (kind === 'checks') return checksReport();
  if (kind === 'market') return marketReport(p.site === 'st' ? 'st' : 'sf', p);
  if (kind === 'changes') return changesReport();
  if (kind === 'pricelist') return pricelistReport(p.supplierId, p.site);
  if (kind === 'products') return productsReport(p);
  throw new Error('Άγνωστη αναφορά.');
}

// ---------- Interactive page ----------
function html(rep) { return require('./reportpage').page(rep, PILLS); }

// ---------- Formatted Excel ----------
const TONE_FILL = { ok: 'FFE3F1E5', warn: 'FFFBEFD9', crit: 'FFF9E1DF', mid: 'FFEFE8F6', info: 'FFE2EDF7', low: 'FFECEDEA' };
async function xlsx(rep) {
  const ExcelJS = require('exceljs');
  const wb = new ExcelJS.Workbook();
  wb.creator = 'SF Κέντρο';
  wb.created = new Date();
  const addSheet = (name, columns, rows, opts) => {
    const ws = wb.addWorksheet(name.slice(0, 31), { views: [{ state: 'frozen', ySplit: 1 }] });
    const cols = columns.filter((c) => c.type !== 'img');
    ws.columns = cols.map((c) => ({ header: c.label || ' ', key: c.key, width: c.width || (c.type === 'money' ? 12 : c.type === 'name' ? 44 : 16) }));
    for (const r of rows) {
      const vals = {};
      for (const c of cols) {
        let v = (opts && opts.get) ? opts.get(r, c) : r[c.key];
        if (c.type === 'pill') v = pillText(c.map, v);
        else if (c.type === 'date') v = v ? new Date(v) : null;
        else if (['money', 'diff', 'num', 'pct', 'pctv'].includes(c.type)) v = v == null || v === '' || isNaN(v) ? null : Number(v);
        vals[c.key] = v;
      }
      const row = ws.addRow(vals);
      cols.forEach((c, i) => {
        const cell = row.getCell(i + 1);
        if (c.type === 'money' || c.type === 'diff') cell.numFmt = '#,##0.00 "€";[Red]-#,##0.00 "€"';
        if (c.type === 'pct') cell.numFmt = '+0%;[Red]-0%;0%';
        if (c.type === 'pctv') cell.numFmt = '0"%"';
        if (c.type === 'date') cell.numFmt = 'dd/mm/yyyy hh:mm';
        if (c.type === 'name' && r.url) cell.value = { text: String(vals[c.key] || ''), hyperlink: r.url };
        if (c.type === 'link' && r[c.key]) cell.value = { text: 'άνοιγμα', hyperlink: r[c.key] };
        if ((c.type === 'name' && r.url) || (c.type === 'link' && r[c.key])) cell.font = { color: { argb: 'FF245A8C' }, underline: true };
        if (c.type === 'pill') { const x = PILLS[c.map] && PILLS[c.map][String(r[c.key])]; if (x) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: TONE_FILL[x[1]] } }; }
        if (c.strong) cell.font = Object.assign({}, cell.font || {}, { bold: true });
        if (c.width >= 30) cell.alignment = { wrapText: true, vertical: 'top' };
        else cell.alignment = { vertical: 'top' };
      });
    }
    const head = ws.getRow(1);
    head.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4B5D3A' } };
    head.alignment = { vertical: 'middle', wrapText: true };
    head.height = 30;
    if (cols.length) ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols.length } };
    return ws;
  };
  addSheet(rep.sheet || 'Αναφορά', rep.columns, rep.rows);
  if (rep.detail) {
    const dcols = [{ key: '_parent', label: rep.columns.find((c) => c.type === 'name' || c.key === 'title') ? (rep.columns.find((c) => c.type === 'name' || c.key === 'title').label) : 'Γραμμή', type: 'text', width: 44 }].concat(rep.detail.columns.map((c) => Object.assign({ width: c.type === 'name' ? 44 : c.type === 'text' ? 28 : 12 }, c)));
    const flat = [];
    const pk = (rep.columns.find((c) => c.type === 'name' || c.key === 'title') || {}).key;
    for (const r of rep.rows) for (const d of r.detail || []) flat.push(Object.assign({ _parent: pk ? r[pk] : '' }, d));
    addSheet(rep.detail.label || 'Λεπτομέρειες', dcols, flat);
  }
  const info = wb.addWorksheet('Πληροφορίες');
  info.columns = [{ width: 26 }, { width: 90 }];
  const lines = [['Αναφορά', rep.title], ['Περιγραφή', rep.subtitle || ''], ['Σημείωση', rep.help || ''], ['Δημιουργήθηκε', new Date().toLocaleString('el-GR')]].concat((rep.summary || []).map((s) => [s.label, s.value]));
  for (const l of lines) { const row = info.addRow(l); row.getCell(1).font = { bold: true }; row.getCell(2).alignment = { wrapText: true }; }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

module.exports = { build, html, xlsx, PILLS };
