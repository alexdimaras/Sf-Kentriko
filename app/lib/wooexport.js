'use strict';
// WooCommerce product CSV files (Products → Import). English column names are recognised by the
// importer in every admin language. Update files carry only ID + the changed columns.
const settings = require('./settings');
const store = require('./store');
const U = require('./util');

function seoMode(site) {
  const catalog = require('./catalog');
  const s = settings.all();
  const m = (s.seo || {})[site] || 'auto';
  if (m !== 'auto') return m;
  return (catalog.load(site).info || {}).seo || 'none';
}
function seoColumns(mode) {
  if (mode === 'yoast') return { desc: 'Meta: _yoast_wpseo_metadesc', kw: 'Meta: _yoast_wpseo_focuskw' };
  if (mode === 'rankmath') return { desc: 'Meta: rank_math_description', kw: 'Meta: rank_math_focus_keyword' };
  return null;
}
function usesBrandTaxonomy(site) {
  const catalog = require('./catalog');
  const prods = catalog.load(site).products.filter((p) => p.type !== 'variation');
  const n = prods.filter((p) => p.brandSource === 'brands').length;
  return n > 0 && n >= prods.length * 0.2;
}
// Google for WooCommerce: "do not sync to Merchant Center, still show in the shop".
const GLA = 'Meta: _wc_gla_visibility';
function publishedValue() { return settings.all().newProduct.status === 'publish' ? 1 : -1; }

