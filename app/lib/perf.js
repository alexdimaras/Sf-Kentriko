'use strict';
// SF Κέντρο — how much of a helping computer the work may use: three profiles, chosen per computer in
// Ρυθμίσεις → Υπολογιστές (Ήπια · Κανονική · Ενίσχυση). Pure rules (no I/O): the worker asks them every 15″ with what
// it measures and follows the answer; the tests check them alone.
//
//   slots      — jobs at once (runners); the rest wait, nothing is lost
//   pages      — pages of a product read at once inside one job
//   domainGap  — the least time between two pages of the same shop, for the whole computer (all its runners)
//   The pace of the search engines is NEVER made faster by a profile: one search at a time per engine, its own
//   pause after a refusal — the profile only says how many products are worked on, not how fast the engines are asked.
//
// Memory: the room of Ollama's model is kept free (qwen2.5:7b ≈ 5 GB) when the computer has the AI; when the memory in
// use goes over the profile's line the computer goes one profile down by itself (and back when it is free again).

const PROFILES = {
  gentle: { label: 'Ήπια', share: 0.25, maxSlots: 2, pages: 1, domainGap: 3000, ramHigh: 70 },
  normal: { label: 'Κανονική', share: 0.5, maxSlots: 6, pages: 2, domainGap: 1500, ramHigh: 80 },
  boost: { label: 'Ενίσχυση', share: 1, maxSlots: 24, pages: 3, domainGap: 1000, ramHigh: 88 },
};
const ORDER = ['gentle', 'normal', 'boost'];
const RUNNER_MB = 450;       // what one runner may take at most (measured: 150–350 MB while reading pages)
const OLLAMA_MB = 5500;      // the room of a 7B model in memory (q4 ≈ 4,7 GB + its context)
const SYSTEM_MB = 2500;      // what Windows and the person's own programs keep

function profileOf(name) { return PROFILES[name] ? name : 'normal'; }

/**
 * m: { profile, cpus, ramTotalMB, ramUsedPct, cpuPct, ollama (has a model), aiBusy (a question is being answered) }
 * → { profile, used (after a step down), label, slots, pages, domainGap, reason, down }
 */
function policy(m) {
  const want = profileOf(m && m.profile);
  let used = want;
  const why = [];
  const ram = Number(m && m.ramUsedPct) || 0;
  // too much memory in use: one step down — and one more when it is very full
  if (ram >= PROFILES[used].ramHigh && used !== 'gentle') { used = ORDER[ORDER.indexOf(used) - 1]; why.push(`μνήμη ${ram}% ≥ ${PROFILES[want].ramHigh}%`); }
  if (ram >= 92 && used !== 'gentle') { used = 'gentle'; why.push('μνήμη σχεδόν γεμάτη'); }
  // the processor busy with the person's own work (not ours): one step down
  if ((Number(m && m.cpuPct) || 0) >= 90 && used !== 'gentle') { used = ORDER[ORDER.indexOf(used) - 1]; why.push(`επεξεργαστής ${m.cpuPct}%`); }
  const P = PROFILES[used];
  const cpus = Math.max(1, Number(m && m.cpus) || 1);
  let slots = Math.max(1, Math.min(P.maxSlots, Math.round(cpus * P.share)));
  // memory: what is left after the system and (when it has the AI) Ollama's model, one runner per RUNNER_MB
  const total = Number(m && m.ramTotalMB) || 0;
  if (total) {
    const room = total - SYSTEM_MB - (m && m.ollama ? OLLAMA_MB : 0);
    const byRam = Math.max(1, Math.floor(room / RUNNER_MB));
    if (byRam < slots) { slots = byRam; why.push(`μνήμη ${Math.round(total / 1024)} GB${m && m.ollama ? ' (με χώρο για το μοντέλο του Ollama)' : ''}`); }
  }
  // the very full memory: one job only
  if (ram >= 95) { slots = 1; why.push('μνήμη ≥ 95%: μία εργασία'); }
  return { profile: want, used, label: P.label, slots, pages: P.pages, domainGap: P.domainGap, down: used !== want, reason: why.join(' · ') };
}

module.exports = { PROFILES, ORDER, policy, profileOf, RUNNER_MB, OLLAMA_MB };
