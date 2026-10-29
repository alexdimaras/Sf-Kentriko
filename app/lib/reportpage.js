'use strict';
// The interactive report page: one HTML file, shown in a Chrome tab (served by the program) or opened
// from the folder. Product cards with photos like a shop, or a table; filters, search, sorting,
// details panel, selection, copy, CSV, print. All text is escaped; scripts carry a nonce.
const U = require('./util');

const CSS = `
:root{--bg:#eef0ea;--surface:#fff;--surface2:#f6f7f3;--ink:#1c221d;--muted:#667064;--line:#dde1d6;--accent:#33422e;--accent2:#a8712f;--accent-ink:#fff;
--ok:#2f6f3c;--ok-bg:#e1efe3;--warn:#9a5b00;--warn-bg:#fbefd9;--crit:#a32020;--crit-bg:#f9e1df;--mid:#6c4f8f;--mid-bg:#efe8f6;--info:#245a8c;--info-bg:#e2edf7;--low:#5d6259;--low-bg:#ecedea;
--shadow:0 1px 0 rgba(28,34,29,.04),0 10px 28px -16px rgba(28,34,29,.35)}
@media (prefers-color-scheme:dark){:root{--bg:#121511;--surface:#1b1f19;--surface2:#222720;--ink:#e6e9e1;--muted:#a0a796;--line:#30362d;--accent:#9db37f;--accent2:#d39a55;--accent-ink:#121511;
--ok:#8fd19a;--ok-bg:#1f3323;--warn:#f0b65a;--warn-bg:#3a2c12;--crit:#f29a92;--crit-bg:#3d1c1a;--mid:#c7a9ee;--mid-bg:#2e243b;--info:#9cc4ef;--info-bg:#1b2a3a;--low:#b4b7ad;--low-bg:#272a24;--shadow:0 12px 30px -16px rgba(0,0,0,.7)}}
*{box-sizing:border-box}html,body{margin:0}body{background:var(--bg);color:var(--ink);font:14px/1.45 "Segoe UI",system-ui,-apple-system,Roboto,Arial,sans-serif}
a{color:var(--info)}button{font:inherit;color:inherit}
.top{background:var(--accent);color:#eef2e8;padding:18px 28px 16px}.top .mark{font-size:12px;letter-spacing:.12em;text-transform:uppercase;opacity:.75}
.top h1{margin:4px 0 2px;font-size:24px;font-weight:700;letter-spacing:.2px}.top .sub{opacity:.85}.top .help{opacity:.75;margin-top:6px;max-width:1000px;font-size:13px}
.kpis{display:flex;gap:10px;flex-wrap:wrap;padding:14px 28px 0}.kpi{background:var(--surface);border:1px solid var(--line);border-radius:14px;padding:10px 16px;min-width:170px;cursor:pointer;text-align:left;box-shadow:var(--shadow)}
.kpi b{display:block;font-size:22px;line-height:1.2}.kpi span{color:var(--muted);font-size:12.5px}.kpi.on{outline:2px solid var(--accent2)}
.bar{position:sticky;top:0;z-index:20;background:color-mix(in srgb,var(--bg) 92%,transparent);backdrop-filter:blur(6px);padding:12px 28px;display:flex;gap:8px;flex-wrap:wrap;align-items:center;border-bottom:1px solid var(--line)}
.bar input[type=search]{flex:1 1 280px;min-width:200px;padding:10px 14px;border:1px solid var(--line);border-radius:11px;background:var(--surface);color:var(--ink);font:inherit}
.bar select{padding:9px 10px;border:1px solid var(--line);border-radius:10px;background:var(--surface);color:var(--ink);font:inherit}
.btn{border:1px solid var(--line);background:var(--surface);border-radius:10px;padding:9px 13px;cursor:pointer;white-space:nowrap}.btn:hover{border-color:var(--accent2);color:var(--accent2)}
.btn.primary{background:var(--accent2);border-color:var(--accent2);color:#fff}.btn.primary:hover{color:#fff;filter:brightness(1.05)}
.seg{display:inline-flex;border:1px solid var(--line);border-radius:10px;overflow:hidden;background:var(--surface)}.seg button{border:0;background:none;padding:9px 12px;cursor:pointer}.seg button.on{background:var(--accent);color:var(--accent-ink)}
.count{color:var(--muted);margin-left:auto;white-space:nowrap}
.facets{padding:10px 28px 0;display:flex;flex-direction:column;gap:7px}.facet{display:flex;gap:6px;flex-wrap:wrap;align-items:center}.facet>em{font-style:normal;color:var(--muted);font-size:12px;min-width:96px}.ffind{font:inherit;font-size:12.5px;padding:5px 10px;border:1px solid var(--line);border-radius:999px;background:var(--surface);color:inherit;width:170px}
.chip{border:1px solid var(--line);background:var(--surface);border-radius:999px;padding:4px 11px;font-size:12.5px;cursor:pointer}.chip.on{background:var(--accent);color:var(--accent-ink);border-color:var(--accent)}.chip i{font-style:normal;opacity:.65;margin-left:5px}
.chip.more{border-style:dashed}
main{padding:16px 28px 60px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:16px}
.pc{position:relative;background:var(--surface);border:1px solid var(--line);border-radius:16px;overflow:hidden;display:flex;flex-direction:column;box-shadow:var(--shadow);transition:transform .12s,border-color .12s}
.pc:hover{transform:translateY(-2px);border-color:var(--accent2)}.pc.sel{outline:2px solid var(--accent2)}
.pc .ph{aspect-ratio:1/1;background:#fff;display:grid;place-items:center;cursor:zoom-in;border-bottom:1px solid var(--line)}
.pc .ph img{width:100%;height:100%;object-fit:contain;padding:10px}.pc .ph .none{color:#b9bdb2;font-size:30px;font-weight:700}
.pc .badges{position:absolute;top:10px;left:10px;right:44px;display:flex;flex-wrap:wrap;gap:4px}
.pc .ck{position:absolute;top:8px;right:8px;background:var(--surface);border:1px solid var(--line);border-radius:8px;width:28px;height:28px;display:grid;place-items:center}
.pc .ck input{width:16px;height:16px;margin:0;cursor:pointer}
.pc .pb{padding:12px 14px 6px;display:flex;flex-direction:column;gap:5px;flex:1;cursor:pointer}
.pc .br{font-size:11.5px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pc h3{margin:0;font-size:14px;line-height:1.35;font-weight:650;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.pc .pr{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;margin-top:auto;padding-top:4px}.pc .pr b{font-size:19px}.pc .pr small{color:var(--muted)}
.pc .pr .p2{color:var(--accent2);font-weight:700}
.pc .note{font-size:12.5px;color:var(--muted);display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.pc .fix{font-size:12.5px;color:var(--ok);background:var(--ok-bg);border-radius:8px;padding:5px 8px}
.pc .pf{display:flex;justify-content:space-between;align-items:center;padding:8px 14px 12px;gap:6px}
.pc .pf a{font-size:13px;text-decoration:none;font-weight:600}.pc .pf a:hover{text-decoration:underline}
.pill{display:inline-block;border-radius:999px;padding:2px 9px;font-size:11.5px;font-weight:650;white-space:nowrap}
.ok{color:var(--ok);background:var(--ok-bg)}.warn{color:var(--warn);background:var(--warn-bg)}.crit{color:var(--crit);background:var(--crit-bg)}.mid{color:var(--mid);background:var(--mid-bg)}.info{color:var(--info);background:var(--info-bg)}.low{color:var(--low);background:var(--low-bg)}
.range{position:relative;height:16px;margin:4px 0 2px}.range .tr{position:absolute;top:7px;left:0;right:0;height:2px;background:var(--line)}.range .sp{position:absolute;top:5px;height:6px;border-radius:3px;background:var(--muted);opacity:.45}
.range .md{position:absolute;top:2px;width:2px;height:12px;background:var(--ink)}.range .us{position:absolute;top:1px;width:14px;height:14px;margin-left:-7px;border-radius:50%;background:var(--accent2);border:2px solid var(--surface)}
.wrap{overflow-x:auto;background:var(--surface);border:1px solid var(--line);border-radius:14px;box-shadow:var(--shadow)}
table{border-collapse:collapse;width:100%}th,td{padding:8px 10px;border-bottom:1px solid var(--line);text-align:left;vertical-align:middle}
th{position:sticky;top:0;background:var(--surface2);font-size:12px;color:var(--muted);font-weight:650;cursor:pointer;white-space:nowrap;user-select:none}th.sorted{color:var(--ink)}
td.n,th.n{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}td.code{font-family:Consolas,ui-monospace,monospace;font-size:12.5px;white-space:nowrap}td.wide{min-width:280px}
tr.row{cursor:pointer}tr.row:hover td{background:var(--surface2)}tr.sel td{background:var(--info-bg)!important}td.strong{font-weight:700}
.thumb{width:46px;height:46px;border-radius:9px;object-fit:contain;background:#fff;border:1px solid var(--line);display:block}
a.nm{color:var(--ink);text-decoration:none;font-weight:600}a.nm:hover{text-decoration:underline}
.up{color:var(--crit)}.down{color:var(--ok)}
.more{display:block;margin:22px auto 0}.empty{padding:50px;text-align:center;color:var(--muted)}
.shade{position:fixed;inset:0;background:rgba(10,14,10,.45);z-index:40;display:none}.shade.on{display:block}
.panel{position:fixed;top:0;right:0;bottom:0;width:min(720px,100vw);background:var(--surface);z-index:50;transform:translateX(105%);transition:transform .18s;overflow:auto;box-shadow:-20px 0 40px -20px rgba(0,0,0,.4)}
.panel.on{transform:none}.panel .ph{background:#fff;display:grid;place-items:center;height:min(48vh,420px);border-bottom:1px solid var(--line)}.panel .ph img{max-width:100%;max-height:100%;object-fit:contain;padding:14px}
.panel .in{padding:18px 22px 40px}.panel h2{margin:0 0 6px;font-size:19px}.panel .x{position:sticky;top:10px;float:right;margin:10px;z-index:2}
.kv{display:grid;grid-template-columns:170px 1fr;gap:6px 14px;margin:14px 0;font-size:13.5px}.kv dt{color:var(--muted)}.kv dd{margin:0}
.panel table{font-size:13px}.acts{display:flex;gap:8px;flex-wrap:wrap;margin:10px 0}
.lb{position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:60;display:none;place-items:center;cursor:zoom-out}.lb.on{display:grid}.lb img{max-width:94vw;max-height:94vh;object-fit:contain;background:#fff;border-radius:10px}
footer{color:var(--muted);font-size:12px;padding:0 28px 30px}
@media print{.bar,.facets,.ck,.more,.panel,.shade,.kpis{display:none!important}.pc{break-inside:avoid;box-shadow:none}th{position:static}body{background:#fff}.top{background:#fff;color:#000}}
@media (max-width:700px){.top,.bar,.facets,main,.kpis{padding-left:12px;padding-right:12px}.grid{grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:10px}.kv{grid-template-columns:1fr}}
`;

