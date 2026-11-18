'use strict';
// SF Κέντρο — families of products: the same model sold as separate products, one per colour (ΣΑΚΙΔΙΟ MIL-TEC ASSAULT
// MOLLE OLIVE SMALL / … ΜΑΥΡΟ SMALL …). What is common (kind, brand, model, category, description) belongs to the family;
// what differs (colour, code, EAN, price, stock, photos, address) to each variant.
//
// Found only with proof: the same kind, the same brand, ALL the same model words, each member in another colour (one
// colour per member). Another size word (SMALL / LARGE), another version (PRO, US, MK2) = another family. Nothing is
// merged by itself: a family is a proposal; a person approves it, and then the program prepares the WooCommerce files of
// the change (the existing approval rule: nothing goes to the sites but the files a person uploads):
//   1. the old products → «Πρόχειρο» (draft) and without code (WooCommerce wants every code once),
//   2. the new product with variations: one page, a colour to choose (swatches), the photo / price / stock / code / EAN
//      of each colour; the colour as a global attribute (filters, swatches, Google «variesBy»),
//   3. the 301 redirects of the old addresses to the new page with that colour chosen (?attribute_pa_…=…), for the
//      plugin «Redirection» (Google keeps the old pages' standing; a customer's old link opens the right colour).
const store = require('./store');
const settings = require('./settings');
const U = require('./util');

const KEY = 'families-decisions'; // { 'site|key': { answer: 'approved' | 'rejected', at, by } }

function decisions() { return store.read(KEY, null) || {}; }

/** The brand of a product: its own, else a known brand written in its title (MIL-TEC of a product filed without brand). */
function brandOf(p, known) {
  if (p.brand) return U.foldKey(p.brand).replace(/[^A-Z0-9Α-Ω]/g, '');
  // the title's words, also two by two without the dash (MIL-TEC = MILTEC): a known brand is one of those words
  const w = U.foldKey(p.name).split(/[^A-Z0-9Α-Ω]+/).filter(Boolean);
  const words = new Set(w);
  for (let i = 0; i < w.length - 1; i++) words.add(w[i] + w[i + 1]);
  let best = '';
  for (const [k] of known) { const kk = k.replace(/[^A-Z0-9Α-Ω]+/g, ''); if (kk.length >= 3 && words.has(kk) && kk.length > best.length) best = kk; }
  return best;
}

/** The family key of a product (kind · brand · model words) and its colour, or null when it cannot be told. */
function keyOf(p, known) {
  const market = require('./market');
  const toks = U.greekUpper(p.name).split(/\s+/);
  const kind = /^[Α-Ω]{4,}$/.test(toks[0] || '') ? toks[0].slice(0, Math.max(4, toks[0].length - 2)) : '';
  const brand = brandOf(p, known);
  const colours = [...market.coloursOf(p.name)];
  const words = market.keyTokens(p.name, p.brand || brand).filter((k) => !brand || k !== brand && !brand.includes(k));
  if (!kind || !brand || words.length < 1 || colours.length !== 1) return null;
  return { key: [kind, brand, words.slice().sort().join(' ')].join('|'), colour: colours[0], kind, brand, words };
}

/** The title of the family: the member's title without its colour word(s). */
function familyTitle(p) {
  const market = require('./market');
  return U.collapse(p.name.split(/\s+/).filter((w) => !market.coloursOf(w).size).join(' '));
}

