require('dotenv').config();
const express=require('express'),cors=require('cors'),jwt=require('jsonwebtoken'),bcrypt=require('bcryptjs'),Database=require('better-sqlite3');
const app=express(),db=new Database('strix.db'); app.use(cors());app.use(express.json());
db.exec(`CREATE TABLE IF NOT EXISTS admins(id INTEGER PRIMARY KEY AUTOINCREMENT,username TEXT UNIQUE NOT NULL,password_hash TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS customers(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL,username TEXT UNIQUE NOT NULL,password_hash TEXT NOT NULL,status TEXT DEFAULT 'active');
CREATE TABLE IF NOT EXISTS servers(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL,url TEXT NOT NULL,token TEXT DEFAULT '',status TEXT DEFAULT 'online');
CREATE TABLE IF NOT EXISTS plans(id INTEGER PRIMARY KEY AUTOINCREMENT,customer_id INTEGER,name TEXT NOT NULL,gb INTEGER,days INTEGER);
CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY AUTOINCREMENT,customer_id INTEGER,name TEXT NOT NULL,plan TEXT,gb INTEGER,date TEXT);
CREATE TABLE IF NOT EXISTS services(id INTEGER PRIMARY KEY AUTOINCREMENT,customer_id INTEGER,name TEXT,user TEXT,server TEXT,link TEXT);
CREATE TABLE IF NOT EXISTS logs(id INTEGER PRIMARY KEY AUTOINCREMENT,customer_id INTEGER,text TEXT,time TEXT);`);

