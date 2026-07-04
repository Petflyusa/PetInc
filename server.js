require('dotenv').config();
const express = require('express');
const path = require('path');
const session = require('express-session');
const MySQLStore = require('express-mysql-session')(session);
const mysql = require('mysql2/promise');
const nodemailer = require('nodemailer');
const bcrypt = require('bcryptjs');
const { initializeDatabase } = require('./db');
const fs = require('fs');
const multer = require('multer');
const crypto = require('crypto');

// File upload storage
const UPLOAD_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${crypto.randomUUID()}${ext}`);
  }
});
const upload = multer({ storage, limits: { fileSize: 20 * 1024 * 1024 } }); // 20MB

const app = express();
const PORT = process.env.PORT || 3000;

const crmPool = require('./db/crm');

// View engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Database pool - will be initialized after db.init
let pool;

// Email transporter
let transporter;

// =============================================================================
// EMAIL HELPER
// =============================================================================
function createTransporter() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'localhost',
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    }
  });
}

async function sendEmail(to, subject, text) {
  try {
    if (!transporter) {
      transporter = createTransporter();
    }
    await transporter.sendMail({
      from: process.env.SMTP_FROM || 'noreply@petinc.com',
      to,
      subject,
      text
    });
    return true;
  } catch (err) {
    console.error('Email error:', err.message);
    return false;
  }
}

// =============================================================================
// MIDDLEWARE
// =============================================================================
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Session middleware MUST be before static serving so API routes get session cookies
app.use(session({
  secret: process.env.SESSION_SECRET || 'petinc-secret-key',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24 * 60 * 60 * 1000, sameSite: 'lax' },
  store: new MySQLStore({
    host: process.env.DB_HOST || 'srv1134.hstgr.io',
    port: parseInt(process.env.DB_PORT || '3306'),
    user: process.env.DB_USER || 'u884869254_petflyinc',
    password: process.env.DB_PASSWORD || 'Jz10191019@@',
    database: process.env.DB_NAME || 'u884869254_petflyinc',
    clearExpired: true,
    autoRemove: 'interval',
    autoRemoveInterval: 60,
    createDatabaseTable: true
  })
}));

// Static files — after session so no impact on API routes
app.use(express.static(path.join(__dirname, 'public')));

// Admin auth middleware
function requireAdmin(req, res, next) {
  if (req.session && req.session.adminLoggedIn) {
    return next();
  }
  return res.status(401).json({ error: 'Unauthorized' });
}

// Client session auth middleware
function requireClient(req, res, next) {
  if (req.session && req.session.clientId) {
    return next();
  }
  // For session-poll requests from the client portal, return 200 with null
  // instead of 401 to prevent polling flood (client retries on 401)
  if (req.path === '/api/client/data' && req.method === 'GET') {
    return res.status(200).json({ client: null });
  }
  return res.status(401).json({ error: 'Not logged in' });
}

// =============================================================================
// PUBLIC VIEW ROUTES
// =============================================================================
app.get('/', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT section, data FROM landing_content');
    const content = {};
    for (const row of rows) {
      try { content[row.section] = JSON.parse(row.data); }
      catch { content[row.section] = row.data; }
    }
    res.render('index', { content });
  } catch (err) {
    res.render('index', { content: {} });
  }
});

app.get('/service', (req, res) => {
  res.render('service.ejs');
});

app.get('/quote', (req, res) => {
  res.render('quote.ejs');
});

app.get('/contact', (req, res) => {
  res.render('contact.ejs');
});

app.get('/regulations', (req, res) => {
  res.render('regulations.ejs');
});

// =============================================================================
// PUBLIC API ROUTES
// =============================================================================

// POST /api/quote - Submit quote request (honeypot protected)
app.post('/api/quote', async (req, res) => {
  try {
    // Honeypot check
    if (req.body.fax_only || req.body.email_addr) {
      return res.status(400).json({ success: false, message: 'Invalid submission' });
    }

    const {
      pet_type, pet_name, pet_weight, breed = '',
      origin_country, origin_city, dest_country, dest_city,
      travel_date, transport_type, contact_name, email,
      phone, referral, notes
    } = req.body;

    // Insert into quote_requests table
    const [result] = await pool.execute(
      `INSERT INTO quote_requests 
       (pet_type, pet_name, pet_weight, breed, origin_country, origin_city, 
        dest_country, dest_city, travel_date, transport_type, contact_name, 
        email, phone, referral, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [pet_type, pet_name, pet_weight, breed, origin_country, origin_city,
       dest_country, dest_city, travel_date, transport_type, contact_name,
       email, phone, referral, notes]
    );

    // Send email notification
    const emailSent = await sendEmail(
      process.env.NOTIFY_EMAIL || 'quotes@petinc.com',
      'New Quote Request - PetInc',
      `New quote request from ${contact_name} (${email}).\n\n` +
      `Pet: ${pet_type} ${breed}, Name: ${pet_name}, Weight: ${pet_weight}\n` +
      `Type: ${transport_type}\n` +
      `Route: ${origin_city} (${origin_country}) → ${dest_city} (${dest_country})\n` +
      `Travel Date: ${travel_date}\n` +
      `Phone: ${phone}\n` +
      `Referral: ${referral}\n` +
      `Notes: ${notes}`
    );

    res.json({ success: true, message: 'Quote submitted successfully', emailSent });
  } catch (err) {
    console.error('Quote error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// POST /api/contact - Submit contact message (honeypot protected)
app.post('/api/contact', async (req, res) => {
  try {
    // Honeypot check
    if (req.body.fax_only || req.body.email_addr) {
      return res.status(400).json({ success: false, message: 'Invalid submission' });
    }

    const { name, email, phone, subject, message } = req.body;

    // Insert into contact_messages table
    const [result] = await pool.execute(
      `INSERT INTO contact_messages (name, email, phone, subject, message) VALUES (?, ?, ?, ?, ?)`,
      [name, email, phone, subject, message]
    );

    // Send email notification
    const emailSent = await sendEmail(
      process.env.NOTIFY_EMAIL || 'contact@petinc.com',
      `Contact Form: ${subject}`,
      `Name: ${name}\nEmail: ${email}\nPhone: ${phone}\nSubject: ${subject}\nMessage: ${message}`
    );

    res.json({ success: true, message: 'Message sent successfully', emailSent });
  } catch (err) {
    console.error('Contact error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// GET /api/messages - Get all message threads (original React CRM)
app.get('/api/messages', (req, res) => {
  try {
    const messagesFilePath = path.join(__dirname, 'messages.json');
    if (fs.existsSync(messagesFilePath)) {
      const fileData = fs.readFileSync(messagesFilePath, 'utf8');
      res.json(JSON.parse(fileData));
    } else {
      res.json([]);
    }
  } catch (error) {
    console.error('Error reading messages:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// POST /api/messages - Send a message in a thread (original React CRM)
app.post('/api/messages', (req, res) => {
  try {
    const { threadId, text, sender } = req.body;
    if (!threadId || !text || !sender) {
      return res.status(400).json({ error: 'Missing required fields: threadId, text, sender' });
    }

    const messagesFilePath = path.join(__dirname, 'messages.json');
    let messagesData = [];

    if (fs.existsSync(messagesFilePath)) {
      const fileData = fs.readFileSync(messagesFilePath, 'utf8');
      messagesData = JSON.parse(fileData);
    }

    let thread = messagesData.find(t => t.id === threadId);
    if (!thread) {
      thread = {
        id: threadId,
        clientName: threadId.charAt(0).toUpperCase() + threadId.slice(1) + ' Family',
        route: 'Unknown Route',
        ref: '#QL-' + Math.floor(10000 + Math.random() * 90000),
        avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&q=80&w=100',
        messages: []
      };
      messagesData.push(thread);
    }

    const newMessage = {
      id: 'm' + Date.now(),
      sender,
      text,
      timestamp: new Date().toISOString()
    };

    thread.messages.push(newMessage);

    fs.writeFileSync(messagesFilePath, JSON.stringify(messagesData, null, 2), 'utf8');
    res.status(201).json(newMessage);
  } catch (error) {
    console.error('Error writing message:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// POST /api/broadcast - Broadcast message to all threads (original React CRM)
app.post('/api/broadcast', (req, res) => {
  try {
    const { text, sender } = req.body;
    if (!text || !sender) {
      return res.status(400).json({ error: 'Missing text or sender' });
    }

    const messagesFilePath = path.join(__dirname, 'messages.json');
    let messagesData = [];

    if (fs.existsSync(messagesFilePath)) {
      const fileData = fs.readFileSync(messagesFilePath, 'utf8');
      messagesData = JSON.parse(fileData);
    }

    const newMessage = {
      id: 'm' + Date.now(),
      sender,
      text,
      timestamp: new Date().toISOString()
    };

    // Add to all threads
    for (const thread of messagesData) {
      thread.messages.push({ ...newMessage, id: 'm' + Date.now() + '_' + thread.id });
    }

    fs.writeFileSync(messagesFilePath, JSON.stringify(messagesData, null, 2), 'utf8');
    res.status(201).json({ success: true, message: 'Broadcast sent' });
  } catch (error) {
    console.error('Error broadcasting:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// =============================================================================
// FILE STORAGE API — local replacement for Supabase Storage
// =============================================================================

// GET /api/files/:bucket/:filename — serve uploaded files (public read)
// Also handles /api/files/uploads/:filename (our upload path)
app.get('/api/files/:bucket/:filename', (req, res) => {
  const { bucket, filename } = req.params;
  const safeBucket = path.basename(bucket);
  // Files saved by /api/files/upload-json land directly in UPLOAD_DIR/filename
  // Files from multer land in UPLOAD_DIR/bucket/filename
  let filePath = path.join(UPLOAD_DIR, filename);
  if (!fs.existsSync(filePath)) {
    filePath = path.join(UPLOAD_DIR, safeBucket, filename);
  }
  if (!fs.existsSync(filePath)) {
    filePath = path.join(__dirname, 'public', 'uploads', filename);
  }
  if (fs.existsSync(filePath)) {
    res.sendFile(filePath);
  } else {
    res.status(404).json({ error: 'File not found' });
  }
});

// POST /api/files/upload — upload a file (returns public URL)
app.post('/api/files/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file provided' });
  const publicUrl = `/api/files/uploads/${req.file.filename}`;
  res.json({ publicUrl, filename: req.file.filename, path: req.file.path });
});

// POST /api/files/upload-json — JSON base64 upload (for CRM storage polyfill rewrites)
app.post('/api/files/upload-json', (req, res) => {
  try {
    console.log('[upload-json] req.body:', JSON.stringify(req.body).substring(0, 200));
    const { bucket, filename, data: b64, ext } = req.body;
    if (!b64) return res.status(400).json({ error: 'No data provided' });
    const buf = Buffer.from(b64, 'base64');
    const safeName = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext || 'bin'}`;
    const filePath = path.join(UPLOAD_DIR, safeName);
    fs.writeFileSync(filePath, buf);
    res.json({ path: `/api/files/uploads/${safeName}`, publicUrl: `/api/files/uploads/${safeName}`, error: null });
  } catch (e) {
    console.error('[upload-json] error:', e);
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/files/:bucket/:filename — delete a file
app.delete('/api/files/:bucket/:filename', (req, res) => {
  const { bucket, filename } = req.params;
  const safeBucket = path.basename(bucket);
  const filePath = path.join(UPLOAD_DIR, safeBucket, filename);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
    res.json({ success: true });
  } else {
    res.status(404).json({ error: 'File not found' });
  }
});

// POST /api/files/get-url — return a public URL for a given bucket+filename
app.post('/api/files/get-url', (req, res) => {
  const { bucket, filename } = req.body;
  if (!bucket || !filename) return res.status(400).json({ error: 'Missing bucket or filename' });
  const publicUrl = `/api/files/${encodeURIComponent(bucket)}/${encodeURIComponent(filename)}`;
  res.json({ publicUrl });
});

// GET /api/files/list — list files in a bucket (query param: ?bucket=uploads)
app.get('/api/files/list', (req, res) => {
  const bucket = req.query.bucket || 'uploads';
  const dir = path.join(UPLOAD_DIR, path.basename(bucket));
  if (!fs.existsSync(dir)) return res.json([]);
  const files = fs.readdirSync(dir).map(f => ({ name: f, url: `/api/files/${encodeURIComponent(bucket)}/${encodeURIComponent(f)}` }));
  res.json(files);
});

// =============================================================================
// ADMIN API ROUTES (Protected)
// =============================================================================

// GET /api/countries - Get all country regulations
app.get('/api/countries', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM country_regulations ORDER BY country_name');
    res.json(rows);
  } catch (err) {
    console.error('Countries error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/airlines - Get all airline regulations
app.get('/api/airlines', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM airline_regulations ORDER BY airline_name');
    res.json(rows);
  } catch (err) {
    console.error('Airlines error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/regulations/country/:id - Get one country regulation
app.get('/api/regulations/country/:id', async (req, res) => {
  try {
    const [rows] = await pool.execute(
      'SELECT * FROM country_regulations WHERE id = ?',
      [req.params.id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Not found' });
    }
    res.json(rows[0]);
  } catch (err) {
    console.error('Country regulation error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/regulations/airline/:id - Get one airline regulation
app.get('/api/regulations/airline/:id', async (req, res) => {
  try {
    const [rows] = await pool.execute(
      'SELECT * FROM airline_regulations WHERE id = ?',
      [req.params.id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Not found' });
    }
    res.json(rows[0]);
  } catch (err) {
    console.error('Airline regulation error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// =============================================================================
// ADMIN AUTH ROUTES
// =============================================================================

// GET /admin - Serve admin CMS SPA (static files handle this via app.use below)

// GET /admin/login - Render admin login page
app.get('/admin/login', (req, res) => {
  res.render('admin-login.ejs');
});

// POST /admin/login - Verify admin credentials
// Supports both EJS form (password only) and SPA (username + password)
app.post('/admin/login', (req, res) => {
  const { username, password, login_password } = req.body;
  const pw = password || login_password;
  const user = username || 'admin';
  // Admin login: username='admin' + password must match ADMIN_PASSWORD
  if (user === 'admin' && pw === process.env.ADMIN_PASSWORD) {
    req.session.adminLoggedIn = true;
    // SPA clients expect JSON or redirect; EJS form expects redirect
    if (req.xhr || req.headers.accept?.includes('json')) {
      return res.json({ success: true });
    }
    return res.redirect('/admin');
  }
  if (req.xhr || req.headers.accept?.includes('json')) {
    return res.status(401).json({ success: false, error: 'Invalid credentials' });
  }
  res.redirect('/admin/login?error=1');
});

// GET /admin/logout - Destroy session and redirect
app.get('/admin/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/admin/login');
  });
});

// GET /admin/me - Check if admin is logged in (JSON for SPA)
app.get('/admin/me', (req, res) => {
  if (req.session && req.session.adminLoggedIn) {
    res.json({ loggedIn: true });
  } else {
    res.status(401).json({ loggedIn: false });
  }
});

// =============================================================================
// PUBLIC LANDING CONTENT API — no auth needed
// =============================================================================
app.get('/api/landing/:section', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT data FROM landing_content WHERE section = ?', [req.params.section]);
    if (!rows[0]) return res.status(404).json({ error: 'Section not found' });
    try { res.json(JSON.parse(rows[0].data)); }
    catch { res.json(rows[0].data); }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/landing', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT section, data FROM landing_content');
    const result = {};
    for (const row of rows) result[row.section] = row.data;
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =============================================================================
// CRM API ROUTES
// =============================================================================

// GET /api/crm/ — base path (no-op, prevents 404)
app.get('/api/crm/', (req, res) => res.json({ error: 'Use /api/crm/{clients,pets,documents,quotes,journeys}' }));

// CRM Auth — maps to supabase-replace.js auth interceptor
// POST /api/crm/auth/login
app.post('/api/crm/auth/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'email and password required' });
  try {
    const [rows] = await crmPool.query('SELECT * FROM crm_clients WHERE email = ? AND password = ?', [email, password]);
    if (!rows.length) return res.status(401).json({ error: 'Invalid credentials' });
    const client = rows[0];
    req.session.crmClientId = client.id;
    req.session.crmClientEmail = client.email;
    req.session.save(() => {
      res.json({
        user: { id: client.id, email: client.email, name: client.name },
        session: { client_id: client.id, email: client.email }
      });
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/crm/auth/register
app.post('/api/crm/auth/register', async (req, res) => {
  const { email, password, name } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'email and password required' });
  try {
    const [existing] = await crmPool.query('SELECT id FROM crm_clients WHERE email = ?', [email]);
    if (existing.length) return res.status(409).json({ error: 'Email already registered' });
    const [result] = await crmPool.query(
      'INSERT INTO crm_clients (name, email, password, status) VALUES (?,?,?,?)',
      [name || email.split('@')[0], email, password, 'active']
    );
    req.session.crmClientId = result.insertId;
    req.session.crmClientEmail = email;
    req.session.save(() => {
      res.status(201).json({
        user: { id: result.insertId, email, name: name || email.split('@')[0] },
        session: { client_id: result.insertId, email }
      });
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/crm/auth/session
app.get('/api/crm/auth/session', (req, res) => {
  if (req.session && req.session.crmClientId) {
    res.json({ user: { id: req.session.crmClientId, email: req.session.crmClientEmail } });
  } else {
    res.json({ user: null });
  }
});

// POST /api/crm/auth/logout
app.post('/api/crm/auth/logout', (req, res) => {
  req.session.destroy(() => res.json({ error: null }));
});

// CRM Clients
app.get('/api/crm/clients', async (req, res) => {
  try {
    const [rows] = await crmPool.query('SELECT * FROM crm_clients ORDER BY id DESC');
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/crm/clients/:id', async (req, res) => {
  try {
    const [rows] = await crmPool.query('SELECT * FROM crm_clients WHERE id = ?', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/crm/clients', async (req, res) => {
  const { id, name, initials, location, address, phone, email, status, password } = req.body;
  try {
    // upsert: if id provided and exists, update; otherwise insert
    if (id) {
      const [existing] = await crmPool.query('SELECT id FROM crm_clients WHERE id = ?', [id]);
      if (existing.length) {
        await crmPool.query(
          'UPDATE crm_clients SET name=?,initials=?,location=?,address=?,phone=?,email=?,status=?,password=? WHERE id=?',
          [name, initials, location, address, phone, email, status, password, id]
        );
        const [rows] = await crmPool.query('SELECT * FROM crm_clients WHERE id = ?', [id]);
        return res.json(rows[0]);
      }
    }
    const [result] = await crmPool.query(
      'INSERT INTO crm_clients (name, initials, location, address, phone, email, status, password) VALUES (?,?,?,?,?,?,?,?)',
      [name, initials, location, address, phone, email, status || 'active', password]
    );
    const [rows] = await crmPool.query('SELECT * FROM crm_clients WHERE id = ?', [result.insertId]);
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/crm/clients/:id', async (req, res) => {
  const { name, initials, location, address, phone, email, status, password } = req.body;
  try {
    await crmPool.query(
      'UPDATE crm_clients SET name=?,initials=?,location=?,address=?,phone=?,email=?,status=?,password=? WHERE id=?',
      [name, initials, location, address, phone, email, status, password, req.params.id]
    );
    const [rows] = await crmPool.query('SELECT * FROM crm_clients WHERE id = ?', [req.params.id]);
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/crm/clients/:id', async (req, res) => {
  try {
    await crmPool.query('DELETE FROM crm_clients WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// CRM Pets
app.get('/api/crm/pets', async (req, res) => {
  try {
    let sql = 'SELECT * FROM crm_pets';
    const params = [];
    if (req.query.client_id) { sql += ' WHERE client_id = ?'; params.push(req.query.client_id); }
    sql += ' ORDER BY id DESC';
    const [rows] = await crmPool.query(sql, params);
    rows.forEach(r => { if (r.details) r.details = JSON.parse(r.details); });
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/crm/pets/:id', async (req, res) => {
  try {
    const [rows] = await crmPool.query('SELECT * FROM crm_pets WHERE id = ?', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    if (rows[0].details) rows[0].details = JSON.parse(rows[0].details);
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/crm/pets', async (req, res) => {
  const { id, client_id, name, breed, type, origin, destination, image, status, status_color, details } = req.body;
  try {
    const detailsStr = typeof details === 'object' ? JSON.stringify(details) : details;
    // upsert: if id provided and exists, update; otherwise insert
    if (id) {
      const [existing] = await crmPool.query('SELECT id FROM crm_pets WHERE id = ?', [id]);
      if (existing.length) {
        await crmPool.query(
          'UPDATE crm_pets SET client_id=?,name=?,breed=?,type=?,origin=?,destination=?,image=?,status=?,status_color=?,details=? WHERE id=?',
          [client_id, name, breed, type, origin, destination, image, status, status_color, detailsStr, id]
        );
        const [rows] = await crmPool.query('SELECT * FROM crm_pets WHERE id = ?', [id]);
        if (rows[0].details) rows[0].details = JSON.parse(rows[0].details);
        return res.json(rows[0]);
      }
    }
    const [result] = await crmPool.query(
      'INSERT INTO crm_pets (client_id,name,breed,type,origin,destination,image,status,status_color,details) VALUES (?,?,?,?,?,?,?,?,?,?)',
      [client_id, name, breed, type, origin, destination, image, status, status_color, detailsStr]
    );
    const [rows] = await crmPool.query('SELECT * FROM crm_pets WHERE id = ?', [result.insertId]);
    if (rows[0].details) rows[0].details = JSON.parse(rows[0].details);
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/crm/pets/:id', async (req, res) => {
  const { client_id, name, breed, type, origin, destination, image, status, status_color, details } = req.body;
  try {
    const detailsStr = typeof details === 'object' ? JSON.stringify(details) : details;
    await crmPool.query(
      'UPDATE crm_pets SET client_id=?,name=?,breed=?,type=?,origin=?,destination=?,image=?,status=?,status_color=?,details=? WHERE id=?',
      [client_id, name, breed, type, origin, destination, image, status, status_color, detailsStr, req.params.id]
    );
    const [rows] = await crmPool.query('SELECT * FROM crm_pets WHERE id = ?', [req.params.id]);
    if (rows[0].details) rows[0].details = JSON.parse(rows[0].details);
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/crm/pets/:id', async (req, res) => {
  try {
    await crmPool.query('DELETE FROM crm_pets WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// CRM Documents
app.get('/api/crm/documents', async (req, res) => {
  try {
    let sql = 'SELECT * FROM crm_documents';
    const params = [];
    const conditions = [];
    if (req.query.client_id) { conditions.push('client_id = ?'); params.push(req.query.client_id); }
    if (req.query.pet_id) { conditions.push('pet_id = ?'); params.push(req.query.pet_id); }
    if (conditions.length) sql += ' WHERE ' + conditions.join(' AND ');
    sql += ' ORDER BY id DESC';
    const [rows] = await crmPool.query(sql, params);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/crm/documents/:id', async (req, res) => {
  try {
    const [rows] = await crmPool.query('SELECT * FROM crm_documents WHERE id = ?', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/crm/documents', async (req, res) => {
  const { id, client_id, pet_id, name, type, expiry_date, status, icon, file_url } = req.body;
  try {
    // upsert: if id provided and exists, update; otherwise insert
    if (id) {
      const [existing] = await crmPool.query('SELECT id FROM crm_documents WHERE id = ?', [id]);
      if (existing.length) {
        await crmPool.query(
          'UPDATE crm_documents SET client_id=?,pet_id=?,name=?,type=?,expiry_date=?,status=?,icon=?,file_url=? WHERE id=?',
          [client_id, pet_id||null, name, type, expiry_date, status, icon, file_url, id]
        );
        const [rows] = await crmPool.query('SELECT * FROM crm_documents WHERE id = ?', [id]);
        return res.json(rows[0]);
      }
    }
    const [result] = await crmPool.query(
      'INSERT INTO crm_documents (client_id,pet_id,name,type,expiry_date,status,icon,file_url) VALUES (?,?,?,?,?,?,?,?)',
      [client_id, pet_id||null, name, type, expiry_date, status, icon, file_url]
    );
    const [rows] = await crmPool.query('SELECT * FROM crm_documents WHERE id = ?', [result.insertId]);
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/crm/documents/:id', async (req, res) => {
  const { client_id, pet_id, name, type, expiry_date, status, icon, file_url } = req.body;
  try {
    await crmPool.query(
      'UPDATE crm_documents SET client_id=?,pet_id=?,name=?,type=?,expiry_date=?,status=?,icon=?,file_url=? WHERE id=?',
      [client_id, pet_id||null, name, type, expiry_date, status, icon, file_url, req.params.id]
    );
    const [rows] = await crmPool.query('SELECT * FROM crm_documents WHERE id = ?', [req.params.id]);
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/crm/documents/:id', async (req, res) => {
  try {
    await crmPool.query('DELETE FROM crm_documents WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// CRM Quotes
app.get('/api/crm/quotes', async (req, res) => {
  try {
    let sql = 'SELECT * FROM crm_quotes';
    const params = [];
    if (req.query.client_id) { sql += ' WHERE client_id = ?'; params.push(req.query.client_id); }
    sql += ' ORDER BY id DESC';
    const [rows] = await crmPool.query(sql, params);
    rows.forEach(r => { if (r.pet_quotes) r.pet_quotes = JSON.parse(r.pet_quotes); });
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/crm/quotes/:id', async (req, res) => {
  try {
    const [rows] = await crmPool.query('SELECT * FROM crm_quotes WHERE id = ?', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    if (rows[0].pet_quotes) rows[0].pet_quotes = JSON.parse(rows[0].pet_quotes);
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/crm/quotes', async (req, res) => {
  const { id, client_id, ref, route, status, pet_quotes } = req.body;
  try {
    const petQuotesStr = typeof pet_quotes === 'object' ? JSON.stringify(pet_quotes) : pet_quotes;
    const [existing] = await crmPool.query('SELECT id FROM crm_quotes WHERE id = ?', [id]);
    if (existing.length) {
      await crmPool.query('UPDATE crm_quotes SET client_id=?,ref=?,route=?,status=?,pet_quotes=? WHERE id=?',
        [client_id, ref, route, status, petQuotesStr, id]);
    } else {
      await crmPool.query('INSERT INTO crm_quotes (id,client_id,ref,route,status,pet_quotes) VALUES (?,?,?,?,?,?)',
        [id, client_id, ref, route, status, petQuotesStr]);
    }
    const [rows] = await crmPool.query('SELECT * FROM crm_quotes WHERE id = ?', [id]);
    if (rows[0].pet_quotes) rows[0].pet_quotes = JSON.parse(rows[0].pet_quotes);
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/crm/quotes/:id', async (req, res) => {
  const { client_id, ref, route, status, pet_quotes } = req.body;
  try {
    const petQuotesStr = typeof pet_quotes === 'object' ? JSON.stringify(pet_quotes) : pet_quotes;
    await crmPool.query('UPDATE crm_quotes SET client_id=?,ref=?,route=?,status=?,pet_quotes=? WHERE id=?',
      [client_id, ref, route, status, petQuotesStr, req.params.id]);
    const [rows] = await crmPool.query('SELECT * FROM crm_quotes WHERE id = ?', [req.params.id]);
    if (rows[0].pet_quotes) rows[0].pet_quotes = JSON.parse(rows[0].pet_quotes);
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/crm/quotes/:id', async (req, res) => {
  try {
    await crmPool.query('DELETE FROM crm_quotes WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// CRM Journeys
app.get('/api/crm/journeys', async (req, res) => {
  try {
    let sql = 'SELECT * FROM crm_journeys';
    const params = [];
    const conditions = [];
    if (req.query.client_id) { conditions.push('client_id = ?'); params.push(req.query.client_id); }
    if (req.query.pet_id) { conditions.push('pet_id = ?'); params.push(req.query.pet_id); }
    if (conditions.length) sql += ' WHERE ' + conditions.join(' AND ');
    sql += ' ORDER BY id DESC';
    const [rows] = await crmPool.query(sql, params);
    rows.forEach(r => { if (r.stages) r.stages = JSON.parse(r.stages); });
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/crm/journeys/:id', async (req, res) => {
  try {
    const [rows] = await crmPool.query('SELECT * FROM crm_journeys WHERE id = ?', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    if (rows[0].stages) rows[0].stages = JSON.parse(rows[0].stages);
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/crm/journeys', async (req, res) => {
  const { id, client_id, pet_id, overall_progress, current_location, estimated_arrival, airline, flight_no, tracking_id, stages } = req.body;
  try {
    const stagesStr = typeof stages === 'object' ? JSON.stringify(stages) : stages;
    // upsert: if id provided and exists, update; otherwise insert
    if (id) {
      const [existing] = await crmPool.query('SELECT id FROM crm_journeys WHERE id = ?', [id]);
      if (existing.length) {
        await crmPool.query(
          'UPDATE crm_journeys SET client_id=?,pet_id=?,overall_progress=?,current_location=?,estimated_arrival=?,airline=?,flight_no=?,tracking_id=?,stages=? WHERE id=?',
          [client_id, pet_id, overall_progress||0, current_location, estimated_arrival, airline, flight_no, tracking_id, stagesStr, id]
        );
        const [rows] = await crmPool.query('SELECT * FROM crm_journeys WHERE id = ?', [id]);
        if (rows[0].stages) rows[0].stages = JSON.parse(rows[0].stages);
        return res.json(rows[0]);
      }
    }
    await crmPool.query(
      'INSERT INTO crm_journeys (id,client_id,pet_id,overall_progress,current_location,estimated_arrival,airline,flight_no,tracking_id,stages) VALUES (?,?,?,?,?,?,?,?,?,?)',
      [id, client_id, pet_id, overall_progress||0, current_location, estimated_arrival, airline, flight_no, tracking_id, stagesStr]
    );
    const [rows] = await crmPool.query('SELECT * FROM crm_journeys WHERE id = ?', [id]);
    if (rows[0].stages) rows[0].stages = JSON.parse(rows[0].stages);
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/crm/journeys/:id', async (req, res) => {
  const { client_id, pet_id, overall_progress, current_location, estimated_arrival, airline, flight_no, tracking_id, stages } = req.body;
  try {
    const stagesStr = typeof stages === 'object' ? JSON.stringify(stages) : stages;
    await crmPool.query(
      'UPDATE crm_journeys SET client_id=?,pet_id=?,overall_progress=?,current_location=?,estimated_arrival=?,airline=?,flight_no=?,tracking_id=?,stages=? WHERE id=?',
      [client_id, pet_id, overall_progress, current_location, estimated_arrival, airline, flight_no, tracking_id, stagesStr, req.params.id]
    );
    const [rows] = await crmPool.query('SELECT * FROM crm_journeys WHERE id = ?', [req.params.id]);
    if (rows[0].stages) rows[0].stages = JSON.parse(rows[0].stages);
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/crm/journeys/:id', async (req, res) => {
  try {
    await crmPool.query('DELETE FROM crm_journeys WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// =============================================================================
// ADMIN API ROUTES (Protected)
// =============================================================================

// All /api/admin/* routes require auth
app.use('/api/admin', requireAdmin);

// Landing content write routes (protected by requireAdmin above)
// PUT /api/admin/landing/:section — upsert a landing section
app.put('/api/admin/landing/:section', async (req, res) => {
  try {
    await pool.query(
      'INSERT INTO landing_content (section, data) VALUES (?, ?) ON DUPLICATE KEY UPDATE data=VALUES(data)',
      [req.params.section, JSON.stringify(req.body)]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =============================================================================
// ADMIN PET CRUD ENDPOINTS (REST-style)
// =============================================================================

// GET /api/admin/list_pets - List all pets
app.get('/api/admin/list_pets', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM client_pets ORDER BY created_at DESC');
    res.json(rows);
  } catch (err) {
    console.error('List pets error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/admin/get_pet - Get single pet by id
app.get('/api/admin/get_pet', async (req, res) => {
  try {
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: 'Pet ID required' });
    const [rows] = await pool.execute('SELECT * FROM client_pets WHERE id = ?', [id]);
    res.json(rows[0] || null);
  } catch (err) {
    console.error('Get pet error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/admin/add_pet - Add a new pet
app.post('/api/admin/add_pet', async (req, res) => {
  try {
    const { client_id, pet_name, pet_type, breed, weight, microchip, photo_url } = req.body;
    const [result] = await pool.execute(
      'INSERT INTO client_pets (client_id, pet_name, pet_type, breed, weight, microchip, photo_url) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [client_id, pet_name, pet_type, breed, weight, microchip, photo_url]
    );
    res.json({ success: true, id: result.insertId });
  } catch (err) {
    console.error('Add pet error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/admin/update_pet - Update an existing pet
app.post('/api/admin/update_pet', async (req, res) => {
  try {
    const { id, client_id, pet_name, pet_type, breed, weight, microchip, photo_url } = req.body;
    if (!id) return res.status(400).json({ error: 'Pet ID required' });
    await pool.execute(
      'UPDATE client_pets SET client_id = ?, pet_name = ?, pet_type = ?, breed = ?, weight = ?, microchip = ?, photo_url = ? WHERE id = ?',
      [client_id, pet_name, pet_type, breed, weight, microchip, photo_url, id]
    );
    res.json({ success: true });
  } catch (err) {
    console.error('Update pet error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /api/admin/delete_pet - Delete a pet
app.delete('/api/admin/delete_pet', async (req, res) => {
  try {
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: 'Pet ID required' });
    await pool.execute('DELETE FROM client_pets WHERE id = ?', [id]);
    res.json({ success: true });
  } catch (err) {
    console.error('Delete pet error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Unified admin API handler for all CRUD operations
app.all('/api/admin/:action', async (req, res) => {
  const { action } = req.params;
  const { id } = req.query;

  try {
    // ========== QUOTE REQUESTS ==========
    if (action === 'get_quote') {
      const [rows] = await pool.execute('SELECT * FROM quote_requests WHERE id = ?', [id]);
      return res.json(rows[0] || null);
    }

    if (action === 'update_quote') {
      const { status, notes } = req.body;
      await pool.execute(
        'UPDATE quote_requests SET status = ?, notes = ? WHERE id = ?',
        [status, notes, id]
      );
      return res.json({ success: true });
    }

    if (action === 'delete_quote') {
      await pool.execute('DELETE FROM quote_requests WHERE id = ?', [id]);
      return res.json({ success: true });
    }

    if (action === 'list_quotes') {
      const [rows] = await pool.query('SELECT * FROM quote_requests ORDER BY created_at DESC');
      return res.json(rows);
    }

    // ========== CONTACT MESSAGES ==========
    if (action === 'get_contact') {
      const [rows] = await pool.execute('SELECT * FROM contact_messages WHERE id = ?', [id]);
      return res.json(rows[0] || null);
    }

    if (action === 'update_contact') {
      // Contact messages don't have status field in schema, but we can add notes
      const { message } = req.body;
      await pool.execute(
        'UPDATE contact_messages SET message = ? WHERE id = ?',
        [message, id]
      );
      return res.json({ success: true });
    }

    if (action === 'delete_contact') {
      await pool.execute('DELETE FROM contact_messages WHERE id = ?', [id]);
      return res.json({ success: true });
    }

    if (action === 'list_contacts') {
      const [rows] = await pool.query('SELECT * FROM contact_messages ORDER BY created_at DESC');
      return res.json(rows);
    }

    // ========== COUNTRY REGULATIONS ==========
    if (action === 'get_country') {
      const [rows] = await pool.execute('SELECT * FROM country_regulations WHERE id = ?', [id]);
      return res.json(rows[0] || null);
    }

    if (action === 'add_country') {
      const { country_code, country_name, pet_types, microchip, rabies_vaccination,
              health_certificate, import_permit, quarantine_days, additional_requirements,
              preparation_time, restricted_breeds, contact_info } = req.body;
      const [result] = await pool.execute(
        `INSERT INTO country_regulations 
         (country_code, country_name, pet_types, microchip, rabies_vaccination,
          health_certificate, import_permit, quarantine_days, additional_requirements,
          preparation_time, restricted_breeds, contact_info)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [country_code, country_name, pet_types, microchip, rabies_vaccination,
         health_certificate, import_permit, quarantine_days, additional_requirements,
         preparation_time, restricted_breeds, contact_info]
      );
      return res.json({ success: true, id: result.insertId });
    }

    if (action === 'update_country') {
      const { country_code, country_name, pet_types, microchip, rabies_vaccination,
              health_certificate, import_permit, quarantine_days, additional_requirements,
              preparation_time, restricted_breeds, contact_info } = req.body;
      await pool.execute(
        `UPDATE country_regulations SET 
         country_code = ?, country_name = ?, pet_types = ?, microchip = ?,
         rabies_vaccination = ?, health_certificate = ?, import_permit = ?,
         quarantine_days = ?, additional_requirements = ?, preparation_time = ?,
         restricted_breeds = ?, contact_info = ?
         WHERE id = ?`,
        [country_code, country_name, pet_types, microchip, rabies_vaccination,
         health_certificate, import_permit, quarantine_days, additional_requirements,
         preparation_time, restricted_breeds, contact_info, id]
      );
      return res.json({ success: true });
    }

    if (action === 'delete_country') {
      await pool.execute('DELETE FROM country_regulations WHERE id = ?', [id]);
      return res.json({ success: true });
    }

    if (action === 'list_countries') {
      const [rows] = await pool.query('SELECT * FROM country_regulations ORDER BY country_name');
      return res.json(rows);
    }

    // ========== AIRLINE REGULATIONS ==========
    if (action === 'get_airline') {
      const [rows] = await pool.execute('SELECT * FROM airline_regulations WHERE id = ?', [id]);
      return res.json(rows[0] || null);
    }

    if (action === 'add_airline') {
      const { airline_name, carry_on, checked_bag, cargo, pet_fee,
              size_limits, breed_restrictions, booking_info, crate_requirements } = req.body;
      const [result] = await pool.execute(
        `INSERT INTO airline_regulations 
         (airline_name, carry_on, checked_bag, cargo, pet_fee,
          size_limits, breed_restrictions, booking_info, crate_requirements)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [airline_name, carry_on, checked_bag, cargo, pet_fee,
         size_limits, breed_restrictions, booking_info, crate_requirements]
      );
      return res.json({ success: true, id: result.insertId });
    }

    if (action === 'update_airline') {
      const { airline_name, carry_on, checked_bag, cargo, pet_fee,
              size_limits, breed_restrictions, booking_info, crate_requirements } = req.body;
      await pool.execute(
        `UPDATE airline_regulations SET 
         airline_name = ?, carry_on = ?, checked_bag = ?, cargo = ?,
         pet_fee = ?, size_limits = ?, breed_restrictions = ?,
         booking_info = ?, crate_requirements = ?
         WHERE id = ?`,
        [airline_name, carry_on, checked_bag, cargo, pet_fee,
         size_limits, breed_restrictions, booking_info, crate_requirements, id]
      );
      return res.json({ success: true });
    }

    if (action === 'delete_airline') {
      await pool.execute('DELETE FROM airline_regulations WHERE id = ?', [id]);
      return res.json({ success: true });
    }

    if (action === 'list_airlines') {
      const [rows] = await pool.query('SELECT * FROM airline_regulations ORDER BY airline_name');
      return res.json(rows);
    }

    // ========== CLIENTS ==========
    if (action === 'list_clients') {
      const [rows] = await pool.query('SELECT * FROM clients ORDER BY created_at DESC');
      return res.json(rows);
    }

    if (action === 'get_client') {
      const [rows] = await pool.execute('SELECT * FROM clients WHERE id = ?', [id]);
      return res.json(rows[0] || null);
    }

    if (action === 'add_client') {
      const { username, password, full_name, email, phone } = req.body;
      const [result] = await pool.execute(
        'INSERT INTO clients (username, password, full_name, email, phone) VALUES (?, ?, ?, ?, ?)',
        [username, password, full_name, email, phone]
      );
      return res.json({ success: true, id: result.insertId });
    }

    if (action === 'update_client') {
      const { username, full_name, email, phone } = req.body;
      await pool.execute(
        'UPDATE clients SET username = ?, full_name = ?, email = ?, phone = ? WHERE id = ?',
        [username, full_name, email, phone, id]
      );
      return res.json({ success: true });
    }

    if (action === 'delete_client') {
      await pool.execute('DELETE FROM clients WHERE id = ?', [id]);
      return res.json({ success: true });
    }

    // ========== PETS (client_pets) ==========
    if (action === 'list_pets') {
      const [rows] = await pool.query('SELECT * FROM client_pets ORDER BY created_at DESC');
      return res.json(rows);
    }

    if (action === 'get_pet') {
      const [rows] = await pool.execute('SELECT * FROM client_pets WHERE id = ?', [id]);
      return res.json(rows[0] || null);
    }

    if (action === 'add_pet') {
      const { client_id, pet_name, pet_type, breed, weight, microchip, photo_url } = req.body;
      const [result] = await pool.execute(
        'INSERT INTO client_pets (client_id, pet_name, pet_type, breed, weight, microchip, photo_url) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [client_id, pet_name, pet_type, breed, weight, microchip, photo_url]
      );
      return res.json({ success: true, id: result.insertId });
    }

    if (action === 'update_pet') {
      const { client_id, pet_name, pet_type, breed, weight, microchip, photo_url } = req.body;
      await pool.execute(
        'UPDATE client_pets SET client_id = ?, pet_name = ?, pet_type = ?, breed = ?, weight = ?, microchip = ?, photo_url = ? WHERE id = ?',
        [client_id, pet_name, pet_type, breed, weight, microchip, photo_url, id]
      );
      return res.json({ success: true });
    }

    if (action === 'delete_pet') {
      await pool.execute('DELETE FROM client_pets WHERE id = ?', [id]);
      return res.json({ success: true });
    }

    // ========== SERVICES (client_services) ==========
    if (action === 'list_services') {
      const [rows] = await pool.query('SELECT * FROM client_services ORDER BY created_at DESC');
      return res.json(rows);
    }

    if (action === 'get_service') {
      const [rows] = await pool.execute('SELECT * FROM client_services WHERE id = ?', [id]);
      return res.json(rows[0] || null);
    }

    if (action === 'add_service') {
      const { client_id, pet_id, origin_country, origin_city, dest_country, dest_city,
              transport_type, travel_date, current_status } = req.body;
      const [result] = await pool.execute(
        `INSERT INTO client_services 
         (client_id, pet_id, origin_country, origin_city, dest_country, dest_city,
          transport_type, travel_date, current_status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [client_id, pet_id, origin_country, origin_city, dest_country, dest_city,
         transport_type, travel_date, current_status]
      );
      return res.json({ success: true, id: result.insertId });
    }

    if (action === 'update_service') {
      const { client_id, pet_id, origin_country, origin_city, dest_country, dest_city,
              transport_type, travel_date, current_status } = req.body;
      await pool.execute(
        `UPDATE client_services SET 
         client_id = ?, pet_id = ?, origin_country = ?, origin_city = ?,
         dest_country = ?, dest_city = ?, transport_type = ?,
         travel_date = ?, current_status = ?
         WHERE id = ?`,
        [client_id, pet_id, origin_country, origin_city, dest_country, dest_city,
         transport_type, travel_date, current_status, id]
      );
      return res.json({ success: true });
    }

    if (action === 'delete_service') {
      await pool.execute('DELETE FROM client_services WHERE id = ?', [id]);
      return res.json({ success: true });
    }

    // ========== SOP (service_sop) ==========
    if (action === 'get_sop') {
      const [rows] = await pool.query('SELECT * FROM service_sop WHERE service_id = ? ORDER BY id', [id]);
      return res.json(rows);
    }

    if (action === 'update_sop') {
      const { service_id, stage, status, completed_date } = req.body;
      // Update or insert SOP entry
      await pool.execute(
        'UPDATE service_sop SET status = ?, completed_date = ? WHERE service_id = ? AND stage = ?',
        [status, completed_date, service_id, stage]
      );
      return res.json({ success: true });
    }

    if (action === 'add_sop') {
      const { service_id, stage, status, completed_date } = req.body;
      const [result] = await pool.execute(
        'INSERT INTO service_sop (service_id, stage, status, completed_date) VALUES (?, ?, ?, ?)',
        [service_id, stage, status, completed_date]
      );
      return res.json({ success: true, id: result.insertId });
    }

    // ========== MESSAGES (client_messages) ==========
    if (action === 'send_message') {
      const { client_id, subject, message } = req.body;
      const [result] = await pool.execute(
        'INSERT INTO client_messages (client_id, sender, subject, message, is_read) VALUES (?, ?, ?, ?, true)',
        [client_id, 'admin', subject, message]
      );
      return res.json({ success: true, id: result.insertId });
    }

    if (action === 'get_messages') {
      const [rows] = await pool.execute(
        'SELECT * FROM client_messages WHERE client_id = ? ORDER BY created_at ASC',
        [id]
      );
      return res.json(rows);
    }

    if (action === 'get_unread_count') {
      const [rows] = await pool.query(
        'SELECT COUNT(*) as count FROM client_messages WHERE is_read = false AND sender != ?',
        ['admin']
      );
      return res.json({ count: rows[0].count });
    }

    if (action === 'mark_read') {
      await pool.execute(
        'UPDATE client_messages SET is_read = true WHERE client_id = ? AND sender != ?',
        [id, 'admin']
      );
      return res.json({ success: true });
    }

    // ========== DOCUMENTS (client_documents) ==========
    if (action === 'list_documents') {
      const [rows] = await pool.query('SELECT * FROM client_documents ORDER BY created_at DESC');
      return res.json(rows);
    }
    if (action === 'get_document') {
      const [rows] = await pool.execute('SELECT * FROM client_documents WHERE id = ?', [id]);
      return res.json(rows[0] || null);
    }
    if (action === 'add_document') {
      const { client_id, pet_id, name, type, expiry_date, status, file_url } = req.body;
      const [result] = await pool.execute(
        'INSERT INTO client_documents (client_id, pet_id, name, type, expiry_date, status, file_url) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [client_id || null, pet_id || null, name || '', type || '', expiry_date || '', status || '', file_url || '']
      );
      return res.json({ success: true, id: result.insertId });
    }
    if (action === 'update_document') {
      const { client_id, pet_id, name, type, expiry_date, status, file_url } = req.body;
      await pool.execute(
        'UPDATE client_documents SET client_id=?, pet_id=?, name=?, type=?, expiry_date=?, status=?, file_url=? WHERE id=?',
        [client_id || null, pet_id || null, name || '', type || '', expiry_date || '', status || '', file_url || '', id]
      );
      return res.json({ success: true });
    }
    if (action === 'delete_document') {
      await pool.execute('DELETE FROM client_documents WHERE id = ?', [id]);
      return res.json({ success: true });
    }

    // ========== STATS ==========
    if (action === 'stats') {
      const [[quotes], [contacts], [countries], [airlines], [clients], [pets], [services]] = await Promise.all([
        pool.query('SELECT COUNT(*) as count FROM quote_requests'),
        pool.query('SELECT COUNT(*) as count FROM contact_messages'),
        pool.query('SELECT COUNT(*) as count FROM country_regulations'),
        pool.query('SELECT COUNT(*) as count FROM airline_regulations'),
        pool.query('SELECT COUNT(*) as count FROM clients'),
        pool.query('SELECT COUNT(*) as count FROM client_pets'),
        pool.query('SELECT COUNT(*) as count FROM client_services')
      ]);
      return res.json({
        quotes: quotes[0].count,
        contacts: contacts[0].count,
        countries: countries[0].count,
        airlines: airlines[0].count,
        clients: clients[0].count,
        pets: pets[0].count,
        services: services[0].count
      });
    }

    return res.status(404).json({ error: 'Action not found' });
  } catch (err) {
    console.error('Admin API error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// =============================================================================
// MIGRATION FROM SUPABASE (Admin only)
// =============================================================================
// POST /api/migrate-from-supabase — Admin-only endpoint to pull all data from Supabase and import into Hostinger MySQL
// POST /api/migrate-from-supabase — Admin-only endpoint to pull all data from Supabase and import into Hostinger MySQL
// Also accepts ?secret=<MIGRATION_SECRET> as an alternative to admin session
app.post('/api/migrate-from-supabase', async (req, res) => {
  // Bearer-token auth bypass — set MIGRATION_SECRET env var on server
  const MIGRATION_SECRET = process.env.MIGRATION_SECRET || 'petfly-migrate-2026';
  const authHeader = req.headers.authorization || '';
  const secretParam = req.query.secret;
  const useSecret = secretParam === MIGRATION_SECRET || authHeader === `Bearer ${MIGRATION_SECRET}`;
  if (!useSecret && !(req.session && req.session.adminLoggedIn)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    const { serviceRoleKey } = req.body;
    if (!serviceRoleKey) {
      return res.status(400).json({ error: 'serviceRoleKey is required' });
    }

    const supabaseUrl = 'https://tfsacppyasdrexjrsjev.supabase.co/rest/v1';
    const headers = {
      'Authorization': `Bearer ${serviceRoleKey}`,
      'apikey': serviceRoleKey,
      'Content-Type': 'application/json'
    };

    const fetchFromSupabase = async (table) => {
      const response = await fetch(`${supabaseUrl}/${table}`, { headers });
      if (!response.ok) {
        throw new Error(`Failed to fetch ${table}: ${response.status} ${response.statusText}`);
      }
      return response.json();
    };

    // Ensure all columns exist before migrating (idempotent ALTER TABLE ADD COLUMN)
    // Ensure all columns exist before migrating — NEVER throws, runs to completion
    const ensureCol = (table, col, def) => {
      pool.query(`ALTER TABLE \`${table}\` ADD COLUMN ${col} ${def}`)
        .catch(e => { if (e.code !== 'ER_DUP_FIELDNAME') console.error(`ensureCol ${table}.${col}: ${e.code}`); });
    };
    ensureCol('clients', 'address', 'TEXT');
    ensureCol('client_pets', 'status', "VARCHAR(50) DEFAULT 'Active'");
    ensureCol('client_pets', 'status_color', 'VARCHAR(100)');
    ensureCol('client_services', 'current_status', "VARCHAR(50) DEFAULT 'pending'");
    ensureCol('client_services', 'payment_record', 'TEXT');
    ensureCol('client_services', 'notes', 'TEXT');
    ensureCol('client_quotes', 'payment_request_type', "VARCHAR(20) DEFAULT 'full'");
    ensureCol('client_quotes', 'payment_request_stage', 'VARCHAR(20)');
    ensureCol('client_quotes', 'payment_record', 'TEXT');
    ensureCol('service_sop', 'title', 'VARCHAR(200)');
    ensureCol('service_sop', 'description', 'TEXT');
    // Wait for all ALTERs to complete before proceeding
    await new Promise(r => setTimeout(r, 2000));

    // Wipe demo data seeded by /api/setup to avoid INSERT IGNORE collisions with Supabase IDs
    await pool.query('DELETE FROM service_sop');
    await pool.query('DELETE FROM client_pets');
    await pool.query('DELETE FROM client_services');
    await pool.query('DELETE FROM client_quotes');
    await pool.query('DELETE FROM client_documents');
    await pool.query('DELETE FROM client_messages');
    await pool.query('DELETE FROM clients');

    const counts = { clients: 0, pets: 0, services: 0, sop: 0, quotes: 0, documents: 0 };

    // ========== MIGRATE CLIENTS ==========
    // Supabase clients: { id, name, initials, location, address, phone, email, password, status }
    // Our schema:       { id, username, password, full_name, email, phone, address }
    const supabaseClients = await fetchFromSupabase('clients');
    for (const client of supabaseClients) {
      // Use email prefix as username (no username field in Supabase)
      const username = client.email ? client.email.split('@')[0] : `client_${client.id}`;
      const hashedPassword = await bcrypt.hash('petfly2024', 10);
      const [result] = await pool.execute(
        `INSERT IGNORE INTO clients (id, username, password, full_name, email, phone, address)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [client.id, username, hashedPassword, client.name || '', client.email || '', client.phone || '', client.address || '']
      );
      if (result.affectedRows > 0) counts.clients++;
    }

    // ========== MIGRATE PETS ==========
    // Supabase pets: { id, client_id, name, type, breed, origin, destination, image, status, status_color, details: {weight, microchip, dob, gender, color} }
    // Our schema:    { id, client_id, pet_name, pet_type, breed, weight, microchip, photo_url, status, status_color }
    const supabasePets = await fetchFromSupabase('pets');
    for (const pet of supabasePets) {
      const details = typeof pet.details === 'string' ? JSON.parse(pet.details || '{}') : (pet.details || {});
      const [result] = await pool.execute(
        `INSERT IGNORE INTO client_pets (id, client_id, pet_name, pet_type, breed, weight, microchip, photo_url, status, status_color)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          pet.id,
          pet.client_id,
          pet.name || '',
          pet.type || '',         // "Canine" / "Feline" — SPA handles this via getPetEmoji()
          pet.breed || '',
          details.weight || '',   // weight is inside details JSON
          details.microchip || '', // microchip is inside details JSON
          pet.image || '',        // Supabase uses "image" not "photo_url"
          pet.status || 'Active',
          pet.status_color || ''
        ]
      );
      if (result.affectedRows > 0) counts.pets++;
    }

    // ========== MIGRATE JOURNEYS → client_services ==========
    // Supabase journeys: { id, client_id, pet_id, overall_progress, current_location, estimated_arrival, airline, flight_no, tracking_id, stages: [...] }
    // Our schema:       { id, client_id, pet_id, origin_city, dest_city, transport_type, travel_date, current_status, notes }
    const supabaseJourneys = await fetchFromSupabase('journeys');
    for (const journey of supabaseJourneys) {
      const notes = JSON.stringify({
        airline: journey.airline || null,
        flight_no: journey.flight_no || null,
        tracking_id: journey.tracking_id || null,
        overall_progress: journey.overall_progress || 0
      });
      const [result] = await pool.execute(
        `INSERT IGNORE INTO client_services (id, client_id, pet_id, origin_city, dest_city, transport_type, travel_date, current_status, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          journey.id,
          journey.client_id,
          journey.pet_id || null,
          journey.current_location || '',  // current_location = departure city
          journey.estimated_arrival || '',  // estimated_arrival = destination / ETA text
          'air_cargo',
          null,                             // travel_date not available in journeys
          journey.overall_progress === 100 ? 'completed' : journey.overall_progress > 0 ? 'in_progress' : 'consultation',
          notes
        ]
      );
      if (result.affectedRows > 0) counts.services++;

      // ========== MIGRATE SOP STAGES (embedded in journey JSON) ==========
      // Supabase stages: [{ id, date, name, title, status, description }]
      if (journey.stages && Array.isArray(journey.stages)) {
        for (const stage of journey.stages) {
          const [sopResult] = await pool.execute(
            `INSERT IGNORE INTO service_sop (id, service_id, stage, status, title, description, completed_date)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [
              typeof stage.id === 'string' ? parseInt(stage.id.replace(/\D/g, '')) || Math.floor(Math.random() * 999999) : stage.id,
              journey.id,
              stage.name || '',       // e.g. "CONSULTING", "BOOKING"
              stage.status || 'pending', // "completed" | "in-progress" | "upcoming"
              stage.title || '',
              stage.description || '',
              stage.date || ''        // completed_date
            ]
          );
          if (sopResult.affectedRows > 0) counts.sop++;
        }
      }
    }

    // ========== MIGRATE QUOTES ==========
    // Supabase quotes: { id, client_id, ref, route, pet_quotes (JSON array), status, payment_status, payment_request_type, payment_request_stage, payment_record }
    // Our schema:      { id, client_id, ref, route, pet_quotes (JSON string), status, payment_status, payment_request_type, payment_request_stage, payment_record }
    const supabaseQuotes = await fetchFromSupabase('quotes');
    for (const quote of supabaseQuotes) {
      const petQuotesJson = quote.pet_quotes
        ? (typeof quote.pet_quotes === 'string' ? quote.pet_quotes : JSON.stringify(quote.pet_quotes))
        : '[]';
      const [result] = await pool.execute(
        `INSERT IGNORE INTO client_quotes (id, client_id, ref, route, pet_quotes, status, payment_status, payment_request_type, payment_request_stage, payment_record)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          quote.id,
          quote.client_id,
          quote.ref || '',
          quote.route || '',
          petQuotesJson,
          quote.status || 'draft',
          quote.payment_status || 'unpaid',
          quote.payment_request_type || 'full',
          quote.payment_request_stage || 'deposit',
          quote.payment_record ? (typeof quote.payment_record === 'string' ? quote.payment_record : JSON.stringify(quote.payment_record)) : '[]'
        ]
      );
      if (result.affectedRows > 0) counts.quotes++;
    }

    // ========== MIGRATE DOCUMENTS ==========
    // Supabase documents: { id, client_id, pet_id, name, type, expiry_date, status, icon, file_url }
    // Our schema:         { id, client_id, pet_id, name, type, expiry_date, status, file_url }
    const supabaseDocs = await fetchFromSupabase('documents');
    for (const doc of supabaseDocs) {
      const [result] = await pool.execute(
        `INSERT IGNORE INTO client_documents (id, client_id, pet_id, name, type, expiry_date, status, file_url)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [doc.id, doc.client_id, doc.pet_id || null, doc.name || '', doc.type || '', doc.expiry_date || '', doc.status || '', doc.file_url || '']
      );
      if (result.affectedRows > 0) counts.documents++;
    }

    console.log('Migration complete:', counts);
    res.json({ success: true, counts });
  } catch (err) {
    console.error('Migration error:', err);
    res.status(500).json({ error: err.message });
  }
});

// =============================================================================
// DATABASE SETUP ENDPOINT (run once to create all tables)
// =============================================================================
app.get('/api/setup', async (req, res) => {
  try {
    // Create all tables if they don't exist
    await pool.query(`
      CREATE TABLE IF NOT EXISTS clients (
        id INT AUTO_INCREMENT PRIMARY KEY,
        username VARCHAR(100) UNIQUE,
        password VARCHAR(255),
        full_name VARCHAR(255),
        email VARCHAR(255),
        phone VARCHAR(100),
        address TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Add missing columns to existing tables (MySQL doesn't support ADD COLUMN IF NOT EXISTS — check first)
    const addColIfMissing = async (table, col, def) => {
      try {
        const [rows] = await pool.query(`SHOW COLUMNS FROM \`${table}\` LIKE ?`, [col]);
        if (rows.length === 0) await pool.query(`ALTER TABLE \`${table}\` ADD COLUMN ${col} ${def}`);
      } catch (e) { /* ignore */ }
    };
    await addColIfMissing('clients', 'address', 'TEXT');
    await addColIfMissing('client_pets', 'status', "VARCHAR(50) DEFAULT 'Active'");
    await addColIfMissing('client_pets', 'status_color', 'VARCHAR(100)');
    await addColIfMissing('client_services', 'current_status', "VARCHAR(50) DEFAULT 'pending'");
    await addColIfMissing('client_services', 'payment_record', 'TEXT');
    await addColIfMissing('client_services', 'notes', 'TEXT');
    await addColIfMissing('client_quotes', 'payment_request_type', "VARCHAR(20) DEFAULT 'full'");
    await addColIfMissing('client_quotes', 'payment_request_stage', 'VARCHAR(20)');
    await addColIfMissing('client_quotes', 'payment_record', 'TEXT');
    await addColIfMissing('service_sop', 'title', 'VARCHAR(200)');

    // DEBUG: verify columns were added
    try {
      const [cols] = await pool.query('SHOW COLUMNS FROM `service_sop`');
      console.log('service_sop columns:', cols.map(c => c.Field));
    } catch(e) { console.error('debug error:', e.message); }

    await pool.query(`
      CREATE TABLE IF NOT EXISTS client_pets (
        id INT AUTO_INCREMENT PRIMARY KEY,
        client_id INT,
        pet_name VARCHAR(100),
        pet_type VARCHAR(100),
        breed VARCHAR(100),
        weight VARCHAR(50),
        microchip VARCHAR(100),
        photo_url TEXT,
        status VARCHAR(50) DEFAULT 'Active',
        status_color VARCHAR(100),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
      )
    `);
    // Add missing columns to existing client_pets table (for schemas created before these columns existed)
    await pool.query("ALTER TABLE client_pets ADD COLUMN IF NOT EXISTS status VARCHAR(50) DEFAULT 'Active'").catch(() => {});
    await pool.query("ALTER TABLE client_pets ADD COLUMN IF NOT EXISTS status_color VARCHAR(100)").catch(() => {});

    await pool.query(`
      CREATE TABLE IF NOT EXISTS client_services (
        id INT AUTO_INCREMENT PRIMARY KEY,
        client_id INT,
        pet_id INT,
        origin_country VARCHAR(100),
        origin_city VARCHAR(100),
        dest_country VARCHAR(100),
        dest_city VARCHAR(100),
        transport_type VARCHAR(50),
        travel_date DATE,
        current_status VARCHAR(50) DEFAULT 'pending',
        notes TEXT,
        payment_record TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE,
        FOREIGN KEY (pet_id) REFERENCES client_pets(id) ON DELETE SET NULL
      )
    `);
    // Add missing columns to existing client_services table
    await pool.query("ALTER TABLE client_services ADD COLUMN IF NOT EXISTS current_status VARCHAR(50) DEFAULT 'pending'").catch(() => {});
    await pool.query("ALTER TABLE client_services ADD COLUMN IF NOT EXISTS payment_record TEXT").catch(() => {});

    await pool.query(`
      CREATE TABLE IF NOT EXISTS service_sop (
        id INT AUTO_INCREMENT PRIMARY KEY,
        service_id INT,
        stage VARCHAR(50),
        status VARCHAR(50) DEFAULT 'pending',
        title VARCHAR(200),
        description TEXT,
        completed_date VARCHAR(100),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (service_id) REFERENCES client_services(id) ON DELETE CASCADE
      )
    `).catch(() => {});

    await pool.query(`
      CREATE TABLE IF NOT EXISTS client_messages (
        id INT AUTO_INCREMENT PRIMARY KEY,
        client_id INT,
        sender VARCHAR(20),
        subject VARCHAR(255),
        message TEXT,
        is_read INT DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
      )
    `).catch(() => {});

    await pool.query(`
      CREATE TABLE IF NOT EXISTS client_documents (
        id INT AUTO_INCREMENT PRIMARY KEY,
        client_id INT,
        pet_id INT,
        name VARCHAR(255),
        type VARCHAR(100),
        expiry_date VARCHAR(100),
        status VARCHAR(50),
        file_url TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
      )
    `).catch(() => {});

    await pool.query(`
      CREATE TABLE IF NOT EXISTS client_quotes (
        id INT AUTO_INCREMENT PRIMARY KEY,
        client_id INT,
        ref VARCHAR(50),
        route TEXT,
        pet_quotes TEXT,
        status VARCHAR(50) DEFAULT 'draft',
        payment_status VARCHAR(50) DEFAULT 'unpaid',
        payment_request_type VARCHAR(20) DEFAULT 'full',
        payment_request_stage VARCHAR(20),
        payment_record TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
      )
    `).catch(() => {});

    // Create a demo test account
    await pool.query(`
      INSERT IGNORE INTO clients (username, password, full_name, email, phone)
      VALUES ('demo', 'demo', 'Demo Client', 'demo@petflyinc.com', '+1-555-0100')
    `);
    // Create a demo pet
    const [[demoClient]] = await pool.query("SELECT id FROM clients WHERE username = 'demo'");
    if (demoClient) {
      await pool.query(`INSERT IGNORE INTO client_pets (client_id, pet_name, pet_type, breed, weight, status) VALUES (?, 'Buddy', 'Dog', 'Golden Retriever', '30kg', 'Active')`, [demoClient.id]);
      await pool.query(`INSERT IGNORE INTO client_services (client_id, origin_country, origin_city, dest_country, dest_city, transport_type, travel_date, current_status)
        SELECT id, 'United States', 'New York', 'United Kingdom', 'London', 'air_cargo', '2026-09-15', 'consultation' FROM clients WHERE username = 'demo' LIMIT 1`);
    }
    res.json({ success: true, message: 'All tables created successfully' + (demoClient ? ' (demo account: demo/demo)' : '') });
  } catch (err) {
    console.error('Setup error:', err);
    res.status(500).json({ error: err.message });
  }
});

// =============================================================================
// CLIENT PORTAL API (public - for client SPA)
// =============================================================================

// POST /api/client/login - Client login (public - no auth required)
app.post('/api/client/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const [rows] = await pool.execute(
      'SELECT id, username, full_name, email, phone, password FROM clients WHERE username = ?',
      [username]
    );
    if (rows.length === 0 || !(await bcrypt.compare(password, rows[0].password))) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    const client = rows[0];
    req.session.clientId = client.id;
    res.json({ 
      id: client.id, 
      username: client.username, 
      name: client.full_name, 
      email: client.email,
      phone: client.phone 
    });
  } catch (err) {
    console.error('Client login error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// REST-compatible routes — bundle calls /rest/v1/{table} directly
// These receive session via cookie (session middleware runs first)
app.get('/rest/v1/:table', async (req, res) => {
  const { table } = req.params;
  const tableMap = {
    clients: 'clients', pets: 'client_pets',
    documents: 'client_documents', journeys: 'client_journeys', quotes: 'quotes'
  };
  const col = tableMap[table];
  // Return [] for unauthenticated instead of 401 — keeps the app quiet
  if (!col) return res.status(200).json([]);
  if (!req.session || !req.session.clientId) return res.status(200).json([]);
  try {
    const [rows] = await pool.query(
      `SELECT * FROM ${col} WHERE client_id = ? ORDER BY id DESC`,
      [req.session.clientId]
    );
    res.json(rows);
  } catch (e) {
    res.status(500).json([{ message: e.message }]);
  }
});

// POST /api/auth/logout — destroy session (maps to bi.auth.logOut())
app.post('/api/auth/logout', (req, res) => {
  if (req.session) {
    req.session.destroy((err) => {
      if (err) return res.status(500).json({ error: 'Logout failed' });
      res.clearCookie('connect.sid');
      res.json({ error: null });
    });
  } else {
    res.json({ error: null });
  }
});

// GET /api/auth/logout — same as POST, destroy session (for <a> tag / script src)
app.get('/api/auth/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) return res.redirect('/CRM?error=logout');
    res.clearCookie('connect.sid');
    res.redirect('/CRM');
  });
});

// GET /api/client/data - Get all client data (pets, services, quotes, docs, messages)
app.get('/api/client/data', requireClient, async (req, res) => {
  try {
    const clientId = req.session.clientId;
    if (!clientId) return res.status(401).json({ error: 'Not logged in' });

    // Ensure each result is a plain array (pool.execute may return rows directly or in [rows, fields] format)
    const toArray = (r) => Array.isArray(r) ? (Array.isArray(r[0]) ? r[0] : r) : [r];
    const [[clientRows], [petsRows], [servicesRows], [quotesRows], [docsRows], [messagesRows]] = await Promise.all([
      pool.execute('SELECT id, username, full_name, email, phone FROM clients WHERE id = ?', [clientId]),
      pool.execute('SELECT * FROM client_pets WHERE client_id = ?', [clientId]),
      pool.execute('SELECT * FROM client_services WHERE client_id = ?', [clientId]),
      pool.execute('SELECT * FROM client_quotes WHERE client_id = ?', [clientId]),
      pool.execute('SELECT * FROM client_documents WHERE client_id = ?', [clientId]),
      pool.execute('SELECT * FROM client_messages WHERE client_id = ? ORDER BY created_at ASC', [clientId])
    ]);
    const clientArr = toArray(clientRows);
    const petsArr = toArray(petsRows);
    const servicesArr = toArray(servicesRows);
    const quotesArr = toArray(quotesRows);
    const docsArr = toArray(docsRows);
    const messagesArr = toArray(messagesRows);

    // Get SOP for each service
    const servicesWithSOP = await Promise.all(servicesArr.map(async (svc) => {
      const [sopRows] = await pool.execute('SELECT * FROM service_sop WHERE service_id = ? ORDER BY id', [svc.id]);
      return { ...svc, stages: toArray(sopRows) };
    }));

    // Parse pet_quotes JSON
    const quotesParsed = quotesArr.map(q => ({
      ...q,
      petQuotes: q.pet_quotes ? JSON.parse(q.pet_quotes) : []
    }));

    res.json({
      client: clientArr[0] || null,
      pets: petsArr,
      services: servicesWithSOP,
      quotes: quotesParsed,
      documents: docsArr,
      messages: messagesArr
    });
  } catch (err) {
    console.error('Client data error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/client/messages - Send message to admin
app.post('/api/client/messages', requireClient, async (req, res) => {
  try {
    const clientId = req.session.clientId;
    if (!clientId) return res.status(401).json({ error: 'Not logged in' });
    const { subject, message } = req.body;
    const [result] = await pool.execute(
      'INSERT INTO client_messages (client_id, sender, subject, message) VALUES (?, ?, ?, ?)',
      [clientId, 'client', subject, message]
    );
    res.json({ success: true, id: result.insertId });
  } catch (err) {
    console.error('Message error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// =============================================================================
// CLIENT PETS (maps to bi.from('pets').insert/update/delete)
// =============================================================================
app.post('/api/client/pets', requireClient, async (req, res) => {
  try {
    const clientId = req.session.clientId;
    if (!clientId) return res.status(401).json({ error: 'Not logged in' });
    const { id, name, breed, type, origin, destination, image, status, status_color, details } = req.body;
    const [result] = await pool.execute(
      'INSERT INTO client_pets (client_id, name, breed, type, origin, destination, image, status, status_color, details) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [clientId, name||'', breed||'', type||'', origin||'', destination||'', image||'', status||'pending', status_color||'', details||'']
    );
    res.json({ success: true, id: result.insertId });
  } catch (err) {
    console.error('Add pet error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.put('/api/client/pets/:id', requireClient, async (req, res) => {
  try {
    const clientId = req.session.clientId;
    if (!clientId) return res.status(401).json({ error: 'Not logged in' });
    const { name, breed, type, origin, destination, image, status, status_color, details } = req.body;
    await pool.execute(
      'UPDATE client_pets SET name=?, breed=?, type=?, origin=?, destination=?, image=?, status=?, status_color=?, details=? WHERE id=? AND client_id=?',
      [name||'', breed||'', type||'', origin||'', destination||'', image||'', status||'pending', status_color||'', details||'', req.params.id, clientId]
    );
    res.json({ success: true });
  } catch (err) {
    console.error('Update pet error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.delete('/api/client/pets/:id', requireClient, async (req, res) => {
  try {
    const clientId = req.session.clientId;
    if (!clientId) return res.status(401).json({ error: 'Not logged in' });
    await pool.execute('DELETE FROM client_pets WHERE id=? AND client_id=?', [req.params.id, clientId]);
    res.json({ success: true });
  } catch (err) {
    console.error('Delete pet error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// =============================================================================
// CLIENT DOCUMENTS (maps to bi.from('documents').insert/delete)
// =============================================================================
app.post('/api/client/documents', requireClient, async (req, res) => {
  try {
    const clientId = req.session.clientId;
    if (!clientId) return res.status(401).json({ error: 'Not logged in' });
    const { id, pet_id, name, type, expiry_date, status, icon, file_url } = req.body;
    const [result] = await pool.execute(
      'INSERT INTO client_documents (client_id, pet_id, name, type, expiry_date, status, icon, file_url) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [clientId, pet_id||null, name||'', type||'', expiry_date||'', status||'', icon||'', file_url||'']
    );
    res.json({ success: true, id: result.insertId });
  } catch (err) {
    console.error('Add document error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.delete('/api/client/documents/:id', requireClient, async (req, res) => {
  try {
    const clientId = req.session.clientId;
    if (!clientId) return res.status(401).json({ error: 'Not logged in' });
    await pool.execute('DELETE FROM client_documents WHERE id=? AND client_id=?', [req.params.id, clientId]);
    res.json({ success: true });
  } catch (err) {
    console.error('Delete document error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// =============================================================================
// CLIENT SERVICES / JOURNEYS (maps to bi.from('journeys').upsert)
// =============================================================================
app.post('/api/client/journeys', requireClient, async (req, res) => {
  try {
    const clientId = req.session.clientId;
    if (!clientId) return res.status(401).json({ error: 'Not logged in' });
    const { id, pet_id, overall_progress, current_location, estimated_arrival, airline, flight_no, tracking_id, stages } = req.body;
    // Upsert: update if exists (by id), insert if not
    if (id) {
      await pool.execute(
        'UPDATE client_services SET pet_id=?, overall_progress=?, current_location=?, estimated_arrival=?, airline=?, flight_no=?, tracking_id=?, stages=? WHERE id=? AND client_id=?',
        [pet_id||null, overall_progress||0, current_location||'', estimated_arrival||'', airline||'', flight_no||'', tracking_id||'', stages||'', id, clientId]
      );
      res.json({ success: true, id });
    } else {
      const [result] = await pool.execute(
        'INSERT INTO client_services (client_id, pet_id, overall_progress, current_location, estimated_arrival, airline, flight_no, tracking_id, stages) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [clientId, pet_id||null, overall_progress||0, current_location||'', estimated_arrival||'', airline||'', flight_no||'', tracking_id||'', stages||'']
      );
      res.json({ success: true, id: result.insertId });
    }
  } catch (err) {
    console.error('Journey upsert error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// =============================================================================
// CLIENT QUOTES (maps to bi.from('quotes').upsert)
// =============================================================================
app.post('/api/client/quotes', requireClient, async (req, res) => {
  try {
    const clientId = req.session.clientId;
    if (!clientId) return res.status(401).json({ error: 'Not logged in' });
    const { id, ref, route, status, pet_quotes } = req.body;
    if (id) {
      await pool.execute(
        'UPDATE client_quotes SET ref=?, route=?, status=?, pet_quotes=? WHERE id=? AND client_id=?',
        [ref||'', route||'', status||'pending', pet_quotes||'', id, clientId]
      );
      res.json({ success: true, id });
    } else {
      const [result] = await pool.execute(
        'INSERT INTO client_quotes (client_id, ref, route, status, pet_quotes) VALUES (?, ?, ?, ?, ?)',
        [clientId, ref||'', route||'', status||'pending', pet_quotes||'']
      );
      res.json({ success: true, id: result.insertId });
    }
  } catch (err) {
    console.error('Quote upsert error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/client/payment-settings - Get payment settings
app.get('/api/client/payment-settings', requireClient, async (req, res) => {
  try {
    const clientId = req.session.clientId;
    if (!clientId) return res.status(401).json({ error: 'Not logged in' });
    const [rows] = await pool.execute(
      'SELECT zelle_email, zelle_name, wechat_qr_url, alipay_qr_url FROM clients WHERE id = ?',
      [clientId]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Not found' });
    const c = rows[0];
    res.json({
      zelleEmail: c.zelle_email || 'billing@petflyinc.com',
      zelleName: c.zelle_name || 'Pet Fly Inc.',
      wechatQrUrl: c.wechat_qr_url || '',
      alipayQrUrl: c.alipay_qr_url || ''
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Stats endpoint (GET /api/admin/stats) - explicit route
app.get('/api/admin/stats', requireAdmin, async (req, res) => {
  try {
    const [[quotes], [contacts], [countries], [airlines], [clients], [pets], [services]] = await Promise.all([
      pool.query('SELECT COUNT(*) as count FROM quote_requests'),
      pool.query('SELECT COUNT(*) as count FROM contact_messages'),
      pool.query('SELECT COUNT(*) as count FROM country_regulations'),
      pool.query('SELECT COUNT(*) as count FROM airline_regulations'),
      pool.query('SELECT COUNT(*) as count FROM clients'),
      pool.query('SELECT COUNT(*) as count FROM client_pets'),
      pool.query('SELECT COUNT(*) as count FROM client_services')
    ]);
    res.json({
      quotes: quotes[0].count,
      contacts: contacts[0].count,
      countries: countries[0].count,
      airlines: airlines[0].count,
      clients: clients[0].count,
      pets: pets[0].count,
      services: services[0].count
    });
  } catch (err) {
    console.error('Stats error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// =============================================================================
// ADMIN CLIENT CRUD ENDPOINTS
// =============================================================================

// GET /api/admin/list_clients
app.get('/api/admin/list_clients', requireAdmin, async (req, res) => {
  try {
    const [rows] = await pool.execute(
      'SELECT id, username, full_name, email, phone, address, created_at FROM clients ORDER BY id DESC'
    );
    res.json(rows);
  } catch (err) {
    console.error('List clients error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/admin/get_client?id=...
app.get('/api/admin/get_client', requireAdmin, async (req, res) => {
  try {
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: 'Client ID required' });
    const [rows] = await pool.execute(
      'SELECT id, username, full_name, email, phone, address, created_at FROM clients WHERE id = ?',
      [id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Client not found' });
    res.json(rows[0]);
  } catch (err) {
    console.error('Get client error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/admin/add_client
app.post('/api/admin/add_client', requireAdmin, async (req, res) => {
  try {
    const { username, password, full_name, email, phone, address } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
    const hashedPassword = await bcrypt.hash(password, 10);
    const [result] = await pool.execute(
      'INSERT INTO clients (username, password, full_name, email, phone, address) VALUES (?, ?, ?, ?, ?, ?)',
      [username, hashedPassword, full_name || '', email || '', phone || '', address || '']
    );
    res.status(201).json({ id: result.insertId, message: 'Client created' });
  } catch (err) {
    console.error('Add client error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/admin/update_client
app.post('/api/admin/update_client', requireAdmin, async (req, res) => {
  try {
    const { id, username, full_name, email, phone, address, password } = req.body;
    if (!id) return res.status(400).json({ error: 'Client ID required' });

    let query, params;
    if (password) {
      const hashedPassword = await bcrypt.hash(password, 10);
      query = 'UPDATE clients SET username = ?, full_name = ?, email = ?, phone = ?, address = ?, password = ? WHERE id = ?';
      params = [username || '', full_name || '', email || '', phone || '', address || '', hashedPassword, id];
    } else {
      query = 'UPDATE clients SET username = ?, full_name = ?, email = ?, phone = ?, address = ? WHERE id = ?';
      params = [username || '', full_name || '', email || '', phone || '', address || '', id];
    }

    const [result] = await pool.execute(query, params);
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Client not found' });
    res.json({ message: 'Client updated' });
  } catch (err) {
    console.error('Update client error:', err);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/admin/delete_client?id=...
app.delete('/api/admin/delete_client', requireAdmin, async (req, res) => {
  try {
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: 'Client ID required' });
    const [result] = await pool.execute('DELETE FROM clients WHERE id = ?', [id]);
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Client not found' });
    res.json({ message: 'Client deleted' });
  } catch (err) {
    console.error('Delete client error:', err);
    res.status(500).json({ error: err.message });
  }
});

// =============================================================================
// ADMIN COUNTRY REGULATIONS CRUD ENDPOINTS
// =============================================================================

// GET /api/admin/list_countries
app.get('/api/admin/list_countries', requireAdmin, async (req, res) => {
  try {
    const [rows] = await pool.execute(
      'SELECT * FROM country_regulations ORDER BY country_name'
    );
    res.json(rows);
  } catch (err) {
    console.error('List countries error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/admin/get_country?id=...
app.get('/api/admin/get_country', requireAdmin, async (req, res) => {
  try {
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: 'Country ID required' });
    const [rows] = await pool.execute(
      'SELECT * FROM country_regulations WHERE id = ?',
      [id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Country not found' });
    res.json(rows[0]);
  } catch (err) {
    console.error('Get country error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/admin/add_country
app.post('/api/admin/add_country', requireAdmin, async (req, res) => {
  try {
    const { country_code, country_name, pet_types, microchip, rabies_vaccination,
            health_certificate, import_permit, quarantine_days, additional_requirements,
            preparation_time, restricted_breeds, contact_info } = req.body;
    if (!country_code || !country_name) return res.status(400).json({ error: 'Country code and name required' });
    const [result] = await pool.execute(
      `INSERT INTO country_regulations 
       (country_code, country_name, pet_types, microchip, rabies_vaccination,
        health_certificate, import_permit, quarantine_days, additional_requirements,
        preparation_time, restricted_breeds, contact_info)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [country_code, country_name, pet_types || '', microchip || '', rabies_vaccination || '',
       health_certificate || '', import_permit || '', quarantine_days || 0, additional_requirements || '',
       preparation_time || '', restricted_breeds || '', contact_info || '']
    );
    res.status(201).json({ id: result.insertId, message: 'Country created' });
  } catch (err) {
    console.error('Add country error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/admin/update_country
app.post('/api/admin/update_country', requireAdmin, async (req, res) => {
  try {
    const { id, country_code, country_name, pet_types, microchip, rabies_vaccination,
            health_certificate, import_permit, quarantine_days, additional_requirements,
            preparation_time, restricted_breeds, contact_info } = req.body;
    if (!id) return res.status(400).json({ error: 'Country ID required' });
    await pool.execute(
      `UPDATE country_regulations SET 
       country_code = ?, country_name = ?, pet_types = ?, microchip = ?,
       rabies_vaccination = ?, health_certificate = ?, import_permit = ?,
       quarantine_days = ?, additional_requirements = ?, preparation_time = ?,
       restricted_breeds = ?, contact_info = ?
       WHERE id = ?`,
      [country_code || '', country_name || '', pet_types || '', microchip || '',
       rabies_vaccination || '', health_certificate || '', import_permit || '',
       quarantine_days || 0, additional_requirements || '', preparation_time || '',
       restricted_breeds || '', contact_info || '', id]
    );
    res.json({ message: 'Country updated' });
  } catch (err) {
    console.error('Update country error:', err);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/admin/delete_country?id=...
app.delete('/api/admin/delete_country', requireAdmin, async (req, res) => {
  try {
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: 'Country ID required' });
    const [result] = await pool.execute('DELETE FROM country_regulations WHERE id = ?', [id]);
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Country not found' });
    res.json({ message: 'Country deleted' });
  } catch (err) {
    console.error('Delete country error:', err);
    res.status(500).json({ error: err.message });
  }
});

// =============================================================================
// ADMIN AIRLINE REGULATIONS CRUD ENDPOINTS
// =============================================================================

// GET /api/admin/list_airlines
app.get('/api/admin/list_airlines', requireAdmin, async (req, res) => {
  try {
    const [rows] = await pool.execute(
      'SELECT * FROM airline_regulations ORDER BY airline_name'
    );
    res.json(rows);
  } catch (err) {
    console.error('List airlines error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/admin/get_airline?id=...
app.get('/api/admin/get_airline', requireAdmin, async (req, res) => {
  try {
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: 'Airline ID required' });
    const [rows] = await pool.execute(
      'SELECT * FROM airline_regulations WHERE id = ?',
      [id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Airline not found' });
    res.json(rows[0]);
  } catch (err) {
    console.error('Get airline error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/admin/add_airline
app.post('/api/admin/add_airline', requireAdmin, async (req, res) => {
  try {
    const { airline_name, carry_on, checked_bag, cargo, pet_fee,
            size_limits, breed_restrictions, booking_info, crate_requirements } = req.body;
    if (!airline_name) return res.status(400).json({ error: 'Airline name required' });
    const [result] = await pool.execute(
      `INSERT INTO airline_regulations 
       (airline_name, carry_on, checked_bag, cargo, pet_fee,
        size_limits, breed_restrictions, booking_info, crate_requirements)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [airline_name, carry_on || '', checked_bag || '', cargo || '', pet_fee || '',
       size_limits || '', breed_restrictions || '', booking_info || '', crate_requirements || '']
    );
    res.status(201).json({ id: result.insertId, message: 'Airline created' });
  } catch (err) {
    console.error('Add airline error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/admin/update_airline
app.post('/api/admin/update_airline', requireAdmin, async (req, res) => {
  try {
    const { id, airline_name, carry_on, checked_bag, cargo, pet_fee,
            size_limits, breed_restrictions, booking_info, crate_requirements } = req.body;
    if (!id) return res.status(400).json({ error: 'Airline ID required' });
    await pool.execute(
      `UPDATE airline_regulations SET 
       airline_name = ?, carry_on = ?, checked_bag = ?, cargo = ?,
       pet_fee = ?, size_limits = ?, breed_restrictions = ?,
       booking_info = ?, crate_requirements = ?
       WHERE id = ?`,
      [airline_name || '', carry_on || '', checked_bag || '', cargo || '',
       pet_fee || '', size_limits || '', breed_restrictions || '',
       booking_info || '', crate_requirements || '', id]
    );
    res.json({ message: 'Airline updated' });
  } catch (err) {
    console.error('Update airline error:', err);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/admin/delete_airline?id=...
app.delete('/api/admin/delete_airline', requireAdmin, async (req, res) => {
  try {
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: 'Airline ID required' });
    const [result] = await pool.execute('DELETE FROM airline_regulations WHERE id = ?', [id]);
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Airline not found' });
    res.json({ message: 'Airline deleted' });
  } catch (err) {
    console.error('Delete airline error:', err);
    res.status(500).json({ error: err.message });
  }
});

// =============================================================================
// ADMIN QUOTES CRUD ENDPOINTS
// =============================================================================

// GET /api/admin/list_quotes
app.get('/api/admin/list_quotes', requireAdmin, async (req, res) => {
  try {
    const [rows] = await pool.execute(
      'SELECT * FROM quote_requests ORDER BY created_at DESC'
    );
    res.json(rows);
  } catch (err) {
    console.error('List quotes error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/admin/get_quote?id=...
app.get('/api/admin/get_quote', requireAdmin, async (req, res) => {
  try {
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: 'Quote ID required' });
    const [rows] = await pool.execute(
      'SELECT * FROM quote_requests WHERE id = ?',
      [id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Quote not found' });
    res.json(rows[0]);
  } catch (err) {
    console.error('Get quote error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/admin/update_quote
app.post('/api/admin/update_quote', requireAdmin, async (req, res) => {
  try {
    const { id, status, notes, name, email, phone, pet_type, breed, weight, age,
            travel_type, origin, destination, departure_date, return_date,
            crate_size, special_requirements } = req.body;
    if (!id) return res.status(400).json({ error: 'Quote ID required' });
    await pool.execute(
      `UPDATE quote_requests SET 
       status = ?, notes = ?, name = ?, email = ?, phone = ?,
       pet_type = ?, breed = ?, weight = ?, age = ?,
       travel_type = ?, origin = ?, destination = ?,
       departure_date = ?, return_date = ?, crate_size = ?,
       special_requirements = ?
       WHERE id = ?`,
      [status || '', notes || '', name || '', email || '', phone || '',
       pet_type || '', breed || '', weight || '', age || '',
       travel_type || '', origin || '', destination || '',
       departure_date || null, return_date || null, crate_size || '',
       special_requirements || '', id]
    );
    res.json({ message: 'Quote updated' });
  } catch (err) {
    console.error('Update quote error:', err);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/admin/delete_quote?id=...
app.delete('/api/admin/delete_quote', requireAdmin, async (req, res) => {
  try {
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: 'Quote ID required' });
    const [result] = await pool.execute('DELETE FROM quote_requests WHERE id = ?', [id]);
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Quote not found' });
    res.json({ message: 'Quote deleted' });
  } catch (err) {
    console.error('Delete quote error:', err);
    res.status(500).json({ error: err.message });
  }
});

// =============================================================================
// ADMIN CONTACT MESSAGES CRUD ENDPOINTS
// =============================================================================

// GET /api/admin/list_contacts
app.get('/api/admin/list_contacts', requireAdmin, async (req, res) => {
  try {
    const [rows] = await pool.execute(
      'SELECT * FROM contact_messages ORDER BY created_at DESC'
    );
    res.json(rows);
  } catch (err) {
    console.error('List contacts error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/admin/get_contact?id=...
app.get('/api/admin/get_contact', requireAdmin, async (req, res) => {
  try {
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: 'Contact ID required' });
    const [rows] = await pool.execute(
      'SELECT * FROM contact_messages WHERE id = ?',
      [id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Contact not found' });
    res.json(rows[0]);
  } catch (err) {
    console.error('Get contact error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /api/admin/delete_contact?id=...
app.delete('/api/admin/delete_contact', requireAdmin, async (req, res) => {
  try {
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: 'Contact ID required' });
    const [result] = await pool.execute('DELETE FROM contact_messages WHERE id = ?', [id]);
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Contact not found' });
    res.json({ message: 'Contact deleted' });
  } catch (err) {
    console.error('Delete contact error:', err);
    res.status(500).json({ error: err.message });
  }
});

// =============================================================================
// ADMIN SERVICES (JOURNEYS) CRUD ENDPOINTS
// =============================================================================

// GET /api/admin/list_services
app.get('/api/admin/list_services', requireAdmin, async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT cs.*, c.full_name as client_name, cp.pet_name
       FROM client_services cs
       LEFT JOIN clients c ON cs.client_id = c.id
       LEFT JOIN client_pets cp ON cs.pet_id = cp.id
       ORDER BY cs.created_at DESC`
    );
    res.json(rows);
  } catch (err) {
    console.error('List services error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/admin/get_service?id=...
app.get('/api/admin/get_service', requireAdmin, async (req, res) => {
  try {
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: 'Service ID required' });
    const [rows] = await pool.execute(
      `SELECT cs.*, c.full_name as client_name, cp.pet_name
       FROM client_services cs
       LEFT JOIN clients c ON cs.client_id = c.id
       LEFT JOIN client_pets cp ON cs.pet_id = cp.id
       WHERE cs.id = ?`,
      [id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Service not found' });
    res.json(rows[0]);
  } catch (err) {
    console.error('Get service error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/admin/add_service
app.post('/api/admin/add_service', requireAdmin, async (req, res) => {
  try {
    const { client_id, pet_id, origin_country, origin_city, dest_country, dest_city,
            transport_type, travel_date, current_status } = req.body;
    if (!client_id) return res.status(400).json({ error: 'Client ID required' });
    const [result] = await pool.execute(
      `INSERT INTO client_services (client_id, pet_id, origin_country, origin_city, dest_country, dest_city, transport_type, travel_date, current_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [client_id, pet_id || null, origin_country || '', origin_city || '', dest_country || '',
       dest_city || '', transport_type || '', travel_date || null, current_status || 'pending']
    );

    // Create default SOP stages
    const stages = ['consultation', 'documents', 'transfer_booking', 'pet_pickup', 'safe_transport', 'delivery'];
    for (const stage of stages) {
      await pool.execute(
        'INSERT INTO service_sop (service_id, stage, status) VALUES (?, ?, ?)',
        [result.insertId, stage, 'pending']
      );
    }

    res.status(201).json({ success: true, id: result.insertId });
  } catch (err) {
    console.error('Add service error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/admin/update_service
app.post('/api/admin/update_service', requireAdmin, async (req, res) => {
  try {
    const { id, client_id, pet_id, origin_country, origin_city, dest_country, dest_city,
            transport_type, travel_date, current_status } = req.body;
    if (!id) return res.status(400).json({ error: 'Service ID required' });
    await pool.execute(
      `UPDATE client_services SET client_id=?, pet_id=?, origin_country=?, origin_city=?,
       dest_country=?, dest_city=?, transport_type=?, travel_date=?, current_status=? WHERE id=?`,
      [client_id||null, pet_id||null, origin_country||'', origin_city||'', dest_country||'',
       dest_city||'', transport_type||'', travel_date||null, current_status||'pending', id]
    );
    res.json({ success: true });
  } catch (err) {
    console.error('Update service error:', err);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/admin/delete_service?id=...
app.delete('/api/admin/delete_service', requireAdmin, async (req, res) => {
  try {
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: 'Service ID required' });
    await pool.execute('DELETE FROM service_sop WHERE service_id = ?', [id]);
    const [result] = await pool.execute('DELETE FROM client_services WHERE id = ?', [id]);
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Service not found' });
    res.json({ success: true });
  } catch (err) {
    console.error('Delete service error:', err);
    res.status(500).json({ error: err.message });
  }
});

// =============================================================================
// ADMIN SERVICE SOP ENDPOINTS
// =============================================================================

// GET /api/admin/get_sop?service_id=...
app.get('/api/admin/get_sop', requireAdmin, async (req, res) => {
  try {
    const { service_id } = req.query;
    if (!service_id) return res.status(400).json({ error: 'Service ID required' });
    const [rows] = await pool.execute(
      'SELECT * FROM service_sop WHERE service_id = ? ORDER BY id ASC',
      [service_id]
    );
    res.json(rows);
  } catch (err) {
    console.error('Get SOP error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/admin/update_sop
app.post('/api/admin/update_sop', requireAdmin, async (req, res) => {
  try {
    const { service_id, stage, status } = req.body;
    if (!service_id || !stage) return res.status(400).json({ error: 'Service ID and stage required' });
    const completedDate = status === 'completed' ? new Date().toISOString().split('T')[0] : null;
    await pool.execute(
      'UPDATE service_sop SET status = ?, completed_date = ? WHERE service_id = ? AND stage = ?',
      [status, completedDate, service_id, stage]
    );
    res.json({ success: true });
  } catch (err) {
    console.error('Update SOP error:', err);
    res.status(500).json({ error: err.message });
  }
});

// =============================================================================
// ADMIN CLIENT MESSAGES ENDPOINTS
// =============================================================================

// GET /api/admin/get_messages?client_id=...
app.get('/api/admin/get_messages', requireAdmin, async (req, res) => {
  try {
    const { client_id } = req.query;
    if (!client_id) return res.status(400).json({ error: 'Client ID required' });
    const [rows] = await pool.execute(
      'SELECT * FROM client_messages WHERE client_id = ? ORDER BY created_at DESC',
      [client_id]
    );
    res.json(rows);
  } catch (err) {
    console.error('Get messages error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/admin/send_message
app.post('/api/admin/send_message', requireAdmin, async (req, res) => {
  try {
    const { client_id, sender, subject, message } = req.body;
    if (!client_id || !message) return res.status(400).json({ error: 'Client ID and message required' });
    const [result] = await pool.execute(
      'INSERT INTO client_messages (client_id, sender, subject, message) VALUES (?, ?, ?, ?)',
      [client_id, sender || 'Admin', subject || '', message]
    );
    res.json({ success: true, id: result.insertId });
  } catch (err) {
    console.error('Send message error:', err);
    res.status(500).json({ error: err.message });
  }
});

// DEBUG: Run ALTER TABLE for all missing columns (bypasses addColIfMissing issues)
app.get('/api/admin/fix-schema', requireAdmin, async (req, res) => {
  try {
    const results = {};
    const tables_cols = {
      'clients': ['address TEXT'],
      'client_pets': ["status VARCHAR(50) DEFAULT 'Active'", 'status_color VARCHAR(100)'],
      'client_services': ["current_status VARCHAR(50) DEFAULT 'pending'", 'payment_record TEXT', 'notes TEXT'],
      'client_quotes': ["payment_request_type VARCHAR(20) DEFAULT 'full'", 'payment_request_stage VARCHAR(20)', 'payment_record TEXT'],
      'service_sop': ['title VARCHAR(200)'],
    };
    for (const [table, colDefs] of Object.entries(tables_cols)) {
      results[table] = {};
      for (const colDef of colDefs) {
        const colName = colDef.split(' ')[0];
        try {
          await pool.query(`ALTER TABLE \`${table}\` ADD COLUMN ${colDef}`);
          results[table][colName] = 'added';
        } catch (e) {
          if (e.code === 'ER_DUP_FIELDNAME') {
            results[table][colName] = 'already exists';
          } else {
            results[table][colName] = 'error: ' + e.code;
          }
        }
      }
    }
    res.json({ success: true, results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =============================================================================
// CRM PORTAL (/CRM/) — dual login: CRM Admin or Client
// =============================================================================
app.use('/CRM', express.static(path.join(__dirname, 'public', 'CRM')));
app.get('/CRM', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'CRM', 'index.html'));
});

// Catch-all: serve SPA for all /CRM/* routes so React Router handles them client-side
app.get('/CRM/*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'CRM', 'index.html'));
});

// ── Storage upload routes ───────────────────────────────────────────────────────
// POST /storage/v1/object/{bucket}/{filename} — raw binary (Supabase storage API compatible)
app.post('/storage/v1/object/:bucket/:filename', (req, res) => {
  const { bucket, filename } = req.params;
  const safeName = `${Date.now()}-${filename.replace(/[^a-zA-Z0-9.\-_]/g, '_')}`;
  const filePath = path.join(UPLOAD_DIR, safeName);

  const chunks = [];
  req.on('data', chunk => chunks.push(chunk));
  req.on('end', () => {
    try {
      const buf = Buffer.concat(chunks);
      fs.writeFileSync(filePath, buf);
      res.json({ path: `/api/files/uploads/${safeName}`, error: null });
    } catch (e) {
      console.error('[storage] write error:', e);
      res.status(500).json([{ message: e.message }]);
    }
  });
  req.on('error', (e) => {
    console.error('[storage] stream error:', e);
    res.status(500).json([{ message: 'Upload failed' }]);
  });
});

// Storage proxy: /storage/v1/object/upload/{bucket}/{filename} → local file storage
app.post('/storage/v1/object/upload/:bucket/:filename', (req, res) => {
  const { bucket, filename } = req.params;
  const safeName = `${Date.now()}-${filename.replace(/[^a-zA-Z0-9.\-_]/g, '_')}`;
  const filePath = path.join(UPLOAD_DIR, safeName);

  const chunks = [];
  req.on('data', chunk => chunks.push(chunk));
  req.on('end', () => {
    try {
      const buf = Buffer.concat(chunks);
      const headerEnd = buf.indexOf('\r\n\r\n');
      const fileContent = headerEnd === -1 ? buf : buf.slice(headerEnd + 4);
      fs.writeFileSync(filePath, fileContent);
      res.json({ path: `/api/files/${bucket}/${safeName}`, error: null });
    } catch (e) {
      console.error('[storage] write error:', e);
      res.status(500).json([{ message: e.message }]);
    }
  });
  req.on('error', (e) => {
    console.error('[storage] stream error:', e);
    res.status(500).json([{ message: 'Upload failed' }]);
  });
});

// Serve uploaded files
app.get('/storage/v1/object/public/:bucket/:filename', (req, res) => {
  const { bucket, filename } = req.params;
  // Try UPLOAD_DIR/filename first (upload-json), then UPLOAD_DIR/bucket/filename (multer)
  let filePath = path.join(UPLOAD_DIR, filename);
  if (!fs.existsSync(filePath)) {
    filePath = path.join(UPLOAD_DIR, bucket, filename);
  }
  if (fs.existsSync(filePath)) return res.sendFile(filePath);
  res.status(404).json([{ message: 'File not found' }]);
});

// Redirect /login → /CRM/login so Express doesn't 404 on React Router's redirect
app.get('/login', (req, res) => res.redirect('/CRM/login'));

// =============================================================================
// ADMIN CRM SEEDING (bulk data migration)
// =============================================================================

// POST /api/admin/seed-crm — bulk seed CRM data from JSON
// Body: { clients: [...], pets: [...], documents: [...], quotes: [...], journeys: [...] }
app.post('/api/admin/seed-crm', requireAdmin, async (req, res) => {
  const { clients = [], pets = [], documents = [], quotes = [], journeys = [] } = req.body;
  const results = { clients: 0, pets: 0, documents: 0, quotes: 0, journeys: 0, errors: [] };

  try {
    // Seed clients
    for (const c of clients) {
      try {
        const detailsStr = c.details ? JSON.stringify(c.details) : null;
        await crmPool.query(
          'INSERT INTO crm_clients (name,initials,location,address,phone,email,status,password) VALUES (?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE name=name',
          [c.name, c.initials||null, c.location||null, c.address||null, c.phone||null, c.email, c.status||'active', c.password||null]
        );
        results.clients++;
      } catch (e) { results.errors.push(`client ${c.email}: ${e.message}`); }
    }

    // Seed pets
    for (const p of pets) {
      try {
        const detailsStr = p.details ? JSON.stringify(p.details) : null;
        await crmPool.query(
          'INSERT INTO crm_pets (client_id,name,breed,type,origin,destination,image,status,status_color,details) VALUES (?,?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE name=name',
          [p.client_id, p.name, p.breed||null, p.type||null, p.origin||null, p.destination||null, p.image||null, p.status||null, p.status_color||null, detailsStr]
        );
        results.pets++;
      } catch (e) { results.errors.push(`pet ${p.name}: ${e.message}`); }
    }

    // Seed documents
    for (const d of documents) {
      try {
        await crmPool.query(
          'INSERT INTO crm_documents (client_id,pet_id,name,type,expiry_date,status,icon,file_url) VALUES (?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE name=name',
          [d.client_id, d.pet_id||null, d.name, d.type||null, d.expiry_date||null, d.status||null, d.icon||null, d.file_url||null]
        );
        results.documents++;
      } catch (e) { results.errors.push(`document ${d.name}: ${e.message}`); }
    }

    // Seed quotes
    for (const q of quotes) {
      try {
        const petQuotesStr = q.pet_quotes ? JSON.stringify(q.pet_quotes) : null;
        await crmPool.query(
          'INSERT INTO crm_quotes (id,client_id,ref,route,status,pet_quotes) VALUES (?,?,?,?,?,?) ON DUPLICATE KEY UPDATE route=route',
          [q.id, q.client_id, q.ref||null, q.route||null, q.status||'Awaiting Approval', petQuotesStr]
        );
        results.quotes++;
      } catch (e) { results.errors.push(`quote ${q.id}: ${e.message}`); }
    }

    // Seed journeys
    for (const j of journeys) {
      try {
        const stagesStr = j.stages ? JSON.stringify(j.stages) : null;
        await crmPool.query(
          'INSERT INTO crm_journeys (id,client_id,pet_id,overall_progress,current_location,estimated_arrival,airline,flight_no,tracking_id,stages) VALUES (?,?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE current_location=current_location',
          [j.id, j.client_id, j.pet_id, j.overall_progress||0, j.current_location||null, j.estimated_arrival||null, j.airline||null, j.flight_no||null, j.tracking_id||null, stagesStr]
        );
        results.journeys++;
      } catch (e) { results.errors.push(`journey ${j.id}: ${e.message}`); }
    }

    res.json({ success: true, results });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// =============================================================================
// ADMIN CMS STATIC FILES (/admin/) — landing page CMS
// =============================================================================
app.use('/admin', express.static(path.join(__dirname, 'public', 'admin')));

// =============================================================================
// =============================================================================
// SPA Catch-all — serve CRM SPA for all non-API, non-static, non-file paths
// React Router handles these client-side. Must be AFTER all real routes.
const KNOWN_STATIC = /^\/(api|admin|CSR|css|js|assets|lib|fonts|images?|img|media|favicon|\.)/;
const CRM_INDEX = path.join(__dirname, 'public', 'CRM', 'index.html');
app.get('*', (req, res) => {
  const path = req.path;
  if (KNOWN_STATIC.test(path)) {
    // Let static middleware or next handler deal with it
    return res.status(404).send('Not Found');
  }
  // Serve CRM SPA — React Router will handle the URL client-side
  res.set({
    'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
    'Pragma': 'no-cache',
    'Expires': '0',
    'Surrogate-Control': 'no-store'
  });
  res.sendFile(CRM_INDEX);
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err.message || err, err.stack);
  res.status(500).json({ error: 'Internal server error' });
});

// =============================================================================
// STARTUP
// =============================================================================
async function start() {
  try {
    // Initialize database (creates tables and seeds data)
    await initializeDatabase();
    console.log('Database initialized');

    // Get pool from db module
    const { pool: dbPool } = require('./db');
    pool = dbPool;

    // Create email transporter
    transporter = createTransporter();

    app.listen(PORT, '0.0.0.0', () => {
      console.log(`PetInc running on port ${PORT}`);
    });
  } catch (err) {
    console.error('Startup error:', err);
    process.exit(1);
  }
}

start();
