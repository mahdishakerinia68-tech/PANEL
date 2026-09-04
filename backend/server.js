require('dotenv').config();
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const app = express();
app.set('trust proxy', 1); // needed for correct client IPs / rate limiting behind Nginx
const db = new Database(process.env.DB_PATH || 'strix.db');
app.use(cors());
app.use(express.json());

// Minimal security headers (no extra dependency needed)
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  next();
});

// Serve the existing frontend from the same backend so API paths like /api/...
// work when the project is started with `npm start` from backend/.
app.use(express.static(path.join(__dirname, '..')));

db.exec(`
CREATE TABLE IF NOT EXISTS admins(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  session_version INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS customers(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  status TEXT DEFAULT 'active',
  session_version INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS servers(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL,url TEXT NOT NULL,token TEXT DEFAULT '',status TEXT DEFAULT 'online');
CREATE TABLE IF NOT EXISTS plans(id INTEGER PRIMARY KEY AUTOINCREMENT,customer_id INTEGER,name TEXT NOT NULL,gb INTEGER,days INTEGER);
CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY AUTOINCREMENT,customer_id INTEGER,name TEXT NOT NULL,plan TEXT,gb INTEGER,date TEXT);
CREATE TABLE IF NOT EXISTS services(id INTEGER PRIMARY KEY AUTOINCREMENT,customer_id INTEGER,name TEXT,user TEXT,server TEXT,link TEXT);
CREATE TABLE IF NOT EXISTS logs(id INTEGER PRIMARY KEY AUTOINCREMENT,customer_id INTEGER,text TEXT,time TEXT);
`);

function ensureColumn(table, column, definition) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.some(c => c.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}
ensureColumn('admins', 'session_version', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('customers', 'session_version', 'INTEGER NOT NULL DEFAULT 0');

// BUG FIX: previously, if JWT_SECRET was not set in .env, a new random secret
// was generated in memory on every process start. That meant every restart
// (crash, redeploy, `pm2 restart`, server reboot, ...) silently invalidated
// every admin and every reseller's session, forcing everyone to log in again
// with no warning. We now persist a generated secret to a local file on first
// run, so restarts keep using the SAME secret and sessions survive. Setting
// JWT_SECRET in .env (recommended for production) still always takes priority.
const SECRET_FILE = path.join(__dirname, '.jwt-secret');
function resolveSecret() {
  if (process.env.JWT_SECRET && process.env.JWT_SECRET.trim()) return process.env.JWT_SECRET.trim();
  try {
    if (fs.existsSync(SECRET_FILE)) {
      const existing = fs.readFileSync(SECRET_FILE, 'utf8').trim();
      if (existing) return existing;
    }
  } catch (e) { /* fall through and generate a new one */ }
  const generated = crypto.randomBytes(48).toString('hex');
  try {
    fs.writeFileSync(SECRET_FILE, generated, { mode: 0o600 });
  } catch (e) {
    console.warn('WARNING: could not persist JWT secret to disk; sessions will not survive a restart until JWT_SECRET is set in .env');
  }
  return generated;
}
const secret = resolveSecret();
const COOKIE_MAX_AGE = 60 * 60 * 24 * 7;

// Very small in-memory rate limiter for auth endpoints (no extra dependency).
// Blocks an IP after too many failed attempts in a short window — important
// for a panel selling paid accounts, since login/setup are the main brute-force targets.
const attempts = new Map(); // ip -> { count, resetAt }
function rateLimit(max, windowMs) {
  return (req, res, next) => {
    const ip = req.ip || 'unknown';
    const now = Date.now();
    const rec = attempts.get(ip);
    if (!rec || now > rec.resetAt) {
      attempts.set(ip, { count: 1, resetAt: now + windowMs });
      return next();
    }
    if (rec.count >= max) {
      return res.status(429).json({ error: 'too_many_attempts' });
    }
    rec.count++;
    next();
  };
}
setInterval(() => {
  const now = Date.now();
  for (const [ip, rec] of attempts) if (now > rec.resetAt) attempts.delete(ip);
}, 5 * 60 * 1000).unref();

function adminCount() {
  return db.prepare('SELECT COUNT(*) AS n FROM admins').get().n;
}
function validUsername(username) {
  return typeof username === 'string' && username.trim().length >= 3 && username.trim().length <= 64;
}
function validPassword(password) {
  return typeof password === 'string' && password.length >= 8;
}
function issueToken(user) {
  return jwt.sign(
    { role: user.role, adminId: user.role === 'admin' ? user.id : undefined, customerId: user.role === 'customer' ? user.id : undefined, sessionVersion: user.session_version },
    secret,
    { expiresIn: COOKIE_MAX_AGE }
  );
}

function auth(req, res, next) {
  try {
    const h = req.headers.authorization || '';
    if (!h.startsWith('Bearer ')) throw new Error('missing_token');
    const payload = jwt.verify(h.slice(7), secret);
    let row = null;
    if (payload.role === 'admin') {
      row = db.prepare('SELECT id, username, session_version FROM admins WHERE id=?').get(payload.adminId);
    } else if (payload.role === 'customer') {
      row = db.prepare('SELECT id, username, session_version, status FROM customers WHERE id=?').get(payload.customerId);
      if (row && row.status !== 'active') row = null;
    }
    if (!row || row.session_version !== payload.sessionVersion) throw new Error('stale_session');
    req.auth = payload;
    req.user = row;
    next();
  } catch (e) {
    res.status(401).json({ error: 'unauthorized' });
  }
}
function admin(req, res, next) {
  if (req.auth.role !== 'admin') return res.status(403).json({ error: 'admin_only' });
  next();
}
function own(table, req) {
  return req.auth.role === 'admin' ? {} : { customer_id: req.auth.customerId };
}

app.get('/api/health', (req, res) => res.json({ ok: true, name: 'STRIX VIP PANEL', version: '1.3.0' }));

app.get('/api/setup/status', (req, res) => {
  res.json({ needsSetup: adminCount() === 0 });
});

app.post('/api/setup/create-admin', rateLimit(10, 10 * 60 * 1000), (req, res) => {
  if (adminCount() > 0) return res.status(409).json({ error: 'setup_completed' });
  const username = String(req.body?.username || '').trim();
  const password = req.body?.password;
  const passwordConfirm = req.body?.passwordConfirm;

  if (!validUsername(username)) return res.status(400).json({ error: 'username_min_3' });
  if (!validPassword(password)) return res.status(400).json({ error: 'password_min_8' });
  if (password !== passwordConfirm) return res.status(400).json({ error: 'password_mismatch' });

  try {
    const passwordHash = bcrypt.hashSync(password, 12);
    const result = db.prepare('INSERT INTO admins(username,password_hash,session_version) VALUES(?,?,0)').run(username, passwordHash);
    const user = db.prepare('SELECT id,username,session_version FROM admins WHERE id=?').get(result.lastInsertRowid);
    const token = issueToken({ ...user, role: 'admin' });
    res.status(201).json({ ok: true, token, role: 'admin', admin: { id: user.id, username: user.username } });
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) return res.status(409).json({ error: 'username_exists' });
    res.status(500).json({ error: 'setup_failed' });
  }
});

