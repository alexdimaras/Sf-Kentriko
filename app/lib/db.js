'use strict';
// The shared database (PostgreSQL — Supabase in the cloud): the one place the truth is kept.
//
//   jobs       the queue of work (lib/coord.js): one row per job, taken by one computer at a time (row locks)
//   workers    the computers of the shops: what they can do, when they were last seen, a fingerprint of their token
//   pairings   one-off codes for adding a computer (fingerprints only)
//   documents  the program's data files (products, research, fixes, settings…), compressed, each with a version
//              number: a change is written only over the version it was made from (optimistic locking), so two
//              writers never lose each other's work without noticing
//   audit_log  who did what and when (approvals, exports, settings, users, computers)
//
// Only the cloud program talks to the database; the computers of the shops talk to the cloud program (they never
// hold the database password). Connection: SFK_DATABASE_URL (with SSL; SFK_DB_CA = the provider's certificate, to
// check that it is really the provider).
const zlib = require('zlib');

const SCHEMA = 2;
let pg = null;
function lib() { if (!pg) pg = require('pg'); return pg; }

/** A small pool (free plans allow few connections). */
let tls = '';
/** How the connection is protected: 'verified' (certificate checked), 'encrypted' (not checked), 'local'. */
function tlsMode() { return tls; }
async function connect(url) {
  const { Pool } = lib();
  const local = /@(localhost|127\.0\.0\.1)(:\d+)?\//.test(url);
  const ca = process.env.SFK_DB_CA ? String(process.env.SFK_DB_CA).replace(/\\n/g, '\n') : '';
  // always encrypted outside this machine; with the provider's certificate the server is also checked
  // the database's identity is checked with its certificate (SFK_DB_CA). Without it the connection is still encrypted,
  // but not checked — said plainly in Settings → Δεδομένα; SFK_DB_TLS=verify refuses to connect without it.
  if (!local && !ca && process.env.SFK_DB_TLS === 'verify') throw new Error('Η βάση δεν έχει πιστοποιητικό (SFK_DB_CA): η σύνδεση δεν γίνεται χωρίς έλεγχο ταυτότητας.');
  const ssl = local ? false : ca ? { ca, rejectUnauthorized: true } : { rejectUnauthorized: false };
  tls = local ? 'local' : ca ? 'verified' : 'encrypted';
  // the ssl settings of a pasted address (?sslmode=require) would replace ours: they are taken out
  let clean = url;
  try { const u = new URL(url); for (const k of [...u.searchParams.keys()]) if (/^ssl/i.test(k)) u.searchParams.delete(k); clean = u.toString(); } catch (_) { /* not a URL: as given */ }
  const pool = new Pool({ connectionString: clean, ssl, max: Number(process.env.SFK_DB_POOL) || 3, idleTimeoutMillis: 30000, connectionTimeoutMillis: 15000, application_name: 'sf-kentro' });
  pool.on('error', (e) => console.error('database:', e.message));
  await migrate(pool);
  return pool;
}

