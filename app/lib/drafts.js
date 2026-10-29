'use strict';
// New product drafts: built from a supplier page, a supplier price list or by hand.
// Staff check them on one screen, approve, and export a WooCommerce import file per shop.
const store = require('./store');
const settings = require('./settings');
const U = require('./util');

const EN_TYPES = [
  [/\b(thigh|drop ?leg)\b.*\b(pouch|bag)\b|\bthigh bag\b/i, 'ΤΣΑΝΤΑΚΙ ΜΗΡΟΥ'], [/\bmagazine pouch|mag pouch\b/i, 'ΘΗΚΗ ΓΕΜΙΣΤΗΡΑ'], [/\bholster\b/i, 'ΘΗΚΗ ΠΙΣΤΟΛΙΟΥ'],
  [/\bplate carrier\b/i, 'ΓΙΛΕΚΟ PLATE CARRIER'], [/\bchest rig\b/i, 'ΓΙΛΕΚΟ CHEST RIG'], [/\bfirst aid|ifak\b/i, 'ΘΗΚΗ ΠΡΩΤΩΝ ΒΟΗΘΕΙΩΝ'],
  [/\bheadlamp|head ?torch\b/i, 'ΦΑΚΟΣ ΚΕΦΑΛΗΣ'], [/\bflashlight|torch|taschenlampe\b/i, 'ΦΑΚΟΣ'], [/\b(t-?shirt|tee)\b/i, 'ΜΠΛΟΥΖΑ'], [/\bpolo\b/i, 'ΜΠΛΟΥΖΑ POLO'],
  [/\bshirt|hemd\b/i, 'ΠΟΥΚΑΜΙΣΟ'], [/\bshorts\b/i, 'ΒΕΡΜΟΥΔΑ'], [/\b(pants|trousers|hose)\b/i, 'ΠΑΝΤΕΛΟΝΙ'], [/\bsoftshell\b/i, 'ΜΠΟΥΦΑΝ SOFTSHELL'],
  [/\b(jacket|parka|jacke)\b/i, 'ΜΠΟΥΦΑΝ'], [/\bfleece\b/i, 'ΖΑΚΕΤΑ FLEECE'], [/\b(hoodie|sweatshirt)\b/i, 'ΦΟΥΤΕΡ'], [/\bsweater|pullover\b/i, 'ΠΛΕΚΤΟ'],
  [/\bvest\b/i, 'ΓΙΛΕΚΟ'], [/\b(boots?|stiefel)\b/i, 'ΑΡΒΥΛΑ'], [/\bshoes?|sneakers?\b/i, 'ΠΑΠΟΥΤΣΙΑ'], [/\bgloves?|handschuhe\b/i, 'ΓΑΝΤΙΑ'],
  [/\bbalaclava\b/i, 'ΚΟΥΚΟΥΛΑ'], [/\bbeanie\b/i, 'ΣΚΟΥΦΟΣ'], [/\bberet\b/i, 'ΜΠΕΡΕΣ'], [/\b(cap|hat)\b/i, 'ΚΑΠΕΛΟ'], [/\bsocks?\b/i, 'ΚΑΛΤΣΕΣ'],
  [/\b(backpack|rucksack|daypack)\b/i, 'ΣΑΚΙΔΙΟ'], [/\bpouch\b/i, 'ΘΗΚΗ'], [/\bbelt|gürtel\b/i, 'ΖΩΝΗ'], [/\bsling\b/i, 'ΙΜΑΝΤΑΣ'], [/\bbag|tasche\b/i, 'ΤΣΑΝΤΑ'],
  [/\bsleeping bag\b/i, 'ΥΠΝΟΣΑΚΟΣ'], [/\btent\b/i, 'ΣΚΗΝΗ'], [/\b(canteen|bottle|flask)\b/i, 'ΠΑΓΟΥΡΙ'], [/\bhelmet\b/i, 'ΚΡΑΝΟΣ'], [/\b(goggles|glasses|sunglasses)\b/i, 'ΓΥΑΛΙΑ'],
  [/\bpatch\b/i, 'ΣΗΜΑ'], [/\bwatch\b/i, 'ΡΟΛΟΙ'], [/\bcompass\b/i, 'ΠΥΞΙΔΑ'], [/\bponcho\b/i, 'ΠΟΝΤΣΟ'], [/\bgaiters?\b/i, 'ΓΚΕΤΕΣ'], [/\binsoles?\b/i, 'ΠΑΤΟΙ'],
  [/\blaces\b/i, 'ΚΟΡΔΟΝΙΑ'], [/\bhandcuffs?\b/i, 'ΧΕΙΡΟΠΕΔΕΣ'], [/\bbaton\b/i, 'ΓΚΛΟΠ'], [/\bmulti-?tool\b/i, 'ΠΟΛΥΕΡΓΑΛΕΙΟ'], [/\baxe|hatchet\b/i, 'ΤΣΕΚΟΥΡΙ'],
  [/\bshovel\b/i, 'ΦΤΥΑΡΑΚΙ'], [/\bmat\b/i, 'ΣΤΡΩΜΑΤΑΚΙ'], [/\bknife|messer\b/i, 'ΜΑΧΑΙΡΙ'], [/\b(riflescope|scope)\b/i, 'ΔΙΟΠΤΡΑ'], [/\bbinoculars?\b/i, 'ΚΙΑΛΙΑ'],
  [/\bbattery\b/i, 'ΜΠΑΤΑΡΙΑ'], [/\bcharger\b/i, 'ΦΟΡΤΙΣΤΗΣ'], [/\bcartridges?|ammo\b/i, 'ΦΥΣΙΓΓΙΑ'], [/\bair ?rifle\b/i, 'ΑΕΡΟΒΟΛΟ'], [/\bshotgun\b/i, 'ΚΑΡΑΜΠΙΝΑ'],
  [/\brifle\b/i, 'ΤΟΥΦΕΚΙ'], [/\bpistol\b/i, 'ΠΙΣΤΟΛΙ'], [/\bgun case|rifle case\b/i, 'ΘΗΚΗ ΟΠΛΟΥ'], [/\bneck gaiter|buff\b/i, 'ΠΕΡΙΛΑΙΜΙΟ'],
];
const EN_COLORS = { black: 'ΜΑΥΡΟ', schwarz: 'ΜΑΥΡΟ', white: 'ΛΕΥΚΟ', grey: 'ΓΚΡΙ', gray: 'ΓΚΡΙ', navy: 'ΜΠΛΕ ΣΚΟΥΡΟ', blue: 'ΜΠΛΕ', red: 'ΚΟΚΚΙΝΟ', brown: 'ΚΑΦΕ', green: 'ΠΡΑΣΙΝΟ', olive: 'ΛΑΔΙ', oliv: 'ΛΑΔΙ', khaki: 'ΧΑΚΙ', beige: 'ΜΠΕΖ', sand: 'ΑΜΜΟΥ', orange: 'ΠΟΡΤΟΚΑΛΙ', yellow: 'ΚΙΤΡΙΝΟ' };

