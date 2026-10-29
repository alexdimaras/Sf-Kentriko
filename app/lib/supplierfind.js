'use strict';
// Automatic search for suppliers (Greek importers / distributors / wholesalers), for approval.
// Two kinds of brands are searched:
//   1. brands we sell that have no supplier in the program ("χωρίς αντιπρόσωπο")
//   2. brands that competitors sell and we don't ("ευκαιρία")
// For each brand: a few web searches, the results are scored (distributor words, Greek site, brand mentioned,
// repeated in several searches), the best sites are opened and checked (does their catalog have the brand,
// contact details, B2B). Nothing is created without approval: approve → new supplier (opens for editing),
// reject → that site is never suggested again for that brand.
const http = require('./http');
const U = require('./util');
const store = require('./store');

const KEY = 'supplier-candidates';
const OWN = /(^|\.)(specialforces|stratiotikaeidi)\.gr$/i;
// marketplaces, social, search engines, directories, news, big chains: never a supplier
const NEVER = /(^|\.)(skroutz|bestprice|amazon|ebay|aliexpress|alibaba|temu|shein|wish|etsy|facebook|instagram|youtube|youtu|linkedin|wikipedia|wikiwand|pinterest|tiktok|twitter|x|threads|reddit|quora|google|bing|duckduckgo|yahoo|yandex|baidu|xo|vrisko|11888|europages|kompass|dnb|opencorporates|trustpilot|tripadvisor|glami|shopflix|public|plaisio|kotsovolos|e-shop|insomnia|carousell|car|spitogatos|vendora|gumtree|olx|allegro|idealo|pricerunner|kelkoo|ceneo|heureka|zbozi|compari|gunbroker|armslist|reddit|imdb|fandom|scribd|issuu|slideshare|medium|blogspot|wordpress|wix|weebly)\.[a-z.]+$/i;
const DIST = /ΑΝΤΙΠΡΟΣΩΠ|ΕΙΣΑΓΩΓ|ΔΙΑΝΟΜ|ΧΟΝΔΡ|ΑΠΟΚΛΕΙΣΤΙΚ|ΕΠΙΣΗΜΟΣ ΑΝΤΙΠΡ|DISTRIBUT|IMPORTER|IMPORT |WHOLESAL|DEALER|RESELLER|OFFICIAL|EXCLUSIVE|B2B|ΕΜΠΟΡΙΑ/;
const SHOPISH = /ΚΑΛΑΘΙ|ΑΓΟΡΑ ΤΩΡΑ|ΠΡΟΣΘΗΚΗ|ADD TO CART|BUY NOW|ΤΙΜΗ:|€/;

function data() {
  const d = store.read(KEY, null) || { brands: {}, rejected: {}, never: [], lastRun: null, blocked: null };
  d.brands = d.brands || {}; d.rejected = d.rejected || {}; d.never = d.never || [];
  return d;
}
function save(d) { store.write(KEY, d); }

const JUNK_BRAND = /^(NO ?BRAND|GENERIC|UNBRANDED|OEM|VARIOUS|ΔΙΑΦΟΡΑ|ΑΛΛΟ|OTHER|N\/?A|-|ΧΩΡΙΣ|BRAND)$/;
const nk = (x) => U.foldKey(x).replace(/[^A-Z0-9Α-Ω]/g, '');
function okBrand(name) {
  const k = U.foldKey(name);
  return nk(name).length >= 2 && k.length <= 40 && !/^\d+$/.test(k) && !JUNK_BRAND.test(k);
}

