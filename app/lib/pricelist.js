'use strict';
// Supplier price lists and product feeds (Excel / CSV / XML, file or link): map columns once,
// then every new list shows price changes, products we don't have yet, and ready update files.
const path = require('path');
const store = require('./store');
const settings = require('./settings');
const http = require('./http');
const U = require('./util');

const FIELD_LABELS = {
  code: 'Κωδικός', ean: 'EAN / Barcode', name: 'Όνομα προϊόντος', brand: 'Μάρκα', price: 'Τιμή',
  category: 'Κατηγορία', desc: 'Περιγραφή', images: 'Φωτογραφίες', url: 'Σύνδεσμος', color: 'Χρώμα', size: 'Μέγεθος',
  group: 'Κωδικός μοντέλου (ομάδα μεγεθών)', stock: 'Διαθεσιμότητα',
};
const GUESS = {
  code: [/^(sku|code|κωδ|κωδικος|item ?code|product ?code|ref|reference|part ?(no|number)|article|artikel|mpn|id)$/, /κωδικ|sku|^code|item.?no|art.?nr/],
  ean: [/ean|barcode|gtin|upc/],
  name: [/^(name|title|ονομα|τιτλος|ονομασια|product ?name|item ?name|bezeichnung)$/, /ονομ|title|name|ονομασ|bezeichnung/],
  brand: [/brand|μαρκα|κατασκευαστ|manufacturer|vendor|marke|hersteller/],
  price: [/τιμη|price|λιανικ|retail|χονδρ|wholesale|cost|κοστος|preis|net|καθαρ/],
  category: [/categ|κατηγορ|kategorie|cat$/],
  desc: [/desc|περιγραφ|beschreibung/],
  images: [/image|εικον|photo|φωτο|picture|img|bild/],
  url: [/url|link|συνδεσμ/],
  color: [/colou?r|χρωμ|farbe/],
  size: [/size|μεγεθ|νουμερ|grosse|größe/],
  group: [/parent|group|γονικ|family|style|model|μοντελ/],
  stock: [/stock|αποθεμ|διαθεσιμ|availability|qty|quantity|ποσοτ|bestand/],
};

function key(h) { return U.stripTonos(String(h || '')).toLowerCase().replace(/[_\s]+/g, ' ').trim(); }

