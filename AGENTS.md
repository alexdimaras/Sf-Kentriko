# AGENTS.md — the shared map for every AI working on this repository (Claude, Codex, Copilot, …)

SF Κέντρο: back office (Node 22, vanilla JS, no framework) for two WooCommerce shops — **specialforces.gr** (`sf`, the
main one) and **stratiotikaeidi.gr** (`st`, for ads). Version **1.6.0**. The person who owns it speaks Greek and is not
a programmer: answers to them in Greek, simple, step by step.

## Read first (in this order)
1. `CLAUDE.md` — the rules that never change and the short architecture (Claude reads it by itself; others: read it).
2. `docs/STATE.md` — where things stand now: deployed version, CI, what works, what is not proven.
3. `docs/DECISIONS.md` — decisions of the owner that must not be undone by accident.
4. `docs/BUGS.md` — known bugs / risks with severity and evidence.
5. `docs/BACKLOG.md` — the owner's list of work, with status.
6. `docs/PROJECT.md` — the long description (architecture §2β/2γ, data, API, history).
7. `docs/RUNBOOKS.md` — what to do when the database / a computer / the backup / the search fails.
8. `docs/TEST-MATRIX.md` — which test proves which requirement.

## Rules that never change (summary — the full text is in CLAUDE.md)
- The program **never writes to the shops**: it makes CSV files the owner imports in WooCommerce.
- **Nothing changes without approval** (Διορθώσεις → Έγκριση); every proposal shows before / after, why, source, how sure.
- **No made-up codes** (never parent code + size, never a «cleaned» junk code, never a brand as a code); a code / EAN
  only from external proof (supplier, or the same code for the same variant in ≥2 independent shops).
- Titles: CAPITALS, KIND BRAND MODEL [COLOUR], no code inside.
- «The same product» only with proof (code / EAN, or brand + model + colour + quantity); a price action needs ≥2 shops.
- Free only: Render free (0.1 CPU / 512 MB), Supabase free (500 MB), no paid AI. Secrets never in logs / chat / repo.
- An AI may propose code changes and run tests; it never changes the shops' data or prices by itself.

## Where things are
| Part | Files |
|---|---|
| Server (API, users, queue) | `app/server.js` |
| Data (files + PostgreSQL, GitHub daily copy) | `app/lib/store.js`, `app/lib/pgsave.js`, `app/lib/db.js`, `app/lib/cloudsave.js` |
| Background preparation of the screens | `app/lib/engine.js`, `app/lib/bg.js`, `app/lib/checks.js`, `app/lib/fixes.js`, `app/lib/flow.js` |
| Queue and helping computers | `app/lib/coord.js`, `app/lib/jobtypes.js`, `app/worker.js`, `app/lib/perf.js`, `app/lib/selfupdate.js`, `app/lib/installer.js` |
| Price research / matching | `app/lib/market.js` (`compare`, `stats`, `decision`), `app/lib/compcat.js`, `app/lib/sitemapcat.js`, `app/lib/research.js` |
| Internet research per product | `app/lib/codefind.js`, `app/lib/supplierfind.js`, `app/lib/extract.js`, `app/lib/airesearch.js` |
| Local AI (Ollama on a PC) | `app/lib/localai.js` |
| Health of the system | `app/lib/health.js`, `systemStatus` / `systemCheck` in `app/server.js` |
| Product report, families, SEO | `app/lib/quality.js`, `app/lib/families.js`, `app/lib/seoaudit.js` |
| Screens | `app/public/js/core.js` (shared), `app/public/js/v-*.js`, `app/public/app.css` |

## Commands
```bash
cd app && npm ci
cd app && npm test                      # every suite (~10 minutes)
service postgresql start && COORD_PG=postgres://sfk:sfk-test-pass@127.0.0.1:5432/sfk node app/test/db.js
node app/test/bench/live-research.js    # live, on real shops (where the network allows)
```

## How work is delivered
- Branch `claude/friendly-sagan-bfjrkj`: **every push deploys to Render** (the owner chose this, 23/11).
- Before a push: `npm test` green (and with `COORD_PG` for the database parts) and a phone-size screen check (Playwright).
- Update `docs/BACKLOG.md` / `docs/STATE.md` / `docs/BUGS.md` when something closes or is found.
- Never claim a thing works without a test or an observation; say plainly what was not checked.
