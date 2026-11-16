// Pictures of the main screens on a phone (and one on a PC) with the real data, for looking at the design.
//   node shots.js <data folder> <folder for the pictures> [scale]
const { chromium, devices } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');
const app = path.join(__dirname, '..', '..'), data = process.argv[2], out = process.argv[3] || __dirname, scale = Number(process.argv[4]) || 1;
const port = 17800 + Math.floor(Math.random() * 90);
const env = Object.assign({}, process.env, { SFK_MODE: 'server', SFK_PORT: String(port), SFK_DATA: data, APPDATA: path.join(data, 'cfg'), SFK_NO_AUTOSYNC: '1', SFK_NO_OPEN: '1', SFK_KEEP_AWAKE: '0', SFK_ADMIN_USER: 'alex', SFK_ADMIN_PASSWORD: 'Kentro-Test-12345', SFK_SECRET_KEY: 'k'.repeat(40) });
(async () => {
  const srv = spawn(process.execPath, [path.join(app, 'server.js')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; srv.stdout.on('data', (b) => { log += b; }); srv.stderr.on('data', (b) => { log += b; });
  for (let i = 0; i < 240 && !/Ready:/.test(log); i++) await new Promise((r) => setTimeout(r, 500));
  const b = await chromium.launch();
  const B = 'http://127.0.0.1:' + port + '/';
  const errs = [];
  const run = async (name, ctxOpts, views) => {
    const ctx = await b.newContext(ctxOpts);
    const pg = await ctx.newPage();
    pg.on('pageerror', (e) => errs.push(name + ': ' + e.message));
    await pg.goto(B); await pg.waitForSelector('#lock input', { timeout: 60000 });
    const i = await pg.$$('#lock input'); await i[0].fill('alex'); await i[1].fill('Kentro-Test-12345');
    await pg.screenshot({ path: path.join(out, name + '-login.png') });
    await pg.click('#lock button[type=submit]'); await pg.waitForTimeout(1500);
    for (const v of views) {
      await pg.goto(B + '#/' + v); await pg.waitForTimeout(1600);
      const file = name + '-' + v.replace(/[^a-z0-9]+/gi, '-');
      await pg.screenshot({ path: path.join(out, file + '.png') });
      await pg.evaluate(() => window.scrollBy(0, window.innerHeight * 0.9)); await pg.waitForTimeout(300);
      await pg.screenshot({ path: path.join(out, file + '-2.png') });
    }
    if (name === 'phone') { await pg.goto(B + '#/today'); await pg.waitForTimeout(600); await pg.click('#tabbar button'); await pg.waitForTimeout(500); await pg.screenshot({ path: path.join(out, 'phone-menu.png') }); }
    await ctx.close();
  };
  await run('phone', Object.assign({}, devices['iPhone 13'], { deviceScaleFactor: scale }), ['today', 'flow', 'fixes', 'market', 'products', 'checks', 'settings']);
  await run('pc', { viewport: { width: 1366, height: 800 }, deviceScaleFactor: scale }, ['today', 'fixes', 'flow']);
  console.log('page errors:', errs.length ? errs : 'none');
  srv.kill(); await b.close(); process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