// ---------- Reading files ----------
function rowsFromBuffer(buf, fileName) {
  const ext = path.extname(String(fileName || '')).toLowerCase();
  const head = buf.slice(0, 200).toString('utf8').trimStart();
  if (ext === '.xml' || head.startsWith('<?xml') || /^<[a-z_]/i.test(head)) return rowsFromXml(U.decodeText(buf));
  if (['.xlsx', '.xls', '.ods', '.xlsm'].includes(ext) || (buf[0] === 0x50 && buf[1] === 0x4b) || (buf[0] === 0xd0 && buf[1] === 0xcf)) return rowsFromExcel(buf);
  if (head.startsWith('[') || head.startsWith('{')) return rowsFromJson(U.decodeText(buf));
  return rowsFromCsv(U.decodeText(buf));
}
function rowsFromCsv(text) {
  const { rows } = U.parseCSV(text);
  // header = first row with at least 2 non-empty cells
  let h = 0;
  while (h < Math.min(rows.length, 15) && rows[h].filter((c) => String(c).trim()).length < 2) h++;
  const headers = (rows[h] || []).map((x, i) => String(x).trim() || 'Στήλη ' + (i + 1));
  const out = rows.slice(h + 1).map((r) => { const o = {}; headers.forEach((k, i) => { o[k] = String(r[i] == null ? '' : r[i]).trim(); }); return o; })
    .filter((o) => Object.values(o).some((v) => v));
  return { headers, rows: out };
}
function rowsFromExcel(buf) {
  const XLSX = require('@e965/xlsx');
  const wb = XLSX.read(buf, { type: 'buffer', cellDates: false, dense: true });
  // Largest sheet wins
  let best = null;
  for (const name of wb.SheetNames) {
    const arr = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: false, defval: '' });
    if (!best || arr.length > best.length) best = arr;
  }
  best = best || [];
  let h = 0;
  while (h < Math.min(best.length, 15) && best[h].filter((c) => String(c).trim()).length < 2) h++;
  const headers = (best[h] || []).map((x, i) => String(x).trim() || 'Στήλη ' + (i + 1));
  const rows = best.slice(h + 1).map((r) => { const o = {}; headers.forEach((k, i) => { o[k] = String(r[i] == null ? '' : r[i]).trim(); }); return o; })
    .filter((o) => Object.values(o).some((v) => v));
  return { headers, rows };
}
function rowsFromJson(text) {
  let d = JSON.parse(text);
  if (!Array.isArray(d)) d = findLargestArray(d) || [];
  const rows = d.filter((x) => x && typeof x === 'object').map((x) => flatten(x));
  return { headers: headersOf(rows), rows };
}
function rowsFromXml(text) {
  const { XMLParser } = require('fast-xml-parser');
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@', removeNSPrefix: true, parseTagValue: false, trimValues: true, cdataPropName: false });
  const doc = parser.parse(text);
  let arr = findLargestArray(doc);
  if (!arr) {
    // single record feeds
    const first = Object.values(doc).find((v) => v && typeof v === 'object');
    arr = first ? [first] : [];
  }
  const rows = arr.filter((x) => x && typeof x === 'object').map((x) => flatten(x));
  return { headers: headersOf(rows), rows };
}
function findLargestArray(o, depth) {
  depth = depth || 0;
  if (!o || typeof o !== 'object' || depth > 8) return null;
  let best = null;
  if (Array.isArray(o) && o.length >= 1 && o.every((x) => x && typeof x === 'object' && !Array.isArray(x))) best = o;
  for (const v of Array.isArray(o) ? o : Object.values(o)) {
    if (!v || typeof v !== 'object') continue;
    const inner = findLargestArray(v, depth + 1);
    if (inner && (!best || inner.length > best.length)) best = inner;
  }
  return best;
}
function flatten(o, prefix, out) {
  out = out || {};
  for (const [k, v] of Object.entries(o)) {
    let name = (prefix ? prefix + '.' : '') + (k === '#text' ? 'τιμή' : k.replace(/^@/, ''));
    if (k.startsWith('@') && Object.prototype.hasOwnProperty.call(o, k.slice(1))) name += ' (ιδιότητα)';
    if (v == null) continue;
    if (Array.isArray(v)) {
      const vals = v.map((x) => (x && typeof x === 'object' ? (x['#text'] != null ? x['#text'] : Object.values(x).filter((y) => typeof y !== 'object').join(' ')) : x)).filter((x) => x !== '' && x != null);
      out[name] = vals.join(', ');
    } else if (typeof v === 'object') {
      const keys = Object.keys(v);
      if (keys.length === 1 && Array.isArray(v[keys[0]])) out[name] = v[keys[0]].map((x) => (x && typeof x === 'object' ? x['#text'] || '' : x)).join(', ');
      else flatten(v, name, out);
    } else out[name] = String(v).trim();
  }
  return out;
}
function headersOf(rows) {
  const s = new Set();
  for (const r of rows.slice(0, 200)) for (const k of Object.keys(r)) s.add(k);
  return [...s];
}

function guessMapping(headers, rows) {
  const mapping = {};
  const used = new Set();
  const avgLen = (h) => { let n = 0, t = 0; for (const r of rows.slice(0, 50)) { if (r[h]) { n++; t += String(r[h]).length; } } return n ? t / n : 0; };
  for (const field of Object.keys(GUESS)) {
    for (const re of GUESS[field]) {
      const h = headers.find((x) => !used.has(x) && re.test(key(x)));
      if (h) { mapping[field] = h; used.add(h); break; }
    }
  }
  // "Περιγραφή" in Greek price lists is often the product name.
  if (!mapping.name && mapping.desc && avgLen(mapping.desc) < 140) { mapping.name = mapping.desc; delete mapping.desc; }
  if (mapping.desc && avgLen(mapping.desc) < 25) delete mapping.desc;
  // Price kind from header
  let priceKind = 'retail', vatIncluded = true;
  if (mapping.price) {
    const k = key(mapping.price);
    if (/χονδρ|wholesale|cost|κοστος|net|καθαρ|dealer|b2b|χωρις φπα|excl/.test(k)) { priceKind = 'cost'; vatIncluded = false; }
    if (/λιανικ|retail|msrp|προτειν|rrp|uvp/.test(k)) { priceKind = 'retail'; vatIncluded = !/χωρις φπα|excl|net/.test(k); }
  }
  return { mapping, priceKind, vatIncluded };
}