/** Families of a site: [{ key, site, title, members: [...], colours, evidence, confidence, status, web }] */
function list(site, opts) {
  const catalog = require('./catalog');
  const market = require('./market');
  const o = opts || {};
  const known = catalog.knownBrands();
  const groups = new Map();
  for (const p of catalog.load(site).products) {
    if (p.type !== 'simple' || p.status === 'private') continue;
    const k = keyOf(p, known);
    if (!k) continue;
    const g = groups.get(k.key) || { key: k.key, info: k, members: [] };
    g.members.push({ p, colour: k.colour });
    groups.set(k.key, g);
  }
  const dec = decisions();
  const web = (store.read('web-codes', null) || {}).products || {};
  const out = [];
  for (const g of groups.values()) {
    // two members at least, each in another colour (two of the same colour = the same product twice, not a family)
    const colours = [...new Set(g.members.map((m) => m.colour))];
    if (g.members.length < 2 || colours.length !== g.members.length) continue;
    const ms = g.members.map((m) => m.p);
    const ev = ['ίδιο είδος', 'ίδια μάρκα', 'ίδιες λέξεις μοντέλου: ' + g.info.words.join(' '), 'ένα χρώμα σε κάθε προϊόν: ' + colours.join(', ')];
    let conf = 70;
    // codes with a long common part (14002001 / 14002002: the maker numbers the colours of one model)
    const skus = ms.map((p) => U.normSku(p.sku || '')).filter(Boolean);
    let pre = skus[0] || '';
    for (const x of skus.slice(1)) { let i = 0; while (i < pre.length && i < x.length && pre[i] === x[i]) i++; pre = pre.slice(0, i); }
    if (skus.length === ms.length && pre.length >= 5) { conf += 12; ev.push(`κωδικοί με κοινή αρχή (${pre}…)`); }
    const prices = new Set(ms.map((p) => p.price));
    if (prices.size === 1) { conf += 8; ev.push('ίδια τιμή'); }
    const cats = new Set(ms.map((p) => (p.cats || []).join(',')));
    if (cats.size === 1) { conf += 5; ev.push('ίδια κατηγορία'); }
    // what the research on the internet saw of this model (other colours that exist)
    const seen = new Set();
    for (const p of ms) for (const f of (web[site + ':' + p.id] || {}).family || []) for (const c of market.coloursOf(f.colour || f.name)) seen.add(c);
    const more = [...seen].filter((c) => !colours.includes(c));
    const d = dec[site + '|' + g.key];
    out.push({
      key: g.key, site, title: familyTitle(ms[0]), confidence: Math.min(97, conf), evidence: ev, attribute: 'colour', colours,
      members: ms.map((p, i) => ({ id: p.id, name: p.name, sku: p.sku || '', ean: p.ean || '', colour: g.members[i].colour, price: p.price, regular: p.regular, sale: p.sale, inStock: p.inStock !== false, images: (p.images || []).slice(0, 6), url: p.url, slug: p.slug, cats: p.catNames || [] })),
      webColours: more, status: d ? d.answer : 'pending', decidedAt: d ? d.at : null,
    });
  }
  out.sort((a, b) => (a.status === 'pending' ? 0 : 1) - (b.status === 'pending' ? 0 : 1) || b.members.length - a.members.length || b.confidence - a.confidence);
  return o.key ? out.filter((f) => f.key === o.key) : out;
}

/** The family a product belongs to (for its card), or null. */
function ofProduct(site, id) {
  return list(site).find((f) => f.members.some((m) => m.id === Number(id))) || null;
}

function decide(site, key, answer, by) {
  if (!['approved', 'rejected', ''].includes(answer)) throw new Error('Λάθος απάντηση.');
  if (!list(site, { key }).length) throw new Error('Δεν βρέθηκε η οικογένεια.');
  store.update(KEY, {}, (d) => { if (answer) d[site + '|' + key] = { answer, at: U.nowIso(), by: by || '' }; else delete d[site + '|' + key]; return d; });
  return list(site, { key })[0];
}

/** The global colour attribute of the site (its name and its slug for the addresses of the variations). */
function colourAttribute(site) {
  const catalog = require('./catalog');
  const name = catalog.detectAttribute(site, 'color');
  let tax = '';
  for (const p of catalog.load(site).products) { const a = (p.attrs || []).find((x) => x.name === name && x.taxonomy); if (a) { tax = a.taxonomy; break; } }
  return { name, taxonomy: tax || 'pa_' + U.slugify(name) };
}
const COLOUR_GR = { BLACK: 'Μαύρο', OLIVE: 'Λαδί', COYOTE: 'Coyote', KHAKI: 'Χακί', WOODLAND: 'Woodland', MULTICAM: 'Multicam', GREEN: 'Πράσινο', GREY: 'Γκρι', NAVY: 'Μπλε σκούρο', BLUE: 'Μπλε', SAND: 'Άμμου', TAN: 'Tan', WHITE: 'Λευκό', RED: 'Κόκκινο', BROWN: 'Καφέ', BEIGE: 'Μπεζ', FLECKTARN: 'Flecktarn', CAMO: 'Παραλλαγή', DESERT: 'Ερήμου' };

