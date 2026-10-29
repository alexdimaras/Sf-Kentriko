'use strict';
// Ready fixes, waiting for a yes. Whatever is missing or wrong, the program fills it in by itself HERE, in the
// program (never on the sites): each change says what, why, from where, and how sure it is.
//   high   — mechanical rules or a sure source (same EAN / code at the supplier, our own other site)
//   medium — probably right (match by name, spelling, type word, category): worth a look
// Nothing is guessed: no source → no proposal. Approved changes become ONE WooCommerce update file per site,
// with the product ID and only the changed columns.
//
// Sources of content, in order of trust: the same product on our other site, the supplier's price list / feed
// (code, EAN, description, photos), the supplier's product page (read politely, kept for 30 days), a page the
// user gives. Competitors' texts are never copied (their work, and duplicate content hurts SEO).
const crypto = require('crypto');
const store = require('./store');
const settings = require('./settings');
const U = require('./util');

const KEY = 'fixes';            // decisions: changeId -> { status, hash, at, by, edited }
const CACHE = 'enrich-cache';   // what was found for each product + the supplier pages read (re-readable: not in backups)
const PAGE_DAYS = 30;

const FIELD = {
  name: 'Τίτλος', desc: 'Περιγραφή', short: 'Σύντομη περιγραφή', images: 'Φωτογραφίες', brand: 'Μάρκα', gtin: 'EAN / GTIN',
  price: 'Τιμή', cats: 'Κατηγορία', published: 'Δημοσίευση', gla: 'Google Shopping',
};
const GROUP = { name: 'titles', desc: 'content', short: 'content', images: 'content', brand: 'content', gtin: 'content', price: 'prices', cats: 'cats', published: 'ads', gla: 'ads' };
const GROUPS = { content: 'Περιεχόμενο', titles: 'Τίτλοι', prices: 'Τιμές', cats: 'Κατηγορίες', ads: 'Διαφημίσεις' };

/** Meta description for Google: the text after the title heading, cut at ~155 characters on a word. */
function metaOf(html) { return require('./wooexport').metaDescription(String(html || '').replace(/^\s*<(h[1-6]|p)>(?:<strong>)?[^<]*(?:<\/strong>)?<\/\1>/i, ''), ''); }
const hashOf = (v) => crypto.createHash('sha1').update(JSON.stringify(v)).digest('hex').slice(0, 12);
const stripText = (html) => U.collapse(U.stripTags(String(html || '')));
/** Share of Greek letters among all letters (0..1): below ~0.3 the text is in English (or another language). */
function greekShare(text) {
  const t = String(text || '');
  const gr = (t.match(/[Ͱ-Ͽἀ-῿]/g) || []).length;
  const all = gr + (t.match(/[A-Za-zÀ-ÿ]/g) || []).length;
  return all ? gr / all : 1;
}
/** GTIN-8/12/13/14 with a correct check digit. */
function validGtin(s) {
  const g = String(s || '').replace(/\D/g, '');
  if (![8, 12, 13, 14].includes(g.length) || /^0+$/.test(g)) return '';
  let sum = 0;
  for (let i = 0; i < g.length - 1; i++) sum += Number(g[g.length - 2 - i]) * (i % 2 === 0 ? 3 : 1);
  return (10 - (sum % 10)) % 10 === Number(g[g.length - 1]) ? g : '';
}

function decisions() { return store.read(KEY, null) || {}; }
function cache() { const c = store.read(CACHE, null) || {}; c.products = c.products || {}; c.pages = c.pages || {}; return c; }

// ---------- what a product needs ----------
function contentNeeds(p, s) {
  const desc = stripText(p.desc);
  // a "description" that is only the title again (checked only for short texts: it is cheap that way)
  let onlyTitle = false;
  if (desc && desc.length <= p.name.length + 40) {
    const title = U.foldKey(p.name), fd = U.foldKey(desc);
    onlyTitle = fd.replace(/[^A-Z0-9Α-Ω ]/g, '').trim().length <= title.length + 12 && fd.includes(title.slice(0, Math.min(20, title.length)));
  }
  const english = desc.length >= 80 && greekShare(desc) < 0.3;
  return {
    desc: !desc || desc.length < Math.max(300, s.descMinChars || 150) || onlyTitle || english,
    descWhy: !desc ? 'Δεν έχει περιγραφή' : onlyTitle ? 'Η περιγραφή επαναλαμβάνει μόνο τον τίτλο' : english ? 'Η περιγραφή είναι στα αγγλικά' : `Πολύ μικρή περιγραφή (${desc.length} χαρακτήρες)`,
    english, hasOwn: desc.length >= 40 && !onlyTitle && !english,
    short: !stripText(p.short),
    images: (p.images || []).length < 2,
    brand: !p.brand,
  };
}