function translateColor(c) {
  const k = String(c || '').trim().toLowerCase();
  return EN_COLORS[k] || U.greekUpper(c);
}
function guessType(name, category) {
  const t = String(name || '') + ' ' + String(category || '');
  for (const [re, gr] of EN_TYPES) if (re.test(t)) return gr;
  // Greek title: first word(s) before the brand are the type
  const caps = U.greekUpper(name);
  const m = caps.match(/^([Ͱ-Ͽ]+(?:\s[Ͱ-Ͽ]+){0,2})/);
  if (m) return m[1];
  // what the shop itself calls products with these words (learned from its titles: FRN → ΣΟΥΓΙΑΣ, MH40 → ΦΑΚΟΣ)
  try {
    const learned = require('./catalog').learnedTypes().map || {};
    const votes = new Map();
    for (const w of caps.replace(/[^A-Z0-9\s-]/g, ' ').split(/\s+/)) {
      const k = w.replace(/[-.]/g, '');
      const e = learned[k];
      if (e && e.share >= 0.75 && e.n >= 3) votes.set(e.type, (votes.get(e.type) || 0) + e.share * Math.log2(1 + e.n));
    }
    const best = [...votes.entries()].sort((a, b) => b[1] - a[1])[0];
    if (best) return best[0];
  } catch (_) { /* no catalog yet */ }
  return '';
}