// Default first admin (changeable from the Admins section).
const DEFAULT_ADMIN_USER = process.env.ADMIN_USER || 'mahdi';
const DEFAULT_ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'mahdi6812';
if (db.prepare('SELECT COUNT(*) n FROM admins').get().n === 0) {
  db.prepare('INSERT INTO admins(username,password_hash) VALUES(?,?)').run(DEFAULT_ADMIN_USER, bcrypt.hashSync(DEFAULT_ADMIN_PASSWORD, 12));
}
const secret=process.env.JWT_SECRET||'CHANGE_ME';
function auth(req,res,next){try{const h=req.headers.authorization||'';if(!h.startsWith('Bearer '))throw 0;req.auth=jwt.verify(h.slice(7),secret);next()}catch(e){res.status(401).json({error:'unauthorized'})}}
function admin(req,res,next){if(req.auth.role!=='admin')return res.status(403).json({error:'admin_only'});next()}
function own(table,req){return req.auth.role==='admin'?{}:{customer_id:req.auth.customerId}}
app.get('/api/setup/status',(req,res)=>res.json({needsSetup:db.prepare('SELECT COUNT(*) n FROM admins').get().n===0}));
app.post('/api/setup/create-admin',(req,res)=>{let count=db.prepare('SELECT COUNT(*) n FROM admins').get().n;if(count>0)return res.status(409).json({error:'setup_completed'});let {username,password}=req.body||{};if(!username||!password||password.length<8)return res.status(400).json({error:'username_and_password_min_8_required'});let r=db.prepare('INSERT INTO admins(username,password_hash) VALUES(?,?)').run(username,bcrypt.hashSync(password,12));res.json({ok:true,id:r.lastInsertRowid})});
app.post('/api/auth/login',(req,res)=>{let {username,password}=req.body||{};let a=db.prepare('SELECT * FROM admins WHERE username=?').get(username);if(a&&bcrypt.compareSync(password,a.password_hash))return res.json({token:jwt.sign({role:'admin',adminId:a.id},secret,{expiresIn:'7d'}),role:'admin',admin:{id:a.id,username:a.username}});let c=db.prepare('SELECT * FROM customers WHERE username=? AND status=?').get(username,'active');if(!c||!bcrypt.compareSync(password,c.password_hash))return res.status(401).json({error:'invalid_login'});res.json({token:jwt.sign({role:'customer',customerId:c.id},secret,{expiresIn:'7d'}),role:'customer',customer:{id:c.id,name:c.name,username:c.username}})});
app.get('/api/admins',auth,admin,(req,res)=>res.json(db.prepare('SELECT id,username FROM admins ORDER BY id').all()));
app.post('/api/admins',auth,admin,(req,res)=>{let {username,password}=req.body||{};if(!username||!password)return res.status(400).json({error:'missing'});try{let r=db.prepare('INSERT INTO admins(username,password_hash) VALUES(?,?)').run(username,bcrypt.hashSync(password,12));res.json({id:r.lastInsertRowid})}catch(e){res.status(409).json({error:'username_exists'})}});
app.put('/api/admins/:id',auth,admin,(req,res)=>{let {username,password}=req.body||{};let a=db.prepare('SELECT * FROM admins WHERE id=?').get(req.params.id);if(!a)return res.sendStatus(404);db.prepare('UPDATE admins SET username=? WHERE id=?').run(username||a.username,a.id);if(password)db.prepare('UPDATE admins SET password_hash=? WHERE id=?').run(bcrypt.hashSync(password,12),a.id);res.json({ok:true})});
app.delete('/api/admins/:id',auth,admin,(req,res)=>{let n=db.prepare('SELECT COUNT(*) n FROM admins').get().n;if(n<=1)return res.status(400).json({error:'last_admin'});db.prepare('DELETE FROM admins WHERE id=?').run(req.params.id);res.json({ok:true})});
app.get('/api/me',auth,(req,res)=>res.json(req.auth));
app.get('/api/customers',auth,admin,(req,res)=>res.json(db.prepare('SELECT id,name,username,status FROM customers ORDER BY id DESC').all()));
app.post('/api/customers',auth,admin,(req,res)=>{let {name,username,password}=req.body;if(!name||!username||!password)return res.status(400).json({error:'missing'});try{let r=db.prepare('INSERT INTO customers(name,username,password_hash) VALUES(?,?,?)').run(name,username,bcrypt.hashSync(password,12));res.json({id:r.lastInsertRowid})}catch(e){res.status(409).json({error:'username_exists'})}});
app.put('/api/customers/:id',auth,admin,(req,res)=>{let {name,username,password,status}=req.body;let c=db.prepare('SELECT * FROM customers WHERE id=?').get(req.params.id);if(!c)return res.sendStatus(404);db.prepare('UPDATE customers SET name=?,username=?,status=? WHERE id=?').run(name||c.name,username||c.username,status||c.status,c.id);if(password)db.prepare('UPDATE customers SET password_hash=? WHERE id=?').run(bcrypt.hashSync(password,12),c.id);res.json({ok:true})});
app.delete('/api/customers/:id',auth,admin,(req,res)=>{db.prepare('DELETE FROM customers WHERE id=?').run(req.params.id);['plans','users','services'].forEach(t=>db.prepare(`DELETE FROM ${t} WHERE customer_id=?`).run(req.params.id));res.json({ok:true})});
app.get('/api/servers',auth,(req,res)=>res.json(db.prepare('SELECT id,name,url,status FROM servers ORDER BY id DESC').all()));
app.post('/api/servers',auth,admin,(req,res)=>{let {name,url,token}=req.body;let r=db.prepare('INSERT INTO servers(name,url,token) VALUES(?,?,?)').run(name,url,token||'');res.json({id:r.lastInsertRowid})});
app.put('/api/servers/:id',auth,admin,(req,res)=>{let {name,url,token,status}=req.body;db.prepare('UPDATE servers SET name=?,url=?,token=?,status=? WHERE id=?').run(name,url,token||'',status||'online',req.params.id);res.json({ok:true})});
app.delete('/api/servers/:id',auth,admin,(req,res)=>{db.prepare('DELETE FROM servers WHERE id=?').run(req.params.id);res.json({ok:true})});
function crud(table,fields){app.get('/api/'+table,auth,(req,res)=>{let q=req.auth.role==='admin'?`SELECT * FROM ${table}`:`SELECT * FROM ${table} WHERE customer_id=?`;res.json(req.auth.role==='admin'?db.prepare(q).all():db.prepare(q).all(req.auth.customerId))});
app.post('/api/'+table,auth,(req,res)=>{let vals=fields.map(f=>req.body[f]??'');if(req.auth.role==='customer')vals=[req.auth.customerId,...vals],fields=['customer_id',...fields];let qs=fields.map(()=>'?').join(',');let r=db.prepare(`INSERT INTO ${table}(${fields.join(',')}) VALUES(${qs})`).run(...vals);res.json({id:r.lastInsertRowid})});
app.put('/api/'+table+'/:id',auth,(req,res)=>{let set=fields.map(f=>`${f}=?`).join(',');let vals=fields.map(f=>req.body[f]??'');let where=req.auth.role==='admin'?'id=?':'id=? AND customer_id=?';vals.push(req.params.id);if(req.auth.role==='customer')vals.push(req.auth.customerId);let r=db.prepare(`UPDATE ${table} SET ${set} WHERE ${where}`).run(...vals);res.json({ok:!!r.changes})});
app.delete('/api/'+table+'/:id',auth,(req,res)=>{let where=req.auth.role==='admin'?'id=?':'id=? AND customer_id=?';let vals=[req.params.id];if(req.auth.role==='customer')vals.push(req.auth.customerId);db.prepare(`DELETE FROM ${table} WHERE ${where}`).run(...vals);res.json({ok:true})})}
crud('plans',['name','gb','days']);crud('users',['name','plan','gb','date']);crud('services',['name','user','server','link']);
app.get('/api/logs',auth,(req,res)=>{let q=req.auth.role==='admin'?db.prepare('SELECT * FROM logs ORDER BY id DESC').all():db.prepare('SELECT * FROM logs WHERE customer_id=? ORDER BY id DESC').all(req.auth.customerId);res.json(q)});
app.get('/api/health',(req,res)=>res.json({ok:true,name:'STRIX VIP PANEL',version:'1.2.0'}));
app.listen(process.env.PORT||3000,()=>console.log('STRIX VIP PANEL backend running'));