// ---------- what must never reach our site from a supplier's text ----------
// Paragraphs / list items with the supplier's contacts, links, prices, "our shop", wholesale / B2B words
// are dropped (they are true for the supplier, wrong on our site).
// (checked without accents, in small letters: ΑΝΤΙΠΡΟΣΩΠΟΣ = αντιπρόσωπος = αντιπροσωπος)
const RISKY = /@|https?:\/\/|www\.|(?:\+?30\s?)?(?:^|\D)(?:2\d{9}|69\d{8})(?:\D|$)|\d{3}[\s.-]\d{3}[\s.-]\d{4}|τηλ[.:ε]|τηλεφων|επικοινων|χονδρικ|b2b|αντιπροσωπ|αποκλειστικ|e-?mail|καταστηματα μας|καταστημα μας|(?:^|[^α-ωa-z])τιμη(?:[^α-ωa-z]|$)|€|(?:^|[^a-z])eur(?:[^a-z]|$)|δωρεαν μεταφορικ|αποστολη σε|παραδοση σε|cookie|καλαθι|add to cart|in stock|σε αποθεμα|διαθεσιμοτητα|ημερες παραδοσης/;
const LEGAL = /\b(AE|EPE|IKE|OE|EE|LTD|GMBH|SA|SRL|INC|CO|ΑΕ|ΕΠΕ|ΙΚΕ|ΟΕ|ΕΕ)\b\.?/g;
const risky = (t) => RISKY.test(U.stripTonos(String(t || '')).toLowerCase());
function scrub(html, supName) {
  const name = U.foldKey(supName || '').replace(LEGAL, ' ').replace(/[^A-Z0-9Α-Ω ]/g, ' ').replace(/\s+/g, ' ').trim();
  const bad = (inner) => { const t = U.stripTags(inner); return risky(t) || (name.length >= 4 && (' ' + U.foldKey(t).replace(/[^A-Z0-9Α-Ω ]/g, ' ').replace(/\s+/g, ' ') + ' ').includes(' ' + name + ' ')); };
  let out = String(html || '').replace(/<(p|li|h[2-5]|blockquote)>([\s\S]*?)<\/\1>/g, (m, tag, inner) => (bad(inner) ? '' : m));
  out = out.replace(/<(ul|ol)>\s*<\/\1>/g, '').replace(/<table>[\s\S]*?<\/table>/g, (m) => (bad(m) ? '' : m));
  return out.trim();
}

// ---------- the description, in the shop's style ----------
// <h2>Title in Title Case</h2> + what the shop already wrote (kept) + the supplier's official text
// + a list: manufacturer, code, specs, features + the shop's footer (Settings → New products).
function buildDesc(p, data, own, fixedName) {
  const catalog = require('./catalog');
  const s = settings.all();
  const extract = require('./extract');
  const title = U.titleCase(fixedName || p.name, catalog.accents());
  const tag = ['h2', 'h3', 'p'].includes(s.newProduct.titleTag) ? s.newProduct.titleTag : 'h2';
  let html = tag === 'p' ? `<p><strong>${U.escapeHtml(title)}</strong></p>` : `<${tag}>${U.escapeHtml(title)}</${tag}>`;
  const ownHtml = own ? extract.cleanHtml(p.desc).replace(/^<h\d>[^<]*<\/h\d>/, '') : '';
  const ownText = U.foldKey(stripText(ownHtml));
  if (ownHtml) html += ownHtml;
  let official = data.descHtml ? scrub(extract.cleanHtml(data.descHtml), data.supplier) : '';
  if (official && ownText && ownText.length > 60 && U.foldKey(stripText(official)).includes(ownText.slice(0, 60))) official = ''; // already there
  if (official) html += official;
  const have = U.foldKey(stripText(html));
  const li = [];
  const brand = p.brand || data.brand;
  if (brand && !/ΚΑΤΑΣΚΕΥΑΣΤΗΣ|MANUFACTURER|BRAND/.test(have)) li.push(`Κατασκευαστής: ${U.escapeHtml(brand)}`);
  if (p.sku && !have.includes(U.foldKey(p.sku))) li.push(`Κωδικός: ${U.escapeHtml(p.sku)}`);
  for (const sp of (data.specs || []).slice(0, 15)) if (!have.includes(U.foldKey(sp.v)) && !risky(sp.k + ' ' + sp.v)) li.push(`${U.escapeHtml(sp.k)}: ${U.escapeHtml(sp.v)}`);
  for (const f of (data.features || []).slice(0, 12)) if (!have.includes(U.foldKey(f).slice(0, 40)) && !risky(f)) li.push(U.escapeHtml(f));
  if (li.length) html += `<ul>${li.map((x) => `<li>${x}</li>`).join('')}</ul>`;
  if (s.newProduct.footer && !have.includes(U.foldKey(s.newProduct.footer).slice(0, 30))) html += `<p>${U.escapeHtml(s.newProduct.footer)}</p>`;
  return html;
}
/** Short description: the 3–6 facts a customer looks for next to the price. */
function buildShort(p, data, sizes) {
  const facts = [];
  for (const f of (data.features || []).filter((x) => x.length <= 90 && !risky(x)).slice(0, 3)) facts.push(U.escapeHtml(f));
  if (!facts.length) for (const sp of (data.specs || []).filter((x) => !risky(x.k + ' ' + x.v)).slice(0, 3)) facts.push(`${U.escapeHtml(sp.k)}: ${U.escapeHtml(sp.v)}`);
  if (sizes.length) facts.push(`Μεγέθη: ${U.escapeHtml(sizes.join(', '))}`);
  if (!facts.length) return ''; // only brand and code: not worth a box
  const brand = p.brand || data.brand;
  const pts = (brand ? [`Κατασκευαστής: ${U.escapeHtml(brand)}`] : []).concat(facts, p.sku ? [`Κωδικός: ${U.escapeHtml(p.sku)}`] : []);
  return `<ul>${pts.map((x) => `<li>${x}</li>`).join('')}</ul>`;
}
function sizesOf(site, p) {
  if (p.type !== 'variable') return [];
  const catalog = require('./catalog');
  const out = [];
  for (const v of catalog.load(site).products) {
    if (v.type !== 'variation' || v.parent !== p.id) continue;
    const m = String(v.varLabel || '').match(/(?:μέγεθος|μεγεθος|νούμερο|νουμερο|size)[^:]*:\s*([^,]+)/i);
    if (m && !out.includes(m[1].trim())) out.push(m[1].trim());
  }
  return out.slice(0, 20);
}
function sameImage(a, b) { const k = (u) => String(u || '').replace(/\?.*$/, '').replace(/-\d{2,4}x\d{2,4}(?=\.\w+$)/, '').toLowerCase().split('/').pop(); return k(a) === k(b); }

