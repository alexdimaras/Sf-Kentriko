'use strict';
// Background work that never freezes the screens.
// A small cloud machine gives the program a tenth of a processor: a calculation of 2 seconds becomes 20 seconds
// in which nothing else is answered. So every long calculation is written as a generator that pauses often
// (`yield`), and is run here in short slices; between slices the program answers whoever is waiting, and while
// somebody is using a screen the background work steps aside.

let active = 0;       // requests being answered right now
let lastRequest = 0;  // when the last one finished
let slices = 0, waitedMs = 0;

/** The server tells us about every request (start → the returned function at its end). */
function request() {
  active++;
  let done = false;
  return () => { if (done) return; done = true; active = Math.max(0, active - 1); lastRequest = Date.now(); };
}

const tick = () => new Promise((r) => setImmediate(r));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Let everybody else run: pending requests first. While a request is being answered, or one just was (a screen
 * asks for 2–4 things in a row), wait a little — at most `max` ms, so the work always goes on.
 */
async function breathe(max) {
  slices++;
  await tick();
  const limit = max == null ? 1500 : max;
  let waited = 0;
  while ((active > 0 || Date.now() - lastRequest < 120) && waited < limit) { await sleep(20); waited += 20; }
  waitedMs += waited;
}

/** Run a generator to its end in slices of about `slice` ms of work. Returns what the generator returns. */
async function drain(gen, slice) {
  const ms = slice || 12;
  let t = Date.now();
  for (;;) {
    const r = gen.next();
    if (r.done) return r.value;
    if (Date.now() - t >= ms) { await breathe(); t = Date.now(); }
  }
}

/** The same work in one go (tests, the program on a PC, or when a result is needed at once). */
function drainSync(gen) {
  for (;;) { const r = gen.next(); if (r.done) return r.value; }
}

/** For plain loops inside async functions: `if (pace.due()) await pace.rest()` every so many items. */
function pacer(slice) {
  const ms = slice || 12;
  let t = Date.now();
  return { due: () => Date.now() - t >= ms, rest: async () => { await breathe(); t = Date.now(); } };
}

function stats() { return { active, slices, waitedMs }; }
/** A machine with little memory (the free cloud plan has 512 MB): what can be let go between uses, is. */
const small = (typeof process.constrainedMemory === 'function' && process.constrainedMemory() > 0 && process.constrainedMemory() < 1.5e9) || process.env.SFK_SMALL === '1';

module.exports = { request, breathe, drain, drainSync, pacer, tick, stats, small };