/* eslint-disable */
// Runs in the browser. Kept as a real function so the code is checked like the rest of the program.
function client(D) {
  var R = D.rep, P = D.pills;
  var $ = function (id) { return document.getElementById(id); };
  var fold = function (s) { return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase(); };
  var nf = new Intl.NumberFormat('el-GR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  var money = function (v) { return v == null || v === '' || isNaN(v) ? '' : nf.format(v) + ' €'; };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var safeUrl = function (u) { u = String(u || ''); return /^https?:\/\//i.test(u) ? u : ''; };
  var pillOf = function (map, v) { var x = P[map] && P[map][String(v)]; return x ? '<span class="pill ' + x[1] + '">' + esc(x[0]) + '</span>' : ''; };
  var pillTxt = function (map, v) { var x = P[map] && P[map][String(v)]; return x ? x[0] : (v == null ? '' : String(v)); };
  var cols = R.columns.filter(function (c) { return c.type !== 'img' || R.rows.some(function (r) { return r.img; }); });
  var colByKey = {}; R.columns.forEach(function (c) { colByKey[c.key] = c; });
  var num = function (c) { return ['money', 'diff', 'pct', 'pctv', 'num'].indexOf(c.type) >= 0; };
  function cell(c, r) {
    var v = r[c.key];
    switch (c.type) {
      case 'img': return safeUrl(v) ? '<img class="thumb" loading="lazy" referrerpolicy="no-referrer" src="' + esc(v) + '" alt="">' : '';
      case 'name': return safeUrl(r.url) ? '<a class="nm" target="_blank" rel="noopener noreferrer" href="' + esc(r.url) + '">' + esc(v) + '</a>' : '<b>' + esc(v) + '</b>';
      case 'link': return safeUrl(v) ? '<a target="_blank" rel="noopener noreferrer" href="' + esc(v) + '">άνοιγμα</a>' : '';
      case 'money': return money(v);
      case 'diff': return v == null ? '' : '<span class="' + (v > 0 ? 'up' : v < 0 ? 'down' : '') + '">' + (v > 0 ? '+' : '') + money(v) + '</span>';
      case 'pct': return v == null ? '' : '<span class="' + (v > 0.05 ? 'up' : v < -0.05 ? 'down' : '') + '">' + (v > 0 ? '+' : '') + Math.round(v * 100) + '%</span>';
      case 'pctv': return v == null ? '' : Math.round(v) + '%';
      case 'num': return v == null ? '' : Number(v).toLocaleString('el-GR');
      case 'pill': return pillOf(c.map, v);
      case 'date': return v ? new Date(v).toLocaleString('el-GR') : '';
      default: return esc(v);
    }
  }
  function txt(c, r) {
    var v = r[c.key];
    if (c.type === 'pill') return pillTxt(c.map, v);
    if (c.type === 'money' || c.type === 'diff') return v == null ? '' : nf.format(v);
    if (c.type === 'pct') return v == null ? '' : Math.round(v * 100) + '%';
    if (c.type === 'date') return v ? new Date(v).toLocaleString('el-GR') : '';
    if (c.type === 'img') return '';
    return v == null ? '' : String(v);
  }
  document.title = R.title;
  $('t').textContent = R.title; $('s').textContent = R.subtitle || ''; $('h').textContent = R.help || '';
  $('ft').textContent = 'Δημιουργήθηκε ' + new Date(R.generated).toLocaleString('el-GR') + ' · SF Κέντρο';
  var hay = R.rows.map(function (r) { return fold(cols.map(function (c) { return txt(c, r); }).join(' ') + ' ' + (r.detail ? r.detail.map(function (d) { return (d.shop || '') + ' ' + (d.name || ''); }).join(' ') : '')); });
  var store = { get: function (k) { try { return localStorage.getItem('sfk-rep-' + k); } catch (e) { return null; } }, set: function (k, v) { try { localStorage.setItem('sfk-rep-' + k, v); } catch (e) { /* private mode */ } } };
  var state = { q: '', f: {}, sort: '', dir: 1, shown: 120, sel: new Set(), view: R.card ? (store.get('view-' + (R.kind || '')) || 'cards') : 'table' };
  // ----- summary cards -----
  (R.summary || []).forEach(function (s, i) {
    var b = document.createElement('button'); b.className = 'kpi'; b.type = 'button';
    b.innerHTML = '<b class="' + s.tone + '" style="background:none">' + Number(s.value || 0).toLocaleString('el-GR') + '</b><span>' + esc(s.label) + '</span>';
    if (s.filter) b.onclick = function () { var set = state.f[s.filter.key]; var on = set && set.size === 1 && set.has(s.filter.value); state.f[s.filter.key] = new Set(on ? [] : [s.filter.value]); syncChips(); state.shown = 120; draw(); document.querySelectorAll('.kpi').forEach(function (k) { k.classList.remove('on'); }); if (!on) b.classList.add('on'); };
    $('kpis').appendChild(b);
  });
  // ----- filters (chips) -----
  var valuesOf = function (c, r) { var t = txt(c, r); if (c.facetSplit) return t ? t.split(/\s*,\s*/) : ['—']; return [t || '—']; };
  var fcols = R.columns.filter(function (c) { return c.facet || c.facetSplit; });
  fcols.forEach(function (c) {
    var counts = {};
    R.rows.forEach(function (r) { valuesOf(c, r).forEach(function (k) { counts[k] = (counts[k] || 0) + 1; }); });
    var keys = Object.keys(counts);
    if (keys.length < 2 || (!c.facetSplit && keys.length > 80)) return;
    if (c.type === 'pill' && P[c.map]) { var ord = Object.keys(P[c.map]).map(function (k) { return P[c.map][k][0]; }); keys.sort(function (a, b) { var x = ord.indexOf(a), y = ord.indexOf(b); return (x < 0 ? 99 : x) - (y < 0 ? 99 : y); }); }
    else keys.sort(function (a, b) { return counts[b] - counts[a]; });
    var box = document.createElement('div'); box.className = 'facet'; box.innerHTML = '<em>' + esc(c.label) + '</em>';
    var LIMIT = 14;
    keys.forEach(function (k, i) {
      var ch = document.createElement('button'); ch.type = 'button'; ch.className = 'chip'; ch.dataset.k = c.key; ch.dataset.v = k;
      ch.innerHTML = (k === '—' ? '(κενό)' : esc(k)) + '<i>' + counts[k] + '</i>';
      if (i >= LIMIT) ch.style.display = 'none';
      ch.onclick = function () { var s = state.f[c.key] || (state.f[c.key] = new Set()); if (s.has(k)) s.delete(k); else s.add(k); ch.classList.toggle('on'); state.shown = 120; draw(); };
      box.appendChild(ch);
    });
    if (keys.length > 40) {
      var fi = document.createElement('input'); fi.type = 'search'; fi.className = 'ffind'; fi.placeholder = 'βρες ' + c.label.toLowerCase() + '…'; fi.setAttribute('aria-label', 'Αναζήτηση σε ' + c.label);
      fi.oninput = function () { var q = fold(fi.value); var shown = 0; box.querySelectorAll('.chip[data-v]').forEach(function (x) { var ok = q ? fold(x.dataset.v).indexOf(q) >= 0 : shown < LIMIT; x.style.display = ok ? '' : 'none'; if (ok) shown++; }); var mm = box.querySelector('.chip.more'); if (mm) mm.style.display = q ? 'none' : ''; };
      box.insertBefore(fi, box.children[1]);
    }
    if (keys.length > LIMIT) { var m = document.createElement('button'); m.type = 'button'; m.className = 'chip more'; m.textContent = '+' + (keys.length - LIMIT) + ' ακόμα'; m.onclick = function () { box.querySelectorAll('.chip').forEach(function (x) { x.style.display = ''; }); m.remove(); }; box.appendChild(m); }
    $('facets').appendChild(box);
  });
  function syncChips() { document.querySelectorAll('.chip[data-k]').forEach(function (ch) { var s = state.f[ch.dataset.k]; ch.classList.toggle('on', !!(s && s.has(ch.dataset.v))); }); }
  // ----- sort & view controls -----
  var sortSel = $('sort');
  sortSel.innerHTML = '<option value="">Σειρά: προεπιλογή</option>' + cols.filter(function (c) { return c.type !== 'img'; }).map(function (c) { return '<option value="' + esc(c.key) + ':1">' + esc(c.label) + (num(c) ? ' ↑' : ' Α→Ω') + '</option><option value="' + esc(c.key) + ':-1">' + esc(c.label) + (num(c) ? ' ↓' : ' Ω→Α') + '</option>'; }).join('');
  sortSel.onchange = function () { var v = sortSel.value.split(':'); state.sort = v[0] || ''; state.dir = Number(v[1] || 1); state.shown = 120; draw(); };
  if (R.card) {
    $('view').innerHTML = '<button type="button" data-v="cards">Κάρτες</button><button type="button" data-v="table">Πίνακας</button>';
    $('view').onclick = function (e) { var b = e.target.closest('button'); if (!b) return; state.view = b.dataset.v; store.set('view-' + (R.kind || ''), state.view); state.shown = 120; draw(); };
  } else $('view').style.display = 'none';
  // ----- filtering -----
  function visible() {
    var q = fold(state.q).split(/\s+/).filter(Boolean), out = [];
    for (var i = 0; i < R.rows.length; i++) {
      var ok = true;
      for (var j = 0; j < q.length; j++) if (hay[i].indexOf(q[j]) < 0) { ok = false; break; }
      if (!ok) continue;
      for (var k in state.f) {
        var s = state.f[k]; if (!s || !s.size) continue;
        var vals = valuesOf(colByKey[k], R.rows[i]);
        if (!vals.some(function (v) { return s.has(v); })) { ok = false; break; }
      }
      if (ok) out.push(i);
    }
    if (state.sort) {
      var c = colByKey[state.sort], d = state.dir;
      out.sort(function (a, b) {
        var x = R.rows[a][c.key], y = R.rows[b][c.key];
        if (num(c)) { x = x == null ? -Infinity : +x; y = y == null ? -Infinity : +y; return (x - y) * d; }
        return String(txt(c, R.rows[a])).localeCompare(String(txt(c, R.rows[b])), 'el') * d;
      });
    }
    return out;
  }
  // ----- cards -----
  function rangeBar(r) {
    if (!r.median || !r.ourPrice) return '';
    var lo = Math.min(r.min, r.ourPrice) * 0.97, hi = Math.max(r.max, r.ourPrice) * 1.03, pos = function (v) { return ((v - lo) / (hi - lo || 1) * 100).toFixed(1) + '%'; };
    return '<div class="range" title="Φθηνότερη ' + money(r.min) + ' · μέση ' + money(r.median) + ' · ακριβότερη ' + money(r.max) + '"><div class="tr"></div><div class="sp" style="left:' + pos(r.min) + ';width:calc(' + pos(r.max) + ' - ' + pos(r.min) + ')"></div><div class="md" style="left:' + pos(r.median) + '"></div><div class="us" style="left:' + pos(r.ourPrice) + '"></div></div>';
  }
  function card(i) {
    var r = R.rows[i], C = R.card;
    var img = safeUrl(r[C.img]);
    var badges = (C.badges || []).map(function (k) { var c = colByKey[k]; return c && r[k] !== '' && r[k] != null && !(c.map === 'ads' && r[k] === 'ok') ? pillOf(c.map, r[k]) : ''; }).join('');
    var sub = (C.sub || []).map(function (k) { return r[k]; }).filter(Boolean).map(esc).join(' · ');
    var pr = r[C.price] != null && r[C.price] !== '' ? '<div><small>' + esc(C.priceLabel || '') + '</small> <b>' + money(r[C.price]) + '</b></div>' : '';
    var p2 = C.price2 && r[C.price2] ? '<div><small>' + esc(C.price2Label || '') + '</small> <b class="p2">' + money(r[C.price2]) + '</b></div>' : '';
    var note = C.note && r[C.note] ? '<div class="note">' + esc((C.noteLabel || '') + r[C.note]) + '</div>' : '';
    var fix = C.fix && r[C.fix] ? '<div class="fix">→ ' + esc(r[C.fix]) + '</div>' : '';
    var url = safeUrl(r.url);
    return '<article class="pc' + (state.sel.has(i) ? ' sel' : '') + '" data-i="' + i + '">' +
      '<div class="ph" data-zoom="' + i + '">' + (img ? '<img loading="lazy" referrerpolicy="no-referrer" src="' + esc(img) + '" alt="">' : '<div class="none">—</div>') + '</div>' +
      '<div class="badges">' + badges + '</div>' +
      '<label class="ck" title="Επιλογή"><input type="checkbox" ' + (state.sel.has(i) ? 'checked' : '') + '></label>' +
      '<div class="pb" data-open="' + i + '">' + (sub ? '<div class="br">' + sub + '</div>' : '') + '<h3>' + esc(r[C.title]) + '</h3>' + note + fix + (C.range ? rangeBar(r) : '') + '<div class="pr">' + pr + p2 + '</div></div>' +
      '<div class="pf">' + (url ? '<a target="_blank" rel="noopener noreferrer" href="' + esc(url) + '">Στο site ↗</a>' : '<span></span>') + (r.detail ? '<span class="pill low">' + r.detail.length + ' ' + esc(R.detail.label) + '</span>' : '') + '</div></article>';
  }
  // ----- table -----
  function table(v) {
    var span = cols.length + 1;
    var head = '<tr><th style="width:28px"><input type="checkbox" id="ckall"></th>' + cols.map(function (c) { return '<th data-k="' + esc(c.key) + '" class="' + (num(c) ? 'n' : '') + (state.sort === c.key ? ' sorted' : '') + '">' + esc(c.label) + (state.sort === c.key ? (state.dir > 0 ? ' ▲' : ' ▼') : '') + '</th>'; }).join('') + '</tr>';
    var body = v.slice(0, state.shown).map(function (i) {
      var r = R.rows[i];
      return '<tr class="row' + (state.sel.has(i) ? ' sel' : '') + '" data-open="' + i + '"><td><input type="checkbox" data-i="' + i + '" ' + (state.sel.has(i) ? 'checked' : '') + '></td>' + cols.map(function (c) { return '<td class="' + (num(c) ? 'n' : '') + (c.type === 'code' ? ' code' : '') + (c.strong ? ' strong' : '') + (c.type === 'name' || (c.width || 0) >= 40 ? ' wide' : '') + '">' + cell(c, r) + '</td>'; }).join('') + '</tr>';
    }).join('');
    return '<div class="wrap"><table><thead>' + head + '</thead><tbody>' + (body || '<tr><td class="empty" colspan="' + span + '">Δεν βρέθηκε τίποτα</td></tr>') + '</tbody></table></div>';
  }
  function draw() {
    var v = visible();
    $('cnt').textContent = v.length.toLocaleString('el-GR') + ' από ' + R.rows.length.toLocaleString('el-GR') + (state.sel.size ? ' · ' + state.sel.size + ' επιλεγμένα' : '');
    $('view').querySelectorAll('button').forEach(function (b) { b.classList.toggle('on', b.dataset.v === state.view); });
    var out = $('out');
    if (!v.length) out.innerHTML = '<div class="empty">Δεν βρέθηκε τίποτα με αυτά τα φίλτρα.</div>';
    else if (state.view === 'cards' && R.card) out.innerHTML = '<div class="grid">' + v.slice(0, state.shown).map(card).join('') + '</div>';
    else out.innerHTML = table(v);
    var more = $('more');
    more.style.display = v.length > state.shown ? '' : 'none';
    more.textContent = 'Δείξε περισσότερα (' + (v.length - state.shown).toLocaleString('el-GR') + ' ακόμα)';
    var ca = $('ckall'); if (ca) { ca.checked = v.length > 0 && v.every(function (i) { return state.sel.has(i); }); ca.onchange = function () { v.forEach(function (i) { if (ca.checked) state.sel.add(i); else state.sel.delete(i); }); draw(); }; }
    out.querySelectorAll('th[data-k]').forEach(function (th) { th.onclick = function () { var k = th.dataset.k; if (state.sort === k) state.dir = -state.dir; else { state.sort = k; state.dir = num(colByKey[k]) ? -1 : 1; } sortSel.value = state.sort + ':' + state.dir; draw(); }; });
  }
  // ----- details panel -----
  function openPanel(i) {
    var r = R.rows[i], C = R.card || {};
    var img = safeUrl(r[C.full] || r[C.img] || r.img);
    var url = safeUrl(r.url);
    var kv = cols.filter(function (c) { return c.type !== 'img' && c.type !== 'name' && txt(c, r) !== ''; }).map(function (c) { return '<dt>' + esc(c.label) + '</dt><dd>' + cell(c, r) + '</dd>'; }).join('');
    var det = '';
    if (R.detail && r.detail) {
      var dc = R.detail.columns.filter(function (c) { return c.type !== 'img' || r.detail.some(function (x) { return x.img; }); });
      det = '<h3>' + esc(R.detail.label) + ' (' + r.detail.length + ')</h3><div class="wrap"><table><thead><tr>' + dc.map(function (c) { return '<th class="' + (num(c) ? 'n' : '') + '">' + esc(c.label) + '</th>'; }).join('') + '</tr></thead><tbody>' +
        (r.detail.length ? r.detail.map(function (x) { return '<tr>' + dc.map(function (c) { return '<td class="' + (num(c) ? 'n' : '') + (c.type === 'code' ? ' code' : '') + '">' + cell(c, x) + '</td>'; }).join('') + '</tr>'; }).join('') : '<tr><td class="empty" colspan="' + dc.length + '">Καμία εγγραφή</td></tr>') + '</tbody></table></div>';
    }
    var titleKey = C.title || (cols.find(function (c) { return c.type === 'name'; }) || cols.find(function (c) { return c.type === 'text'; }) || {}).key;
    $('panel').innerHTML = '<button class="btn x" type="button" id="px">Κλείσιμο ✕</button>' + (img ? '<div class="ph"><img referrerpolicy="no-referrer" src="' + esc(img) + '" alt=""></div>' : '') +
      '<div class="in"><h2>' + esc(r[titleKey]) + '</h2><div class="acts">' + (url ? '<a class="btn primary" target="_blank" rel="noopener noreferrer" href="' + esc(url) + '">Άνοιγμα στο site ↗</a>' : '') +
      '<button class="btn" type="button" id="pcopy">Αντιγραφή τίτλου</button></div><dl class="kv">' + kv + '</dl>' + det + '</div>';
    $('panel').classList.add('on'); $('shade').classList.add('on');
    $('px').onclick = closePanel;
    var big = $('panel').querySelector('.ph img');
    if (big) { big.style.cursor = 'zoom-in'; big.onclick = function () { if (!big.naturalWidth) return; $('lb').innerHTML = '<img referrerpolicy="no-referrer" src="' + esc(img) + '" alt="">'; $('lb').classList.add('on'); }; }
    $('pcopy').onclick = function () { copy(String(r[titleKey] || ''), $('pcopy')); };
  }
  function closePanel() { $('panel').classList.remove('on'); $('shade').classList.remove('on'); }
  $('shade').onclick = closePanel;
  // photos that do not load: hide them (no inline handlers, the page has a strict security policy)
  document.addEventListener('error', function (e) { var t = e.target; if (t && t.tagName === 'IMG') { if (t.closest('.panel')) { var ph = t.closest('.ph'); if (ph) ph.remove(); } else if (t.closest('.ph')) { var d = document.createElement('div'); d.className = 'none'; d.textContent = '—'; t.replaceWith(d); } else t.style.visibility = 'hidden'; } }, true);
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') { closePanel(); $('lb').classList.remove('on'); } });
  $('lb').onclick = function () { $('lb').classList.remove('on'); };
  // ----- events -----
  $('out').addEventListener('click', function (e) {
    var t = e.target;
    if (t.closest('a')) return;
    var cb = t.closest('input[type=checkbox]');
    if (cb && cb.id !== 'ckall') {
      var host = cb.closest('[data-i]') || cb; var i = Number(cb.dataset.i != null ? cb.dataset.i : host.dataset.i);
      if (cb.checked) state.sel.add(i); else state.sel.delete(i);
      var el = cb.closest('.pc, tr'); if (el) el.classList.toggle('sel', cb.checked);
      $('cnt').textContent = visible().length.toLocaleString('el-GR') + ' από ' + R.rows.length.toLocaleString('el-GR') + (state.sel.size ? ' · ' + state.sel.size + ' επιλεγμένα' : '');
      return;
    }
    if (t.closest('label.ck')) return;
    var z = t.closest('[data-zoom]');
    if (z) { openPanel(Number(z.dataset.zoom)); return; }
    var o = t.closest('[data-open]');
    if (o) openPanel(Number(o.dataset.open));
  });
  $('q').addEventListener('input', function (e) { state.q = e.target.value; state.shown = 120; draw(); });
  $('more').onclick = function () { state.shown += 240; draw(); };
  if ('IntersectionObserver' in window) new IntersectionObserver(function (en) { if (en[0].isIntersecting && $('more').style.display !== 'none') { state.shown += 240; draw(); } }, { rootMargin: '600px' }).observe($('more'));
  $('all').onclick = function () { var v = visible(); var allOn = v.length && v.every(function (i) { return state.sel.has(i); }); v.forEach(function (i) { if (allOn) state.sel.delete(i); else state.sel.add(i); }); draw(); };
  function rowsFor(ix) { var cs = cols.filter(function (c) { return c.type !== 'img'; }); var lines = [cs.map(function (c) { return c.label; })]; ix.forEach(function (i) { lines.push(cs.map(function (c) { return txt(c, R.rows[i]); })); }); return lines; }
  function copy(t, btn) {
    var done = function () { var o = btn.textContent; btn.textContent = 'Αντιγράφηκε ✓'; setTimeout(function () { btn.textContent = o; }, 1600); };
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(t).then(done, fallback); else fallback();
    function fallback() { var ta = document.createElement('textarea'); ta.value = t; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); done(); } catch (e) { /* ignore */ } ta.remove(); }
  }
  $('copy').onclick = function () { var ix = state.sel.size ? Array.from(state.sel) : visible(); copy(rowsFor(ix).map(function (l) { return l.map(function (x) { return String(x).replace(/[\t\n]+/g, ' '); }).join('\t'); }).join('\n'), $('copy')); };
  $('csv').onclick = function () {
    var ix = state.sel.size ? Array.from(state.sel) : visible();
    var t = '﻿' + rowsFor(ix).map(function (l) { return l.map(function (x) { x = String(x); return /[;"\n]/.test(x) ? '"' + x.replace(/"/g, '""') + '"' : x; }).join(';'); }).join('\r\n');
    var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([t], { type: 'text/csv;charset=utf-8' })); a.download = (R.file || 'anafora') + '.csv'; document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  };
  $('print').onclick = function () { window.print(); };
  draw();
}
/* eslint-enable */

function page(rep, pills) {
  const data = JSON.stringify({ rep: Object.assign({}, rep, { generated: new Date().toISOString() }), pills })
    .replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  return '<!doctype html>\n<html lang="el"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<meta name="referrer" content="no-referrer"><title>' + U.escapeHtml(rep.title) + '</title><style>' + CSS + '</style></head><body>' +
    '<header class="top"><div class="mark">SF Κέντρο · αναφορά</div><h1 id="t"></h1><div class="sub" id="s"></div><div class="help" id="h"></div></header>' +
    '<section class="kpis" id="kpis"></section>' +
    '<div class="bar"><input type="search" id="q" placeholder="Αναζήτηση: όνομα, κωδικός, μάρκα…" autofocus><select id="sort" title="Σειρά"></select><div class="seg" id="view"></div>' +
    '<button class="btn" type="button" id="all">Επιλογή όλων</button><button class="btn" type="button" id="copy">Αντιγραφή</button><button class="btn primary" type="button" id="csv">CSV</button><button class="btn" type="button" id="print">Εκτύπωση</button><span class="count" id="cnt"></span></div>' +
    '<div class="facets" id="facets"></div><main><div id="out"></div><button class="btn more" type="button" id="more">Δείξε περισσότερα</button></main>' +
    '<div class="shade" id="shade"></div><aside class="panel" id="panel" aria-label="Λεπτομέρειες"></aside><div class="lb" id="lb"></div><footer id="ft"></footer>' +
    '<script type="application/json" id="data">' + data + '</script>' +
    '<script nonce="__NONCE__">(' + client.toString() + ')(JSON.parse(document.getElementById("data").textContent));</script></body></html>';
}

module.exports = { page };