/**
 * The category of similar products, for products that are only in the general category: the categories of
 * the shop's products whose title starts with the same type word (same brand counts more), plus the
 * categories named after the type (ΣΑΚΙΔΙΟ → ΣΑΚΙΔΙΑ). Built once per site, answers are remembered.
 */
function categoryGuesser(site, isDefault) {
  const catalog = require('./catalog');
  const idx = catalog.categoryIndex(site);
  const keyed = catalog.load(site).products.filter((p) => p.type !== 'variation' && (p.cats || []).some((c) => !isDefault(c))).map((p) => ({ t: U.foldKey(p.name), b: U.foldKey(p.brand || ''), cats: p.cats.filter((c) => !isDefault(c)) }));
  const catWords = idx.cats.filter((c) => !isDefault(c.id)).map((c) => ({ id: c.id, words: U.foldKey(c.name).split(/[\s\-–/,]+/) }));
  const memo = new Map();
  return (typeRaw, brandRaw) => {
    const type = U.foldKey(typeRaw), brand = U.foldKey(brandRaw || '');
    const mk = type + '|' + brand;
    if (memo.has(mk)) return memo.get(mk);
    const score = new Map();
    for (const k of keyed) {
      if (k.t !== type && !k.t.startsWith(type + ' ')) continue;
      for (const c of k.cats) score.set(c, (score.get(c) || 0) + 2 + (brand && k.b === brand ? 1 : 0));
    }
    const word = type.split(' ')[0] || '';
    if (word.length >= 4) { const stem = word.slice(0, Math.max(4, word.length - 2)); for (const c of catWords) if (c.words.some((w) => w.startsWith(stem))) score.set(c.id, (score.get(c.id) || 0) + 3); }
    const best = [...score.entries()].filter(([id]) => idx.byId.has(id)).sort((a, b) => b[1] - a[1] || idx.pathOf(b[0]).length - idx.pathOf(a[0]).length)[0];
    const res = best ? { id: best[0], path: idx.pathOf(best[0]).join(' › '), score: best[1] } : null;
    memo.set(mk, res);
    return res;
  };
}

// ---------- compute every proposal (fast: only local data; the job below reads the suppliers) ----------
let memo = null;
function invalidate() { memo = null; }