/** Brands to search: ours without a supplier, and competitors' brands that we don't have. */
function targets() {
  const catalog = require('./catalog');
  const suppliers = require('./suppliers');
  const market = require('./market');
  const compcat = require('./compcat');
  const ours = new Map();
  for (const site of ['sf', 'st']) {
    const per = new Map();
    for (const p of catalog.load(site).products) {
      if (p.type === 'variation' || !p.brand || !okBrand(p.brand)) continue;
      const k = nk(p.brand);
      const e = per.get(k) || { name: p.brand, count: 0, unsupplied: 0 };
      e.count++;
      if (!suppliers.forProduct(p)) e.unsupplied++;
      per.set(k, e);
    }
    for (const [k, e] of per) {
      const o = ours.get(k);
      if (!o || e.count > o.count) ours.set(k, e); // the same products are often on both sites: keep the bigger
    }
  }
  const compNames = new Set();
  const theirs = new Map();
  for (const c of market.competitors()) {
    if (c.enabled === false || c.foreign) continue;
    compNames.add(nk(c.name));
    const cat = compcat.load(c.id);
    const per = new Map();
    for (const x of cat.products || []) {
      if (!x.b || !okBrand(x.b)) continue;
      const k = nk(x.b);
      if (ours.has(k)) continue;
      const e = per.get(k) || { name: x.b, count: 0, inStock: 0 };
      e.count++; if (x.st) e.inStock++;
      per.set(k, e);
    }
    for (const [k, e] of per) {
      const t = theirs.get(k) || { name: e.name, products: 0, inStock: 0, shops: [] };
      t.products += e.count; t.inStock += e.inStock; t.shops.push(c.name);
      theirs.set(k, t);
    }
  }
  const out = [];
  for (const [k, e] of ours) {
    if (e.unsupplied / e.count < 0.5) continue;
    out.push({ key: k, brand: e.name, reason: 'unsupplied', stats: { ourProducts: e.count, unsupplied: e.unsupplied }, rank: 1000 + e.unsupplied });
  }
  for (const [k, t] of theirs) {
    if (compNames.has(k)) continue; // a competitor's own name as "brand" (house brand)
    if (t.shops.length < 2 && t.products < 8) continue;
    out.push({ key: k, brand: t.name, reason: 'opportunity', stats: { compProducts: t.products, compInStock: t.inStock, shops: t.shops.slice(0, 8), shopCount: t.shops.length }, rank: t.shops.length * 40 + Math.min(200, t.products) });
  }
  return out.sort((a, b) => b.rank - a.rank);
}