/** Common first words of our own titles = the store's product types. */
function typeSuggestions() {
  const catalog = require('./catalog');
  const m = new Map();
  for (const site of ['sf', 'st']) for (const p of catalog.load(site).products) {
    if (p.type === 'variation') continue;
    const w = U.greekUpper(p.name).split(' ');
    const one = w[0] || '';
    if (/[Ͱ-Ͽ]/.test(one)) m.set(one, (m.get(one) || 0) + 1);
    if (w[1] && /[Ͱ-Ͽ]/.test(w[1])) m.set(one + ' ' + w[1], (m.get(one + ' ' + w[1]) || 0) + 0.5);
  }
  return [...m.entries()].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]).slice(0, 150).map(([k]) => k);
}

/** Find a known brand (from the shops and the suppliers) inside a product name. */
function brandIn(name, supplierBrands) {
  const catalog = require('./catalog');
  const map = catalog.knownBrands();
  for (const b of supplierBrands || []) map.set(U.foldKey(b), b);
  const t = ' ' + U.foldKey(name).replace(/[^\p{L}\p{N}.\-&]+/gu, ' ') + ' ';
  const list = [...map.entries()].filter(([k]) => k.length >= 2).sort((a, b) => b[0].length - a[0].length);
  for (const [k, disp] of list) if (t.includes(' ' + k + ' ')) return disp;
  return '';
}

function buildTitle(f) {
  const brand = U.collapse(f.brand || '');
  let model = U.collapse(f.model || '');
  if (brand && U.foldKey(model).startsWith(U.foldKey(brand) + ' ')) model = model.slice(brand.length).trim();
  return U.greekUpper([f.type, brand, model, f.extra].filter(Boolean).join(' '));
}
function displayTitleFrom(f) {
  const catalog = require('./catalog');
  return U.titleCase([f.type, f.brand, f.model, f.extra].filter(Boolean).join(' '), catalog.accents());
}

function templateBody(d) {
  const s = settings.all();
  const li = [];
  if (d.fields.brand) li.push(`<li>Κατασκευαστής: ${U.escapeHtml(d.fields.brand)}</li>`);
  if (d.fields.model) li.push(`<li>Μοντέλο: ${U.escapeHtml(d.fields.model)}</li>`);
  const colors = [...new Set((d.variations || []).map((v) => v.color).filter(Boolean))];
  const sizes = [...new Set((d.variations || []).map((v) => v.size).filter(Boolean))];
  if (colors.length) li.push(`<li>Διαθέσιμα χρώματα: ${U.escapeHtml(colors.join(', '))}</li>`);
  else if (d.fields.extra) li.push(`<li>Χρώμα / έκδοση: ${U.escapeHtml(U.titleCase(d.fields.extra, require('./catalog').accents()))}</li>`);
  if (sizes.length) li.push(`<li>Διαθέσιμα μεγέθη: ${U.escapeHtml(sizes.join(', '))}</li>`);
  for (const sp of (d.specs || []).slice(0, 12)) li.push(`<li>${U.escapeHtml(sp.k)}: ${U.escapeHtml(sp.v)}</li>`);
  for (const f of (d.features || []).slice(0, 12)) li.push(`<li>${U.escapeHtml(f)}</li>`);
  for (const n of String(d.keyPoints || '').split(/\n+/).map((x) => x.trim()).filter(Boolean)) li.push(`<li>${U.escapeHtml(n)}</li>`);
  let html = li.length ? `<ul>${li.join('')}</ul>` : '';
  if (s.newProduct.footer) html += `<p>${U.escapeHtml(s.newProduct.footer)}</p>`;
  return html;
}