function compute() {
  if (memo) return memo;
  const catalog = require('./catalog');
  const checks = require('./checks');
  const wx = require('./wooexport');
  const s = settings.all();
  const out = [];
  const add = (c) => { c.id = `${c.site}:${c.pid}:${c.field}`; c.group = GROUP[c.field]; c.label = FIELD[c.field]; c.hash = hashOf(c.to); out.push(c); };
  const ec = cache();
  const L = catalog.links();
  const ign = checks.ignored();
  const ignoredIn = (id, site, pid) => (ign[id] || []).includes(site + ':' + pid);
  for (const site of catalog.SITES) {
    const cat = catalog.load(site);
    if (!cat.syncedAt) continue;
    const other = site === 'sf' ? 'st' : 'sf';
    const oById = new Map(catalog.load(other).products.map((p) => [p.id, p]));
    const map = site === 'sf' ? L.sfToSt : L.stToSf;
    const main = cat.products.filter((p) => p.type !== 'variation' && p.status !== 'draft' && p.status !== 'private');
    const ctx = checks.titleContext(site);
    const idx = catalog.categoryIndex(site);
    const isDefault = (id) => { const cc = idx.byId.get(id); return !cc || /^(uncategorized|default|xoris-katigoria|χωρις-κατηγορια|genika)$/i.test(String(cc.slug || '')) || /^(uncategorized|χωρις κατηγορια)$/i.test(U.stripTonos(cc.name).toLowerCase()); };
    const attrBrands = !wx.usesBrandTaxonomy(site);
    const guessCat = categoryGuesser(site, isDefault);
    const seo = wx.seoColumns(wx.seoMode(site));
    for (const p of main) {
      const base = { site, pid: p.id, name: p.name, img: p.thumb || (p.images || [])[0] || '', url: p.url, sku: p.sku, type: p.type };
      // titles: every rule of the checks, combined into one corrected title
      let fixedName = '';
      if (!['mixed', 'typos', 'suspect', 'typefirst', 'caps', 'accents', 'spaces'].some((k) => ignoredIn(site + '-' + k, site, p.id))) {
        const tf = checks.titleFix(p, ctx);
        if (tf.fix && tf.fix !== p.name && tf.steps.length) {
          fixedName = tf.fix;
          add(Object.assign({}, base, { field: 'name', from: p.name, to: tf.fix, why: tf.steps.map((x) => x.why).join(' · '), source: { kind: 'rule', label: 'Κανόνες τίτλων του καταστήματος' }, level: tf.steps.some((x) => x.level === 'medium') ? 'medium' : 'high' }));
        }
      }
      // category: only in the general category → the category of similar products (same type word)
      if ((!p.cats.length || p.cats.every(isDefault)) && !ignoredIn(site + '-nocat', site, p.id)) {
        // the type word: the first Greek word of the title (5.11 TACTICAL ΜΠΟΥΦΑΝ … → ΜΠΟΥΦΑΝ)
        const type = (U.greekUpper(fixedName || p.name).match(/[Α-Ω]{3,}(?:\s[Α-Ω]{3,})?/) || [''])[0];
        const sug = type ? guessCat(type, p.brand) : null;
        if (sug && sug.score >= 6) add(Object.assign({}, base, { field: 'cats', from: (p.catNames || []).join(', ') || '—', to: { id: sug.id, path: sug.path }, why: `Είναι μόνο στη γενική κατηγορία. Προϊόντα «${type}» είναι στην «${sug.path}».`, source: { kind: 'rule', label: 'Από παρόμοια προϊόντα του καταστήματος' }, level: 'medium' }));
      }
      // ads site: what Google / Meta do not allow
      if (site === 'st') {
        const oid = map.get(p.id);
        const ad = catalog.adStatus(site, p, oid ? oById.get(oid) : null, other);
        if (ad.level === 'banned' && !ignoredIn('st-ads-banned', site, p.id)) add(Object.assign({}, base, { field: 'published', from: 'Δημοσιευμένο', to: -1, why: `Απαγορεύεται σε Google και Meta (${ad.why}): γίνεται «Πρόχειρο» στο ${s.sites.st.name}, δεν διαγράφεται. Στο ${s.sites.sf.name} μένει κανονικά.`, source: { kind: 'rule', label: 'Κανόνες διαφημίσεων Google / Meta' }, level: 'high' }));
        else if (ad.level === 'google' && !ignoredIn('st-ads-google', site, p.id)) add(Object.assign({}, base, { field: 'gla', from: 'Στο Google Shopping', to: 'dont-sync-and-show', why: `Το Google δεν το δέχεται (${ad.why}): μένει στο site, βγαίνει από το Google Shopping.`, source: { kind: 'rule', label: 'Κανόνες διαφημίσεων Google' }, level: 'high' }));
      }
      // content: description, short description, photos, brand, EAN — only from a real source
      const need = contentNeeds(p, s);
      const found = ec.products[site + ':' + p.id];
      const twin = (() => { const oid = map.get(p.id); return oid ? oById.get(oid) : null; })();
      // our other site already has a good text / more photos: the safest source of all (our own work)
      const twinDesc = twin && stripText(twin.desc).length >= 300 && greekShare(stripText(twin.desc)) >= 0.3 ? twin.desc : '';
      if (need.desc && twinDesc && !need.hasOwn) {
        add(Object.assign({}, base, { field: 'desc', from: p.desc || '', to: { html: twinDesc, meta: seo ? metaOf(twinDesc) : '' }, why: need.descWhy + `. Το ίδιο προϊόν στο ${s.sites[other].name} έχει πλήρη περιγραφή.`, source: { kind: 'twin', label: 'Από το ' + s.sites[other].name, url: twin.url }, level: 'high' }));
      } else if (need.desc && found && found.data && stripText(scrub(found.data.descHtmlEl || found.data.descHtml, found.data.supplier)).length >= 80) {
        const html = buildDesc(p, Object.assign({}, found.data, found.data.descHtmlEl ? { descHtml: found.data.descHtmlEl } : {}), need.hasOwn, fixedName);
        const englishSrc = !found.data.descHtmlEl && greekShare(stripText(found.data.descHtml)) < 0.3;
        add(Object.assign({}, base, { field: 'desc', from: p.desc || '', to: { html, meta: seo ? metaOf(html) : '' }, why: need.descWhy + '.' + (englishSrc ? ' Το κείμενο του αντιπροσώπου είναι στα αγγλικά: μετάφρασέ το (AI) ή κράτα το.' : '') + (found.data.descHtmlEl ? ' Μετάφραση με AI: διάβασέ τη πριν την έγκριση.' : ''), source: found.src, level: found.src.level === 'high' && !englishSrc && !found.data.descHtmlEl ? 'high' : 'medium', english: englishSrc }));
      }
      if (need.short && found && found.data) {
        const sh = buildShort(p, found.data, sizesOf(site, p));
        if (sh) add(Object.assign({}, base, { field: 'short', from: p.short || '', to: sh, why: 'Δεν έχει σύντομη περιγραφή: τα βασικά δίπλα στην τιμή βοηθούν τον πελάτη να αποφασίσει.', source: found.src, level: found.src.level }));
      }
      // photos from ONE source: our other site first (our own photos), else the supplier's
      const extraImgs = [];
      let fromTwin = false;
      if (need.images) {
        const twinMore = twin && (twin.images || []).length > (p.images || []).length;
        fromTwin = !!twinMore;
        const cand = twinMore ? twin.images : found && found.data ? found.data.images || [] : [];
        for (const u of cand) if (!(p.images || []).some((x) => sameImage(x, u)) && !extraImgs.some((x) => sameImage(x, u))) extraImgs.push(u);
      }
      if (extraImgs.length) {
        add(Object.assign({}, base, { field: 'images', from: p.images || [], to: (p.images || []).concat(extraImgs).slice(0, 6), why: (p.images || []).length ? 'Μόνο μία φωτογραφία: περισσότερες όψεις = περισσότερες πωλήσεις.' : 'Δεν έχει φωτογραφία: χωρίς αυτή δεν πουλάει και το Google Shopping το απορρίπτει.', source: fromTwin ? { kind: 'twin', label: 'Από το ' + s.sites[other].name, url: twin.url } : found.src, level: fromTwin ? 'high' : found.src.level }));
      }
      if (need.brand && found && found.data && found.data.brand && U.foldKey(found.data.brand).length >= 2) {
        const exportable = attrBrands && p.type === 'simple' && !(p.attrs || []).length;
        add(Object.assign({}, base, { field: 'brand', from: '', to: U.collapse(found.data.brand), why: 'Χωρίς μάρκα: η μάρκα μπαίνει στα φίλτρα, στο Google και συνδέει το προϊόν με τον αντιπρόσωπο.' + (exportable ? '' : ' (Δεν μπαίνει στο αρχείο: ' + (attrBrands ? 'το προϊόν έχει ήδη ιδιότητες/μεγέθη' : 'το κατάστημα χρησιμοποιεί «Brands»') + ' — βάλ’ τη από τη μαζική επεξεργασία.)'), source: found.src, level: found.src.level, exportable }));
      }
      if (found && found.data && found.src.level === 'high' && p.type === 'simple') {
        const g = validGtin(found.data.ean);
        if (g && !p.ean) add(Object.assign({}, base, { field: 'gtin', from: '', to: g, why: 'Το EAN βοηθά το Google Shopping να δείξει το προϊόν (σωστό ψηφίο ελέγχου).', source: found.src, level: 'high' }));
      }
    }
  }
  // prices: the two sites must agree (the reference site wins)
  for (const it of (checks.cached().checks.find((c) => c.id === 'x-price') || { items: [] }).items) {
    if (!it.fix || !(Number(it.fix.regular) > 0)) continue;
    add({ site: it.site, pid: it.id, name: it.name, img: it.img, url: it.url, sku: it.sku, type: it.type, field: 'price', from: { price: it.site === 'st' ? it.stPrice : it.sfPrice }, to: { regular: Number(it.fix.regular), sale: Number(it.fix.sale) || 0, srcId: it.srcId }, why: `Διαφορετική τιμή στα δύο sites (${it.why}). Σωστή είναι του ${settings.all().sites[settings.all().master === 'st' ? 'st' : 'sf'].name}.`, source: { kind: 'rule', label: 'Η τιμή του κεντρικού site' }, level: 'high' });
  }
  // the user's decisions
  const dec = decisions();
  for (const c of out) {
    const d = dec[c.id];
    c.status = 'pending';
    if (d && (d.hash === c.hash || d.edited !== undefined)) {
      c.status = d.status; c.at = d.at; c.by = d.by || '';
      if (d.edited !== undefined) { c.edited = true; c.to = d.edited; }
    }
  }
  memo = { at: U.nowIso(), items: out, cacheAt: ec.at || null };
  return memo;
}

