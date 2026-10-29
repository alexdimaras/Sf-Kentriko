'use strict';
// Read a supplier / manufacturer product page and pull out what a listing needs:
// name, brand, code, EAN, price, official description (HTML), features, specs, images, variants.
const { parse } = require('node-html-parser');
const http = require('./http');
const U = require('./util');

const DESC_SELECTORS = [
  '#tab-description', '.woocommerce-Tabs-panel--description', '.woocommerce-product-details__description',
  '.product__description', '.product-single__description', '.product-description', '#product-description',
  '.product.attribute.description .value', '#description', '[itemprop=description]', '.description', '.product-details', '.rte',
];
const SHORT_SELECTORS = ['.woocommerce-product-details__short-description', '.product-short-description', '.short-description', '.product-summary'];
const ALLOWED = new Set(['p', 'br', 'ul', 'ol', 'li', 'strong', 'b', 'em', 'i', 'h2', 'h3', 'h4', 'h5', 'table', 'thead', 'tbody', 'tr', 'td', 'th', 'dl', 'dt', 'dd', 'blockquote', 'sup', 'sub']);

function emptyProduct() {
  return { url: '', host: '', platform: '', name: '', brand: '', code: '', ean: '', price: 0, currency: '', descHtml: '', descText: '', shortHtml: '', features: [], specs: [], images: [], variants: [], category: '', notes: [] };
}

