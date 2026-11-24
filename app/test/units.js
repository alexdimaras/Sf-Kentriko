'use strict';
// SF Κέντρο — the parts that had no test of their own (checked 24/11): the network guard (DNS rebinding), the ads
// rules (what may be advertised), the PIN lock and the vault of passwords, the suppliers, the audit log.
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const dns = require('dns');

const APP = path.join(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sfk-units-'));
process.env.SFK_DATA = path.join(tmp, 'data');
process.env.APPDATA = path.join(tmp, 'cfg');
fs.mkdirSync(process.env.SFK_DATA, { recursive: true });
delete process.env.SFK_ALLOW_PRIVATE;
delete process.env.SFK_TREAT_PUBLIC;

let fails = 0, passes = 0;
function ok(cond, name, detail) {
  if (cond) passes++; else fails++;
  console.log((cond ? '  ok   ' : '  FAIL ') + name + (cond || detail === undefined ? '' : ' — ' + detail));
}
const section = (t) => console.log('\n' + t);

(async () => {
  const store = require(APP + '/lib/store'); store.init();

  section('Δίκτυο: η διεύθυνση που ελέγχθηκε είναι αυτή που συνδέεται (DNS rebinding)');
  const H = require(APP + '/lib/http');
  const srv = http.createServer((q, r) => r.end('SECRET of this machine'));
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port;
  // a name that says «public» when it is checked, and «this machine» when the connection is made
  const real = dns.lookup;
  let n = 0;
  dns.lookup = (host, opts, cb) => {
    if (typeof opts === 'function') { cb = opts; opts = {}; }
    if (host !== 'rebind.example') return real(host, opts, cb);
    n++;
    const addr = n === 1 ? '93.184.216.34' : '127.0.0.1';
    return opts && opts.all ? cb(null, [{ address: addr, family: 4 }]) : cb(null, addr, 4);
  };
  let err = null, body = '';
  try { const r = await H.get(`http://rebind.example:${port}/`, { retries: 0, timeout: 5000 }); body = r.text; } catch (e) { err = e; }
  dns.lookup = real;
  ok(n >= 2 && err && err.private && !/SECRET/.test(body), 'a name that answers «public» to the check and «127.0.0.1» to the connection gets nothing', JSON.stringify([n, err && err.message, body.slice(0, 20)]));
  let e2 = null; try { await H.get(`http://127.0.0.1:${port}/`, { retries: 0, timeout: 5000 }); } catch (e) { e2 = e; }
  ok(e2 && e2.private, 'an address of this machine is refused (as before)');
  srv.close();
  ok(H.privateIp('10.1.2.3') && H.privateIp('169.254.169.254') && H.privateIp('::ffff:127.0.0.1') && !H.privateIp('93.184.216.34'), 'private ranges: LAN, the cloud\'s metadata, IPv6-mapped loopback — a public one passes');

  section('Διαφημίσεις: τι επιτρέπεται σε Google / Meta');
  const ad = require(APP + '/lib/adrules');
  const ev = (name, cats, brand) => ad.evaluate({ name, brand: brand || '' }, cats ? [cats.map((c) => ({ name: c, slug: c.toLowerCase() }))] : []);
  ok(ev('ΠΙΣΤΟΛΙ GLOCK 17 GEN5', ['ΟΠΛΑ', 'ΠΙΣΤΟΛΙΑ']).level === 'banned', 'a pistol in the weapons category: banned on Google and Meta');
  ok(ev('ΟΠΛΟΚΙΒΩΤΙΟ RIEFFEL 5 ΟΠΛΩΝ', ['ΟΠΛΑ', 'ΟΠΛΟΚΙΒΩΤΙΑ']).level === 'ok', 'a gun safe, even inside the weapons category: allowed (the safe rule comes first)');
  ok(ev('ΦΥΣΙΓΓΙΑ FEDERAL 12ΒΟΛΑ', ['ΦΥΣΙΓΓΙΑ']).level === 'banned', 'ammunition: banned');
  ok(ad.rank('banned') > ad.rank('google') && ad.rank('google') > ad.rank('ok'), 'the levels in order (banned > not Google > allowed)');
  const tac = ev('ΣΑΚΙΔΙΟ 5.11 TACTICAL RUSH 12', ['ΣΑΚΙΔΙΑ'], '5.11 TACTICAL');
  ok(tac.level !== 'banned', 'the brand «5.11 TACTICAL» is not a weapon word (a backpack stays allowed)', JSON.stringify(tac));

  section('Κλείδωμα με PIN και θησαυροφυλάκιο κωδικών');
  const sec = require(APP + '/lib/security');
  let pe = null; try { sec.setPin('123456'); } catch (e) { pe = e; }
  ok(pe && /εύκολο/.test(pe.message), 'an easy PIN (123456) is refused');
  sec.setPin('7391-alpha');
  ok(sec.hasPin() && !sec.isLocked(), 'a PIN is set; the program stays open for the one who set it');
  const saved = JSON.stringify(store.read('security'));
  ok(!saved.includes('7391-alpha') && /"hash"/.test(saved), 'the PIN itself is never kept: only its slow hash');
  const blob = sec.wrap('b2b-pass-xyz');
  ok(blob !== 'b2b-pass-xyz' && sec.unwrap(blob) === 'b2b-pass-xyz', 'a supplier\'s password is sealed with the PIN and opened again');
  sec.lock();
  ok(sec.isLocked(), 'locked');
  let we = null; try { sec.unlock('wrong-pin-1'); } catch (e) { we = e; }
  ok(we && /Λάθος PIN/.test(we.message) && sec.isLocked(), 'a wrong PIN: refused, stays locked');
  ok(sec.unlock('7391-alpha') && !sec.isLocked(), 'the right PIN opens it');
  sec.removePin('7391-alpha');
  ok(!sec.hasPin(), 'the PIN can be removed (with the PIN)');

  section('Αντιπρόσωποι');
  const sup = require(APP + '/lib/suppliers');
  let se = null; try { sup.save({ name: '   ' }); } catch (e) { se = e; }
  ok(se && /υποχρεωτικό/.test(se.message), 'a supplier without a name is refused');
  const s1 = sup.save({ name: 'Αντιπρόσωπος Α', brands: 'PENTAGON, MIL-TEC ,PENTAGON', markup: '', code: 'ab-12!' }).supplier;
  ok(s1.brands.join() === 'PENTAGON,MIL-TEC' && s1.markup === 80 && s1.code === 'AB12', 'brands without doubles, the default markup 80%, a clean short code', JSON.stringify([s1.brands, s1.markup, s1.code]));
  const r2 = sup.save({ name: 'Αντιπρόσωπος Β', brands: ['PENTAGON'] });
  const s2 = r2.supplier;
  ok(r2.clashes.length === 1 && r2.clashes[0].brand === 'PENTAGON', 'the same brand at two suppliers is said when it is saved (who brings it?)', JSON.stringify(r2.clashes));
  ok(!JSON.stringify(sup.view(Object.assign({}, s2, { b2bPass: 'x' }))).includes('"b2bPass"'), 'a supplier\'s B2B password never goes back to the screen');
  const info = require(APP + '/lib/supplierinfo');
  ok(info.normPhone('+30 210 1234567') === '210 123 4567' && info.normPhone('6971234567') === '697 123 4567' && info.normPhone('12') === '', 'phone numbers: +30 taken off, grouped; a broken one is left empty');

  section('Ιστορικό ενεργειών');
  const audit = require(APP + '/lib/audit');
  const sm = audit.summary({ password: 'p', token: 't', ids: [1, 2, 3, 4, 5, 6, 7], name: 'Χ', obj: { a: 1 } });
  ok(!('password' in sm) && !('token' in sm) && sm.ids === '7 στοιχεία' && sm.name === 'Χ' && sm.obj === '…', 'what is written: no password or token, counts instead of long lists', JSON.stringify(sm));
  await audit.record('alex', 'έγκριση', 'sf:1', { n: 1 });
  const l = await audit.list(5);
  ok(Array.isArray(l) && l[0] && l[0].actor === 'alex' && l[0].action === 'έγκριση', 'who did what and when is kept');

  console.log(`\n${passes} ok, ${fails} failed`);
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) { /* ignore */ }
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
