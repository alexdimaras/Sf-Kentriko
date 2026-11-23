'use strict';
const store = require('./store');

const DEFAULTS = {
  sites: {
    sf: { name: 'SpecialForces', url: 'https://specialforces.gr', role: 'Όλα τα προϊόντα (μαζί με όπλα)' },
    st: { name: 'Στρατιωτικά Είδη', url: 'https://stratiotikaeidi.gr', role: 'Μόνο ρούχα και εξοπλισμός (διαφημίσεις)' },
  },
  master: 'sf', // which site's price is the reference when the two differ
  vat: 24,
  rounding: '90',
  strategy: 'median_minus',
  percent: 3,
  floorMargin: 25,
  // the price changes only when at least this many shops (in stock, not suspect) agree
  minShops: 2,
  // sizes / colours of a product: 'suffix' = each its own code — ONLY a real one, from sources (the supplier's code of
  // that size, or the same code shown by two independent shops for that very size / colour); never made from ours
  // (no K13079-SAND, no P-B-10-XL: the owner's test plan of 19/11/2026); 'same' = no codes for sizes / colours at all.
  variantSku: 'suffix',
  skuPolicy: 0,
  // a competitor price this many % under the others (or under the supplier's retail price) is suspect: old stock, mistake
  suspectPct: 30,
  marketGreekOnly: true,
  competitorGap: 900, // ms between requests to the same competitor
  sitemapPages: 300, // shops read through their site map: how many product pages may be opened per shop in one run
  syncVariations: true,
  autoSyncHours: 12,
  descMinChars: 150,
  longTitle: 110,
  // Competitor research: every day automatically, the first time the program is open that day
  // (marketHour: not before this hour; 0 = as soon as it opens).
  marketAuto: true,
  supplierFindAuto: true,
  marketHour: 0,
  // What may be advertised on the ads site: null = the built-in rules from the Google/Meta policies (adrules.js).
  adRules: null,
  newProduct: {
    status: 'draft', // draft | publish
    footer: 'Διαθέσιμο στα καταστήματά μας στον Πειραιά και online, με αποστολή σε όλη την Ελλάδα.',
    titleTag: 'h2',
  },
  seo: { sf: 'auto', st: 'auto' }, // auto | none | yoast | rankmath
  attributes: { sf: { brand: '', size: '', color: '' }, st: { brand: '', size: '', color: '' } },
  localAI: { enabled: false, url: 'http://127.0.0.1:11434', model: '', research: true },
  // The research on the internet (lib/codefind.js): how far it goes for one product. «auto» (by itself, for everything)
  // stops when what is missing is confirmed by `minShops` shops after at least `minQueries` searches; «full» (the
  // button «Πλήρης έρευνα Internet») runs the whole plan. Limits protect the engines, the shops, memory and processor.
  webResearch: {
    maxQueries: 12, pagesPerQuery: 8, perHost: 4, maxPages: 60, minQueries: 4, minShops: 4,
    fullQueries: 20, fullPages: 120,
    minImages: 3,            // fewer photos than this: photos are looked for
    approveNewShops: true,   // a price from a shop that is not a competitor counts only after a yes for that shop
    apis: { searxng: false, brave: false, google: false }, // optional search APIs (keys kept apart, encrypted)
  },
  firstRunDone: false,
};

function merge(def, val) {
  if (Array.isArray(def) || typeof def !== 'object' || def === null) return val === undefined ? def : val;
  const out = {};
  for (const k of Object.keys(def)) out[k] = merge(def[k], val ? val[k] : undefined);
  if (val && typeof val === 'object') for (const k of Object.keys(val)) if (!(k in out)) out[k] = val[k];
  return out;
}

/**
 * The settings. A decision of the owner reaches settings saved before it WITHOUT writing anything at the start (a write
 * there could come before the data is brought back from the database / GitHub and replace it): it is applied when they
 * are read, and kept with the next save. (skuPolicy 2, 18/11/2026: a distinct code per size / colour, as Google asks.)
 */
function all() {
  const stored = store.read('settings', {}) || {};
  const m = merge(DEFAULTS, stored);
  if ((Number(stored.skuPolicy) || 0) < 2) { m.variantSku = 'suffix'; m.skuPolicy = 2; }
  return m;
}
function save(patch) {
  const cur = all();
  const next = merge(cur, patch || {});
  // basic validation
  next.vat = clampNum(next.vat, 0, 40, 24);
  next.percent = clampNum(next.percent, 0, 50, 3);
  next.floorMargin = clampNum(next.floorMargin, 0, 300, 25);
  next.minShops = Math.round(clampNum(next.minShops, 2, 5, 2)); // one shop alone never moves a price (only shown)
  next.suspectPct = clampNum(next.suspectPct, 10, 60, 30);
  next.competitorGap = clampNum(next.competitorGap, 200, 10000, 900);
  next.sitemapPages = clampNum(next.sitemapPages, 20, 3000, 300);
  next.autoSyncHours = clampNum(next.autoSyncHours, 0, 720, 12);
  next.descMinChars = clampNum(next.descMinChars, 0, 5000, 150);
  next.marketHour = clampNum(next.marketHour, 0, 23, 0);
  next.marketAuto = !!next.marketAuto;
  next.supplierFindAuto = next.supplierFindAuto !== false;
  next.variantSku = next.variantSku === 'same' ? 'same' : 'suffix';
  next.skuPolicy = 2;
  const wr = next.webResearch;
  wr.maxQueries = Math.round(clampNum(wr.maxQueries, 2, 30, 12)); wr.pagesPerQuery = Math.round(clampNum(wr.pagesPerQuery, 2, 20, 8));
  wr.perHost = Math.round(clampNum(wr.perHost, 1, 10, 4)); wr.maxPages = Math.round(clampNum(wr.maxPages, 5, 200, 60));
  wr.minQueries = Math.round(clampNum(wr.minQueries, 1, wr.maxQueries, 4)); wr.minShops = Math.round(clampNum(wr.minShops, 1, 10, 4));
  wr.fullQueries = Math.round(clampNum(wr.fullQueries, wr.maxQueries, 40, 20)); wr.fullPages = Math.round(clampNum(wr.fullPages, wr.maxPages, 300, 120));
  wr.minImages = Math.round(clampNum(wr.minImages, 1, 8, 3)); wr.approveNewShops = wr.approveNewShops !== false;
  if (!['90', '99', '00', 'none'].includes(String(next.rounding))) next.rounding = '90';
  if (!['median_minus', 'median', 'min', 'min_minus'].includes(next.strategy)) next.strategy = 'median_minus';
  store.write('settings', next);
  return next;
}
function clampNum(v, lo, hi, d) { const n = Number(v); return isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; }

function lines(s) { return String(s || '').split(/\r?\n|,/).map((x) => x.trim()).filter(Boolean); }

const STRATEGIES = {
  median_minus: 'Λίγο κάτω από τη μέση τιμή αγοράς (−X%)',
  median: 'Ίδια με τη μέση τιμή αγοράς',
  min: 'Ίδια με το φθηνότερο κατάστημα',
  min_minus: 'Κάτω από το φθηνότερο κατάστημα (−X%)',
};

module.exports = { all, save, lines, DEFAULTS, STRATEGIES };