// ---------- quality score of the catalog (0–100 per product) ----------
function quality(site) {
  const catalog = require('./catalog');
  const cat = catalog.load(site);
  const s = settings.all();
  const main = cat.products.filter((p) => p.type !== 'variation' && p.status !== 'draft' && p.status !== 'private');
  const parts = { desc: 0, images: 0, brand: 0, short: 0, title: 0, sku: 0 };
  const W = { desc: 30, images: 25, brand: 10, short: 10, title: 15, sku: 10 };
  let total = 0;
  const pending = new Map();
  for (const c of compute().items) if (c.site === site && c.status !== 'rejected') { if (!pending.has(c.pid)) pending.set(c.pid, new Set()); pending.get(c.pid).add(c.field); }
  let after = 0;
  for (const p of main) {
    const n = contentNeeds(p, s);
    const desc = stripText(p.desc).length;
    const sc = {
      desc: n.desc ? (desc >= 80 && !n.english ? 0.4 : 0) : 1,
      images: (p.images || []).length >= 2 ? 1 : (p.images || []).length === 1 ? 0.5 : 0,
      brand: p.brand ? 1 : 0, short: n.short ? 0 : 1,
      title: /^[Α-Ω]/.test(U.greekUpper(p.name)) && p.name.length <= (s.longTitle || 110) && !/[a-zά-ώ]/.test(p.name) ? 1 : 0,
      sku: p.sku ? 1 : 0,
    };
    let v = 0;
    for (const k of Object.keys(W)) { v += sc[k] * W[k]; parts[k] += sc[k]; }
    total += v;
    // after the waiting fixes
    const f = pending.get(p.id);
    if (f) { if (f.has('desc')) sc.desc = 1; if (f.has('images')) sc.images = 1; if (f.has('brand')) sc.brand = 1; if (f.has('short')) sc.short = 1; if (f.has('name')) sc.title = 1; }
    let a = 0; for (const k of Object.keys(W)) a += sc[k] * W[k];
    after += a;
  }
  const n = main.length || 1;
  const pct = (x) => Math.round((x / n) * 100);
  return {
    site, products: main.length, score: Math.round(total / n), after: Math.round(after / n),
    parts: [
      { key: 'desc', label: 'Περιγραφή', pct: pct(parts.desc), weight: W.desc }, { key: 'images', label: 'Φωτογραφίες (2+)', pct: pct(parts.images), weight: W.images },
      { key: 'title', label: 'Τίτλος σωστός', pct: pct(parts.title), weight: W.title }, { key: 'brand', label: 'Μάρκα', pct: pct(parts.brand), weight: W.brand },
      { key: 'short', label: 'Σύντομη περιγραφή', pct: pct(parts.short), weight: W.short }, { key: 'sku', label: 'Κωδικός (SKU)', pct: pct(parts.sku), weight: W.sku },
    ],
  };
}

// ---------- the screen ----------
function view(q) {
  q = q || {};
  const all = compute().items;
  const site = q.site === 'st' ? 'st' : q.site === 'sf' ? 'sf' : '';
  const status = ['pending', 'approved', 'exported', 'rejected'].includes(q.status) ? q.status : 'pending';
  const counts = { groups: {}, status: { pending: 0, approved: 0, exported: 0, rejected: 0 }, high: 0, sites: { sf: 0, st: 0 } };
  for (const c of all) {
    if (site && c.site !== site) continue;
    counts.status[c.status]++;
    if (c.status !== status) continue;
    counts.groups[c.group] = (counts.groups[c.group] || 0) + 1;
    if (c.level === 'high') counts.high++;
  }
  for (const c of all) if (c.status === 'approved') counts.sites[c.site]++;
  let list = all.filter((c) => (!site || c.site === site) && c.status === status && (!q.group || c.group === q.group) && (q.level !== 'high' || c.level === 'high'));
  if (q.q) { const t = U.foldKey(q.q).split(' ').filter(Boolean); list = list.filter((c) => { const h = U.foldKey(c.name + ' ' + (c.sku || '')); return t.every((x) => h.includes(x)); }); }
  // one card per product, the products with the most (and surest) changes first
  const by = new Map();
  for (const c of list) { const k = c.site + ':' + c.pid; if (!by.has(k)) by.set(k, { site: c.site, pid: c.pid, name: c.name, img: c.img, url: c.url, sku: c.sku, changes: [] }); by.get(k).changes.push(c); }
  const order = { desc: 0, images: 1, name: 2, price: 3, published: 4, gla: 5, short: 6, brand: 7, cats: 8, gtin: 9 };
  const cards = [...by.values()];
  for (const cd of cards) cd.changes.sort((a, b) => order[a.field] - order[b.field]);
  cards.sort((a, b) => b.changes.filter((c) => c.level === 'high').length - a.changes.filter((c) => c.level === 'high').length || b.changes.length - a.changes.length);
  const per = Math.min(100, Number(q.per) || 30), page = Math.max(1, Number(q.page) || 1);
  return {
    at: compute().at, cacheAt: compute().cacheAt, counts, total: cards.length, cards: cards.slice((page - 1) * per, page * per), groups: GROUPS, fields: FIELD,
    quality: ['sf', 'st'].filter((x) => require('./catalog').load(x).syncedAt).map((x) => quality(x)),
    ai: !!(settings.all().localAI || {}).enabled,
  };
}

