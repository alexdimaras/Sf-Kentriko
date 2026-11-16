// The phone, for real (Playwright, iPhone 13): how fast does each screen show, is an approval instant, does the
// program open at once when it is reopened — also while the cloud program is down or waking up?
//   node phone.js <data folder> [BOX=1 to run the program inside the Render box]
const { chromium, devices } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');
const app = path.join(__dirname, '..', '..'), data = process.argv[2], port = 17900 + Math.floor(Math.random() * 90);
const boxed = process.argv.includes('BOX=1');
const env = Object.assign({}, process.env, { SFK_MODE: 'server', SFK_PORT: String(port), PORT: String(port), SFK_DATA: data, APPDATA: path.join(data, 'cfg'), SFK_NO_AUTOSYNC: '1', SFK_NO_OPEN: '1', SFK_KEEP_AWAKE: '0', SFK_ADMIN_USER: 'alex', SFK_ADMIN_PASSWORD: 'Kentro-Test-12345', SFK_SECRET_KEY: 'k'.repeat(40), NODE_OPTIONS: '--max-old-space-size=280' });
let srv, log = '';
const startServer = () => {
  log = '';
  srv = boxed ? spawn('bash', [path.join(__dirname, 'box.sh'), process.execPath, path.join(app, 'server.js')], { env, stdio: ['ignore', 'pipe', 'pipe'] }) : spawn(process.execPath, [path.join(app, 'server.js')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  srv.stdout.on('data', (b) => { log += b; }); srv.stderr.on('data', (b) => { log += b; });
};
const ready = async () => { for (let i = 0; i < 600 && !/Ready:/.test(log); i++) await new Promise((r) => setTimeout(r, 500)); };
const B = 'http://127.0.0.1:' + port + '/';
const rowSel = (cid) => '.fx-change[data-id="' + cid.replace(/"/g, '\\"') + '"]';
(async () => {
  startServer(); await ready();
  const b = await chromium.launch();
  const ctx = await b.newContext(Object.assign({}, devices['iPhone 13'], { deviceScaleFactor: 1 }));
  const pg = await ctx.newPage();
  const errs = []; pg.on('pageerror', (e) => errs.push(e.message)); pg.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|ERR_CONNECTION_REFUSED|net::ERR/.test(m.text())) errs.push(m.text()); });
  const fails = []; pg.on('response', (r) => { if (r.status() >= 400 && r.status() !== 503) fails.push(r.status() + ' ' + r.url().replace(/^https?:\/\/[^/]+/, '')); });
  const filled = () => pg.evaluate(() => { const m = document.querySelector('main'); return !!m && m.innerText.trim().length > 120; });
  const untilFilled = async (max) => { const t = Date.now(); while (Date.now() - t < (max || 120000)) { if (await filled()) return Date.now() - t; await pg.waitForTimeout(16); } return -1; };
  const line = (l, ms, extra) => console.log(l.padEnd(46), (ms < 0 ? 'ΑΔΕΙΟ' : String(ms).padStart(6) + ' ms'), extra || '');

  await pg.goto(B); await pg.waitForSelector('#lock input', { timeout: 120000 });
  const i = await pg.$$('#lock input'); await i[0].fill('alex'); await i[1].fill('Kentro-Test-12345');
  let t = Date.now(); await pg.click('#lock button[type=submit]'); await untilFilled();
  line('σύνδεση → πρώτη οθόνη', Date.now() - t);
  const tabs = ['flow', 'fixes', 'market', 'products', 'today'];
  for (const round of ['πρώτη φορά', 'ξανά']) for (const v of tabs) {
    t = Date.now();
    await pg.evaluate((x) => { document.querySelector('main').replaceChildren(); location.hash = '#/' + x; }, v);
    await pg.waitForFunction((x) => document.querySelector('main').classList.contains('view-' + x), v);
    line(v + ' (' + round + ')', await untilFilled());
    await pg.waitForTimeout(1700); // let the fresh answer arrive
  }
  // an approval: when does the change leave the list?
  await pg.evaluate(() => { location.hash = '#/fixes'; }); await pg.waitForSelector('.fx-change[data-id]', { timeout: 120000 });
  await pg.waitForTimeout(1800);
  const before = await pg.$$eval('.fx-change[data-id]', (els) => els.length);
  const id = await pg.$eval('.fx-change[data-id]', (el) => el.dataset.id);
  const badge = () => pg.$eval('.tabs button[data-k="pending"] .badge', (el) => el.textContent);
  const badge0 = await badge();
  t = Date.now();
  await pg.evaluate((sel) => { const row = document.querySelector(sel); [...row.querySelectorAll('button')].find((x) => /Έγκριση/.test(x.textContent)).click(); }, rowSel(id));
  await pg.waitForFunction((sel) => !document.querySelector(sel), rowSel(id));
  line('έγκριση → η αλλαγή φεύγει από τη λίστα', Date.now() - t, '(' + before + ' αλλαγές στη σελίδα, σήμα ' + badge0 + ' → ' + (await badge()) + ')');
  // five quick decisions in a row, then the list settles by itself
  t = Date.now();
  for (let k = 0; k < 5; k++) await pg.evaluate(() => { const row = document.querySelector('.fx-change[data-id]'); if (row) [...row.querySelectorAll('button')].find((x) => /Έγκριση|Όχι/.test(x.textContent)).click(); });
  line('5 αποφάσεις στη σειρά (όλες φαίνονται)', Date.now() - t);
  await pg.waitForTimeout(boxed ? 9000 : 3000);
  const st = await pg.evaluate(async () => App.GET('/api/fixes', { status: 'approved', per: 100 }).then((v) => v.counts.status));
  console.log('  ο διακομιστής μετά: ', JSON.stringify(st), '| στη λίστα τώρα', await pg.$$eval('.fx-change[data-id]', (els) => els.length), 'αλλαγές');
  // put them back (the test leaves the data as it found it)
  await pg.evaluate(async () => { for (const s of ['approved', 'rejected']) { const v = await App.GET('/api/fixes', { status: s, per: 100 }); const ids = v.cards.flatMap((c) => c.changes.map((x) => x.id)); if (ids.length) await App.POST('/api/fixes/decide', { ids, status: 'pending' }); } });

  // reopening the program (as from the phone's home screen)
  await pg.waitForTimeout(1500);
  const sw = await pg.evaluate(async () => !!(navigator.serviceWorker && (await navigator.serviceWorker.getRegistration())));
  await pg.goto(B + '#/today'); await pg.reload(); const open1 = await untilFilled();
  line('ξανάνοιγμα (το πρόγραμμα τρέχει)', open1, sw ? '· κέλυφος στη συσκευή: ναι' : '· κέλυφος στη συσκευή: ΟΧΙ');
  // the cloud program is down / waking: the phone still opens with the last screens
  srv.kill('SIGKILL'); await new Promise((r) => setTimeout(r, 800));
  await pg.reload({ waitUntil: 'commit' }).catch(() => {}); const open2 = await untilFilled(15000);
  const note = await pg.evaluate(() => (document.querySelector('.wakebar') || {}).textContent || '');
  line('ξανάνοιγμα με το πρόγραμμα ΚΛΕΙΣΤΟ', open2, note ? '· σημείωση: «' + note.slice(0, 60) + '…»' : '');
  await pg.evaluate(() => { location.hash = '#/fixes'; }); await pg.waitForTimeout(300);
  line('  → Διορθώσεις από τη μνήμη της συσκευής', await untilFilled(8000));
  await pg.screenshot({ path: path.join(process.env.SHOTS || __dirname, 'phone-asleep.png') });
  startServer(); t = Date.now(); await ready();
  await pg.waitForFunction(() => !document.querySelector('.wakebar:not(.prep)'), null, { timeout: 180000 }).catch(() => {});
  line('το πρόγραμμα ξύπνησε → η σημείωση έφυγε', Date.now() - t);
  await pg.waitForTimeout(2500);
  console.log('σφάλματα σελίδας:', errs.length ? errs.slice(0, 6) : 'κανένα', '| αποτυχημένες κλήσεις:', fails.length ? [...new Set(fails)].slice(0, 8) : 'καμία');
  srv.kill(); await b.close(); process.exit(0);
})().catch((e) => { console.error(e); console.log(log.slice(-1500)); try { srv.kill(); } catch (_) { /* gone */ } process.exit(1); });