async function migrate(pool) {
  await pool.query(`CREATE TABLE IF NOT EXISTS sfk_schema (id int PRIMARY KEY, version int NOT NULL, at timestamptz NOT NULL DEFAULT now())`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS jobs (
      id text PRIMARY KEY, type text NOT NULL, status text NOT NULL, priority int NOT NULL DEFAULT 0, auto boolean NOT NULL DEFAULT false,
      dedup_key text NOT NULL DEFAULT '', worker_id text NOT NULL DEFAULT '', lease_until bigint NOT NULL DEFAULT 0,
      attempts int NOT NULL DEFAULT 0, created_at text NOT NULL, completed_at text, idem text NOT NULL DEFAULT '', data jsonb NOT NULL);
    CREATE INDEX IF NOT EXISTS jobs_live ON jobs (status, priority DESC, auto, created_at) WHERE status IN ('queued','assigned','running');
    CREATE INDEX IF NOT EXISTS jobs_key ON jobs (dedup_key) WHERE dedup_key <> '';
    CREATE INDEX IF NOT EXISTS jobs_worker ON jobs (worker_id) WHERE status IN ('assigned','running');
    CREATE TABLE IF NOT EXISTS workers (id text PRIMARY KEY, token_hash text UNIQUE NOT NULL, revoked boolean NOT NULL DEFAULT false, data jsonb NOT NULL);
    CREATE TABLE IF NOT EXISTS pairings (hash text PRIMARY KEY, until bigint NOT NULL, data jsonb NOT NULL);
    CREATE TABLE IF NOT EXISTS documents (name text PRIMARY KEY, version bigint NOT NULL, size int NOT NULL, gz bytea NOT NULL, updated_at timestamptz NOT NULL DEFAULT now(), updated_by text NOT NULL DEFAULT '');
    CREATE TABLE IF NOT EXISTS audit_log (id bigserial PRIMARY KEY, at timestamptz NOT NULL DEFAULT now(), actor text NOT NULL, action text NOT NULL, target text NOT NULL DEFAULT '', detail jsonb);
    CREATE INDEX IF NOT EXISTS audit_at ON audit_log (at DESC);
  `);
  await pool.query(`INSERT INTO sfk_schema (id, version) VALUES (1, $1) ON CONFLICT (id) DO UPDATE SET version = GREATEST(sfk_schema.version, $1), at = now()`, [SCHEMA]);
}

/** Tests only: an empty queue. */
async function reset(pool) { await pool.query('TRUNCATE jobs, workers, pairings, audit_log'); }

// ---------- the queue (same calls as lib/coord-store.js) ----------
function coordBackend(pool) {
  const row = (r) => (r ? r.data : null);
  const put = (j) => pool.query(
    `INSERT INTO jobs (id, type, status, priority, auto, dedup_key, worker_id, lease_until, attempts, created_at, completed_at, idem, data)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     ON CONFLICT (id) DO UPDATE SET type=$2, status=$3, priority=$4, auto=$5, dedup_key=$6, worker_id=$7, lease_until=$8, attempts=$9, completed_at=$11, idem=$12, data=$13`,
    [j.id, j.type, j.status, j.priority | 0, !!j.auto, j.dedupKey || '', j.workerId || '', Math.round(j.leaseUntil || 0), j.attempts | 0, j.createdAt, j.completedAt || null, j.idem || '', j]);
  return {
    kind: 'postgres',
    async save(j) { await put(j); },
    async job(id) { return row((await pool.query('SELECT data FROM jobs WHERE id = $1', [id])).rows[0]); },
    async findByKey(key) { return (await pool.query('SELECT data FROM jobs WHERE dedup_key = $1 ORDER BY created_at DESC LIMIT 20', [key])).rows.map(row); },
    async live() { return (await pool.query(`SELECT data FROM jobs WHERE status IN ('queued','assigned','running')`)).rows.map(row); },
    async byWorker(id) { return (await pool.query(`SELECT data FROM jobs WHERE worker_id = $1 AND status IN ('assigned','running')`, [id])).rows.map(row); },
    async recent(n) { return (await pool.query('SELECT data FROM jobs ORDER BY created_at DESC LIMIT $1', [n])).rows.map(row); },
    /**
     * The best queued job that passes `ok`, given out atomically: the update succeeds only while the job is still
     * queued (compare-and-set), so when two computers ask at the same moment one gets it and the other moves on to
     * the next — no job is ever given to two, and nobody waits for a lock.
     */
    async takeNext(ok, take) {
      const rs = await pool.query(`SELECT data FROM jobs WHERE status = 'queued' ORDER BY priority DESC, auto, created_at LIMIT 100`);
      for (const j of rs.rows.map(row)) {
        if (!ok(j)) continue;
        take(j);
        const r = await pool.query(`UPDATE jobs SET status=$2, worker_id=$3, lease_until=$4, attempts=$5, data=$6 WHERE id=$1 AND status = 'queued' RETURNING id`, [j.id, j.status, j.workerId || '', Math.round(j.leaseUntil || 0), j.attempts | 0, j]);
        if (r.rowCount === 1) return j;
      }
      return null;
    },
    async worker(id) { return row((await pool.query('SELECT data FROM workers WHERE id = $1', [id])).rows[0]); },
    async workers() { return (await pool.query('SELECT data FROM workers')).rows.map(row); },
    async workerByHash(h) { return row((await pool.query('SELECT data FROM workers WHERE token_hash = $1', [h])).rows[0]); },
    async saveWorker(w) { await pool.query('INSERT INTO workers (id, token_hash, revoked, data) VALUES ($1,$2,$3,$4) ON CONFLICT (id) DO UPDATE SET token_hash=$2, revoked=$3, data=$4', [w.id, w.tokenHash, !!w.revoked, w]); },
    async savePairing(p) { await pool.query('DELETE FROM pairings WHERE until < $1', [Date.now()]); await pool.query('INSERT INTO pairings (hash, until, data) VALUES ($1,$2,$3)', [p.hash, Math.round(p.until), p]); },
    async takePairing(h) { const r = await pool.query('DELETE FROM pairings WHERE hash = $1 RETURNING data', [h]); return row(r.rows[0]); },
    async close() { await pool.end(); },
  };
}

// ---------- the data files ----------
class Conflict extends Error { constructor(name, have, want) { super(`Το «${name}» άλλαξε στο μεταξύ από αλλού (έκδοση ${have}, γράφτηκε πάνω στην ${want}).`); this.conflict = true; this.name2 = name; this.have = have; } }
/** All documents: [{ name, version, size }] (no contents). */
async function docList(pool) { return (await pool.query('SELECT name, version, size, updated_at FROM documents ORDER BY name')).rows.map((r) => ({ name: r.name, version: Number(r.version), size: r.size, at: r.updated_at })); }
/** One document → { text, version } or null. */
async function docGet(pool, name) {
  const r = (await pool.query('SELECT version, gz FROM documents WHERE name = $1', [name])).rows[0];
  return r ? { text: zlib.gunzipSync(r.gz).toString('utf8'), version: Number(r.version) } : null;
}
/**
 * Write a document over the version it was read at (`base`: 0 = it must not exist yet). → the new version.
 * Someone else wrote it in between → Conflict (nothing is written).
 */
async function docPut(pool, name, text, base, by) {
  const gz = zlib.gzipSync(Buffer.from(String(text), 'utf8'), { level: 6 });
  if (!base) {
    const r = await pool.query(`INSERT INTO documents (name, version, size, gz, updated_by) VALUES ($1, 1, $2, $3, $4) ON CONFLICT (name) DO NOTHING RETURNING version`, [name, Buffer.byteLength(text), gz, by || '']);
    if (r.rows[0]) return 1;
  } else {
    const r = await pool.query(`UPDATE documents SET version = version + 1, size = $2, gz = $3, updated_at = now(), updated_by = $5 WHERE name = $1 AND version = $4 RETURNING version`, [name, Buffer.byteLength(text), gz, base, by || '']);
    if (r.rows[0]) return Number(r.rows[0].version);
  }
  const cur = (await pool.query('SELECT version FROM documents WHERE name = $1', [name])).rows[0];
  throw new Conflict(name, cur ? Number(cur.version) : 0, base);
}
/** The same with the file's bytes as they are on disk (no text conversion: big files stay light). */
async function docPutRaw(pool, name, buf, base, by) {
  const gz = await new Promise((ok, no) => zlib.gzip(buf, { level: buf.length > 4e6 ? 4 : 6 }, (e, r) => (e ? no(e) : ok(r))));
  if (!base) {
    const r = await pool.query(`INSERT INTO documents (name, version, size, gz, updated_by) VALUES ($1, 1, $2, $3, $4) ON CONFLICT (name) DO NOTHING RETURNING version`, [name, buf.length, gz, by || '']);
    if (r.rows[0]) return { version: 1, gz: gz.length };
  } else {
    const r = await pool.query(`UPDATE documents SET version = version + 1, size = $2, gz = $3, updated_at = now(), updated_by = $5 WHERE name = $1 AND version = $4 RETURNING version`, [name, buf.length, gz, base, by || '']);
    if (r.rows[0]) return { version: Number(r.rows[0].version), gz: gz.length };
  }
  const cur = (await pool.query('SELECT version FROM documents WHERE name = $1', [name])).rows[0];
  throw new Conflict(name, cur ? Number(cur.version) : 0, base);
}
/** One document's bytes → { buf, version } or null. */
async function docGetRaw(pool, name) {
  const r = (await pool.query('SELECT version, gz FROM documents WHERE name = $1', [name])).rows[0];
  if (!r) return null;
  const buf = await new Promise((ok, no) => zlib.gunzip(r.gz, (e, x) => (e ? no(e) : ok(x))));
  return { buf, version: Number(r.version) };
}
async function docDelete(pool, name) { await pool.query('DELETE FROM documents WHERE name = $1', [name]); }

// ---------- who did what ----------
async function audit(pool, actor, action, target, detail) {
  await pool.query('INSERT INTO audit_log (actor, action, target, detail) VALUES ($1,$2,$3,$4)', [String(actor || 'πρόγραμμα').slice(0, 80), String(action).slice(0, 80), String(target || '').slice(0, 200), detail == null ? null : detail]);
}
async function auditList(pool, n) { return (await pool.query('SELECT id, at, actor, action, target, detail FROM audit_log ORDER BY at DESC LIMIT $1', [n || 200])).rows; }
/** Storage used, for the screen (free plans: 500 MB). */
async function size(pool) { return Number((await pool.query('SELECT pg_database_size(current_database()) AS b')).rows[0].b); }

module.exports = { tlsMode, connect, migrate, reset, coordBackend, docList, docGet, docPut, docPutRaw, docGetRaw, docDelete, audit, auditList, size, Conflict, SCHEMA };