// ---------- web search ----------
class Blocked extends Error {}
function cleanText(s) { return U.collapse(U.decodeEntities(String(s || '').replace(/<[^>]+>/g, ' '))); }
function parseDdg(html) {
  const out = [];
  if (/anomaly-modal|challenge-form|bots use DuckDuckGo/i.test(html)) throw new Blocked('DuckDuckGo');
  for (const block of html.split(/<div[^>]+class="[^"]*\bresult\b/).slice(1)) {
    if (/result--ad\b/.test(block.slice(0, 200))) continue;
    const a = block.match(/<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/) || block.match(/<a[^>]+href="([^"]+)"[^>]+class="[^"]*result__a[^"]*"[^>]*>([\s\S]*?)<\/a>/);
    if (!a) continue;
    let url = U.decodeEntities(a[1]);
    const m = url.match(/[?&]uddg=([^&]+)/);
    if (m) url = decodeURIComponent(m[1]);
    if (url.startsWith('//')) url = 'https:' + url;
    const sn = block.match(/class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/(?:a|div|td)>/);
    out.push({ url, title: cleanText(a[2]), snippet: sn ? cleanText(sn[1]) : '' });
  }
  return out;
}
function parseBing(html) {
  const out = [];
  if (/\/challenge\/|captcha/i.test(html.slice(0, 20000)) && !/b_algo/.test(html)) throw new Blocked('Bing');
  for (const block of html.split(/<li class="b_algo/).slice(1)) {
    const a = block.match(/<h2[^>]*>\s*<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
    if (!a) continue;
    let url = U.decodeEntities(a[1]);
    const m = url.match(/[?&]u=a1([^&]+)/);
    if (/bing\.com\/ck\//.test(url) && m) { try { url = Buffer.from(m[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'); } catch (_) { continue; } }
    const sn = block.match(/<p[^>]*>([\s\S]*?)<\/p>/);
    out.push({ url, title: cleanText(a[2]), snippet: sn ? cleanText(sn[1]) : '' });
  }
  return out;
}
const ENGINES = [
  { id: 'ddg', name: 'DuckDuckGo', url: (q) => (process.env.SFK_SEARCH_DDG || 'https://html.duckduckgo.com/html/') + '?q=' + encodeURIComponent(q) + '&kl=gr-el', parse: parseDdg, host: 'duckduckgo.com' },
  { id: 'bing', name: 'Bing', url: (q) => (process.env.SFK_SEARCH_BING || 'https://www.bing.com/search') + '?q=' + encodeURIComponent(q) + '&setlang=el&cc=GR', parse: parseBing, host: 'bing.com' },
];
let lastSearch = 0;
async function search(q, state) {
  for (const eng of ENGINES) {
    if (state.blocked.has(eng.id)) continue;
    // a calm pace, like a person searching: 4–7 seconds between searches
    const wait = lastSearch + 4000 + Math.random() * 3000 - Date.now();
    if (wait > 0 && !process.env.SFK_SEARCH_FAST) await U.sleep(wait);
    lastSearch = Date.now();
    try {
      const r = await http.get(eng.url(q), { retries: 0, timeout: 20000 });
      if (r.status === 202) throw new Blocked(eng.name);
      const res = eng.parse(r.text);
      state.used.add(eng.name);
      return res;
    } catch (e) {
      if (e instanceof Blocked || (e.status && [403, 429, 503, 202].includes(e.status))) { state.blocked.add(eng.id); continue; }
      throw e;
    }
  }
  throw new Blocked('all');
}

// the third search only runs when the first two found nothing convincing
function queriesFor(brand) {
  return [`"${brand}" αντιπρόσωπος Ελλάδα`, `${brand} distributor Greece`, `"${brand}" εισαγωγέας χονδρική`];
}

// ---------- scoring ----------
function brandInDomain(host, brand) {
  const b = U.slugify(brand).replace(/-/g, '');
  return b.length >= 3 && host.replace(/[.-]/g, '').includes(b);
}
function score(brand, hits, comps) {
  const byHost = new Map();
  for (const h of hits) {
    let host;
    try { host = new URL(h.url).hostname.replace(/^www\./, '').toLowerCase(); } catch (_) { continue; }
    if (!/^https?:/.test(h.url) || OWN.test(host) || NEVER.test(host)) continue;
    const e = byHost.get(host) || { host, url: new URL(h.url).origin, title: h.title, snippet: h.snippet, pages: [], queries: new Set(), score: 0, why: [] };
    e.pages.push({ url: h.url, title: h.title, snippet: h.snippet });
    e.queries.add(h.q);
    e.bestRank = Math.min(e.bestRank == null ? 99 : e.bestRank, h.rank);
    byHost.set(host, e);
  }
  const out = [];
  for (const e of byHost.values()) {
    const text = U.foldKey(e.pages.map((p) => p.title + ' ' + p.snippet).join(' '));
    const textN = text.replace(/[^A-Z0-9Α-Ω]/g, '');
    const gr = /\.gr$/.test(e.host) || /[Α-Ω]{3}/.test(U.stripTonos(e.pages.map((p) => p.title + ' ' + p.snippet).join(' ')).toUpperCase().replace(/[A-Z]/g, ''));
    let s = 0;
    const why = [];
    s += Math.max(0, 3 - e.bestRank / 3);
    if (e.queries.size > 1) { s += 2 * (e.queries.size - 1); why.push(`βγήκε σε ${e.queries.size} αναζητήσεις`); }
    const dist = DIST.test(text);
    if (dist) { s += 4; why.push('γράφει αντιπρόσωπος / εισαγωγέας / διανομέας'); }
    if (textN.includes(nk(brand))) { s += 2; why.push('αναφέρει τη μάρκα'); }
    if (gr) { s += 2; why.push('ελληνικό site'); }
    let kind = 'distributor';
    const comp = comps.find((c) => c.host === e.host);
    if (comp) { kind = 'competitor'; s -= 3; why.push(`είναι ανταγωνιστής (${comp.name}) — μπορεί να είναι και εισαγωγέας`); }
    else if (brandInDomain(e.host, brand) && !/\.gr$/.test(e.host)) { kind = 'maker'; why.push('το site της ίδιας της μάρκας: ρώτα τους ποιος είναι ο αντιπρόσωπος στην Ελλάδα'); }
    else if (brandInDomain(e.host, brand)) { s += 2; why.push('ελληνικό site με το όνομα της μάρκας'); }
    if (SHOPISH.test(text) && !DIST.test(text)) { s -= 1; }
    out.push({ host: e.host, url: e.url, title: e.title, snippet: e.snippet, pages: e.pages.slice(0, 3), score: Math.round(s * 10) / 10, why, kind, gr, dist });
  }
  return out.sort((a, b) => b.score - a.score);
}

/** Open the best sites: contact details, B2B, and whether their catalog really has the brand. */
async function verify(brand, cand) {
  const info = require('./supplierinfo');
  const r = await Promise.race([info.lookup(cand.url), U.sleep(60000).then(() => { throw new Error('άργησε'); })]);
  const B = nk(brand);
  const all = [...(r.brands.common || []), ...(r.brands.other || [])];
  const has = all.find((b) => nk(b.name) === B);
  const sg = r.suggestions || {};
  cand.info = {
    name: sg.name ? sg.name.value : '', email: sg.email ? sg.email.value : '', phone: sg.phone ? sg.phone.value : (sg.mobile ? sg.mobile.value : ''), address: sg.address ? sg.address.value : '', vat: sg.vat ? sg.vat.value : '',
    platform: r.platform && r.platform.kind, b2b: (r.b2b || []).length > 0, feeds: (r.feeds || []).length, commonBrands: (r.brands.common || []).length, brandCount: all.length, hasBrand: has ? has.count || true : false,
  };
  if (has) { cand.score += 6; cand.why.unshift('έχει τη μάρκα στον κατάλογό του' + (has.count ? ` (${has.count} προϊόντα)` : '')); }
  if (cand.info.b2b) { cand.score += 2; cand.why.push('έχει B2B για επαγγελματίες'); }
  if (cand.info.commonBrands >= 3) { cand.score += 1; cand.why.push(`έχει και ${cand.info.commonBrands} μάρκες που πουλάμε`); }
  if (cand.info.vat) cand.score += 0.5;
  cand.verified = true;
}
// a real lead: a distributor-like site that says so, or whose catalog has the brand
function useful(c) { return c.kind === 'distributor' && (c.dist || (c.info && c.info.hasBrand)) && c.score >= 6; }
function confidence(c) {
  if (c.kind !== 'distributor') return 'low';
  if ((c.info && c.info.hasBrand && c.score >= 12) || c.score >= 15) return 'high';
  return useful(c) && c.score >= 8 ? 'medium' : 'low';
}

/**
 * Search for suppliers. opts: { brands: [keys] (only these), limit }.
 * Stops politely if the search engines block, and continues from there next time.
 */
async function run(job, opts) {
  const o = Object.assign({ limit: 30 }, opts || {});
  const d = data();
  const market = require('./market');
  const comps = market.competitors().map((c) => ({ host: U.hostOf(c.url).replace(/^www\./, ''), name: c.name }));
  const all = targets();
  const monthAgo = Date.now() - 30 * 864e5;
  let todo = all.filter((t) => {
    const b = d.brands[t.key];
    if (o.brands) return o.brands.includes(t.key);
    if (!b) return true;
    if (b.status === 'dismissed' || b.status === 'approved') return false;
    return !b.searchedAt || new Date(b.searchedAt).getTime() < monthAgo;
  });
  todo = todo.slice(0, o.limit);
  const state = { blocked: new Set(), used: new Set() };
  let done = 0, found = 0;
  d.blocked = null;
  for (const t of todo) {
    if (job && job.cancelled()) break;
    if (job) job.progress(done, todo.length, `Αναζήτηση αντιπροσώπου: ${t.brand}`);
    const hits = [];
    let stop = false;
    const qs = queriesFor(t.brand);
    for (let qi = 0; qi < qs.length; qi++) {
      const q = qs[qi];
      if (qi === 2 && score(t.brand, hits, comps).some((c) => c.kind === 'distributor' && c.score >= 7)) break;
      try {
        const res = await search(q, state);
        res.slice(0, 10).forEach((r, i) => hits.push(Object.assign({ q, rank: i + 1 }, r)));
      } catch (e) {
        if (e instanceof Blocked) { stop = true; break; }
        if (job) job.log(`${t.brand}: ${e.message}`);
      }
      if (job && job.cancelled()) break;
    }
    if (stop) {
      d.blocked = { at: U.nowIso(), msg: 'Οι μηχανές αναζήτησης ζήτησαν να σταματήσουμε για λίγο (πολλές αναζητήσεις). Θα συνεχίσει αυτόματα σε επόμενη εκτέλεση.' };
      if (job) job.log(d.blocked.msg);
      break;
    }
    const rejected = new Set([...(d.rejected[t.key] || []), ...d.never]);
    let cands = score(t.brand, hits, comps).filter((c) => !rejected.has(c.host));
    // open the 3 best (not the maker's or competitors') to check them
    for (const c of cands.filter((x) => x.kind === 'distributor' && x.score >= 3).slice(0, 3)) {
      if (job && job.cancelled()) break;
      try { await verify(t.brand, c); } catch (e) {
        if (e.network && /Δεν βρέθηκε|αρνήθηκε/.test(e.message)) c.dead = true; // the site does not exist any more
        else { c.score -= 2; c.why.push('δεν άνοιξε: ' + e.message); }
      }
    }
    cands = cands.filter((c) => !c.dead).sort((a, b) => b.score - a.score).slice(0, 6).map((c) => Object.assign(c, { confidence: confidence(c) }));
    const prev = d.brands[t.key] || {};
    const good = cands.filter(useful);
    const maker = cands.find((c) => c.kind === 'maker');
    d.brands[t.key] = { key: t.key, brand: t.brand, reason: t.reason, stats: t.stats, status: good.length ? 'found' : 'nothing', maker: maker ? maker.url : '', candidates: cands, searchedAt: U.nowIso(), firstAt: prev.firstAt || U.nowIso() };
    if (good.length) found++;
    done++;
    save(d);
    if (job) job.log(`${t.brand}: ${good.length ? good.length + ' προτάσεις (καλύτερη: ' + good[0].host + ')' : maker ? 'μόνο το site του κατασκευαστή' : 'δεν βρέθηκε κάτι σίγουρο'}`);
  }
  if (!d.blocked) d.lastRun = U.nowIso(); // when blocked, it tries again in a few hours (weeklyDue)
  d.lastEngines = [...state.used];
  save(d);
  return { searched: done, found, remaining: Math.max(0, all.filter((t) => !d.brands[t.key]).length), blocked: d.blocked };
}

function weeklyDue() {
  const d = data();
  if (d.blocked) return Date.now() - new Date(d.blocked.at).getTime() > 6 * 36e5;
  return !d.lastRun || Date.now() - new Date(d.lastRun).getTime() > 7 * 864e5;
}

function view() {
  const d = data();
  const t = targets();
  const tk = new Map(t.map((x) => [x.key, x]));
  const rows = Object.values(d.brands).map((b) => Object.assign({}, b, { stats: (tk.get(b.key) || b).stats, stillTarget: tk.has(b.key) }));
  rows.sort((a, b) => ({ found: 0, nothing: 1, approved: 2, dismissed: 3 }[a.status] - { found: 0, nothing: 1, approved: 2, dismissed: 3 }[b.status]) || ((b.candidates[0] || {}).score || 0) - ((a.candidates[0] || {}).score || 0));
  return {
    rows,
    waiting: t.filter((x) => !d.brands[x.key]).map((x) => ({ key: x.key, brand: x.brand, reason: x.reason, stats: x.stats })),
    counts: { unsupplied: t.filter((x) => x.reason === 'unsupplied').length, opportunity: t.filter((x) => x.reason === 'opportunity').length, found: rows.filter((r) => r.status === 'found').length },
    lastRun: d.lastRun, blocked: d.blocked,
  };
}

/** Approve a candidate: creates the supplier (with the brand) and returns it, to be checked in the form. */
function approve(key, host) {
  const d = data();
  const b = d.brands[key];
  if (!b) throw new Error('Δεν βρέθηκε η πρόταση.');
  const c = b.candidates.find((x) => x.host === host);
  if (!c) throw new Error('Δεν βρέθηκε η πρόταση.');
  const suppliers = require('./suppliers');
  const existing = suppliers.list().find((s) => U.hostOf(U.normUrl(s.website) || '').replace(/^www\./, '') === host);
  let r;
  if (existing) {
    const brands = [...new Set([...(existing.brands || []), b.brand])];
    r = suppliers.save(Object.assign({}, existing, { brands }));
  } else {
    const i = c.info || {};
    const name = i.name || host.replace(/\.(gr|com|eu|net)$/, '').replace(/^\w/, (x) => x.toUpperCase());
    r = suppliers.save({ name, website: c.url, email: i.email || '', phone: i.phone || '', address: i.address || '', vat: i.vat || '', brands: [b.brand], notes: `Βρέθηκε αυτόματα (${U.nowIso().slice(0, 10)}): ${c.why.join(', ')}.` });
  }
  b.status = 'approved'; b.approved = { host, supplierId: r.supplier.id, at: U.nowIso() };
  save(d);
  return Object.assign(r, { existing: !!existing });
}
function reject(key, host, never) {
  const d = data();
  if (never) { if (!d.never.includes(host)) d.never.push(host); }
  else d.rejected[key] = [...new Set([...(d.rejected[key] || []), host])];
  const b = d.brands[key];
  if (b) {
    b.candidates = b.candidates.filter((c) => c.host !== host);
    if (!b.candidates.some(useful)) b.status = 'nothing';
  }
  if (never) for (const x of Object.values(d.brands)) x.candidates = x.candidates.filter((c) => c.host !== host);
  save(d);
  return { ok: true };
}
/** Not interested in this brand (it will not be searched again); undo with restore. */
function dismiss(key, undo) {
  const d = data();
  const b = d.brands[key] || (() => { const t = targets().find((x) => x.key === key); if (!t) throw new Error('Δεν βρέθηκε η μάρκα.'); return (d.brands[key] = { key, brand: t.brand, reason: t.reason, stats: t.stats, candidates: [], searchedAt: null }); })();
  b.status = undo ? (b.candidates.some(useful) ? 'found' : 'nothing') : 'dismissed';
  if (undo) b.searchedAt = null;
  save(d);
  return { ok: true };
}

module.exports = { targets, run, view, approve, reject, dismiss, weeklyDue, parseDdg, parseBing, score, queriesFor };