function decide(ids, status, by, edited) {
  if (!['approved', 'rejected', 'pending'].includes(status)) throw new Error('Λάθος κατάσταση.');
  const items = new Map(compute().items.map((c) => [c.id, c]));
  let n = 0;
  store.update(KEY, {}, (d) => {
    for (const id of [].concat(ids || [])) {
      const c = items.get(id);
      if (!c) continue;
      if (status === 'pending') { delete d[id]; n++; continue; }
      const prev = d[id] || {};
      d[id] = { status, hash: c.hash, at: U.nowIso(), by: by || '' };
      if (edited !== undefined && ids.length === 1) d[id].edited = editedValue(c, edited);
      else if (prev.edited !== undefined) d[id].edited = prev.edited;
      n++;
    }
    return d;
  });
  invalidate();
  return { count: n };
}
function editedValue(c, v) {
  if (c.field === 'name') { const t = U.capsTitle(String(v || '')); if (!t) throw new Error('Ο τίτλος δεν μπορεί να είναι κενός.'); return t; }
  if (c.field === 'desc') { const html = require('./extract').cleanHtml(String(v && v.html != null ? v.html : v || '')); if (stripText(html).length < 20) throw new Error('Πολύ μικρή περιγραφή.'); return { html, meta: c.to && c.to.meta ? metaOf(html) : '' }; }
  if (c.field === 'short') return require('./extract').cleanHtml(String(v || ''));
  throw new Error('Αυτή η αλλαγή δεν διορθώνεται με το χέρι εδώ.');
}
/** Approve every sure (high) change that waits, of a site / group. */
function approveSure(site, group, by) {
  const ids = compute().items.filter((c) => c.status === 'pending' && c.level === 'high' && (!site || c.site === site) && (!group || c.group === group) && c.exportable !== false).map((c) => c.id);
  return decide(ids, 'approved', by);
}

// ---------- the WooCommerce update file ----------
function exportFile(site, by) {
  const catalog = require('./catalog');
  const wx = require('./wooexport');
  const s = settings.all();
  const items = compute().items.filter((c) => c.site === site && c.status === 'approved' && c.exportable !== false);
  if (!items.length) throw new Error('Δεν υπάρχουν εγκεκριμένες διορθώσεις για το ' + s.sites[site].name + '.');
  const cat = catalog.load(site);
  const byId = new Map(cat.products.map((p) => [p.id, p]));
  const seo = wx.seoColumns(wx.seoMode(site));
  const rows = new Map();
  const extraRows = [];
  const cols = new Set();
  const row = (pid) => { if (!rows.has(pid)) rows.set(pid, { ID: pid }); return rows.get(pid); };
  const set = (r, k, v) => { r[k] = v; cols.add(k); };
  const brandAttr = catalog.detectAttribute(site, 'brand');
  for (const c of items) {
    const p = byId.get(c.pid);
    if (!p) continue;
    const r = row(c.pid);
    if (c.field === 'name') set(r, 'Name', c.to);
    else if (c.field === 'desc') { set(r, 'Description', c.to.html); if (seo && c.to.meta) set(r, seo.desc, c.to.meta); }
    else if (c.field === 'short') set(r, 'Short description', c.to);
    else if (c.field === 'images') set(r, 'Images', wx.imgs(c.to));
    else if (c.field === 'cats') { const idx = catalog.categoryIndex(site); set(r, 'Categories', wx.cats([idx.pathOf(c.to.id)])); }
    else if (c.field === 'published') set(r, 'Published', -1);
    else if (c.field === 'gla') set(r, wx.GLA, 'dont-sync-and-show');
    else if (c.field === 'gtin') set(r, 'GTIN, UPC, EAN, or ISBN', c.to);
    else if (c.field === 'brand') { wx.setAttrs(r, [{ name: brandAttr, values: [c.to], visible: true, global: true }]); for (const k of ['Attribute 1 name', 'Attribute 1 value(s)', 'Attribute 1 visible', 'Attribute 1 global']) cols.add(k); }
    else if (c.field === 'price') {
      if (p.type === 'variable') {
        // every size gets the price of the same size on the reference site
        const master = s.master === 'st' ? 'st' : 'sf';
        const src = catalog.load(master);
        const sv = src.products.filter((x) => x.type === 'variation' && x.parent === c.to.srcId);
        for (const v of cat.products.filter((x) => x.type === 'variation' && x.parent === p.id)) {
          const m = sv.find((x) => (x.sku && v.sku && U.normSku(x.sku) === U.normSku(v.sku)) || U.foldKey(x.varLabel) === U.foldKey(v.varLabel));
          if (m && m.regular > 0) extraRows.push({ ID: v.id, 'Regular price': m.regular.toFixed(2), 'Sale price': m.sale ? m.sale.toFixed(2) : '' });
        }
        cols.add('Regular price'); cols.add('Sale price');
      } else { set(r, 'Regular price', Number(c.to.regular).toFixed(2)); set(r, 'Sale price', c.to.sale ? Number(c.to.sale).toFixed(2) : ''); }
    }
  }
  const order = ['Name', 'Published', 'Short description', 'Description', 'Regular price', 'Sale price', 'Categories', 'Images', 'GTIN, UPC, EAN, or ISBN', 'Attribute 1 name', 'Attribute 1 value(s)', 'Attribute 1 visible', 'Attribute 1 global'];
  const columns = order.filter((k) => cols.has(k)).concat([...cols].filter((k) => !order.includes(k)));
  const all = [...rows.values()].filter((r) => Object.keys(r).length > 1).concat(extraRows);
  if (!all.length) throw new Error('Δεν βγήκε καμία γραμμή για το αρχείο.');
  const csv = wx.updateFile(all, columns);
  const at = U.nowIso();
  store.update(KEY, {}, (d) => { for (const c of items) d[c.id] = Object.assign({}, d[c.id] || { hash: c.hash }, { status: 'exported', at, by: by || '', exportedAt: at }); return d; });
  invalidate();
  return { csv, count: all.length, products: rows.size, changes: items.length, site, name: `diorthoseis-${site}.csv`, gtin: cols.has('GTIN, UPC, EAN, or ISBN') };
}