function shortFrom(d) {
  const pts = [];
  if (d.fields.brand) pts.push(`Κατασκευαστής: ${U.escapeHtml(d.fields.brand)}`);
  if (d.code) pts.push(`Κωδικός: ${U.escapeHtml(d.code)}`);
  const sizes = [...new Set((d.variations || []).map((v) => v.size).filter(Boolean))];
  if (sizes.length) pts.push(`Μεγέθη: ${U.escapeHtml(sizes.join(', '))}`);
  return pts.length ? `<ul>${pts.map((p) => `<li>${p}</li>`).join('')}</ul>` : '';
}

/** Recompute everything derived from the editable fields. */
function derive(d) {
  const s = settings.all();
  d.title = d.titleManual ? U.greekUpper(d.titleManual) : buildTitle(d.fields);
  d.displayTitle = d.displayManual || displayTitleFrom(d.fields) || U.titleCase(d.title);
  d.focus = U.collapse([d.fields.type, d.fields.brand, d.fields.model].filter(Boolean).join(' '));
  const tag = ['h2', 'h3', 'p'].includes(s.newProduct.titleTag) ? s.newProduct.titleTag : 'h2';
  const head = tag === 'p' ? `<p><strong>${U.escapeHtml(d.displayTitle)}</strong></p>` : `<${tag}>${U.escapeHtml(d.displayTitle)}</${tag}>`;
  d.descTemplate = templateBody(d);
  let body = '';
  if (d.descMode === 'official' && d.descOfficial) body = d.descOfficial;
  else if (d.descMode === 'custom' && d.descCustom) body = d.descCustom;
  else if (d.descMode === 'ai' && d.descAI) body = d.descAI;
  else { body = d.descTemplate; if (d.descMode !== 'template') d.descMode = d.descOfficial ? d.descMode : 'template'; }
  d.description = head + body;
  d.short = d.shortManual != null && d.shortManual !== '' ? d.shortManual : (d.autoShort === false ? '' : shortFrom(d));
  if (!d.sku) d.sku = makeSku(d);
  d.price = U.r2(U.parseNumber(d.price));
  d.sale = U.r2(U.parseNumber(d.sale));
  for (const v of d.variations || []) { v.size = U.collapse(v.size || ''); v.color = U.collapse(v.color || ''); v.price = U.r2(U.parseNumber(v.price)); }
  d.checks = checksFor(d);
  return d;
}

function makeSku(d) {
  const sup = d.supplierId ? require('./suppliers').get(d.supplierId) : null;
  const code = String(d.code || '').trim().replace(/\s+/g, '-');
  if (code) return code;
  const base = U.normSku((d.fields.model || '').slice(0, 20));
  if (!base) return '';
  return ((sup && sup.code) || 'SF') + '-' + base;
}

