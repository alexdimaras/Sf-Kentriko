// A little "GitHub" on this PC for the cloud-save measurements: trees, blobs, commits, refs, contents — only what
// the program uses. Everything in memory.   node fakegithub.js [port]   → prints the port; GET /_stats for numbers.
const http = require('http');
const crypto = require('crypto');
const S = { head: null, commits: 0, blobPosts: 0, bytesIn: 0, bytesOut: 0, blobs: new Map(), trees: new Map(), commitsMap: new Map() };
const tree = () => (S.head ? S.trees.get(S.commitsMap.get(S.head)) : []);
const file = (name) => { const e = tree().find((x) => x.path === name); return e ? S.blobs.get(e.sha) : null; };
const id = () => crypto.randomBytes(20).toString('hex');
const srv = http.createServer((req, res) => {
  const ch = []; req.on('data', (c) => ch.push(c)); req.on('end', () => {
    const raw = Buffer.concat(ch); S.bytesIn += raw.length;
    const out = (code, o) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o || {})); };
    const bin = (b) => { S.bytesOut += b.length; res.writeHead(200); res.end(b); };
    let j = {}; if (raw.length) { try { j = JSON.parse(raw.toString('utf8')); } catch (_) { return out(400); } }
    const commit = (entries) => { const t = id(), c = id(); S.trees.set(t, entries); S.commitsMap.set(c, t); S.head = c; S.commits++; };
    let m;
    if (req.url === '/_stats') return out(200, { commits: S.commits, blobPosts: S.blobPosts, mbIn: +(S.bytesIn / 1048576).toFixed(2), mbOut: +(S.bytesOut / 1048576).toFixed(2), files: tree().map((e) => `${e.path} ${(S.blobs.get(e.sha).length / 1024).toFixed(0)}KB`) });
    if (req.method === 'GET' && /\/git\/trees\/[^?]+\?recursive=1$/.test(req.url)) { if (!S.head) return out(409, { message: 'Git Repository is empty.' }); return out(200, { tree: tree().map((e) => ({ path: e.path, mode: e.mode, type: 'blob', sha: e.sha, size: S.blobs.get(e.sha).length })) }); }
    if (req.method === 'GET' && (m = req.url.match(/\/git\/blobs\/([0-9a-f]+)$/))) { const b = S.blobs.get(m[1]); return b ? bin(b) : out(404); }
    if (req.method === 'GET' && (m = req.url.match(/\/contents\/([^?]+)/))) { const b = file(decodeURIComponent(m[1])); return b ? bin(b) : out(404); }
    if (req.method === 'PUT' && (m = req.url.match(/\/contents\/([^?]+)/))) { const k = id(); S.blobs.set(k, Buffer.from(j.content, 'base64')); commit(tree().filter((e) => e.path !== m[1]).concat([{ path: decodeURIComponent(m[1]), mode: '100644', type: 'blob', sha: k }])); return out(201, { content: { sha: k } }); }
    if (req.method === 'POST' && /\/git\/blobs$/.test(req.url)) { if (!S.head) return out(409, { message: 'Git Repository is empty.' }); const k = id(); S.blobs.set(k, Buffer.from(j.content, 'base64')); S.blobPosts++; return out(201, { sha: k }); }
    if (req.method === 'POST' && /\/git\/trees$/.test(req.url)) { if (j.tree.some((e) => !S.blobs.has(e.sha))) return out(422); const k = id(); S.trees.set(k, j.tree); return out(201, { sha: k }); }
    if (req.method === 'POST' && /\/git\/commits$/.test(req.url)) { const k = id(); S.commitsMap.set(k, j.tree); return out(201, { sha: k }); }
    if (req.method === 'PATCH' && /\/git\/refs\/heads\//.test(req.url)) { if (!S.commitsMap.has(j.sha)) return out(422); S.head = j.sha; S.commits++; return out(200, { object: { sha: j.sha } }); }
    return out(404, { message: 'not here: ' + req.method + ' ' + req.url });
  });
});
srv.listen(Number(process.argv[2]) || 0, '127.0.0.1', () => console.log('fake GitHub on ' + srv.address().port));