// ---------- finding the sources (background job: supplier price lists + supplier pages) ----------
/**
 * For every product that misses content: the same product in the suppliers' price lists (code / EAN / name),
 * then — when the list has no text or photos — the supplier's product page, read politely (one page every
 * 1.5 s per site, at most opts.maxPages per run, each page kept for 30 days).
 * A source counts only if its title really is our product (the same strict check as the price research).
 */
async function findSources(job, opts) {
  opts = opts || {};
  const catalog = require('./catalog');
  const suppliers = require('./suppliers');
  const pricelist = require('./pricelist');
  const extract = require('./extract');
  const market = require('./market');
  const s = settings.all();
  const ec = cache();
  const maxPages = Math.max(0, Number(opts.maxPages == null ? 120 : opts.maxPages));
  const sites = catalog.SITES.filter((x) => catalog.load(x).syncedAt);
  // 1. who needs what
  const needs = [];
  for (const site of sites) {
    for (const p of catalog.load(site).products) {
      if (p.type === 'variation' || p.status === 'draft' || p.status === 'private') continue;
      const n = contentNeeds(p, s);
      if (n.desc || n.short || n.images || n.brand) needs.push({ site, p, n });
    }
  }
  job && job.progress(0, needs.length, `${needs.length.toLocaleString('el-GR')} προϊόντα θέλουν περιεχόμενο — αντιστοίχιση με τους τιμοκαταλόγους…`);
  // 2. the suppliers' lists, matched to our products (code, EAN, name — the same matching as the price lists)
  const cand = new Map(); // site:id -> [{ sup, item, how, weak }]
  for (const sup of suppliers.list()) {
    if (job && job.cancelled()) return null;
    const items = pricelist.rawItems(sup.id);
    if (!items.length) continue;
    const byKey = new Map(items.map((i) => [i.key, i]));
    for (const site of sites) {
      const cmp = pricelist.compare(sup.id, site);
      if (!cmp) continue;
      for (const r of cmp.rows) {
        if (!r.match) continue;
        const k = site + ':' + (r.match.parent || r.match.id);
        if (!cand.has(k)) cand.set(k, []);
        cand.get(k).push({ sup, item: byKey.get(r.key), how: r.match.how, weak: !!r.match.weak });
      }
    }
  }
  // 3. the best source for each product, checked against our title
  let pages = 0, found = 0, done = 0, errors = 0;
  const now = Date.now();
  const gap = 1500;
  for (const { site, p, n } of needs) {
    if (job && job.cancelled()) break;
    done++;
    if (done % 50 === 0) job && job.progress(done, needs.length, `${found.toLocaleString('el-GR')} πηγές βρέθηκαν · ${pages} σελίδες αντιπροσώπων διαβάστηκαν`);
    const key = site + ':' + p.id;
    const list = (cand.get(key) || []).filter((x) => x.item).sort((a, b) => Number(a.weak) - Number(b.weak));
    let best = null;
    for (const c of list) {
      const it = c.item;
      const chk = market.score({ name: p.name, brand: p.brand, sku: p.sku, price: 0 }, { name: it.name + (it.brand && !U.foldKey(it.name).includes(U.foldKey(it.brand)) ? ' ' + it.brand : ''), sku: it.code, brand: it.brand, price: 0 });
      const strong = !c.weak && /EAN|κωδικ/i.test(c.how);
      if (chk.match === 'none' && !strong) continue; // the title is another product: never take its text
      best = { c, level: strong && chk.match !== 'none' ? 'high' : 'medium', chk };
      break;
    }
    if (!best) { if (ec.products[key] && ec.products[key].src && ec.products[key].src.kind === 'manual') continue; delete ec.products[key]; continue; }
    const it = best.c.item;
    const data = { name: it.name, brand: it.brand || '', ean: it.ean || '', code: it.code || '', descHtml: it.desc ? (/<[a-z]/i.test(it.desc) ? extract.cleanHtml(it.desc) : extract.textToHtml(it.desc)) : '', images: extract.cleanImages(it.images || [], it.url || 'https://x/'), features: [], specs: [] };
    let url = /^https?:\/\//i.test(it.url || '') ? it.url : '';
    // the page has more (full text, all photos, specs) when the list has little
    const wantPage = url && ((n.desc && stripText(data.descHtml).length < 200) || (n.images && data.images.length < 2) || (n.short && !data.features.length));
    if (wantPage) {
      let pg = ec.pages[url];
      if (!(pg && now - new Date(pg.at).getTime() < PAGE_DAYS * 864e5) && pages < maxPages) {
        pages++;
        try {
          const x = await extract.fromUrl(url, { gap });
          pg = { at: U.nowIso(), data: { name: x.name, brand: x.brand, ean: x.ean, code: x.code, descHtml: String(x.descHtml || '').slice(0, 20000), shortHtml: String(x.shortHtml || '').slice(0, 4000), features: (x.features || []).slice(0, 25), specs: (x.specs || []).slice(0, 20), images: (x.images || []).slice(0, 12) } };
        } catch (e) { errors++; pg = { at: U.nowIso(), error: e.message }; }
        ec.pages[url] = pg;
      }
      if (pg && pg.data) {
        // the page must show the same product (a B2B page may redirect to a login or a category)
        const pchk = market.score({ name: p.name, brand: p.brand, sku: p.sku, price: 0 }, { name: pg.data.name, sku: pg.data.code, brand: pg.data.brand, price: 0 });
        if (pchk.match !== 'none') {
          if (stripText(pg.data.descHtml).length > stripText(data.descHtml).length) data.descHtml = pg.data.descHtml;
          if ((pg.data.images || []).length > data.images.length) data.images = pg.data.images;
          data.features = pg.data.features || []; data.specs = pg.data.specs || [];
          data.brand = data.brand || pg.data.brand || ''; data.ean = data.ean || pg.data.ean || '';
          if (pchk.match === 'similar' && best.level === 'high' && !/EAN|κωδικ/i.test(best.c.how)) best.level = 'medium';
        } else url = '';
      }
    }
    if (!stripText(data.descHtml) && !data.images.length && !data.brand && !data.features.length) { delete ec.products[key]; continue; }
    const prev = ec.products[key];
    data.supplier = best.c.sup.name;
    ec.products[key] = { at: U.nowIso(), src: { kind: 'supplier', label: `${best.c.sup.name} · ${best.c.how}`, url: url || '', supplierId: best.c.sup.id, level: best.level }, data: Object.assign(data, prev && prev.data && prev.data.descHtmlEl && prev.data.descHtml === data.descHtml ? { descHtmlEl: prev.data.descHtmlEl } : {}) };
    found++;
  }
  // pages not needed any more are forgotten after 30 days
  for (const [u, pg] of Object.entries(ec.pages)) if (now - new Date(pg.at).getTime() > PAGE_DAYS * 864e5) delete ec.pages[u];
  // decisions about changes that no longer exist (fixed on the site, product gone) are forgotten after 2 weeks
  invalidate();
  const alive = new Set(compute().items.map((c) => c.id));
  store.update(KEY, {}, (d) => { for (const [id, x] of Object.entries(d)) if (!alive.has(id) && now - new Date(x.at).getTime() > 14 * 864e5) delete d[id]; return d; });
  ec.at = U.nowIso();
  store.write(CACHE, ec);
  invalidate();
  job && job.progress(needs.length, needs.length, `Έτοιμο: πηγές για ${found.toLocaleString('el-GR')} προϊόντα · ${pages} σελίδες αντιπροσώπων διαβάστηκαν`);
  return { needs: needs.length, found, pages, errors };
}