app.post('/api/auth/login', rateLimit(8, 10 * 60 * 1000), (req, res) => {
  const username = String(req.body?.username || '').trim();
  const password = req.body?.password;
  if (!username || typeof password !== 'string') return res.status(400).json({ error: 'missing_credentials' });
  if (adminCount() === 0) return res.status(409).json({ error: 'setup_required' });

  const a = db.prepare('SELECT id,username,password_hash,session_version FROM admins WHERE username=?').get(username);
  if (a && bcrypt.compareSync(password, a.password_hash)) {
    return res.json({ token: issueToken({ ...a, role: 'admin' }), role: 'admin', admin: { id: a.id, username: a.username } });
  }
  const c = db.prepare('SELECT id,name,username,password_hash,status,session_version FROM customers WHERE username=? AND status=?').get(username, 'active');
  if (c && bcrypt.compareSync(password, c.password_hash)) {
    return res.json({ token: issueToken({ ...c, role: 'customer' }), role: 'customer', customer: { id: c.id, name: c.name, username: c.username } });
  }
  res.status(401).json({ error: 'invalid_login' });
});

app.get('/api/me', auth, (req, res) => {
  if (req.auth.role === 'admin') return res.json({ role: 'admin', admin: { id: req.user.id, username: req.user.username } });
  res.json({ role: 'customer', customer: { id: req.user.id, username: req.user.username } });
});

