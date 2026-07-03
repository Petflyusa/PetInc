const express = require('express');
const router = express.Router();
const crmPool = require('../db/crm');

// GET /api/admin/crm/list_clients — paginated list
router.get('/list_clients', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const offset = (page - 1) * limit;
    const [rows] = await crmPool.query('SELECT * FROM crm_clients ORDER BY id DESC LIMIT ? OFFSET ?', [limit, offset]);
    const [[{ total }]] = await crmPool.query('SELECT COUNT(*) as total FROM crm_clients');
    res.json({ data: rows, total, page, limit });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/admin/crm/get_client/:id
router.get('/get_client/:id', async (req, res) => {
  try {
    const [rows] = await crmPool.query('SELECT * FROM crm_clients WHERE id = ?', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/admin/crm/add_client
router.post('/add_client', async (req, res) => {
  const { name, initials, location, address, phone, email, status, password } = req.body;
  if (!name || !email) return res.status(400).json({ error: 'name and email required' });
  try {
    const [result] = await crmPool.query(
      'INSERT INTO crm_clients (name,initials,location,address,phone,email,status,password) VALUES (?,?,?,?,?,?,?,?)',
      [name, initials, location, address, phone, email, status || 'active', password]
    );
    const [rows] = await crmPool.query('SELECT * FROM crm_clients WHERE id = ?', [result.insertId]);
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/admin/crm/update_client/:id
router.put('/update_client/:id', async (req, res) => {
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

// DELETE /api/admin/crm/delete_client/:id
router.delete('/delete_client/:id', async (req, res) => {
  try {
    await crmPool.query('DELETE FROM crm_clients WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/admin/crm/list_pets?client_id=X
router.get('/list_pets', async (req, res) => {
  try {
    let sql = 'SELECT p.*, c.name as client_name FROM crm_pets p LEFT JOIN crm_clients c ON p.client_id=c.id';
    const params = [];
    if (req.query.client_id) { sql += ' WHERE p.client_id = ?'; params.push(req.query.client_id); }
    sql += ' ORDER BY p.id DESC';
    const [rows] = await crmPool.query(sql, params);
    rows.forEach(r => { if (r.details) r.details = JSON.parse(r.details); });
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/admin/crm/get_pet/:id
router.get('/get_pet/:id', async (req, res) => {
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

// POST /api/admin/crm/add_pet
router.post('/add_pet', async (req, res) => {
  const { client_id, name, breed, type, origin, destination, image, status, status_color, details } = req.body;
  if (!client_id || !name) return res.status(400).json({ error: 'client_id and name required' });
  try {
    const detailsStr = typeof details === 'object' ? JSON.stringify(details) : details;
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

// PUT /api/admin/crm/update_pet/:id
router.put('/update_pet/:id', async (req, res) => {
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

// DELETE /api/admin/crm/delete_pet/:id
router.delete('/delete_pet/:id', async (req, res) => {
  try {
    await crmPool.query('DELETE FROM crm_pets WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/admin/crm/list_documents?client_id=X&pet_id=Y
router.get('/list_documents', async (req, res) => {
  try {
    let sql = 'SELECT d.*, c.name as client_name, p.name as pet_name FROM crm_documents d LEFT JOIN crm_clients c ON d.client_id=c.id LEFT JOIN crm_pets p ON d.pet_id=p.id';
    const params = [];
    const conditions = [];
    if (req.query.client_id) { conditions.push('d.client_id = ?'); params.push(req.query.client_id); }
    if (req.query.pet_id) { conditions.push('d.pet_id = ?'); params.push(req.query.pet_id); }
    if (conditions.length) sql += ' WHERE ' + conditions.join(' AND ');
    sql += ' ORDER BY d.id DESC';
    const [rows] = await crmPool.query(sql, params);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/admin/crm/add_document
router.post('/add_document', async (req, res) => {
  const { client_id, pet_id, name, type, expiry_date, status, icon, file_url } = req.body;
  if (!client_id || !name) return res.status(400).json({ error: 'client_id and name required' });
  try {
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

// PUT /api/admin/crm/update_document/:id
router.put('/update_document/:id', async (req, res) => {
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

// DELETE /api/admin/crm/delete_document/:id
router.delete('/delete_document/:id', async (req, res) => {
  try {
    await crmPool.query('DELETE FROM crm_documents WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/admin/crm/list_quotes?client_id=X
router.get('/list_quotes', async (req, res) => {
  try {
    let sql = 'SELECT q.*, c.name as client_name FROM crm_quotes q LEFT JOIN crm_clients c ON q.client_id=c.id';
    const params = [];
    if (req.query.client_id) { sql += ' WHERE q.client_id = ?'; params.push(req.query.client_id); }
    sql += ' ORDER BY q.id DESC';
    const [rows] = await crmPool.query(sql, params);
    rows.forEach(r => { if (r.pet_quotes) r.pet_quotes = JSON.parse(r.pet_quotes); });
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/admin/crm/add_quote
router.post('/add_quote', async (req, res) => {
  const { id, client_id, ref, route, status, pet_quotes } = req.body;
  if (!client_id) return res.status(400).json({ error: 'client_id required' });
  try {
    const petQuotesStr = typeof pet_quotes === 'object' ? JSON.stringify(pet_quotes) : pet_quotes;
    await crmPool.query(
      'INSERT INTO crm_quotes (id,client_id,ref,route,status,pet_quotes) VALUES (?,?,?,?,?,?)',
      [id, client_id, ref, route, status || 'Awaiting Approval', petQuotesStr]
    );
    const [rows] = await crmPool.query('SELECT * FROM crm_quotes WHERE id = ?', [id]);
    if (rows[0].pet_quotes) rows[0].pet_quotes = JSON.parse(rows[0].pet_quotes);
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/admin/crm/update_quote/:id
router.put('/update_quote/:id', async (req, res) => {
  const { client_id, ref, route, status, pet_quotes } = req.body;
  try {
    const petQuotesStr = typeof pet_quotes === 'object' ? JSON.stringify(pet_quotes) : pet_quotes;
    await crmPool.query(
      'UPDATE crm_quotes SET client_id=?,ref=?,route=?,status=?,pet_quotes=? WHERE id=?',
      [client_id, ref, route, status, petQuotesStr, req.params.id]
    );
    const [rows] = await crmPool.query('SELECT * FROM crm_quotes WHERE id = ?', [req.params.id]);
    if (rows[0].pet_quotes) rows[0].pet_quotes = JSON.parse(rows[0].pet_quotes);
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/admin/crm/delete_quote/:id
router.delete('/delete_quote/:id', async (req, res) => {
  try {
    await crmPool.query('DELETE FROM crm_quotes WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/admin/crm/list_journeys?client_id=X&pet_id=Y
router.get('/list_journeys', async (req, res) => {
  try {
    let sql = 'SELECT j.*, c.name as client_name, p.name as pet_name FROM crm_journeys j LEFT JOIN crm_clients c ON j.client_id=c.id LEFT JOIN crm_pets p ON j.pet_id=p.id';
    const params = [];
    const conditions = [];
    if (req.query.client_id) { conditions.push('j.client_id = ?'); params.push(req.query.client_id); }
    if (req.query.pet_id) { conditions.push('j.pet_id = ?'); params.push(req.query.pet_id); }
    if (conditions.length) sql += ' WHERE ' + conditions.join(' AND ');
    sql += ' ORDER BY j.id DESC';
    const [rows] = await crmPool.query(sql, params);
    rows.forEach(r => { if (r.stages) r.stages = JSON.parse(r.stages); });
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/admin/crm/add_journey
router.post('/add_journey', async (req, res) => {
  const { id, client_id, pet_id, overall_progress, current_location, estimated_arrival, airline, flight_no, tracking_id, stages } = req.body;
  if (!client_id || !pet_id) return res.status(400).json({ error: 'client_id and pet_id required' });
  try {
    const stagesStr = typeof stages === 'object' ? JSON.stringify(stages) : stages;
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

// PUT /api/admin/crm/update_journey/:id
router.put('/update_journey/:id', async (req, res) => {
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

// DELETE /api/admin/crm/delete_journey/:id
router.delete('/delete_journey/:id', async (req, res) => {
  try {
    await crmPool.query('DELETE FROM crm_journeys WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/admin/crm/crm_stats — dashboard counts
router.get('/crm_stats', async (req, res) => {
  try {
    const [[clients]] = await crmPool.query('SELECT COUNT(*) as count FROM crm_clients');
    const [[pets]] = await crmPool.query('SELECT COUNT(*) as count FROM crm_pets');
    const [[documents]] = await crmPool.query('SELECT COUNT(*) as count FROM crm_documents');
    const [[quotes]] = await crmPool.query('SELECT COUNT(*) as count FROM crm_quotes');
    const [[journeys]] = await crmPool.query('SELECT COUNT(*) as count FROM crm_journeys');
    res.json({
      clients: clients.count,
      pets: pets.count,
      documents: documents.count,
      quotes: quotes.count,
      journeys: journeys.count
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
