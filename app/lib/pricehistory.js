'use strict';
// SF Κέντρο — the history of the competitors' prices (spec 2.0 §7, an idea of PriceBuddy — no code copied): every offer
// of the SAME product (exact, or confirmed by a person) keeps its CHANGES of price / stock, with the day — not a copy
// per day, so it stays small. From it: lowest / highest of 30 and 90 days, since when the price is the same, and a
// «discount» whose «before» price was never really asked in the last 30 days (a discount that may be artificial).
// It only describes the market: it never changes a price (the price research decides, with its own rules).
const store = require('./store');

const KEY = 'price-history';      // { 'site:id': { url: [[day, price, inStock 1|0|null, regular]] } }
const PER_OFFER = 40;             // changes kept per offer
const DAYS = 180;                 // older changes go

const day = (iso) => String(iso || new Date().toISOString()).slice(0, 10);
function same(a, b) { return a && b && a[1] === b[1] && a[2] === b[2] && (a[3] || 0) === (b[3] || 0); }

/**
 * Write down what the price research saw: entries = { 'site:id': { competitors: [...] } } (all of them, or only the
 * products that changed). → how many offers changed.
 */
function observe(entries) {
  let changed = 0;
  const cut = day(new Date(Date.now() - DAYS * 864e5).toISOString());
  store.update(KEY, {}, (h) => {
    for (const [key, e] of Object.entries(entries || {})) {
      if (!e || !Array.isArray(e.competitors)) continue;
      for (const c of e.competitors) {
        if (!c || !c.url || !(Number(c.price) > 0) || !(c.match === 'exact' || c.confirmed) || c.ignored) continue;
        const row = [day(c.seenAt), Math.round(Number(c.price) * 100) / 100, c.inStock === true ? 1 : c.inStock === false ? 0 : null, Number(c.regular) > Number(c.price) ? Math.round(Number(c.regular) * 100) / 100 : 0];
        const p = h[key] || (h[key] = {});
        const list = p[c.url] || (p[c.url] = []);
        const last = list[list.length - 1];
        if (same(last, row)) continue;
        if (last && last[0] > row[0]) continue; // (an older reading never goes after a newer one)
        if (last && last[0] === row[0]) list[list.length - 1] = row; else list.push(row);
        while (list.length > PER_OFFER || (list.length > 1 && list[0][0] < cut)) list.shift();
        changed++;
      }
    }
    return h;
  });
  return changed;
}

/** What the history says about one offer → { min30, max30, min90, since, artificial, points } (null: nothing kept). */
function summary(list) {
  if (!Array.isArray(list) || !list.length) return null;
  const now = Date.now();
  const inDays = (d, n) => now - new Date(d).getTime() <= n * 864e5;
  // a price counts from the day it was seen until the next change
  const asked = (n) => list.filter((x, i) => inDays(x[0], n) || (list[i + 1] && inDays(list[i + 1][0], n)) || i === list.length - 1).map((x) => x[1]);
  const p30 = asked(30), p90 = asked(90);
  const last = list[list.length - 1];
  // «before X, now Y»: was X really asked in the last 30 days? (EU rule of the lowest price of 30 days)
  const artificial = !!(last[3] > last[1] && p30.length >= 2 && !p30.some((x) => x >= last[3] - 0.01));
  return { min30: Math.min(...p30), max30: Math.max(...p30), min90: Math.min(...p90), since: last[0], points: list.length, artificial, low30: last[1] <= Math.min(...p30) + 0.001 };
}

/** The history of one product, per offer. */
function forProduct(key) {
  const h = store.read(KEY, {});
  const p = h[key] || {};
  return Object.fromEntries(Object.entries(p).map(([url, list]) => [url, { list, sum: summary(list) }]));
}

module.exports = { observe, summary, forProduct, KEY, PER_OFFER };