/** A page given by the user (manufacturer / supplier) as the source of one product. */
async function fromPage(site, id, url) {
  const catalog = require('./catalog');
  const extract = require('./extract');
  const market = require('./market');
  const p = catalog.load(site).products.find((x) => x.id === Number(id));
  if (!p) throw new Error('Δεν βρέθηκε το προϊόν.');
  const x = await extract.fromUrl(url);
  const chk = market.score({ name: p.name, brand: p.brand, sku: p.sku, price: 0 }, { name: x.name, sku: x.code, brand: x.brand, price: 0 });
  const ec = cache();
  ec.products[site + ':' + p.id] = { at: U.nowIso(), src: { kind: 'manual', label: 'Σελίδα που έδωσες · ' + U.hostOf(x.url || url), url: x.url || url, level: chk.match === 'none' ? 'medium' : 'high' }, data: { name: x.name, brand: x.brand, ean: x.ean, code: x.code, descHtml: String(x.descHtml || '').slice(0, 20000), shortHtml: x.shortHtml || '', features: (x.features || []).slice(0, 25), specs: (x.specs || []).slice(0, 20), images: (x.images || []).slice(0, 12) } };
  store.write(CACHE, ec);
  invalidate();
  return { ok: true, sameProduct: chk.match !== 'none', name: x.name };
}

/** Greek translation of the supplier's English text, with the free local AI (if it is on). */
async function translate(site, id) {
  const localai = require('./localai');
  const ec = cache();
  const e = ec.products[site + ':' + Number(id)];
  if (!e || !e.data || !e.data.descHtml) throw new Error('Δεν υπάρχει κείμενο αντιπροσώπου για μετάφραση.');
  e.data.descHtmlEl = await localai.translate(e.data.descHtml);
  store.write(CACHE, ec);
  invalidate();
  return { ok: true };
}

/** For the "Today" screen and the menu badge. */
function summary() {
  try {
    const items = compute().items;
    const pending = items.filter((c) => c.status === 'pending');
    return { pending: pending.length, sure: pending.filter((c) => c.level === 'high').length, approved: items.filter((c) => c.status === 'approved').length, exported: items.filter((c) => c.status === 'exported').length, products: new Set(pending.map((c) => c.site + ':' + c.pid)).size };
  } catch (e) { return { pending: 0, sure: 0, approved: 0, exported: 0, products: 0, error: e.message }; }
}

module.exports = { scrub, compute, view, decide, approveSure, exportFile, findSources, fromPage, translate, summary, quality, invalidate, validGtin, greekShare, contentNeeds, buildDesc, CACHE, GROUPS };
