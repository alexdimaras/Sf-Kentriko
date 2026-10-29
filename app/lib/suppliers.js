'use strict';
// Representatives / suppliers: contact details, brands they bring, lead times, pricing terms, orders.
const store = require('./store');
const U = require('./util');

function list() { return store.read('suppliers', []); }
function get(id) { return list().find((s) => s.id === id) || null; }

const FIELDS = ['name', 'contact', 'phone', 'mobile', 'email', 'website', 'address', 'vat', 'leadDays', 'minOrder', 'freeShippingFrom', 'paymentTerms',
  'priceMode', 'markup', 'discount', 'orderDay', 'notes', 'active', 'brands', 'keywords', 'feedUrl', 'b2bUrl', 'code',
  'catalogMode', 'catalogKind', 'b2bUser', 'b2bPriceKind', 'b2bVatIncluded', 'autoRefresh', 'info'];

function clean(input, prev) {
  const s = Object.assign({}, prev || {}, {});
  for (const f of FIELDS) if (input[f] !== undefined) s[f] = input[f];
  s.name = U.collapse(s.name || '');
  if (!s.name) throw new Error('Το όνομα του αντιπροσώπου είναι υποχρεωτικό.');
  const listOf = (v) => [...new Set((Array.isArray(v) ? v : String(v || '').split(/[,\n;]/)).map((x) => U.collapse(x)).filter(Boolean))];
  s.brands = listOf(s.brands);
  s.keywords = listOf(s.keywords);
  s.leadDays = Math.max(0, Math.round(Number(s.leadDays) || 0));
  s.minOrder = U.r2(U.parseNumber(s.minOrder));
  s.freeShippingFrom = U.r2(U.parseNumber(s.freeShippingFrom));
  s.markup = U.r2(s.markup === '' || s.markup == null ? 80 : U.parseNumber(s.markup));
  s.discount = U.r2(U.parseNumber(s.discount));
  s.priceMode = s.priceMode === 'cost' ? 'cost' : 'retail';
  s.active = s.active !== false && s.active !== 'false';
  s.email = String(s.email || '').trim();
  s.website = String(s.website || '').trim();
  s.code = String(s.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
  if (!['none', 'public', 'b2b'].includes(s.catalogMode)) s.catalogMode = 'none';
  s.b2bPriceKind = s.b2bPriceKind === 'retail' ? 'retail' : 'cost';
  s.b2bVatIncluded = s.b2bVatIncluded === true || s.b2bVatIncluded === 'true';
  s.autoRefresh = s.autoRefresh !== false && s.autoRefresh !== 'false';
  s.b2bUser = String(s.b2bUser || '').trim();
  // the B2B password is kept protected, never as plain text, and never sent back to the screen
  if (typeof input.b2bPassword === 'string' && input.b2bPassword) s.b2bPass = require('./secrets').protect(input.b2bPassword);
  if (input.clearB2bPassword) delete s.b2bPass;
  delete s.b2bPassword;
  return s;
}
/** What the screen may see (no password). */
function view(s) { if (!s) return s; const o = Object.assign({}, s); o.b2bPassSet = !!o.b2bPass; delete o.b2bPass; return o; }

function save(input) {
  const all = list();
  let s;
  if (input.id) {
    const i = all.findIndex((x) => x.id === input.id);
    if (i < 0) throw new Error('Δεν βρέθηκε ο αντιπρόσωπος.');
    s = clean(input, all[i]);
    s.updatedAt = U.nowIso();
    all[i] = s;
  } else {
    s = clean(input, { id: U.uid('s'), createdAt: U.nowIso() });
    all.push(s);
  }
  const clash = brandClashes(all);
  store.write('suppliers', all);
  index = null;
  return { supplier: view(s), clashes: clash.filter((c) => c.ids.includes(s.id)) };
}

function remove(id) {
  store.write('suppliers', list().filter((s) => s.id !== id));
  index = null;
}

function brandClashes(all) {
  const m = new Map();
  for (const s of all) for (const b of s.brands || []) {
    const k = U.foldKey(b);
    if (!m.has(k)) m.set(k, { brand: b, ids: [] });
    m.get(k).ids.push(s.id);
  }
  return [...m.values()].filter((x) => x.ids.length > 1);
}

let index = null;
function buildIndex() {
  const byBrand = new Map();
  const kw = [];
  for (const s of list()) {
    if (s.active === false) continue;
    for (const b of s.brands || []) if (!byBrand.has(U.foldKey(b))) byBrand.set(U.foldKey(b), s);
    for (const k of s.keywords || []) kw.push([U.foldKey(k), s]);
  }
  index = { byBrand, kw };
  return index;
}
function forProduct(p) {
  const ix = index || buildIndex();
  if (p.brand && ix.byBrand.has(U.foldKey(p.brand))) return ix.byBrand.get(U.foldKey(p.brand));
  if (ix.kw.length) {
    const t = ' ' + U.foldKey(p.name + ' ' + (p.sku || '')) + ' ';
    for (const [k, s] of ix.kw) if (t.includes(' ' + k + ' ') || (k.length >= 4 && t.includes(k))) return s;
  }
  return null;
}
function matches(s, p) { const f = forProduct(p); return !!f && f.id === s.id; }
function resetIndex() { index = null; }

// ---------- Orders to suppliers (simple log, not stock management) ----------
function orders() { return store.read('orders', []); }
function saveOrder(input) {
  const all = orders();
  const sup = get(input.supplierId);
  if (!sup) throw new Error('Διάλεξε αντιπρόσωπο.');
  const items = (input.items || []).map((i) => ({
    site: i.site || 'sf', id: Number(i.id) || 0, name: U.collapse(i.name || ''), sku: String(i.sku || ''), qty: Math.max(1, Math.round(Number(i.qty) || 1)), note: U.collapse(i.note || ''),
  })).filter((i) => i.name);
  let o;
  if (input.id) {
    o = all.find((x) => x.id === input.id);
    if (!o) throw new Error('Δεν βρέθηκε η παραγγελία.');
    Object.assign(o, { items, note: input.note || '', customer: input.customer || '' });
  } else {
    o = { id: U.uid('o'), supplierId: sup.id, createdAt: U.nowIso(), status: 'draft', items, note: input.note || '', customer: input.customer || '' };
    all.unshift(o);
  }
  if (input.status && input.status !== o.status) setStatusOn(o, input.status, sup);
  store.write('orders', all.slice(0, 1000));
  return o;
}
function setStatusOn(o, status, sup) {
  o.status = status;
  if (status === 'sent') {
    o.sentAt = U.nowIso();
    const d = new Date(); d.setDate(d.getDate() + (sup ? sup.leadDays || 0 : 0));
    o.expectedAt = sup && sup.leadDays ? d.toISOString().slice(0, 10) : '';
  }
  if (status === 'received') o.receivedAt = U.nowIso();
}
function setOrderStatus(id, status) {
  const all = orders();
  const o = all.find((x) => x.id === id);
  if (!o) throw new Error('Δεν βρέθηκε η παραγγελία.');
  if (!['draft', 'sent', 'received', 'cancelled'].includes(status)) throw new Error('Λάθος κατάσταση.');
  setStatusOn(o, status, get(o.supplierId));
  store.write('orders', all);
  return o;
}
function removeOrder(id) { store.write('orders', orders().filter((o) => o.id !== id)); }

function orderEmail(o) {
  const sup = get(o.supplierId) || { name: '' };
  const lines = o.items.map((i) => `• ${i.qty} τεμ. — ${i.name}${i.sku ? ' (κωδ. ' + i.sku + ')' : ''}${i.note ? ' — ' + i.note : ''}`);
  const hello = sup.contact ? `Καλημέρα κ. ${sup.contact},` : 'Καλημέρα σας,';
  const body = [hello, '', 'θα θέλαμε να παραγγείλουμε τα παρακάτω:', '', ...lines, '',
    o.note ? o.note + '\n' : '', 'Παρακαλούμε επιβεβαιώστε διαθεσιμότητα και ημερομηνία αποστολής.', '', 'Ευχαριστούμε,', 'SpecialForces — Πειραιάς'].filter((x, i, a) => !(x === '' && a[i - 1] === '')).join('\n');
  const subject = `Παραγγελία SpecialForces — ${new Date().toLocaleDateString('el-GR')}`;
  return { to: sup.email || '', subject, body, mailto: `mailto:${encodeURIComponent(sup.email || '')}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}` };
}

module.exports = { view, list, get, save, remove, forProduct, matches, resetIndex, brandClashes, orders, saveOrder, setOrderStatus, removeOrder, orderEmail };
