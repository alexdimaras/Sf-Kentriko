// node mockwoo.js <port> <products> <variations>  (DESC_WORDS=450): a WooCommerce Store API of that size, Greek texts
// A WooCommerce Store API with N products (long descriptions, photos, attributes) and their variations.
const http = require('http');
const [port, N, V] = [Number(process.argv[2]), Number(process.argv[3] || 3500), Number(process.argv[4] || 6000)];
const TYPES = ['ΠΑΝΤΕΛΟΝΙ', 'ΜΠΟΥΦΑΝ', 'ΣΑΚΙΔΙΟ', 'ΜΠΟΤΑ', 'ΓΑΝΤΙΑ', 'ΦΑΚΟΣ', 'ΜΑΧΑΙΡΙ', 'ΖΩΝΗ', 'ΚΑΠΕΛΟ', 'ΘΗΚΗ'];
const BRANDS = ['PENTAGON', 'HELIKON-TEX', '5.11 TACTICAL', 'MECHANIX', 'FENIX', 'NITECORE', 'VICTORINOX', 'MIL-TEC', 'CONDOR', 'MAGNUM'];
const VOC = ('ανθεκτικό προϊόν ποιότητας επαγγελματίες λάτρεις outdoor ενισχυμένες ραφές υλικά αντέχουν σακίδιο τσέπες φερμουάρ αδιάβροχο ύφασμα cordura ripstop βάρος διαστάσεις χρώμα μαύρο χακί coyote ελαφρύ άνετο εργονομικό σύστημα molle ιμάντες ώμων πλάτη αερισμός θήκη νερού κράνος γάντια μπότες σόλα vibram δέρμα nubuck αντιολισθητικό θερμομόνωση gore-tex μεμβράνη αναπνέει στρατιωτικό αστυνομία κυνήγι πεζοπορία κάμπινγκ εκπαίδευση αποστολή επιχείρηση ασφάλεια φακός lumens μπαταρία φόρτιση usb δέσμη εμβέλεια μαχαίρι λάμα ανοξείδωτο λαβή g10 θήκη ζώνη αγκράφα').split(' ');
let seed = 1; const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed; };
const words = (n) => { let o = []; for (let k = 0; k < n; k++) o.push(VOC[rnd() % VOC.length] + (rnd() % 7 === 0 ? ' ' + (rnd() % 1000) : '')); return o.join(' '); };
const desc = (i) => '<p>' + words(Number(process.env.DESC_WORDS || 400)) + '.</p><ul>' + [1, 2, 3, 4, 5, 6].map(() => '<li>' + words(8) + '</li>').join('') + '</ul>';
const prod = (i) => {
  const t = TYPES[i % 10], b = BRANDS[(i * 7) % 10], variable = i % 3 === 0;
  return { id: i, name: `${t} ${b} MODEL-${i} ${['ΜΑΥΡΟ', 'ΧΑΚΙ', 'COYOTE'][i % 3]}`, slug: 'p-' + i, parent: 0, type: variable ? 'variable' : 'simple', variation: '', permalink: `https://shop.example/p/${i}`, sku: 'SKU-' + i,
    short_description: '<ul><li>Υλικό: Cordura</li><li>Χρώμα: μαύρο</li></ul>', description: desc(i), on_sale: false,
    prices: { price: String(4990 + i), regular_price: String(4990 + i), sale_price: String(4990 + i), currency_minor_unit: 2 },
    images: [1, 2, 3, 4].map((k) => ({ src: `https://shop.example/img/${i}-${k}.jpg`, thumbnail: `https://shop.example/img/${i}-${k}-150.jpg`, alt: '' })),
    categories: [{ id: 10 + (i % 10), name: TYPES[i % 10], slug: 'c' + (i % 10) }], tags: [], brands: [{ name: b }],
    attributes: [{ name: 'Μέγεθος', taxonomy: 'pa_size', has_variations: variable, terms: ['S', 'M', 'L', 'XL'].map((n) => ({ name: n })) }],
    variations: variable ? [0, 1, 2, 3, 4, 5, 6, 7].map((k) => ({ id: 100000 + i * 10 + k })) : [], is_in_stock: true, is_purchasable: true };
};
const vars = (n) => { const out = []; for (let i = 3; i < N && out.length < n; i += 3) for (let k = 0; k < 8; k++) out.push({ id: 100000 + i * 10 + k, parent: i, type: 'variation', variation: 'Μέγεθος: ' + ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', '4XL'][k], sku: `SKU-${i}-${k}`, prices: { price: '4990', regular_price: '4990', currency_minor_unit: 2 }, on_sale: false, is_in_stock: true, images: [] }); return out; };
const VARS = vars(V);
http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  const per = Number(u.searchParams.get('per_page') || 100), page = Number(u.searchParams.get('page') || 1);
  let list;
  if (u.pathname.endsWith('/products/categories')) list = TYPES.map((t, k) => ({ id: 10 + k, name: t, slug: 'c' + k, parent: 0, count: 100, permalink: '' }));
  else if (u.pathname.endsWith('/products') && u.searchParams.get('type') === 'variation') list = VARS;
  else if (u.pathname.endsWith('/products')) { list = []; for (let i = 1; i <= N; i++) list.push(i); }
  else { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end('<html>yoast</html>'); }
  const total = list.length, pages = Math.max(1, Math.ceil(total / per));
  let slice = list.slice((page - 1) * per, page * per);
  if (typeof slice[0] === 'number') slice = slice.map(prod);
  if (u.searchParams.get('_fields') === 'id') slice = slice.map((p) => ({ id: p.id }));
  res.writeHead(200, { 'Content-Type': 'application/json', 'X-WP-Total': String(total), 'X-WP-TotalPages': String(pages) });
  res.end(JSON.stringify(slice));
}).listen(port, '127.0.0.1');