async function load(input) {
  let buf, name = input.fileName || 'list';
  if (input.url) {
    const r = await http.get(input.url, { timeout: 60000, retries: 1, raw: false, accept: '*/*' });
    buf = r.buf;
    name = new URL(r.url || input.url).pathname.split('/').pop() || 'feed';
  } else if (input.base64) {
    buf = Buffer.from(input.base64, 'base64');
  } else throw new Error('Δώσε αρχείο ή σύνδεσμο.');
  if (!buf || !buf.length) throw new Error('Το αρχείο είναι κενό.');
  const isPdf = /\.pdf$/i.test(name) || buf.slice(0, 5).toString('latin1') === '%PDF-';
  const parsed = isPdf ? await require('./pdflist').read(buf) : rowsFromBuffer(buf, name);
  if (isPdf && !parsed.rows.length) throw new Error('Δεν βρέθηκε πίνακας με τιμές στο PDF (ίσως είναι σκαναρισμένη εικόνα). Ζητήστε από τον αντιπρόσωπο Excel ή ένα PDF με κείμενο.');
  if (!parsed.rows.length) throw new Error('Δεν βρέθηκαν γραμμές προϊόντων στο αρχείο.');
  return Object.assign(parsed, { fileName: name });
}

/** Preview: columns, sample rows, suggested (or saved) mapping. */
async function preview(supplierId, input) {
  const sup = require('./suppliers').get(supplierId);
  if (!sup) throw new Error('Διάλεξε αντιπρόσωπο.');
  const parsed = await load(input);
  const saved = store.read('pricelist-' + supplierId, null);
  const g = guessMapping(parsed.headers, parsed.rows);
  let mapping = g.mapping, priceKind = g.priceKind, vatIncluded = g.vatIncluded;
  if (saved && saved.mapping && Object.values(saved.mapping).every((h) => !h || parsed.headers.includes(h))) {
    mapping = saved.mapping; priceKind = saved.priceKind; vatIncluded = saved.vatIncluded;
  } else if (sup.priceMode === 'cost' && !/λιανικ|retail/.test(key(mapping.price || ''))) { priceKind = 'cost'; vatIncluded = false; }
  pending.set(supplierId, parsed);
  return { fileName: parsed.fileName, headers: parsed.headers, sample: parsed.rows.slice(0, 6), rows: parsed.rows.length, mapping, priceKind, vatIncluded, labels: FIELD_LABELS, usedSaved: !!(saved && saved.mapping === mapping) };
}
const pending = new Map();