app.put('/api/account/me', auth, (req, res) => {
  const username = String(req.body?.username || '').trim();
  const password = req.body?.password;
  const passwordConfirm = req.body?.passwordConfirm;
  if (!validUsername(username)) return res.status(400).json({ error: 'username_min_3' });

  if (password !== undefined && password !== '') {
    if (!validPassword(password)) return res.status(400).json({ error: 'password_min_8' });
    if (password !== passwordConfirm) return res.status(400).json({ error: 'password_mismatch' });
  }

  const table = req.auth.role === 'admin' ? 'admins' : 'customers';
  const id = req.auth.role === 'admin' ? req.auth.adminId : req.auth.customerId;
  const old = db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(id);
  if (!old) return res.status(404).json({ error: 'account_not_found' });

  try {
    const hash = password ? bcrypt.hashSync(password, 12) : old.password_hash;
    db.prepare(`UPDATE ${table} SET username=?, password_hash=?, session_version=session_version+1 WHERE id=?`).run(username, hash, id);
    res.json({ ok: true, sessionInvalidated: true });
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) return res.status(409).json({ error: 'username_exists' });
    res.status(500).json({ error: 'account_update_failed' });
  }
});

app.get('/api/admins', auth, admin, (req, res) => res.json(db.prepare('SELECT id,username FROM admins ORDER BY id').all()));

app.post('/api/admins', auth, admin, (req, res) => {
  const username = String(req.body?.username || '').trim();
  const password = req.body?.password;
  if (!validUsername(username)) return res.status(400).json({ error: 'username_min_3' });
  if (!validPassword(password)) return res.status(400).json({ error: 'password_min_8' });
  try {
    const r = db.prepare('INSERT INTO admins(username,password_hash,session_version) VALUES(?,?,0)').run(username, bcrypt.hashSync(password, 12));
    res.json({ id: r.lastInsertRowid });
  } catch (e) {
    res.status(409).json({ error: 'username_exists' });
  }
});

app.put('/api/admins/:id', auth, admin, (req, res) => {
  const id = Number(req.params.id);
  const old = db.prepare('SELECT * FROM admins WHERE id=?').get(id);
  if (!old) return res.sendStatus(404);
  const username = String(req.body?.username || '').trim();
  const password = req.body?.password;
  if (!validUsername(username)) return res.status(400).json({ error: 'username_min_3' });
  if (password && !validPassword(password)) return res.status(400).json({ error: 'password_min_8' });
  try {
    db.prepare('UPDATE admins SET username=?,password_hash=?,session_version=session_version+1 WHERE id=?')
      .run(username, password ? bcrypt.hashSync(password, 12) : old.password_hash, id);
    res.json({ ok: true, sessionInvalidated: true });
  } catch (e) {
    res.status(409).json({ error: 'username_exists' });
  }
});