/**
 * The files of an approved family (nothing is sent to the site). opts: { parentSku, variantSkus: 'own' | 'same' }
 *   own  — each variation keeps the code its product has (the maker's code of that colour: best for Google)
 *   same — the shop's rule «one code for all colours»: the variations without code (the product's code is the parent's)
 * → { files: [{ name, csv, what }], rows, notes }
 */
function exportFiles(site, key, opts) {
  const wx = require('./wooexport');
  const catalog = require('./catalog');
  const o = opts || {};
  const f = list(site, { key })[0];
  if (!f) throw new Error('Δεν βρέθηκε η οικογένεια.');
  if (f.status !== 'approved') throw new Error('Πρώτα έγκρινε την οικογένεια (είναι ίδιο μοντέλο σε άλλα χρώματα).');
  const s = settings.all();
  const mode = o.variantSkus === 'own' ? 'own' : o.variantSkus === 'same' ? 'same' : s.variantSku === 'suffix' ? 'own' : 'same';
  const byId = catalog.byId(site);
  const full = f.members.map((m) => byId.get(m.id));
  // the parent's code: the one a person wrote, else the common part of the codes (only from them, never made up)
  const skus = f.members.map((m) => m.sku).filter(Boolean);
  const common = skus.length > 1 ? require('./extract').commonCode(skus) : '';
  const parentSku = U.collapse(o.parentSku || common || (mode === 'same' ? skus[0] || '' : ''));
  if (!parentSku) throw new Error('Γράψε τον κωδικό του νέου προϊόντος (οι παραλλαγές συνδέονται μαζί του).');
  const attr = colourAttribute(site);
  const brandAttr = catalog.detectAttribute(site, 'brand');
  const brand = (full.find((p) => p.brand) || {}).brand || '';
  const best = full.slice().sort((a, b) => (b.descLen || 0) - (a.descLen || 0))[0];
  const idx = catalog.categoryIndex(site);
  const catIds = best.cats || [];
  const colourName = (c) => COLOUR_GR[c] || c.charAt(0) + c.slice(1).toLowerCase();
  const notes = [];
  // 1. the old products: draft, without code (kept, not deleted)
  const old = f.members.map((m) => ({ ID: m.id, SKU: '', Published: -1 }));
  // 2. the new product with variations
  const parent = {
    Type: 'variable', SKU: parentSku, Name: f.title, Published: s.newProduct.status === 'publish' ? 1 : -1, 'Is featured?': 0, 'Visibility in catalog': 'visible',
    'Short description': best.short || '', Description: best.desc || '', 'Tax status': 'taxable', 'In stock?': full.some((p) => p.inStock !== false) ? 1 : 0,
    Categories: catIds.length ? wx.cats(catIds.map((id) => idx.pathOf(id))) : '', Tags: [...new Set(full.flatMap((p) => p.tags || []))].join(', '),
    // the family's photos: each colour's first photo (the page changes its main photo with the colour chosen)
    Images: wx.imgs(full.map((p) => (p.images || [])[0]).filter(Boolean)),
  };
  const attrs = [];
  if (brand) attrs.push({ name: brandAttr, values: [brand], visible: true, global: true });
  attrs.push({ name: attr.name, values: f.members.map((m) => colourName(m.colour)), visible: true, global: true });
  wx.setAttrs(parent, attrs);
  const rows = [parent];
  const gtinCol = 'GTIN, UPC, EAN, or ISBN';
  full.forEach((p, i) => {
    const m = f.members[i];
    const onSale = p.sale > 0 && p.sale < p.regular;
    const v = {
      Type: 'variation', SKU: mode === 'own' ? p.sku || '' : '', Parent: parentSku, Published: 1, 'Visibility in catalog': 'visible', 'Tax status': 'taxable', 'In stock?': p.inStock !== false ? 1 : 0,
      'Regular price': (p.regular || p.price) > 0 ? Number(p.regular || p.price).toFixed(2) : '', 'Sale price': onSale ? Number(p.sale).toFixed(2) : '',
      // the photo of THIS colour (its own product's photos, never another colour's)
      Images: wx.imgs((p.images || []).slice(0, 1)),
      [gtinCol]: p.ean || '',
    };
    wx.setAttrs(v, [{ name: attr.name, values: [colourName(m.colour)], visible: true, global: true }]);
    rows.push(v);
    if (mode === 'same' && p.sku && p.sku !== parentSku) notes.push(`Ο κωδικός ${p.sku} (${colourName(m.colour)}) δεν μπαίνει στην παραλλαγή (κανόνας «ένας κωδικός»): κράτησέ τον στις σημειώσεις αν τον χρειάζεσαι.`);
  });
  const newCsv = U.toCSV(rows, ['Type', 'SKU', 'Parent', 'Name', 'Published', 'Is featured?', 'Visibility in catalog', 'Short description', 'Description', 'Tax status', 'In stock?', 'Regular price', 'Sale price', 'Categories', 'Tags', 'Images', gtinCol,
    'Attribute 1 name', 'Attribute 1 value(s)', 'Attribute 1 visible', 'Attribute 1 global', 'Attribute 2 name', 'Attribute 2 value(s)', 'Attribute 2 visible', 'Attribute 2 global'].map((c) => ({ key: c, label: c })), { sep: ',', bom: true });
  // 3. the redirects (plugin «Redirection» → Import: source,target,regex,code)
  const newSlug = U.slugify(f.title);
  const base = String(s.sites[site].url || '').replace(/\/+$/, '');
  const path = (u) => { try { return new URL(u).pathname; } catch (_) { return ''; } };
  const red = f.members.map((m) => ({ source: path(m.url) || '/product/' + m.slug + '/', target: `/product/${newSlug}/?attribute_${attr.taxonomy}=${encodeURIComponent(U.slugify(colourName(m.colour)))}`, regex: 0, code: 301 }));
  const redCsv = U.toCSV(red, ['source', 'target', 'regex', 'code'].map((c) => ({ key: c, label: c })), { sep: ',', bom: false });
  notes.push(`Μετά την εισαγωγή έλεγξε ότι η νέα σελίδα είναι ${base}/product/${newSlug}/ — αν το WordPress έδωσε άλλη διεύθυνση, άλλαξέ τη στο αρχείο ανακατευθύνσεων πριν το ανεβάσεις.`);
  const slugName = U.slugify(f.title).slice(0, 40);
  return {
    family: f, mode, parentSku, notes,
    files: [
      { name: `oikogeneia-1-palia-se-proxeiro-${site}-${slugName}.csv`, csv: wx.updateFile(old, ['SKU', 'Published']), what: '1. Τα παλιά προϊόντα σε «Πρόχειρο», χωρίς κωδικό (Εισαγωγή → «Ενημέρωση υπαρχόντων»)' },
      { name: `oikogeneia-2-neo-metavlito-${site}-${slugName}.csv`, csv: newCsv, what: '2. Το νέο προϊόν με τα χρώματα (Εισαγωγή, ΧΩΡΙΣ «Ενημέρωση υπαρχόντων»)' },
      { name: `oikogeneia-3-anakateythynseis-${site}-${slugName}.csv`, csv: redCsv, what: '3. Ανακατευθύνσεις 301 των παλιών σελίδων (πρόσθετο Redirection → Import)' },
    ],
  };
}

module.exports = { list, ofProduct, decide, exportFiles, keyOf, familyTitle, colourAttribute, KEY };