function checksFor(d) {
  const catalog = require('./catalog');
  const out = [];
  if (!d.fields.type) out.push({ level: 'warn', text: 'Λείπει το είδος (π.χ. ΠΑΝΤΕΛΟΝΙ).' });
  if (!d.fields.brand) out.push({ level: 'warn', text: 'Λείπει η μάρκα.' });
  if (!(d.price > 0) && !(d.variations || []).some((v) => v.price > 0)) out.push({ level: 'error', text: 'Δεν έχει τιμή.' });
  if (!(d.images || []).length) out.push({ level: 'warn', text: 'Δεν έχει φωτογραφίες.' });
  if (!((d.cats || {}).sf || []).length) out.push({ level: 'warn', text: 'Δεν έχει κατηγορία στο ' + settings.all().sites.sf.name + '.' });
  if (d.sites.st && !((d.cats || {}).st || []).length) out.push({ level: 'warn', text: 'Δεν έχει κατηγορία στο ' + settings.all().sites.st.name + '.' });
  if (U.stripTags(d.description).length < 80) out.push({ level: 'warn', text: 'Η περιγραφή είναι πολύ σύντομη.' });
  // advertising rules (Google / Meta) for the ads site
  const ad = catalog.adStatus('sf', { name: d.title, brand: d.fields.brand, cats: (d.cats || {}).sf || [] }, { cats: (d.cats || {}).st || [] }, 'st');
  d.ads = ad.level; d.adsWhy = ad.why;
  d.regulated = ad.level === 'banned' ? 'critical' : '';
  if (d.sites.st) {
    if (ad.level === 'banned') out.push({ level: 'error', text: 'Δεν επιτρέπεται στις διαφημίσεις (' + ad.why + '): θα μπει μόνο στο ' + settings.all().sites.sf.name + '.' });
    else if (ad.level === 'google') out.push({ level: 'warn', text: 'Στο ' + settings.all().sites.st.name + ' θα μπει κρυφό για το Google Shopping (' + ad.why + '). Στο Meta μόνο με κοινό 18+.' });
    else if (ad.level === 'caution') out.push({ level: 'info', text: 'Διαφημίσεις: ' + ad.why + '. Έλεγξε ότι η περιγραφή δεν το παρουσιάζει ως όπλο.' });
    else if (ad.level === 'meta18') out.push({ level: 'info', text: 'Διαφημίσεις στο Meta μόνο με κοινό 18+ (' + ad.why + ').' });
  }
  // duplicates
  for (const dup of duplicates(d)) out.push({ level: 'warn', text: `Υπάρχει ήδη στο ${settings.all().sites[dup.site].name}: ${dup.name} (${dup.how})`, link: dup });
  const code = U.normSku(d.code || '');
  const twin = store.read('drafts', []).find((x) => x.id !== d.id && x.title && (x.title === d.title || (code.length >= 4 && U.normSku(x.code || '') === code)));
  if (twin) out.push({ level: 'warn', text: 'Υπάρχει και άλλο ίδιο στα νέα προϊόντα (' + (twin.status === 'approved' ? 'εγκεκριμένο' : 'πρόχειρο') + '). Κράτα ένα.' });
  return out;
}

function duplicates(d) {
  const catalog = require('./catalog');
  const out = [];
  const code = U.normSku(d.code || d.sku || '');
  const tk = U.foldKey(d.title);
  for (const site of ['sf', 'st']) {
    for (const p of catalog.load(site).products) {
      let how = '';
      if (code.length >= 4 && p.sku && U.normSku(p.sku) === code) how = 'ίδιος κωδικός';
      else if (p.type !== 'variation' && tk && U.foldKey(p.name) === tk) how = 'ίδιος τίτλος';
      if (how) { out.push({ site, id: p.type === 'variation' ? p.parent : p.id, name: p.name, how }); break; }
    }
  }
  return out;
}

function suggestCategories(d, site) {
  const catalog = require('./catalog');
  const idx = catalog.categoryIndex(site);
  const type = U.foldKey(d.fields.type || '');
  const brand = U.foldKey(d.fields.brand || '');
  const score = new Map();
  for (const p of catalog.load(site).products) {
    if (p.type === 'variation') continue;
    const t = U.foldKey(p.name);
    const sameType = type && (t === type || t.startsWith(type + ' '));
    const sameBrand = brand && U.foldKey(p.brand) === brand;
    if (!sameType) continue;
    for (const c of p.cats) score.set(c, (score.get(c) || 0) + 2 + (sameBrand ? 1 : 0));
  }
  // categories named after the product type (ΣΑΚΙΔΙΟ → ΣΑΚΙΔΙΑ)
  const typeWord = type.split(' ')[0] || '';
  if (typeWord.length >= 4) {
    const stem = typeWord.slice(0, Math.max(4, typeWord.length - 2));
    for (const c of idx.cats) {
      if (U.foldKey(c.name).split(/[\s\-–/,]+/).some((w) => w.startsWith(stem))) score.set(c.id, (score.get(c.id) || 0) + 3);
    }
  }
  // deeper categories win ties
  return [...score.entries()].filter(([id]) => idx.byId.has(id) && !/uncategorized|χωρις κατηγορια/i.test(U.stripTonos(idx.byId.get(id).name).toLowerCase()))
    .sort((a, b) => b[1] - a[1] || idx.pathOf(b[0]).length - idx.pathOf(a[0]).length).slice(0, 5)
    .map(([id, sc]) => ({ id, path: idx.pathOf(id).join(' › '), score: sc }));
}