app.delete('/api/admins/:id', auth, admin, (req, res) => {
  const n = adminCount();
  if (n <= 1) return res.status(400).json({ error: 'last_admin' });
  db.prepare('DELETE FROM admins WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

app.get('/api/customers', auth, admin, (req, res) => res.json(db.prepare('SELECT id,name,username,status FROM customers ORDER BY id DESC').all()));
app.post('/api/customers', auth, admin, (req, res) => {
  const { name, username, password } = req.body || {};
  if (!name || !validUsername(username) || !validPassword(password)) return res.status(400).json({ error: 'invalid_customer' });
  try {
    const r = db.prepare('INSERT INTO customers(name,username,password_hash,status,session_version) VALUES(?,?,?,"active",0)').run(name, username.trim(), bcrypt.hashSync(password, 12));
    res.json({ id: r.lastInsertRowid });
  } catch (e) { res.status(409).json({ error: 'username_exists' }); }
});
app.put('/api/customers/:id', auth, admin, (req, res) => {
  const id = Number(req.params.id);
  const c = db.prepare('SELECT * FROM customers WHERE id=?').get(id);
  if (!c) return res.sendStatus(404);
  const username = req.body?.username === undefined ? c.username : String(req.body.username).trim();
  const name = req.body?.name === undefined ? c.name : req.body.name;
  const status = req.body?.status === undefined ? c.status : req.body.status;
  const password = req.body?.password;
  if (!validUsername(username)) return res.status(400).json({ error: 'username_min_3' });
  if (password && !validPassword(password)) return res.status(400).json({ error: 'password_min_8' });
  try {
    db.prepare('UPDATE customers SET name=?,username=?,status=?,password_hash=?,session_version=session_version+1 WHERE id=?')
      .run(name, username, status, password ? bcrypt.hashSync(password, 12) : c.password_hash, id);
    res.json({ ok: true });
  } catch (e) { res.status(409).json({ error: 'username_exists' }); }
});
app.delete('/api/customers/:id', auth, admin, (req, res) => {
  const id = Number(req.params.id);
  db.prepare('DELETE FROM customers WHERE id=?').run(id);
  ['plans','users','services'].forEach(t => db.prepare(`DELETE FROM ${t} WHERE customer_id=?`).run(id));
  res.json({ ok: true });
});

app.get('/api/servers', auth, admin, (req, res) => res.json(db.prepare('SELECT id,name,url,token,status FROM servers ORDER BY id DESC').all()));
app.post('/api/servers', auth, admin, (req, res) => { const {name,url,token}=req.body||{}; const r=db.prepare('INSERT INTO servers(name,url,token) VALUES(?,?,?)').run(name,url,token||''); res.json({id:r.lastInsertRowid}); });
app.put('/api/servers/:id', auth, admin, (req,res)=>{ const {name,url,token,status}=req.body||{}; db.prepare('UPDATE servers SET name=?,url=?,token=?,status=? WHERE id=?').run(name,url,token||'',status||'online',req.params.id); res.json({ok:true}); });
app.delete('/api/servers/:id', auth, admin, (req,res)=>{db.prepare('DELETE FROM servers WHERE id=?').run(req.params.id);res.json({ok:true});});

function crud(table, fields) {
  app.get('/api/'+table, auth, (req,res)=>{
    const q=req.auth.role==='admin'?`SELECT * FROM ${table}`:`SELECT * FROM ${table} WHERE customer_id=?`;
    res.json(req.auth.role==='admin'?db.prepare(q).all():db.prepare(q).all(req.auth.customerId));
  });
  app.post('/api/'+table, auth, (req,res)=>{
    let actualFields=[...fields];
    let vals=fields.map(f=>req.body?.[f]??'');
    if(req.auth.role==='customer'){actualFields=['customer_id',...fields];vals=[req.auth.customerId,...vals];}
    const qs=actualFields.map(()=>'?').join(',');
    const r=db.prepare(`INSERT INTO ${table}(${actualFields.join(',')}) VALUES(${qs})`).run(...vals);
    res.json({id:r.lastInsertRowid});
  });
  app.put('/api/'+table+'/:id', auth, (req,res)=>{
    const set=fields.map(f=>`${f}=?`).join(',');
    const vals=fields.map(f=>req.body?.[f]??'');
    const where=req.auth.role==='admin'?'id=?':'id=? AND customer_id=?';
    vals.push(req.params.id); if(req.auth.role==='customer') vals.push(req.auth.customerId);
    const r=db.prepare(`UPDATE ${table} SET ${set} WHERE ${where}`).run(...vals);
    res.json({ok:!!r.changes});
  });
  app.delete('/api/'+table+'/:id', auth, (req,res)=>{
    const where=req.auth.role==='admin'?'id=?':'id=? AND customer_id=?';
    const vals=[req.params.id]; if(req.auth.role==='customer') vals.push(req.auth.customerId);
    db.prepare(`DELETE FROM ${table} WHERE ${where}`).run(...vals); res.json({ok:true});
  });
}
crud('plans',['name','gb','days']);
crud('users',['name','plan','gb','date']);
crud('services',['name','user','server','link']);

// Full factory reset: wipes EVERY table (admins included) so the panel goes
// back to a blank state and shows the "first admin setup" screen again.
// Requires the current admin's password as confirmation since this is
// irreversible and destroys all reseller/customer data.
app.post('/api/system/factory-reset', auth, admin, (req, res) => {
  const password = req.body?.password;
  if (typeof password !== 'string' || !password) return res.status(400).json({ error: 'password_required' });
  const me = db.prepare('SELECT * FROM admins WHERE id=?').get(req.auth.adminId);
  if (!me || !bcrypt.compareSync(password, me.password_hash)) return res.status(401).json({ error: 'invalid_login' });
  try {
    const wipe = db.transaction(() => {
      ['logs', 'services', 'users', 'plans', 'servers', 'customers', 'admins'].forEach(t => db.exec(`DELETE FROM ${t}`));
      try { db.exec('DELETE FROM sqlite_sequence'); } catch (e) { /* table may not exist yet, ignore */ }
    });
    wipe();
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'reset_failed' });
  }
});

app.get('/api/logs',auth,(req,res)=>{
  if(req.auth.role==='admin') return res.json(db.prepare('SELECT * FROM logs ORDER BY id DESC').all());
  res.json(db.prepare('SELECT * FROM logs WHERE customer_id=? ORDER BY id DESC').all(req.auth.customerId));
});

app.delete('/api/logs',auth,(req,res)=>{
  if(req.auth.role==='admin') db.prepare('DELETE FROM logs').run();
  else db.prepare('DELETE FROM logs WHERE customer_id=?').run(req.auth.customerId);
  res.json({ok:true});
});

const PORT=Number(process.env.PORT||3000);
app.listen(PORT,()=>console.log(`STRIX VIP PANEL backend running on ${PORT}`));
