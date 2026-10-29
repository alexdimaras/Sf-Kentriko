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
  // a competitor price this many % under the others (or under the supplier's retail price) is suspect: old stock, mistake
  suspectPct: 30,
  marketGreekOnly: true,
  competitorGap: 900, // ms between requests to the same competitor
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
  localAI: { enabled: false, url: 'http://127.0.0.1:11434', model: '' },
  firstRunDone: false,
};

function merge(def, val) {
  if (Array.isArray(def) || typeof def !== 'object' || def === null) return val === undefined ? def : val;
  const out = {};
  for (const k of Object.keys(def)) out[k] = merge(def[k], val ? val[k] : undefined);
  if (val && typeof val === 'object') for (const k of Object.keys(val)) if (!(k in out)) out[k] = val[k];
  return out;
}

function all() { return merge(DEFAULTS, store.read('settings', {})); }

function save(patch) {
  const cur = all();
  const next = merge(cur, patch || {});
  // basic validation
  next.vat = clampNum(next.vat, 0, 40, 24);
  next.percent = clampNum(next.percent, 0, 50, 3);
  next.floorMargin = clampNum(next.floorMargin, 0, 300, 25);
  next.minShops = Math.round(clampNum(next.minShops, 1, 5, 2));
  next.suspectPct = clampNum(next.suspectPct, 10, 60, 30);
  next.competitorGap = clampNum(next.competitorGap, 200, 10000, 900);
  next.autoSyncHours = clampNum(next.autoSyncHours, 0, 720, 12);
  next.descMinChars = clampNum(next.descMinChars, 0, 5000, 150);
  next.marketHour = clampNum(next.marketHour, 0, 23, 0);
  next.marketAuto = !!next.marketAuto;
  next.supplierFindAuto = next.supplierFindAuto !== false;
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
