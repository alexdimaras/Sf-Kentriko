// Every main screen with the real data, on a phone: how long until it is filled, and any error.
const { chromium, devices } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');
const app = path.join(__dirname, '..', '..'), data = process.argv[2] || process.env.SFK_DATA, port = 17992; // node screens.js <data folder>
(async () => {
  const srv = spawn(process.execPath, ['--max-old-space-size=280', app + '/server.js'], { env: Object.assign({}, process.env, { SFK_MODE: 'server', SFK_PORT: String(port), SFK_DATA: data, APPDATA: data + '/cfg', SFK_NO_AUTOSYNC: '1', SFK_NO_OPEN: '1' }), stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; srv.stdout.on('data', (b) => { log += b; }); srv.stderr.on('data', (b) => { log += b; });
  await new Promise((r) => setTimeout(r, 2500));
  const b = await chromium.launch();
  const pg = await (await b.newContext(Object.assign({}, devices['iPhone 13'], { deviceScaleFactor: 1 }))).newPage();
  const errs = []; pg.on('pageerror', (e) => errs.push(e.message)); pg.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  const fails = []; pg.on('response', (r) => { if (r.status() >= 400) fails.push(r.status() + ' ' + r.url().replace(/^https?:\/\/[^/]+/, '')); });
  const base = `http://127.0.0.1:${port}/`;
  await pg.goto(base); await pg.waitForSelector('#lock input', { timeout: 60000 });
  const i = await pg.$$('#lock input'); await i[0].fill('alex'); await i[1].fill('Kentro-Test-12345');
  await pg.click('#lock button[type=submit]'); await pg.waitForTimeout(3000);
  for (const hash of ['#/today', '#/flow', '#/fixes', '#/market', '#/products', '#/checks', '#/suppliers', '#/new', '#/settings?tab=data']) {
    const t = Date.now();
    await pg.goto(base + hash);
    let filled = false;
    for (let k = 0; k < 120 && !filled; k++) { await pg.waitForTimeout(250); filled = await pg.evaluate(() => { const m = document.querySelector('main'); return !!m && m.innerText.trim().length > 200; }); }
    const txt = await pg.evaluate(() => document.querySelector('main').innerText.replace(/\s+/g, ' ').slice(0, 90));
    console.log((filled ? 'OK  ' : 'EMPTY ') + hash.padEnd(22), ((Date.now() - t) / 1000).toFixed(1) + 's', '|', txt);
    if (!filled) await pg.screenshot({ path: __dirname + '/empty-' + hash.replace(/[^a-z]/g, '') + '.png' });
  }
  console.log('page errors:', errs.length ? errs.slice(0, 5) : 'none', '| failed calls:', fails.length ? fails.slice(0, 8) : 'none');
  srv.kill(); await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