function blank() {
  return {
    id: U.uid('d'), createdAt: U.nowIso(), updatedAt: U.nowIso(), status: 'draft', source: { type: 'manual' },
    fields: { type: '', brand: '', model: '', extra: '' }, titleManual: '', displayManual: '', code: '', ean: '', sku: '',
    price: 0, sale: 0, cost: 0, priceNote: '', descMode: 'template', descOfficial: '', descCustom: '', descAI: '', keyPoints: '', features: [], specs: [],
    images: [], variations: [], cats: { sf: [], st: [] }, sites: { sf: true, st: true }, supplierId: '', tags: [], autoShort: true, exported: {},
  };
}

function list() { return store.read('drafts', []); }
function get(id) { return list().find((d) => d.id === id) || null; }
function saveAll(all) { store.write('drafts', all.slice(0, 3000)); }

function autoCategories(d) {
  for (const site of ['sf', 'st']) {
    if ((d.cats[site] || []).length) continue;
    const sug = suggestCategories(d, site);
    if (sug.length) d.cats[site] = [sug[0].id];
  }
}

function fromExtract(x, opts) {
  const sup = require('./suppliers');
  const catalog = require('./catalog');
  const d = blank();
  d.source = { type: 'url', url: x.url, host: x.host };
  const brand = x.brand || brandIn(x.name || '', []);
  let model = U.collapse(x.name || '');
  // model = name without brand and without type words we translate
  if (brand) model = model.replace(new RegExp('\\b' + brand.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i'), '').trim();
  const type = guessType(x.name, x.category || (x.breadcrumbs || []).slice(-1)[0]);
  if (type && /[Ͱ-Ͽ]/.test(x.name || '')) {
    // Greek supplier title: drop the leading type words from the model
    const caps = U.greekUpper(model);
    if (caps.startsWith(type + ' ')) model = model.slice(type.length).trim();
  } else {
    for (const [re] of EN_TYPES) model = model.replace(re, ' ');
  }
  model = U.collapse(model.replace(/\s[-–|]\s*$/, ''));
  d.fields = { type, brand, model, extra: '' };
  d.code = x.code || ''; d.ean = x.ean || '';
  d.descOfficial = x.descHtml || '';
  d.descMode = x.descHtml ? 'official' : 'template';
  d.features = x.features || []; d.specs = x.specs || [];
  d.images = x.images || [];
  const variants = x.variants || [];
  const colors = [...new Set(variants.map((v) => v.color).filter(Boolean))];
  if (colors.length === 1) { d.fields.extra = translateColor(colors[0]); }
  d.variations = variants.map((v) => ({ size: U.greekUpper(v.size), color: colors.length > 1 ? translateColor(v.color) : '', sku: v.sku || '', ean: v.ean || '', price: 0, supplierPrice: v.price || 0 }))
    .filter((v) => v.size || v.color);
  // dedupe variations
  const seen = new Set();
  d.variations = d.variations.filter((v) => { const k = v.size + '|' + v.color; if (seen.has(k)) return false; seen.add(k); return true; });
  if (opts && opts.supplierId) d.supplierId = opts.supplierId;
  else {
    const s = sup.forProduct({ brand, name: x.name, sku: x.code });
    if (s) d.supplierId = s.id;
  }
  d.supplierPrice = x.price || 0;
  if (x.price > 0 && (!x.currency || x.currency === 'EUR')) {
    // A public page shows retail prices; costs come from the supplier's price list.
    d.price = U.roundPrice(x.price, settings.all().rounding);
    d.priceNote = `Τιμή στη σελίδα: ${U.money(x.price)}. Έλεγξέ την ή κάνε έρευνα αγοράς.`;
  }
  d.notes = x.notes || [];
  derive(d);
  autoCategories(d);
  derive(d);
  const all = list(); all.unshift(d); saveAll(all);
  return d;
}

/** Turn price-list rows into drafts. Rows with the same model code (or same name) become one product with sizes/colours. */
function fromPricelist(supplierId, keys) {
  const pl = require('./pricelist');
  const sup = require('./suppliers').get(supplierId);
  const items = pl.rawItems(supplierId).filter((i) => keys.includes(i.key));
  const list0 = require('./store').read('pricelist-' + supplierId, {});
  const groups = new Map();
  for (const it of items) {
    const gk = it.group ? 'g:' + U.normSku(it.group) : 'n:' + U.foldKey(it.name.replace(/\b(XXS|XS|S|M|L|XL|XXL|XXXL|\dXL)\b\s*$/i, ''));
    if (!groups.has(gk)) groups.set(gk, []);
    groups.get(gk).push(it);
  }
  const created = [];
  const all = list();
  for (const [, its] of groups) {
    const first = its[0];
    const d = blank();
    d.source = { type: 'pricelist', supplierId };
    d.supplierId = supplierId;
    const brand = first.brand || brandIn(first.name, sup ? sup.brands : []) || (sup && sup.brands && sup.brands.length === 1 ? sup.brands[0] : '');
    let model = first.name;
    if (brand) model = model.replace(new RegExp('\\b' + brand.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i'), '').trim();
    const type = guessType(first.name, first.category);
    if (/[Ͱ-Ͽ]/.test(first.name) && type && U.greekUpper(model).startsWith(type + ' ')) model = model.slice(type.length).trim();
    else for (const [re] of EN_TYPES) model = model.replace(re, ' ');
    const colors = [...new Set(its.map((i) => i.color).filter(Boolean))];
    if (its.length > 1) {
      // drop size/colour from the model text
      for (const i of its) { if (i.size) model = model.replace(new RegExp('\\b' + i.size.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i'), ''); }
    }
    for (const c of colors) model = model.replace(new RegExp('\\b' + c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i'), '');
    d.fields = { type, brand, model: U.collapse(model), extra: colors.length === 1 ? translateColor(colors[0]) : '' };
    d.code = first.group || (its.length === 1 ? first.code : '');
    d.ean = its.length === 1 ? first.ean : '';
    d.descOfficial = first.desc ? (/<[a-z]/i.test(first.desc) ? require('./extract').cleanHtml(first.desc) : require('./extract').textToHtml(first.desc)) : '';
    d.descMode = d.descOfficial ? 'official' : 'template';
    d.images = [...new Set(its.flatMap((i) => i.images))].slice(0, 12);
    const r = pl.retailFor(sup, list0, first.price);
    d.price = r.retail; d.cost = r.cost;
    d.priceNote = list0.priceKind === 'cost' ? `Κόστος ${U.money(r.cost)} + ${sup ? sup.markup : 80}% + ΦΠΑ` : `Λιανική αντιπροσώπου ${U.money(first.price)}`;
    if (its.length > 1 || first.size) {
      d.variations = its.map((i) => {
        const rr = pl.retailFor(sup, list0, i.price);
        return { size: U.greekUpper(i.size), color: colors.length > 1 ? translateColor(i.color) : '', sku: i.code, ean: i.ean, price: Math.abs(rr.retail - d.price) > 0.009 ? rr.retail : 0 };
      }).filter((v) => v.size || v.color);
    }
    derive(d); autoCategories(d); derive(d);
    all.unshift(d); created.push(d);
  }
  saveAll(all);
  return created;
}

/**
 * New products from a supplier list. Items that have a page on the supplier's site (catalog / B2B source)
 * are read from that page: official description, all photos, sizes and colours; the price comes from the list.
 */
async function fromPricelistRich(supplierId, keys, job) {
  const pl = require('./pricelist');
  const extract = require('./extract');
  const sup = require('./suppliers').get(supplierId);
  const list0 = require('./store').read('pricelist-' + supplierId, {});
  const items = pl.rawItems(supplierId).filter((i) => keys.includes(i.key));
  const withPage = items.filter((i) => /^https?:\/\//i.test(i.url || ''));
  const plain = items.filter((i) => !withPage.includes(i));
  const created = [];
  const errors = [];
  let n = 0;
  for (const it of withPage) {
    if (job && job.cancelled()) break;
    job && job.progress(n++, withPage.length, it.name);
    try {
      const x = await extract.fromUrl(it.url);
      const d = fromExtract(x, { supplierId });
      const r = pl.retailFor(sup, list0, it.price);
      const all = list();
      const dd = all.find((y) => y.id === d.id);
      if (dd && r.retail > 0) {
        dd.price = r.retail; dd.cost = r.cost;
        dd.priceNote = list0.priceKind === 'cost' ? `Κόστος ${U.money(r.cost)} + ${sup ? sup.markup : 80}% + ΦΠΑ` : `Λιανική αντιπροσώπου ${U.money(it.price)}`;
        if (!dd.code && it.code) dd.code = it.code;
        if (!dd.ean && it.ean) dd.ean = it.ean;
        derive(dd); saveAll(all);
      }
      created.push(d);
    } catch (e) { errors.push(it.name + ': ' + e.message); plain.push(it); }
  }
  if (plain.length) created.push(...fromPricelist(supplierId, plain.map((i) => i.key)));
  job && job.progress(withPage.length, withPage.length, 'Έτοιμο');
  return { created: created.length, errors: errors.slice(0, 10) };
}

function create(input) {
  const d = Object.assign(blank(), input || {});
  derive(d); autoCategories(d); derive(d);
  const all = list(); all.unshift(d); saveAll(all);
  return d;
}

function update(id, patch) {
  const all = list();
  const i = all.findIndex((d) => d.id === id);
  if (i < 0) throw new Error('Δεν βρέθηκε το προϊόν.');
  const d = all[i];
  const allowed = ['fields', 'titleManual', 'displayManual', 'code', 'ean', 'sku', 'price', 'sale', 'cost', 'priceNote', 'descMode', 'descOfficial', 'descCustom', 'descAI', 'keyPoints', 'features', 'specs', 'images', 'variations', 'cats', 'sites', 'supplierId', 'tags', 'autoShort', 'shortManual', 'status', 'newCategory'];
  for (const k of allowed) if (patch[k] !== undefined) d[k] = k === 'fields' ? Object.assign({}, d.fields, patch.fields) : patch[k];
  if (patch.fields && (patch.fields.type !== undefined || patch.fields.brand !== undefined)) d.sku = patch.sku !== undefined ? patch.sku : d.sku;
  d.updatedAt = U.nowIso();
  derive(d);
  all[i] = d; saveAll(all);
  return d;
}
function remove(ids) { const set = new Set([].concat(ids)); saveAll(list().filter((d) => !set.has(d.id))); }
function refreshAll() { const all = list().map(derive); saveAll(all); return all.length; }

function exportDrafts(ids, site) {
  const wx = require('./wooexport');
  const all = list();
  const skipped = [];
  const pick = [];
  for (const d of all.filter((x) => ids.includes(x.id))) {
    if (!d.sites[site]) { skipped.push({ name: d.title, why: 'Δεν είναι επιλεγμένο για αυτό το site.' }); continue; }
    if (site === 'st' && d.ads === 'banned') { skipped.push({ name: d.title, why: 'Δεν επιτρέπεται στις διαφημίσεις (' + (d.adsWhy || 'όπλα/φυσίγγια') + ').' }); continue; }
    const dup = duplicates(d).find((x) => x.site === site && x.how === 'ίδιος κωδικός');
    if (dup) { skipped.push({ name: d.title, why: 'Υπάρχει ήδη με τον ίδιο κωδικό: ' + dup.name }); continue; }
    pick.push(d);
  }
  if (!pick.length) throw new Error(skipped.length ? 'Κανένα προϊόν για αυτό το site: ' + skipped.map((x) => x.name + ' — ' + x.why).join(' · ') : 'Δεν υπάρχουν προϊόντα για αυτό το site.');
  const res = wx.newProducts(pick, site);
  const at = U.nowIso();
  for (const d of pick) { d.exported = Object.assign({}, d.exported, { [site]: at }); if (d.status === 'draft') d.status = 'approved'; }
  saveAll(all);
  return { csv: res.csv, count: pick.length, skipped };
}

module.exports = { list, get, create, update, remove, fromExtract, fromPricelist, fromPricelistRich, suggestCategories, typeSuggestions, exportDrafts, derive, refreshAll, guessType, translateColor, buildTitle };
