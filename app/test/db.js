'use strict';
// the little shops of the tests run on this machine: the program may open private addresses here (never in use)
process.env.SFK_ALLOW_PRIVATE = '1';
// SF Κέντρο — the shared database (lib/db.js): versions of documents, no lost writes. Needs COORD_PG=postgres://…
// (skipped without it: npm test runs it only where a PostgreSQL is there).
const path = require('path');
const APP = path.join(__dirname, '..');
let fails = 0, passes = 0;
const ok = (c, n, d) => { if (c) passes++; else fails++; console.log((c ? '  ok   ' : '  FAIL ') + n + (c || d === undefined ? '' : ' — ' + d)); };
(async () => {
  if (!process.env.COORD_PG) { console.log('\nΒάση δεδομένων: παραλείπεται (δεν υπάρχει COORD_PG)\n\n0 ok, 0 failed'); return; }
  console.log('\nΒάση δεδομένων: εκδόσεις, καμία χαμένη εγγραφή');
  const db = require(APP + '/lib/db');
  const pool = await db.connect(process.env.COORD_PG);
  await db.docDelete(pool, 'test-doc.json');
  const v1 = await db.docPut(pool, 'test-doc.json', '{"a":1}', 0, 'alex');
  ok(v1 === 1, 'a new document starts at version 1');
  let err = null; try { await db.docPut(pool, 'test-doc.json', '{"a":9}', 0, 'maria'); } catch (e) { err = e; }
  ok(err && err.conflict, 'a second «new» with the same name is refused (no silent overwrite)');
  const v2 = await db.docPut(pool, 'test-doc.json', '{"a":2}', 1, 'alex');
  ok(v2 === 2, 'a change made from version 1 becomes version 2');
  err = null; try { await db.docPut(pool, 'test-doc.json', '{"a":3}', 1, 'maria'); } catch (e) { err = e; }
  ok(err && err.conflict && err.have === 2 && /άλλαξε στο μεταξύ/.test(err.message), 'a change made from an older version is refused: the newer one is not lost', err && err.message);
  const got = await db.docGet(pool, 'test-doc.json');
  ok(got.text === '{"a":2}' && got.version === 2, 'what is kept is the newer change');
  const big = Buffer.from(JSON.stringify({ products: Array.from({ length: 20000 }, (_, i) => ({ id: i, name: 'ΠΡΟΪΟΝ ' + i, desc: 'κείμενο '.repeat(20) })) }));
  const r = await db.docPutRaw(pool, 'test-big.json', big, 0, 'test');
  const back = await db.docGetRaw(pool, 'test-big.json');
  ok(back.buf.equals(big) && r.gz < big.length / 5, `a big file goes in compressed and comes back the same (${Math.round(big.length / 1e6)} MB → ${Math.round(r.gz / 1e3)} KB)`);
  await db.docDelete(pool, 'test-doc.json'); await db.docDelete(pool, 'test-big.json');
  await db.audit(pool, 'alex', 'δοκιμή', 'x', { n: 1 });
  ok((await db.auditList(pool, 5)).some((a) => a.action === 'δοκιμή'), 'the audit log keeps actions');
  ok((await db.size(pool)) > 0, 'the size of the database can be shown (free plan: 500 MB)');
  await pool.end();
  console.log(`\n${passes} ok, ${fails} failed`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