function importList(supplierId, opts) {
  const parsed = pending.get(supplierId);
  if (!parsed) throw new Error('Φόρτωσε ξανά το αρχείο.');
  const mapping = opts.mapping || {};
  if (!mapping.code && !mapping.name) throw new Error('Διάλεξε τουλάχιστον στήλη κωδικού ή ονόματος.');
  if (!mapping.price) throw new Error('Διάλεξε τη στήλη της τιμής.');
  const prev = store.read('pricelist-' + supplierId, null);
  const prevPrices = {};
  if (prev) for (const it of prev.items || []) prevPrices[it.key] = it.price;
  const get = (r, f) => (mapping[f] ? String(r[mapping[f]] == null ? '' : r[mapping[f]]).trim() : '');
  const items = [];
  const seen = new Set();
  for (const r of parsed.rows) {
    const code = get(r, 'code');
    const name = U.collapse(get(r, 'name'));
    const price = U.parseNumber(get(r, 'price'));
    if (!code && !name) continue;
    const k = code ? 'c:' + U.normSku(code) : 'n:' + U.foldKey(name) + '|' + get(r, 'size') + '|' + get(r, 'color');
    if (seen.has(k)) continue;
    seen.add(k);
    items.push({
      key: k, code, ean: get(r, 'ean').replace(/\D/g, ''), name, brand: get(r, 'brand'), price: U.r2(price),
      category: get(r, 'category'), desc: get(r, 'desc'), images: get(r, 'images').split(/[,|;\s]+/).filter((x) => /^https?:\/\//i.test(x)).slice(0, 12),
      url: get(r, 'url'), color: get(r, 'color'), size: get(r, 'size'), group: get(r, 'group'), stock: get(r, 'stock'),
      prevPrice: prevPrices[k] != null ? prevPrices[k] : null,
    });
  }
  const data = { importedAt: U.nowIso(), fileName: parsed.fileName, source: opts.url ? { url: opts.url } : { file: parsed.fileName }, mapping, priceKind: opts.priceKind === 'cost' ? 'cost' : 'retail', vatIncluded: !!opts.vatIncluded, items };
  store.write('pricelist-' + supplierId, data);
  pending.delete(supplierId);
  // remember feed link on the supplier for one-click refresh
  if (opts.url) {
    const sup = require('./suppliers');
    const s = sup.get(supplierId);
    if (s && s.feedUrl !== opts.url) sup.save(Object.assign({}, s, { feedUrl: opts.url }));
  }
  const changed = items.filter((i) => i.prevPrice != null && Math.abs(i.prevPrice - i.price) > 0.009).length;
  return { items: items.length, changed };
}

// ---------- Automatic sources: feed link, the supplier's own catalog (public or B2B login) ----------
/** Re-read a price list from its saved link, with the saved column mapping. */
async function refreshFeed(supplierId) {
  const saved = store.read('pricelist-' + supplierId, null);
  const sup = require('./suppliers').get(supplierId);
  const url = (saved && saved.source && saved.source.url) || (sup && sup.feedUrl);
  if (!url) throw new Error('Δεν υπάρχει σύνδεσμος (feed) για αυτόν τον αντιπρόσωπο.');
  if (!saved || !saved.mapping) throw new Error('Φορτώστε το feed μία φορά με το χέρι για να οριστούν οι στήλες.');
  const parsed = await load({ url });
  if (!Object.values(saved.mapping).every((h) => !h || parsed.headers.includes(h))) throw new Error('Το feed άλλαξε μορφή (στήλες). Φορτώστε το ξανά με το χέρι.');
  pending.set(supplierId, parsed);
  return importList(supplierId, { mapping: saved.mapping, priceKind: saved.priceKind, vatIncluded: saved.vatIncluded, url });
}

/**
 * The supplier's shop as a price list: their whole catalog (WooCommerce / Shopify), with our B2B prices
 * when we log in. Products we don't have become candidates for new products (with description and photos).
 */
async function fromCatalog(supplierId, job) {
  const suppliers = require('./suppliers');
  const compcat = require('./compcat');
  const sup = suppliers.get(supplierId);
  if (!sup) throw new Error('Δεν βρέθηκε ο αντιπρόσωπος.');
  const b2b = sup.catalogMode === 'b2b';
  const base = U.normUrl(b2b ? (sup.b2bUrl || sup.website) : sup.website);
  if (!base) throw new Error('Δεν έχει οριστεί το site του αντιπροσώπου.');
  const origin = new URL(base).origin;
  let kind = sup.catalogKind;
  if (!kind) {
    const d = await require('./market').detect({ url: origin });
    if (d.kind !== 'woo' && d.kind !== 'shopify') throw new Error('Ο κατάλογος του site δεν διαβάζεται αυτόματα. Χρησιμοποιήστε feed, Excel ή PDF.');
    kind = d.kind;
  }
  let headers;
  if (b2b) {
    if (kind !== 'woo') throw new Error('Η αυτόματη σύνδεση B2B γίνεται μόνο σε B2B φτιαγμένα με WooCommerce.');
    headers = await require('./b2b').wpLogin(origin, sup.b2bUser, require('./secrets').reveal(sup.b2bPass));
    delete headers.at;
  }
  const catalog = require('./catalog');
  const prog = catalog.makeProgress(job).site('sup', sup.name);
  const r = await compcat.syncOne({ id: 'sup-' + supplierId, name: sup.name, url: origin, kind }, { prog, headers, full: true, cancelled: () => !!(job && job.cancelled()) });
  if (!r) return null;
  const cat = compcat.load('sup-' + supplierId);
  const prev = store.read('pricelist-' + supplierId, null);
  const prevPrices = {};
  if (prev) for (const it of prev.items || []) prevPrices[it.key] = it.price;
  const items = [];
  const seen = new Set();
  for (const c of cat.products) {
    const k = c.s ? 'c:' + U.normSku(c.s) : 'n:' + U.foldKey(c.n);
    if (seen.has(k)) continue;
    seen.add(k);
    items.push({ key: k, code: c.s || '', ean: c.g || '', name: c.n, brand: c.b || '', price: U.r2(c.p), category: '', desc: '', images: c.i ? [c.i] : [], url: c.u, color: '', size: '', group: '', stock: c.st ? 'ναι' : 'όχι', prevPrice: prevPrices[k] != null ? prevPrices[k] : null });
  }
  // B2B prices are usually without VAT and are our cost; public prices are their retail with VAT
  const priceKind = b2b ? (sup.b2bPriceKind || 'cost') : 'retail';
  const vatIncluded = b2b ? !!sup.b2bVatIncluded : true;
  store.write('pricelist-' + supplierId, { importedAt: U.nowIso(), fileName: (b2b ? 'B2B ' : 'Κατάλογος ') + U.hostOf(origin), source: { catalog: origin, mode: b2b ? 'b2b' : 'public', kind }, mapping: null, priceKind, vatIncluded, items });
  if (sup.catalogKind !== kind) suppliers.save(Object.assign({}, sup, { catalogKind: kind, b2bPass: undefined }));
  const changed = items.filter((i) => i.prevPrice != null && Math.abs(i.prevPrice - i.price) > 0.009).length;
  return { items: items.length, changed, b2b };
}

/** Everything automatic for one supplier (used by the daily run). */
async function refresh(supplierId, job) {
  const sup = require('./suppliers').get(supplierId);
  if (!sup) throw new Error('Δεν βρέθηκε ο αντιπρόσωπος.');
  const res = sup.catalogMode === 'public' || sup.catalogMode === 'b2b' ? await fromCatalog(supplierId, job) : await refreshFeed(supplierId);
  if (res) { try { res.costs = refreshCosts(supplierId); } catch (e) { console.error('costs ' + supplierId + ':', e.message); } }
  store.update('supplier-updates', [], (l) => { l.unshift(Object.assign({ supplierId, name: sup.name, at: U.nowIso() }, res || {})); return l.slice(0, 200); });
  return res;
}
function autoSources() {
  return require('./suppliers').list().filter((s) => s.active !== false && s.autoRefresh !== false && (s.catalogMode === 'public' || s.catalogMode === 'b2b' || (s.feedUrl && (store.read('pricelist-' + s.id, null) || {}).mapping)));
}

// ---------- Compare with our shop ----------
function ourIndex(site) {
  const catalog = require('./catalog');
  const prods = catalog.load(site).products;
  const bySku = new Map(), byCode = new Map(), byName = new Map(), byEan = new Map();
  const byId = new Map(prods.map((p) => [p.id, p]));
  const skuCount = new Map();
  for (const p of prods) if (p.sku) { const k = U.normSku(p.sku); skuCount.set(k, (skuCount.get(k) || 0) + 1); }
  for (const p of prods) {
    // a code used by several products (e.g. the same code on different items) proves nothing
    if (p.sku && skuCount.get(U.normSku(p.sku)) === 1) bySku.set(U.normSku(p.sku), p);
    if (p.ean && p.ean.length >= 8) byEan.set(p.ean, p);
    if (p.type !== 'variation') {
      byName.set(U.foldKey(p.name), p);
      for (const t of U.foldKey(p.name + ' ' + p.sku).split(/\s+/)) {
        const n = t.replace(/[-./]/g, '');
        if (n.length >= 4 && /\d/.test(n)) { if (!byCode.has(n)) byCode.set(n, p); else if (byCode.get(n) !== p) byCode.set(n, null); }
      }
    }
  }
  return { prods, bySku, byCode, byName, byId, byEan, site };
}
// brand + model words, the same careful comparison as the market research (only "same product" counts)
function smartIndex(ix) {
  if (ix.smart) return ix.smart;
  const market = require('./market');
  const items = ix.prods.filter((p) => p.type !== 'variation');
  const feats = items.map((p) => market.candFeatures({ n: p.name, s: p.sku, b: p.brand }));
  const post = new Map();
  feats.forEach((f, i) => { for (const t of f.set) { let a = post.get(t); if (!a) post.set(t, (a = [])); a.push(i); } });
  ix.smart = { items, feats, post, market };
  return ix.smart;
}
function smartMatch(it, ix) {
  if (!it.name) return null;
  const sm = smartIndex(ix);
  const f = sm.market.features({ name: it.name + (it.brand && !U.foldKey(it.name).includes(U.foldKey(it.brand)) ? ' ' + it.brand : ''), brand: it.brand, sku: '', price: 0 });
  if (!f.keys.length) return null;
  const ks = f.keys.map((k) => [k, (sm.post.get(k) || []).length]).filter((x) => x[1] > 0 && x[1] < 400).sort((a, b) => a[1] - b[1]).slice(0, 2);
  const cand = new Set();
  for (const [k] of ks) for (const i of sm.post.get(k)) cand.add(i);
  let best = null;
  for (const i of cand) {
    const p = sm.items[i];
    const r = sm.market.compare(f, { n: p.name, s: p.sku, b: p.brand, p: 0 }, sm.feats[i]);
    if (r.match === 'exact' && (!best || r.score > best.score)) best = { p, score: r.score };
  }
  return best ? { p: best.p, how: 'Ίδια μάρκα και μοντέλο', weak: true } : null;
}
function matchItem(it, ix) {
  if (it.ean && ix.byEan.has(it.ean)) return { p: ix.byEan.get(it.ean), how: 'Ίδιο EAN' };
  const c = U.normSku(it.code);
  if (c && ix.bySku.has(c)) return { p: ix.bySku.get(c), how: 'Ίδιος κωδικός' };
  if (c.length >= 4) {
    for (const [sku, p] of ix.bySku) if (sku.length > c.length && sku.endsWith(c) && sku.length - c.length <= 4) return { p, how: 'Κωδικός με πρόθεμα' };
    for (const [sku, p] of ix.bySku) if (c.length > sku.length && sku.length >= 4 && c.startsWith(sku)) return { p, how: 'Κωδικός μοντέλου' };
    if (ix.byCode.get(c)) return { p: ix.byCode.get(c), how: 'Κωδικός στον τίτλο' };
  }
  const g = U.normSku(it.group);
  if (g.length >= 4) {
    if (ix.bySku.has(g)) return { p: ix.bySku.get(g), how: 'Κωδικός μοντέλου' };
    if (ix.byCode.get(g)) return { p: ix.byCode.get(g), how: 'Κωδικός μοντέλου στον τίτλο' };
  }
  if (it.name && ix.byName.has(U.foldKey(it.name))) return { p: ix.byName.get(U.foldKey(it.name)), how: 'Ίδιο όνομα', weak: true };
  return smartMatch(it, ix);
}

/** Retail price we would charge for this supplier price. */
function retailFor(sup, list, price) {
  const s = settings.all();
  const vat = 1 + s.vat / 100;
  if (!(price > 0)) return { retail: 0, cost: 0 };
  if (list.priceKind === 'cost') {
    const cost = list.vatIncluded ? price / vat : price;
    const markup = sup && sup.markup != null ? sup.markup : 80;
    return { retail: U.roundPrice(cost * (1 + markup / 100) * vat, s.rounding), cost: U.r2(cost) };
  }
  const retail = list.vatIncluded ? price : price * vat;
  const cost = sup && sup.discount ? U.r2((retail / vat) * (1 - sup.discount / 100)) : 0;
  return { retail: U.roundPrice(retail, s.rounding), cost };
}

function compare(supplierId, site) {
  site = site === 'st' ? 'st' : 'sf';
  const sup = require('./suppliers').get(supplierId);
  const list = store.read('pricelist-' + supplierId, null);
  if (!list) return null;
  const ix = ourIndex(site);
  const s = settings.all();
  const rows = list.items.map((it) => {
    const m = matchItem(it, ix);
    const r = retailFor(sup, list, it.price);
    const p = m ? m.p : null;
    const parent = p && p.type === 'variation' ? ix.byId.get(p.parent) : null;
    const ourPrice = p ? p.price : 0;
    const floor = r.cost ? U.roundPrice(r.cost * (1 + s.floorMargin / 100) * (1 + s.vat / 100), s.rounding) : 0;
    let status = 'new';
    if (p) status = Math.abs(ourPrice - r.retail) <= 0.009 ? 'same' : 'diff';
    if (p && floor && ourPrice < floor) status = 'loss';
    const margin = p && r.cost && ourPrice ? U.r2(((ourPrice / (1 + s.vat / 100)) - r.cost) / (ourPrice / (1 + s.vat / 100)) * 100) : null;
    return {
      key: it.key, code: it.code, ean: it.ean, name: it.name, brand: it.brand, size: it.size, color: it.color, group: it.group, stock: it.stock, image: it.images[0] || '',
      supplierPrice: it.price, prevPrice: it.prevPrice, changed: it.prevPrice != null && Math.abs(it.prevPrice - it.price) > 0.009,
      retail: r.retail, cost: r.cost, floor, margin,
      match: p ? { id: p.id, name: parent ? parent.name + ' — ' + p.varLabel : p.name, price: ourPrice, type: p.type, parent: parent ? parent.id : 0, how: m.how, weak: !!m.weak } : null,
      status,
    };
  });
  const counts = { all: rows.length, new: 0, diff: 0, same: 0, loss: 0, changed: 0 };
  for (const r of rows) { counts[r.status]++; if (r.changed) counts.changed++; }
  return { supplier: require('./suppliers').view(sup), importedAt: list.importedAt, fileName: list.fileName, priceKind: list.priceKind, vatIncluded: list.vatIncluded, site, rows, counts, source: list.source };
}

/** Cost rows of a list for our products; the supplier's retail price too when the list is a retail list. */
function costRows(cmp, strongOnly) {
  const out = [];
  for (const r of cmp.rows) {
    if (!r.match || !(r.cost > 0) || (strongOnly && r.match.weak)) continue;
    out.push({ site: cmp.site, id: r.match.parent || r.match.id, cost: r.cost, rrp: cmp.priceKind === 'retail' ? r.retail : 0 });
  }
  return out;
}

/** Save costs from the list (used as price floor and to spot suspect competitor prices). */
function storeCosts(supplierId, site) {
  const cmp = compare(supplierId, site);
  if (!cmp) return 0;
  return require('./market').setCosts(costRows(cmp, false), 'pricelist:' + supplierId);
}

/**
 * After an automatic refresh: keep the costs from this list up to date (new prices of the supplier = new cost).
 * Only sure matches (code / EAN), and never over a cost typed by hand or taken from another supplier.
 */
function refreshCosts(supplierId) {
  const src = 'pricelist:' + supplierId;
  let n = 0;
  for (const site of ['sf', 'st']) {
    const cmp = compare(supplierId, site);
    if (cmp) n += require('./market').setCosts(costRows(cmp, true), src, (prev) => !prev || prev.source === src);
  }
  return n;
}

function info(supplierId) {
  const l = store.read('pricelist-' + supplierId, null);
  return l ? { importedAt: l.importedAt, fileName: l.fileName, items: l.items.length, priceKind: l.priceKind, vatIncluded: l.vatIncluded, source: l.source } : null;
}
function rawItems(supplierId) { const l = store.read('pricelist-' + supplierId, null); return l ? l.items : []; }

module.exports = { refreshFeed, fromCatalog, refresh, refreshCosts, autoSources, smartMatch, preview, importList, compare, storeCosts, info, rawItems, FIELD_LABELS, retailFor, rowsFromBuffer, guessMapping };
