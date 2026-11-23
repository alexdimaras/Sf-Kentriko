// node test/bench/recall-bench.js [limit=600] [products]  — measured 23/11: 9.517 products, 6.147 found, 0 lost
// recall of market.bestIn (posting lists over 600 left out) against a full comparison, on the real catalogs
const fs = require('fs'), path = require('path'), os = require('os');
const APP = path.join(__dirname, '..', '..');
process.env.SFK_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'sfk-recall-'));
// the real catalogs (Store API JSON of both shops) in a folder: SFK_FULL=/path (sf.json, st.json)
const FULL = process.env.SFK_FULL || path.join(__dirname, 'full');
const catalog = require(APP + '/lib/catalog');
const compcat = require(APP + '/lib/compcat');
const m = require(APP + '/lib/market');
const LIMIT = Number(process.argv[2] || 600);
const ours = JSON.parse(fs.readFileSync(path.join(FULL, 'sf.json'))).map((p) => catalog.fromStoreApi(p)).filter((p) => p.type !== 'variation');
const theirs = JSON.parse(fs.readFileSync(path.join(FULL, 'st.json'))).map((p) => compcat.fromWoo(p, 'https://stratiotikaeidi.gr')).filter((x) => x && x.n);
const items = theirs, feats = items.map((it) => m.candFeatures(it)), post = new Map();
const put = (k, i) => { let a = post.get(k); if (!a) post.set(k, (a = [])); a.push(i); };
feats.forEach((cf, i) => { for (const t of cf.set) put(t, i); if (cf.sku) put('#' + cf.sku, i); for (const cb of [cf.code, cf.mpn]) if (cb) { put('~' + cb.base, i); if (cb.run && cb.run !== cb.base) put('~' + cb.run, i); } if (cf.gtin) put('=' + cf.gtin, i); });
const ix = { items, feats, post };
const comp = { name: 'st', id: 'st' };
let n = 0, both = 0, onlyFull = 0, onlyIdx = 0, none = 0, cands = 0;
const lost = [];
const t0 = Date.now();
for (const p of ours.slice(0, Number(process.argv[3] || 3000))) {
  const f = m.features(p);
  if (!(f.keys.length || f.sku || f.codes.length || f.gtin)) continue;
  n++;
  const a = m.bestIn(f, ix, comp);
  const aEx = a && a.match === 'exact';
  let bEx = null;
  for (let i = 0; i < items.length; i++) { const s = m.compare(f, items[i], feats[i]); if (s.match === 'exact') { bEx = items[i]; break; } }
  if (aEx && bEx) both++; else if (bEx && !aEx) { onlyFull++; if (lost.length < 12) lost.push(p.name + '  →  ' + bEx.n); } else if (aEx) onlyIdx++; else none++;
}
console.log(`limit ${LIMIT}: products ${n} · found by both ${both} · ONLY by the full comparison (lost by the index) ${onlyFull} · only index ${onlyIdx} · none ${none} · ${Math.round((Date.now() - t0) / 1000)}s`);
for (const l of lost) console.log('  lost: ' + l);
