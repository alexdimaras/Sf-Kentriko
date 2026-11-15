// Phone: open the app, go away, the program stops (asleep), come back while it starts again: what does the screen do?
const { chromium, devices } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');
const app = path.join(__dirname, '..', '..'), data = process.argv[2] || process.env.SFK_DATA, port = 17991; // node wake.js <data folder with users alex / Kentro-Test-12345>
const start = () => { const c = spawn(process.execPath, ['--max-old-space-size=280', app + '/server.js'], { env: Object.assign({}, process.env, { SFK_MODE: 'server', SFK_PORT: String(port), SFK_DATA: data, APPDATA: data + '/cfg', SFK_NO_AUTOSYNC: '1', SFK_NO_OPEN: '1' }), stdio: ['ignore', 'pipe', 'pipe'] }); c.log = ''; c.stdout.on('data', (b) => { c.log += b; }); c.stderr.on('data', (b) => { c.log += b; }); return c; };
(async () => {
  let srv = start();
  await new Promise((r) => setTimeout(r, 2500));
  const b = await chromium.launch();
  const ctx = await b.newContext(Object.assign({}, devices['iPhone 13'], { deviceScaleFactor: 2 }));
  const pg = await ctx.newPage(); const errs = []; pg.on('pageerror', (e) => errs.push(e.message)); pg.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
  const base = `http://127.0.0.1:${port}/`;
  let t = Date.now();
  await pg.goto(base); await pg.waitForSelector('#lock input', { timeout: 60000 });
  const i = await pg.$$('#lock input'); await i[0].fill('alex'); await i[1].fill('Kentro-Test-12345');
  const rem = await pg.$('#lock input[type=checkbox]'); if (rem) await rem.check();
  await pg.click('#lock button[type=submit]');
  await pg.waitForSelector('main .task, main .panel', { timeout: 120000 });
  console.log('first open + login to a full Today screen:', ((Date.now() - t) / 1000).toFixed(1), 's');
  // "leave the app": the program goes to sleep
  srv.kill('SIGTERM'); await new Promise((r) => setTimeout(r, 1500));
  // "come back": the phone shows the page again → catch up, while the program is still asleep
  t = Date.now();
  await pg.evaluate(() => { App.live.lastCatch = 0; App.live.catchUp(); App.go('fixes'); });
  await pg.waitForTimeout(4000);
  const bar = await pg.evaluate(() => (document.querySelector('.wakebar') || {}).textContent || '');
  await pg.screenshot({ path: __dirname + '/wake-1.png' });
  console.log('while asleep the screen says:', JSON.stringify(bar));
  srv = start(); // Render wakes it up
  await pg.waitForFunction(() => !document.querySelector('.wakebar') && document.querySelector('main .fx-card, main .panel, main .note'), null, { timeout: 180000 });
  console.log('back with the screen filled in', ((Date.now() - t) / 1000).toFixed(1), 's after coming back; errors on screen:', await pg.evaluate(() => [...document.querySelectorAll('main .note.crit')].map((e) => e.textContent).join(' | ') || 'none'));
  await pg.waitForTimeout(8000);
  await pg.screenshot({ path: __dirname + '/wake-2.png' });
  console.log('main after 8 s more:', JSON.stringify(await pg.evaluate(() => document.querySelector('main').innerText.replace(/\s+/g, ' ').slice(0, 160))), '| mains in page:', await pg.evaluate(() => document.querySelectorAll('main').length));
  console.log('page errors:', errs.length ? errs : 'none', '| server:', (srv.log.match(/Ready[^\n]*/) || [''])[0]);
  srv.kill(); await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