async function fromUrl(url) {
  url = String(url || '').trim();
  if (!/^https?:\/\//i.test(url)) throw new Error('Δώσε πλήρη διεύθυνση (https://…).');
  const r = await http.get(url, { timeout: 30000, retries: 1 });
  let html = r.text;
  const cs = (html.slice(0, 3000).match(/<meta[^>]+charset=["']?([a-z0-9_-]+)/i) || [])[1];
  if (cs && !/utf-?8/i.test(cs)) {
    try { html = new TextDecoder(cs.toLowerCase()).decode(r.buf); } catch (_) { /* keep utf8 */ }
  }
  const out = fromHtml(html, r.url || url);
  // Platform APIs give cleaner data than the HTML.
  try {
    if (out.platform === 'shopify') await enrichShopify(out, r.url || url);
    else if (out.platform === 'woocommerce') await enrichWoo(out, r.url || url);
  } catch (e) { out.notes.push('Δεν διαβάστηκαν τα επιπλέον δεδομένα του καταστήματος: ' + e.message); }
  finish(out);
  if (!out.name && !out.descText) throw new Error('Η σελίδα δεν έδωσε στοιχεία προϊόντος (ίσως φορτώνει με JavaScript). Συμπλήρωσε τα πεδία με το χέρι.');
  return out;
}

function fromHtml(html, url) {
  const out = emptyProduct();
  out.url = url; out.host = U.hostOf(url);
  if (/cdn\.shopify\.com|Shopify\.theme|shopify-section/i.test(html)) out.platform = 'shopify';
  else if (/woocommerce|wp-content\/plugins\/woocommerce/i.test(html)) out.platform = 'woocommerce';
  else if (/prestashop/i.test(html)) out.platform = 'prestashop';
  else if (/Magento|mage\//.test(html)) out.platform = 'magento';
  else if (/catalog\/view\/theme|route=product/i.test(html)) out.platform = 'opencart';
  const root = parse(html, { comment: false, blockTextElements: { script: true, style: true, noscript: false, pre: true } });
  const meta = {};
  for (const m of root.querySelectorAll('meta')) {
    const k = (m.getAttribute('property') || m.getAttribute('name') || m.getAttribute('itemprop') || '').toLowerCase();
    const v = m.getAttribute('content');
    if (k && v && !(k in meta)) meta[k] = U.decodeEntities(v).trim();
  }
  // JSON-LD
  const blocks = root.querySelectorAll('script[type="application/ld+json"]').map((s) => s.rawText);
  const ld = productFromJsonLd(blocks);
  Object.assign(out, pick(ld, ['name', 'brand', 'code', 'ean', 'price', 'currency', 'category']));
  out.variants.push(...ld.variants);
  const imgs = [];
  if (meta['og:image']) imgs.push(meta['og:image']);
  imgs.push(...ld.images);
  // Woo variations JSON
  for (const f of root.querySelectorAll('form[data-product_variations]')) mergeWooVariations(out, f.getAttribute('data-product_variations'), imgs);
  // Product gallery images
  const gallery = root.querySelectorAll('.woocommerce-product-gallery img, .product-gallery img, .product__media img, .product-images img, #product-images img, .product-image img, [data-zoom-image], [data-large_image]');
  for (const img of gallery.length ? gallery : root.querySelectorAll('img')) {
    for (const a of ['data-zoom-image', 'data-large_image', 'data-large', 'data-full', 'data-original', 'data-src', 'data-lazy-src', 'src']) {
      const v = img.getAttribute(a);
      if (v && !v.startsWith('data:')) { imgs.push(v); break; }
    }
    const ss = img.getAttribute('srcset') || img.getAttribute('data-srcset');
    if (ss) { const b = largestFromSrcset(ss); if (b) imgs.push(b); }
  }
  for (const a of root.querySelectorAll('a[href]')) {
    const h = a.getAttribute('href');
    if (/\.(jpe?g|png|webp)(\?|$)/i.test(h) && a.closest('.woocommerce-product-gallery, .product-gallery, .product__media, .product-images, #product-images, .images, .product-image')) imgs.push(h);
  }
  out.images = cleanImages(imgs, url);

  if (!out.name) out.name = U.collapse(meta['og:title'] || (root.querySelector('h1') || {}).text || (root.querySelector('title') || {}).text || '');
  if (!out.price) out.price = U.parseNumber(meta['product:price:amount'] || meta['og:price:amount'] || meta.price || '');
  if (!out.currency) out.currency = meta['product:price:currency'] || meta.pricecurrency || '';
  if (!out.brand) out.brand = meta['product:brand'] || meta.brand || '';
  if (!out.code) out.code = meta['product:retailer_item_id'] || meta.sku || meta.mpn || '';

  // Official description
  for (const sel of DESC_SELECTORS) {
    const el = root.querySelector(sel);
    if (!el) continue;
    const h = cleanHtml(el.innerHTML);
    if (U.stripTags(h).length >= 40) { out.descHtml = h; break; }
  }
  for (const sel of SHORT_SELECTORS) {
    const el = root.querySelector(sel);
    if (el) { const h = cleanHtml(el.innerHTML); if (U.stripTags(h).length >= 15) { out.shortHtml = h; break; } }
  }
  if (!out.descHtml && ld.description) out.descHtml = textToHtml(ld.description);
  if (!out.descHtml && (meta['og:description'] || meta.description)) out.descHtml = textToHtml(meta['og:description'] || meta.description);

  // Specs: Woo "additional information" table or any th/td table near the product, dt/dd lists
  for (const row of root.querySelectorAll('.woocommerce-product-attributes tr, .product-attributes tr, .data-table tr, table.specs tr, .product-specs tr')) {
    const k = row.querySelector('th, td:first-child'); const v = row.querySelector('td:last-child');
    if (k && v && k !== v) addSpec(out, k.text, v.text);
  }
  out.breadcrumbs = root.querySelectorAll('.woocommerce-breadcrumb a, .breadcrumb a, .breadcrumbs a, nav[aria-label*="read"] a').map((a) => U.collapse(a.text)).filter(Boolean).slice(1);
  return out;
}

function addSpec(out, k, v) {
  k = U.collapse(U.decodeEntities(k)).replace(/:$/, ''); v = U.collapse(U.decodeEntities(v));
  if (!k || !v || k.length > 60 || v.length > 300) return;
  if (out.specs.some((s) => s.k === k)) return;
  out.specs.push({ k, v });
}

async function enrichShopify(out, url) {
  const u = new URL(url);
  const m = u.pathname.match(/\/products\/([^/?#]+)/);
  if (!m) return;
  const r = await http.getJson(`${u.origin}/products/${m[1]}.js`, { retries: 0, timeout: 15000 });
  const p = r.json || {};
  if (p.title) out.name = p.title;
  if (p.vendor) out.brand = p.vendor;
  if (p.description) out.descHtml = cleanHtml(p.description);
  if (p.type) out.category = p.type;
  const imgs = (p.images || []).map((x) => (String(x).startsWith('//') ? 'https:' + x : x));
  if (imgs.length) out.images = cleanImages(imgs.concat(out.images), url);
  const opts = p.options || [];
  out.variants = (p.variants || []).map((v) => {
    const attrs = {};
    opts.forEach((o, i) => { const name = typeof o === 'string' ? o : o.name; const val = v['option' + (i + 1)]; if (name && val && !/^title$/i.test(name)) attrs[name] = val; });
    return { name: v.title, sku: v.sku || '', ean: v.barcode || '', attrs, price: (Number(v.price) || 0) / 100, inStock: !!v.available };
  }).filter((v) => Object.keys(v.attrs).length);
  if (p.price) out.price = Number(p.price) / 100;
  if (!out.code && p.variants && p.variants[0] && p.variants[0].sku) out.code = String(p.variants[0].sku).replace(/[-_ ]?(XS|S|M|L|XL|XXL|\d?XL|\d{2})$/i, '');
}

async function enrichWoo(out, url) {
  const u = new URL(url);
  const slug = decodeURIComponent(u.pathname.split('/').filter(Boolean).pop() || '');
  if (!slug) return;
  const r = await http.getJson(`${u.origin}/wp-json/wc/store/v1/products?slug=${encodeURIComponent(slug)}`, { retries: 0, timeout: 15000 });
  const p = Array.isArray(r.json) ? r.json[0] : null;
  if (!p) return;
  out.name = U.decodeEntities(p.name) || out.name;
  if (p.sku && !out.code) out.code = p.sku;
  if (p.description && U.stripTags(p.description).length >= 40) out.descHtml = cleanHtml(p.description);
  if (p.short_description && U.stripTags(p.short_description).length >= 15) out.shortHtml = cleanHtml(p.short_description);
  const unit = Number((p.prices || {}).currency_minor_unit == null ? 2 : p.prices.currency_minor_unit);
  if (p.prices && p.prices.price) out.price = Number(p.prices.price) / Math.pow(10, unit);
  if (p.prices && p.prices.currency_code) out.currency = p.prices.currency_code;
  const imgs = (p.images || []).map((i) => i.src);
  if (imgs.length) out.images = cleanImages(imgs.concat(out.images), url);
  for (const a of p.attributes || []) {
    const name = U.decodeEntities(a.name);
    if (/κατασκευαστ|brand|μάρκ|μαρκ/i.test(name) && a.terms && a.terms[0]) out.brand = out.brand || U.decodeEntities(a.terms[0].name);
    else if (!a.has_variations && a.terms && a.terms.length) addSpec(out, name, a.terms.map((t) => U.decodeEntities(t.name)).join(', '));
  }
  if (p.brands && p.brands[0] && !out.brand) out.brand = U.decodeEntities(p.brands[0].name);
  if (p.categories && p.categories.length) out.category = U.decodeEntities(p.categories[p.categories.length - 1].name);
  if (p.type === 'variable' && (!out.variants.length || out.variants.every((v) => !v.price))) {
    const vr = await http.getJson(`${u.origin}/wp-json/wc/store/v1/products?type=variation&parent=${p.id}&per_page=100`, { retries: 0, timeout: 15000 }).catch(() => null);
    if (vr && Array.isArray(vr.json) && vr.json.length) {
      out.variants = vr.json.map((v) => ({
        name: U.decodeEntities(v.variation || ''), sku: v.sku || '', ean: '',
        attrs: parseVarLabel(U.decodeEntities(v.variation || '')),
        price: v.prices ? Number(v.prices.price) / Math.pow(10, unit) : 0, inStock: v.is_in_stock !== false,
      }));
    }
  }
}

function parseVarLabel(s) {
  const attrs = {};
  for (const part of String(s || '').split(/,\s*(?=[^,:]+:)/)) {
    const i = part.indexOf(':');
    if (i > 0) attrs[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return attrs;
}

function finish(out) {
  out.name = U.collapse(U.decodeEntities(out.name)).replace(/\s*[|–-]\s*[^|–-]{2,40}$/, (m) => (out.host && m.toLowerCase().includes(out.host.split('.')[0]) ? '' : m));
  out.brand = U.collapse(U.decodeEntities(out.brand));
  out.descText = U.stripTags(out.descHtml);
  // Features = bullet points of the official description
  const lis = (out.descHtml.match(/<li>([\s\S]*?)<\/li>/g) || []).map((x) => U.stripTags(x)).filter((x) => x.length > 2 && x.length < 220);
  out.features = [...new Set(lis)].slice(0, 25);
  // Variants: normalize attrs into size/colour
  out.variants = out.variants.map((v) => {
    const attrs = v.attrs || {};
    let size = v.size || '', color = v.color || '';
    for (const [k, val] of Object.entries(attrs)) {
      if (!size && /size|μέγεθ|μεγεθ|νούμερ|νουμερ/i.test(k)) size = val;
      else if (!color && /colou?r|χρώμ|χρωμ/i.test(k)) color = val;
    }
    return { name: v.name || '', sku: v.sku || '', ean: v.ean || '', size: String(size || '').trim(), color: String(color || '').trim(), price: Number(v.price) || 0, inStock: v.inStock !== false };
  }).filter((v) => v.size || v.color).slice(0, 120);
  if (out.currency && out.currency !== 'EUR') out.notes.push('Η τιμή της σελίδας είναι σε ' + out.currency + ', όχι σε ευρώ.');
}

function productFromJsonLd(blocks) {
  const prod = { name: '', brand: '', code: '', ean: '', price: 0, currency: '', description: '', images: [], variants: [], category: '' };
  const nodes = [];
  for (let b of blocks) {
    b = String(b || '').trim();
    let data = null;
    try { data = JSON.parse(b); } catch (_) { try { data = JSON.parse(b.replace(/,\s*([\]}])/g, '$1')); } catch (e) { data = null; } }
    if (data) collect(data, nodes, 0);
  }
  if (!nodes.length) return prod;
  const main = nodes.find((n) => isType(n, 'ProductGroup')) || nodes[0];
  prod.name = str(main.name);
  prod.code = str(main.mpn || main.sku || main.productGroupID || '');
  prod.ean = gtin(main);
  prod.brand = str(main.brand && typeof main.brand === 'object' ? main.brand.name : main.brand);
  prod.description = str(typeof main.description === 'string' ? main.description : '');
  prod.category = str(main.category);
  prod.images = imagesFrom(main.image);
  [prod.price, prod.currency] = offerPrice(main.offers);
  const vars = Array.isArray(main.hasVariant) ? main.hasVariant : nodes.length > 1 ? nodes.slice(1) : [];
  for (const v of vars.slice(0, 120)) {
    if (!v || typeof v !== 'object') continue;
    const [vp] = offerPrice(v.offers);
    const attrs = {};
    if (v.size) attrs.size = str(typeof v.size === 'object' ? v.size.name : v.size);
    if (v.color) attrs.color = str(v.color);
    prod.variants.push({ name: str(v.name), sku: str(v.sku), ean: gtin(v), attrs, price: vp });
    if (!prod.price && vp) prod.price = vp;
    prod.images.push(...imagesFrom(v.image));
  }
  prod.images = [...new Set(prod.images)];
  return prod;
}
function collect(d, out, depth) {
  if (depth > 6 || !d || typeof d !== 'object') return;
  if (isType(d, 'Product') || isType(d, 'ProductGroup')) { out.push(d); return; }
  for (const v of Array.isArray(d) ? d : Object.values(d)) if (v && typeof v === 'object') collect(v, out, depth + 1);
}
function isType(n, t) { const x = n && n['@type']; return Array.isArray(x) ? x.includes(t) : x === t; }
function str(v) { if (Array.isArray(v)) v = v[0]; return v == null || typeof v === 'object' ? '' : U.collapse(U.decodeEntities(String(v))); }
function gtin(n) {
  for (const k of ['gtin13', 'gtin', 'gtin12', 'gtin14', 'gtin8', 'ean']) {
    if (n && n[k]) { const g = str(n[k]).replace(/\D/g, ''); if (g.length >= 8) return g; }
  }
  return '';
}
function imagesFrom(img) {
  const out = [];
  for (const i of Array.isArray(img) ? img : img ? [img] : []) {
    if (typeof i === 'string') out.push(i);
    else if (i && typeof i === 'object') { if (typeof i.url === 'string') out.push(i.url); else if (typeof i.contentUrl === 'string') out.push(i.contentUrl); }
  }
  return out;
}
function offerPrice(offers) {
  if (!offers || typeof offers !== 'object') return [0, ''];
  const list = Array.isArray(offers) ? offers : (offers.offers && Array.isArray(offers.offers) ? offers.offers.concat([offers]) : [offers]);
  let best = 0, cur = '';
  for (const o of list) {
    if (!o || typeof o !== 'object') continue;
    let p = 0;
    if (o.price != null) p = U.parseNumber(o.price);
    else if (o.lowPrice != null) p = U.parseNumber(o.lowPrice);
    else if (o.priceSpecification && o.priceSpecification.price != null) p = U.parseNumber(o.priceSpecification.price);
    if (p > 0 && (!best || p < best)) { best = p; cur = str(o.priceCurrency); }
  }
  return [best, cur];
}
function mergeWooVariations(out, json, imgs) {
  let vars;
  try { vars = JSON.parse(U.decodeEntities(json)); } catch (_) { return; }
  if (!Array.isArray(vars)) return;
  for (const v of vars.slice(0, 120)) {
    const attrs = {};
    for (const [k, val] of Object.entries(v.attributes || {})) {
      let dv = val; try { dv = decodeURIComponent(val); } catch (_) { /* keep */ }
      attrs[k.replace(/^attribute_(pa_)?/, '')] = dv;
    }
    out.variants.push({ name: Object.values(attrs).join(' / '), sku: v.sku || '', ean: '', attrs, price: Number(v.display_price) || 0, inStock: !!v.is_in_stock });
    if (v.image && v.image.full_src) imgs.push(v.image.full_src);
    if (!out.price && v.display_price) out.price = Number(v.display_price);
  }
}
function largestFromSrcset(ss) {
  let best = '', bw = 0;
  for (const part of ss.split(',')) {
    const bits = part.trim().split(/\s+/);
    if (!bits[0]) continue;
    const w = parseInt(bits[1], 10) || 1;
    if (w >= bw) { bw = w; best = bits[0]; }
  }
  return best;
}
function cleanImages(imgs, base) {
  const out = [], seen = new Set();
  for (let u of imgs) {
    u = U.decodeEntities(String(u || '')).trim();
    if (!u || /^(data|blob):/.test(u)) continue;
    if (u.startsWith('//')) u = 'https:' + u;
    else if (!/^https?:\/\//i.test(u)) { try { u = new URL(u, base).href; } catch (_) { continue; } }
    let path = '';
    try { path = new URL(u).pathname; } catch (_) { continue; }
    if (/\.(svg|ico|gif)$/i.test(path)) continue;
    const bn = path.split('/').pop();
    if (/(logo|icon|sprite|placeholder|loader|loading|spinner|banner|flag|payment|visa|mastercard|paypal|avatar|badge|rating|stars?[-_.]|social|facebook|instagram|youtube|tiktok|whatsapp|cart|arrow|pixel|blank\.)/i.test(bn)) continue;
    u = u.replace(/-\d{2,4}x\d{2,4}(\.(jpe?g|png|webp))(\?.*)?$/i, '$1$3');
    u = u.replace(/_(pico|icon|thumb|small|compact|medium|large|grande|\d+x\d*|x\d+)(@2x)?(\.(jpe?g|png|webp))/i, '$3');
    const key = u.replace(/\?.*$/, '').toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key); out.push(u);
    if (out.length >= 20) break;
  }
  return out;
}

/** Keep the text structure, drop everything else (classes, styles, scripts, images, links). */
function cleanHtml(html) {
  const root = parse('<div>' + String(html || '') + '</div>', { comment: false });
  const walk = (node) => {
    let s = '';
    for (const c of node.childNodes) {
      if (c.nodeType === 3) { s += U.escapeHtml(U.decodeEntities(c.rawText)); continue; }
      if (c.nodeType !== 1) continue;
      let tag = c.rawTagName ? c.rawTagName.toLowerCase() : '';
      if (['script', 'style', 'noscript', 'iframe', 'svg', 'form', 'button', 'select', 'input', 'img', 'video', 'picture', 'figure'].includes(tag)) continue;
      if (tag === 'h1') tag = 'h3';
      if (tag === 'h6') tag = 'h5';
      const inner = walk(c);
      if (tag === 'br') { s += '<br>'; continue; }
      if (ALLOWED.has(tag)) {
        if (!U.collapse(inner.replace(/<br>/g, '')) && tag !== 'td' && tag !== 'th') continue;
        s += `<${tag}>${inner.trim()}</${tag}>`;
      } else if (['div', 'section', 'article'].includes(tag)) {
        s += /<(p|ul|ol|table|h\d|div)/.test(inner) ? inner : (U.collapse(inner) ? `<p>${inner.trim()}</p>` : '');
      } else s += inner;
    }
    return s;
  };
  let out = walk(root.firstChild || root);
  out = out.replace(/^\s*<h\d>\s*(Περιγραφή|Description|Product description|Περιγραφή προϊόντος)\s*<\/h\d>/i, '');
  out = out.replace(/(<br>\s*){3,}/g, '<br><br>').replace(/\s{2,}/g, ' ').replace(/>\s+</g, '><').trim();
  return out;
}
function textToHtml(t) {
  return String(t || '').split(/\n{2,}|\r\n\r\n/).map((p) => U.collapse(p)).filter(Boolean).map((p) => `<p>${U.escapeHtml(p)}</p>`).join('');
}
function pick(o, keys) { const r = {}; for (const k of keys) if (o[k]) r[k] = o[k]; return r; }

module.exports = { fromUrl, fromHtml, cleanHtml, cleanImages, textToHtml, parseVarLabel };