function metaDescription(html, title) {
  const t = U.stripTags(html).replace(new RegExp('^' + escapeRe(title) + '\\s*', 'i'), '');
  if (t.length <= 155) return t;
  const cut = t.slice(0, 155);
  return cut.slice(0, cut.lastIndexOf(' ') > 100 ? cut.lastIndexOf(' ') : 155).replace(/[,;:.\s]+$/, '') + '…';
}
function escapeRe(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function cats(paths) { return paths.filter(Boolean).map((p) => p.map((x) => x.replace(/,/g, '\\,').replace(/>/g, '')).join(' > ')).join(', '); }
function imgs(list) { return (list || []).filter((u) => /^https?:\/\//i.test(u)).map((u) => u.replace(/,/g, '%2C')).join(', '); }

const BASE_COLS = ['ID', 'Type', 'SKU', 'Name', 'Published', 'Is featured?', 'Visibility in catalog', 'Short description', 'Description', 'Tax status', 'In stock?', 'Regular price', 'Sale price', 'Categories', 'Tags', 'Images', 'Parent',
  'Attribute 1 name', 'Attribute 1 value(s)', 'Attribute 1 visible', 'Attribute 1 global',
  'Attribute 2 name', 'Attribute 2 value(s)', 'Attribute 2 visible', 'Attribute 2 global',
  'Attribute 3 name', 'Attribute 3 value(s)', 'Attribute 3 visible', 'Attribute 3 global',
  'Attribute 4 name', 'Attribute 4 value(s)', 'Attribute 4 visible', 'Attribute 4 global'];

function finalize(rows, site, extra) {
  const cols = BASE_COLS.slice();
  const seo = seoColumns(seoMode(site));
  if (seo) cols.push(seo.desc, seo.kw);
  // Brands: the WooCommerce importer has no column for the brand taxonomy, so the brand goes in the
  // "Κατασκευαστής" attribute (what the shop already uses); Products → Bulk edit sets the brand term.
  for (const e of extra || []) if (!cols.includes(e)) cols.push(e);
  // drop attribute columns nobody uses
  const used = cols.filter((c) => !/^Attribute \d/.test(c) || rows.some((r) => r[c.replace(/ (value\(s\)|visible|global)$/, ' name')]));
  return { csv: U.toCSV(rows, used.map((c) => ({ key: c, label: c })), { sep: ',', bom: true }), seo };
}

function setAttrs(row, attrs) {
  attrs.slice(0, 4).forEach((a, i) => {
    const n = i + 1;
    row[`Attribute ${n} name`] = a.name;
    row[`Attribute ${n} value(s)`] = (a.values || []).map((v) => String(v).replace(/,/g, '\\,')).join(', ');
    row[`Attribute ${n} visible`] = a.visible === false ? 0 : 1;
    row[`Attribute ${n} global`] = a.global === false ? 0 : 1;
  });
}

// ---------- New products from drafts ----------
function draftRows(d, site) {
  const catalog = require('./catalog');
  const idx = catalog.categoryIndex(site);
  const seo = seoColumns(seoMode(site));
  const pub = publishedValue();
  const brandAttr = catalog.detectAttribute(site, 'brand');
  const sizeAttr = catalog.detectAttribute(site, 'size');
  const colorAttr = catalog.detectAttribute(site, 'color');
  const vars = (d.variations || []).filter((v) => v.size || v.color);
  const sizes = [...new Set(vars.map((v) => v.size).filter(Boolean))];
  const colors = [...new Set(vars.map((v) => v.color).filter(Boolean))];
  const variable = vars.length > 0;
  const sku = d.sku || '';
  const catIds = (d.cats && d.cats[site]) || [];
  const row = {
    Type: variable ? 'variable' : 'simple', SKU: sku, Name: d.title, Published: pub, 'Is featured?': 0, 'Visibility in catalog': 'visible',
    'Short description': d.short || '', Description: d.description || '', 'Tax status': 'taxable', 'In stock?': 1,
    'Regular price': variable ? '' : num(d.price), 'Sale price': variable ? '' : (d.sale > 0 && d.sale < d.price ? num(d.sale) : ''),
    Categories: catIds.length ? cats(catIds.map((id) => idx.pathOf(id))) : (d.newCategory ? d.newCategory : ''),
    Tags: (d.tags || []).join(', '), Images: imgs(d.images),
  };
  const attrs = [];
  const brand = (d.fields && d.fields.brand) || d.brand || '';
  if (brand) attrs.push({ name: brandAttr, values: [brand], visible: true, global: true });
  if (sizes.length) attrs.push({ name: sizeAttr, values: sizes, visible: true, global: true });
  if (colors.length) attrs.push({ name: colorAttr, values: colors, visible: true, global: true });
  setAttrs(row, attrs);
  if (seo) { row[seo.desc] = metaDescription(d.description, d.displayTitle || d.title); row[seo.kw] = (d.focus || '').toLowerCase(); }
  if (site === 'st' && d.ads === 'google') row[GLA] = 'dont-sync-and-show';
  const rows = [row];
  vars.forEach((v, i) => {
    const vr = {
      Type: 'variation', SKU: v.sku || (sku ? `${sku}-${U.normSku(v.size || v.color || String(i + 1))}` : ''), Name: d.title + ' - ' + [v.size, v.color].filter(Boolean).join(' '),
      Published: 1, 'Visibility in catalog': 'visible', 'Tax status': 'taxable', 'In stock?': 1, 'Regular price': num(v.price || d.price),
      'Sale price': d.sale > 0 && d.sale < (v.price || d.price) ? num(d.sale) : '', Parent: sku, Images: v.image ? imgs([v.image]) : '',
    };
    const va = [];
    if (sizes.length) va.push({ name: sizeAttr, values: [v.size || ''], visible: true, global: true });
    if (colors.length) va.push({ name: colorAttr, values: [v.color || ''], visible: true, global: true });
    setAttrs(vr, va); // the importer matches variation attributes to the parent by name
    rows.push(vr);
  });
  return rows;
}
function num(n) { n = Number(n); return n > 0 ? U.r2(n).toFixed(2) : ''; }

function newProducts(drafts, site) {
  const rows = [];
  for (const d of drafts) rows.push(...draftRows(d, site));
  return finalize(rows, site, rows.some((r) => r[GLA]) ? [GLA] : []);
}

// ---------- Copy products from one shop to the other ----------
function categoryMap(from, to) {
  const catalog = require('./catalog');
  const saved = store.read('catmap-' + from + '-' + to, {});
  const A = catalog.categoryIndex(from), B = catalog.categoryIndex(to);
  const byPath = new Map(B.cats.map((c) => [B.pathOf(c.id).map(U.foldKey).join('>'), c.id]));
  const byName = new Map();
  for (const c of B.cats) { const k = U.foldKey(c.name); byName.set(k, byName.has(k) ? null : c.id); }
  const map = {};
  for (const c of A.cats) {
    if (saved[c.id] !== undefined) { map[c.id] = { to: saved[c.id], how: 'manual' }; continue; }
    const p = A.pathOf(c.id).map(U.foldKey).join('>');
    if (byPath.has(p)) map[c.id] = { to: byPath.get(p), how: 'path' };
    else if (byName.get(U.foldKey(c.name))) map[c.id] = { to: byName.get(U.foldKey(c.name)), how: 'name' };
    else map[c.id] = { to: 0, how: 'none' };
  }
  return map;
}
function saveCategoryMap(from, to, pairs) {
  store.update('catmap-' + from + '-' + to, {}, (m) => { for (const [k, v] of Object.entries(pairs || {})) { if (v === null || v === '') delete m[k]; else m[k] = Number(v) || 0; } return m; });
}

function parseVarLabel(label) {
  const out = [];
  for (const part of String(label || '').split(/,\s*(?=[^,:]+:)/)) {
    const i = part.indexOf(':');
    if (i > 0) out.push({ name: part.slice(0, i).trim(), value: part.slice(i + 1).trim() });
  }
  return out;
}

function transfer(from, to, ids) {
  const catalog = require('./catalog');
  const src = catalog.load(from);
  const A = catalog.categoryIndex(from), B = catalog.categoryIndex(to);
  const cmap = categoryMap(from, to);
  const byId = new Map(src.products.map((p) => [p.id, p]));
  const pub = publishedValue();
  const seo = seoColumns(seoMode(to));
  const brandAttr = catalog.detectAttribute(to, 'brand');
  const L = catalog.links();
  const rows = [];
  const skipped = [];
  const newCats = new Set();
  for (const id of ids) {
    const p = byId.get(Number(id));
    if (!p || p.type === 'variation') continue;
    let ad = null;
    if (to === 'st') {
      ad = catalog.adStatus(from, p);
      if (ad.level === 'banned') { skipped.push({ id: p.id, name: p.name, why: 'Δεν επιτρέπεται στις διαφημίσεις: ' + ad.why }); continue; }
    }
    const already = from === 'sf' ? L.sfToSt.get(p.id) : L.stToSf.get(p.id);
    if (already) { skipped.push({ id: p.id, name: p.name, why: 'Υπάρχει ήδη στο άλλο site.' }); continue; }
    const vars = src.products.filter((v) => v.type === 'variation' && v.parent === p.id);
    const variable = p.type === 'variable' && vars.length > 0;
    if (p.type === 'variable' && !vars.length) { skipped.push({ id: p.id, name: p.name, why: 'Δεν διαβάστηκαν τα μεγέθη/χρώματα (παραλλαγές). Συγχρόνισε ξανά με ενεργές παραλλαγές.' }); continue; }
    if (!['simple', 'variable'].includes(p.type)) { skipped.push({ id: p.id, name: p.name, why: 'Τύπος προϊόντος «' + p.type + '» δεν μεταφέρεται αυτόματα.' }); continue; }
    const sku = p.sku || (variable ? 'SF-' + p.id : '');
    const catPaths = p.cats.map((cid) => {
      const m = cmap[cid];
      if (m && m.to) return B.pathOf(m.to);
      const path = A.pathOf(cid);
      if (path.length) newCats.add(path.join(' > '));
      return path;
    });
    const cleanName = U.greekUpper(U.fixMixedScript(p.name).text);
    const row = {
      Type: variable ? 'variable' : 'simple', SKU: sku, Name: cleanName, Published: pub, 'Is featured?': 0, 'Visibility in catalog': 'visible',
      'Short description': p.short, Description: p.desc, 'Tax status': 'taxable', 'In stock?': p.inStock ? 1 : 0,
      'Regular price': variable ? '' : num(p.regular), 'Sale price': variable ? '' : (p.sale ? num(p.sale) : ''),
      Categories: cats(catPaths), Tags: p.tags.join(', '), Images: imgs(p.images),
    };
    const attrs = p.attrs.map((a) => ({ name: a.name, values: a.terms, visible: true, global: !!a.taxonomy }));
    // the brand travels as the "Κατασκευαστής" attribute (the importer has no brands column)
    if (p.brand && !attrs.some((a) => /κατασκευαστ|brand|μάρκ|μαρκ/i.test(a.name))) attrs.unshift({ name: brandAttr, values: [p.brand], visible: true, global: true });
    setAttrs(row, attrs);
    if (seo) { row[seo.desc] = metaDescription(p.desc || p.short, p.name); row[seo.kw] = ''; }
    if (ad && ad.level === 'google') row[GLA] = 'dont-sync-and-show';
    rows.push(row);
    if (variable) {
      for (const v of vars) {
        const pairs = parseVarLabel(v.varLabel);
        const vr = { Type: 'variation', SKU: v.sku || '', Name: cleanName, Published: 1, 'Visibility in catalog': 'visible', 'Tax status': 'taxable', 'In stock?': v.inStock ? 1 : 0, 'Regular price': num(v.regular), 'Sale price': v.sale ? num(v.sale) : '', Parent: sku };
        const va = attrs.map((a) => {
          const pv = pairs.find((x) => U.foldKey(x.name) === U.foldKey(a.name));
          return { name: a.name, values: [pv ? pv.value : ''], visible: true, global: a.global };
        });
        setAttrs(vr, va);
        for (let i = 1; i <= 4; i++) if (vr[`Attribute ${i} value(s)`] === '') { vr[`Attribute ${i} name`] = ''; vr[`Attribute ${i} visible`] = ''; vr[`Attribute ${i} global`] = ''; }
        rows.push(vr);
      }
    }
  }
  const out = finalize(rows, to, rows.some((r) => r[GLA]) ? [GLA] : []);
  return { csv: out.csv, products: rows.filter((r) => r.Type !== 'variation').length, rows: rows.length, skipped, newCategories: [...newCats] };
}

// ---------- Update files ----------
function updateFile(rows, columns) {
  // rows: [{ID, ...}] — only the given columns are touched by the importer
  return U.toCSV(rows, ['ID'].concat(columns).map((c) => ({ key: c, label: c })), { sep: ',', bom: true });
}

module.exports = { newProducts, transfer, updateFile, categoryMap, saveCategoryMap, metaDescription, draftRows, seoMode, usesBrandTaxonomy };
