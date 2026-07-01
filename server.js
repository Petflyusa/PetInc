require('dotenv').config();
const express = require('express');
const path = require('path');
const session = require('express-session');
const mysql = require('mysql2/promise');
const nodemailer = require('nodemailer');
const { initializeDatabase } = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

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
app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
  secret: process.env.SESSION_SECRET || 'petinc-secret-key',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24 * 60 * 60 * 1000 }
}));

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
  return res.status(401).json({ error: 'Not logged in' });
}

// =============================================================================
// CLIENT PORTAL (from original CRM React SPA)
// Route: /client/* → static client SPA
// =============================================================================
app.use('/client', express.static(path.join(__dirname, 'public', 'client')));

// GET /client → serve client SPA index.html
app.get('/client', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'client', 'index.html'));
});

// =============================================================================
// PUBLIC VIEW ROUTES
// =============================================================================
app.get('/', (req, res) => {
  res.render('index.ejs');
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
      pet_type, pet_name, pet_weight, breed,
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

// GET /admin - Serve admin SPA
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin', 'index.html'));
});

// GET /admin/login - Render admin login page
app.get('/admin/login', (req, res) => {
  res.render('admin-login.ejs');
});

// POST /admin/login - Verify admin password
app.post('/admin/login', (req, res) => {
  const { password, login_password } = req.body;
  const pw = password || login_password;
  if (pw === process.env.ADMIN_PASSWORD) {
    req.session.adminLoggedIn = true;
    return res.redirect('/admin');
  }
  res.redirect('/admin/login?error=1');
});

// GET /admin/logout - Destroy session and redirect
app.get('/admin/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/admin/login');
  });
});

// =============================================================================
// ADMIN API ROUTES (Protected)
// =============================================================================

// All /api/admin/* routes require auth
app.use('/api/admin', requireAdmin);

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
      'SELECT id, username, full_name, email, phone FROM clients WHERE username = ? AND password = ?',
      [username, password]
    );
    if (rows.length === 0) {
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

// GET /api/client/data - Get all client data (pets, services, quotes, docs, messages)
app.get('/api/client/data', requireClient, async (req, res) => {
  try {
    const clientId = req.session.clientId;
    if (!clientId) return res.status(401).json({ error: 'Not logged in' });

    const [[client], [pets], [services], [quotes], [docs], [messages]] = await Promise.all([
      pool.execute('SELECT id, username, full_name, email, phone FROM clients WHERE id = ?', [clientId]),
      pool.execute('SELECT * FROM client_pets WHERE client_id = ?', [clientId]),
      pool.execute('SELECT * FROM client_services WHERE client_id = ?', [clientId]),
      pool.execute('SELECT * FROM client_quotes WHERE client_id = ?', [clientId]),
      pool.execute('SELECT * FROM client_documents WHERE client_id = ?', [clientId]),
      pool.execute('SELECT * FROM client_messages WHERE client_id = ? ORDER BY created_at ASC', [clientId])
    ]);

    // Get SOP for each service
    const servicesWithSOP = await Promise.all((services[0] || []).map(async (svc) => {
      const [sop] = await pool.execute('SELECT * FROM service_sop WHERE service_id = ? ORDER BY id', [svc.id]);
      return { ...svc, stages: sop };
    }));

    // Parse pet_quotes JSON
    const quotesParsed = (quotes[0] || []).map(q => ({
      ...q,
      petQuotes: q.pet_quotes ? JSON.parse(q.pet_quotes) : []
    }));

    res.json({
      client: client[0] || null,
      pets: pets[0] || [],
      services: servicesWithSOP,
      quotes: quotesParsed,
      documents: docs[0] || [],
      messages: messages[0] || []
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
// ADMIN SPA STATIC FILES
// =============================================================================
app.use('/admin', express.static(path.join(__dirname, 'public', 'admin')));

// =============================================================================
// GLOBAL ERROR HANDLER
// =============================================================================
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
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
