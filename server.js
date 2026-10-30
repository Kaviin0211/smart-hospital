// Smart Hospital OPD backend - zero dependencies. Run: node server.js
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const PORT = process.env.PORT || 3000;
const DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const FILE = path.join(DIR, 'db.json');
const PINS = {
  reception: process.env.RECEPTION_PIN || '1111',
  doctor: process.env.DOCTOR_PIN || '2222',
  pharmacy: process.env.PHARMACY_PIN || '3333'
};
const SECRET = process.env.SECRET || crypto.randomBytes(32).toString('hex');
const DEPTS = ['General Medicine', 'Paediatrics', 'Orthopaedics', 'Dermatology', 'ENT', 'Eye'];
const MODES = ['Cash', 'UPI', 'Card'];
if (!process.env.RECEPTION_PIN) console.warn('WARNING: using default demo PINs. Set RECEPTION_PIN, DOCTOR_PIN, PHARMACY_PIN before hosting.');

// ---------- storage (atomic JSON file) ----------
fs.mkdirSync(DIR, { recursive: true });
let db = { patients: [], counters: {} };
try { db = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch (e) {}
const save = () => { const t = FILE + '.tmp'; fs.writeFileSync(t, JSON.stringify(db)); fs.renameSync(t, FILE); };

// ---------- helpers ----------
const clean = (s, max) => String(s ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, max);
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
const now = () => new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
const sign = d => crypto.createHmac('sha256', SECRET).update(d).digest('base64url');
const makeToken = role => { const b = Buffer.from(JSON.stringify({ r: role, e: Date.now() + 12 * 3600e3 })).toString('base64url'); return b + '.' + sign(b); };
function roleOf(req) {
  const h = req.headers.authorization || '';
  const [b, s] = h.replace('Bearer ', '').split('.');
  if (!b || !s || sign(b) !== s) return null;
  try { const d = JSON.parse(Buffer.from(b, 'base64url')); return d.e > Date.now() ? d.r : null; } catch (e) { return null; }
}
const hits = new Map();
function limited(ip, max, ms) {
  const t = Date.now(), a = (hits.get(ip) || []).filter(x => t - x < ms);
  a.push(t); hits.set(ip, a); return a.length > max;
}
const send = (res, code, data, type = 'application/json', extra = {}) => {
  res.writeHead(code, { 'Content-Type': type + '; charset=utf-8', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store', ...extra });
  res.end(type === 'application/json' ? JSON.stringify(data) : data);
};
const body = req => new Promise((ok, no) => {
  let s = ''; req.on('data', c => { s += c; if (s.length > 100000) { req.destroy(); no(new Error('Too large')); } });
  req.on('end', () => { try { ok(s ? JSON.parse(s) : {}); } catch (e) { no(new Error('Invalid JSON')); } });
});
const bad = (res, m, c = 400) => send(res, c, { error: m });
const money = n => Math.round(n * 100) / 100;
const total = b => money(b.fee + b.items.reduce((s, i) => s + i.qty * i.price, 0));

// ---------- server ----------
http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x'), p = url.pathname, m = req.method;
  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  try {
    if (m === 'GET' && (p === '/' || p === '/index.html'))
      return send(res, 200, fs.readFileSync(path.join(__dirname, 'public', 'index.html')), 'text/html');
    if (!p.startsWith('/api/')) return bad(res, 'Not found', 404);

    // ----- public -----
    if (m === 'POST' && p === '/api/register') {
      if (limited('r' + ip, 15, 10 * 60e3)) return bad(res, 'Too many registrations. Please wait a few minutes.', 429);
      const b = await body(req);
      const name = clean(b.name, 60), location = clean(b.location, 80), mobile = clean(b.mobile, 10), email = clean(b.email, 100);
      const age = Number(b.age), department = clean(b.department, 40);
      if (!name || !location) return bad(res, 'Name and location are required.');
      if (!Number.isInteger(age) || age < 0 || age > 120) return bad(res, 'Enter a valid age (0-120).');
      if (!/^\d{10}$/.test(mobile)) return bad(res, 'Mobile number must be 10 digits.');
      if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return bad(res, 'Enter a valid email or leave it empty.');
      if (!DEPTS.includes(department)) return bad(res, 'Choose a department.');
      const d = today(); db.counters[d] = (db.counters[d] || 0) + 1;
      const pt = {
        id: crypto.randomUUID(), token: 'OP-' + String(db.counters[d]).padStart(3, '0'), date: d,
        name, age, location, mobile, email, department, assistance: !!b.assistance,
        status: 'Waiting', note: '', medicines: '', createdAt: now(),
        bill: { fee: 200, items: [], mode: '', status: 'Pending', paidAt: '' }
      };
      db.patients.push(pt); save();
      return send(res, 201, { token: pt.token, name, department, status: pt.status });
    }
    if (m === 'GET' && p === '/api/status') {
      if (limited('s' + ip, 30, 10 * 60e3)) return bad(res, 'Too many requests.', 429);
      const t = clean(url.searchParams.get('token'), 10).toUpperCase(), mob = clean(url.searchParams.get('mobile'), 10);
      const pt = db.patients.filter(x => x.token === t && x.mobile === mob && x.date === today())[0];
      if (!pt) return bad(res, 'No matching token found for today.', 404);
      const ahead = db.patients.filter(x => x.date === pt.date && x.status === 'Waiting' && x.createdAt <= pt.createdAt && x.id !== pt.id).length;
      return send(res, 200, { token: pt.token, name: pt.name, department: pt.department, status: pt.status, waitingAhead: pt.status === 'Waiting' ? ahead : 0 });
    }
    if (m === 'POST' && p === '/api/login') {
      if (limited('l' + ip, 10, 10 * 60e3)) return bad(res, 'Too many login attempts. Try later.', 429);
      const b = await body(req), r = clean(b.role, 20), pin = String(b.pin || '');
      const ok = PINS[r] && pin.length === PINS[r].length && crypto.timingSafeEqual(Buffer.from(pin), Buffer.from(PINS[r]));
      return ok ? send(res, 200, { token: makeToken(r), role: r }) : bad(res, 'Wrong PIN.', 401);
    }

    // ----- staff only -----
    const role = roleOf(req);
    if (!role) return bad(res, 'Login required.', 401);
    const need = (...r) => { if (!r.includes(role)) { bad(res, 'Not allowed for your role.', 403); return false; } return true; };

    if (m === 'GET' && p === '/api/patients') {
      if (!need('reception', 'doctor', 'pharmacy')) return;
      let list = db.patients;
      if (role === 'pharmacy') list = list.filter(x => x.status === 'Consulted');
      return send(res, 200, list);
    }
    if (m === 'POST' && p === '/api/call-next') {
      if (!need('reception')) return;
      const pt = db.patients.find(x => x.status === 'Waiting');
      if (!pt) return bad(res, 'No waiting patients.', 404);
      pt.status = 'Called'; pt.calledAt = now(); save();
      return send(res, 200, pt);
    }
    if (m === 'GET' && p === '/api/export.csv') {
      if (!need('reception')) return;
      const safe = v => { v = String(v ?? ''); return /^[=+\-@]/.test(v) ? "'" + v : v; };
      const q = v => '"' + String(v).replace(/"/g, '""') + '"';
      const head = ['Date', 'Token', 'Name', 'Age', 'Location', 'Mobile', 'Email', 'Department', 'Status', 'Note', 'Medicines', 'Bill total', 'Bill status', 'Payment mode'];
      const rows = db.patients.map(x => [x.date, x.token, safe(x.name), x.age, safe(x.location), '="' + x.mobile + '"', safe(x.email), x.department, x.status, safe(x.note), safe(x.medicines), total(x.bill), x.bill.status, x.bill.mode]);
      const csv = '\uFEFF' + [head, ...rows].map(r => r.map(q).join(',')).join('\r\n');
      return send(res, 200, csv, 'text/csv', { 'Content-Disposition': 'attachment; filename="smart_hospital.csv"' });
    }
    if (m === 'POST' && p === '/api/reset') {
      if (!need('reception')) return;
      db = { patients: [], counters: {} }; save(); return send(res, 200, { ok: true });
    }
    let r;
    if (m === 'PUT' && (r = p.match(/^\/api\/patients\/([\w-]+)\/(consult|bill)$/))) {
      const pt = db.patients.find(x => x.id === r[1]);
      if (!pt) return bad(res, 'Patient not found.', 404);
      const b = await body(req);
      if (r[2] === 'consult') {
        if (!need('doctor')) return;
        pt.note = clean(b.note, 2000); pt.medicines = clean(b.medicines, 3000);
        pt.status = 'Consulted'; pt.consultedAt = now(); save();
        return send(res, 200, pt);
      }
      if (!need('pharmacy')) return;
      if (pt.status !== 'Consulted') return bad(res, 'Doctor has not completed the consultation.');
      if (pt.bill.status === 'Paid') return bad(res, 'Bill already paid and locked.');
      const fee = Number(b.fee);
      if (!isFinite(fee) || fee < 0 || fee > 100000) return bad(res, 'Invalid consultation fee.');
      const items = (Array.isArray(b.items) ? b.items : []).slice(0, 30).map(i => ({ name: clean(i.name, 80), qty: Math.floor(Number(i.qty)), price: Number(i.price) })).filter(i => i.name);
      if (items.some(i => !(i.qty >= 1 && i.qty <= 999) || !isFinite(i.price) || i.price < 0 || i.price > 100000)) return bad(res, 'Check medicine quantity and price.');
      pt.bill.fee = money(fee); pt.bill.items = items.map(i => ({ ...i, price: money(i.price) }));
      pt.bill.mode = MODES.includes(b.mode) ? b.mode : pt.bill.mode;
      if (b.pay) {
        if (!MODES.includes(pt.bill.mode)) return bad(res, 'Choose a payment mode.');
        pt.bill.status = 'Paid'; pt.bill.paidAt = now();
      }
      save(); return send(res, 200, pt);
    }
    return bad(res, 'Not found', 404);
  } catch (e) {
    console.error(e); return bad(res, e.message || 'Server error', 500);
  }
}).listen(PORT, () => console.log('Smart Hospital running on port ' + PORT));
