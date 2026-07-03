# PetInc — Supabase-to-MySQL Migration: Implementation Plan

**Project:** PetInc CRM SPA → Express + MySQL (Hostinger)  
**Bundle analysis date:** July 2026  
**Supabase client variable:** `bi` (found in bundled vendor code `index-CVJoSUgX.js`)  
**Tables:** `clients`, `client_pets`, `client_services` (journeys), `client_quotes` (quotes), `client_documents` (documents)  
**Auth pattern:** `bi.auth.signInWithPassword()` / `bi.auth.logOut()` / `bi.auth.getSession()` / `bi.auth.onAuthStateChange()` → Express sessions  
**User storage:** `localStorage` via `setCurrentUser` / `setCurrentUser`  
**Field convention:** camelCase (Supabase) ↔ snake_case (MySQL)  

---

## Architecture Summary

```
Browser SPA (CRM)                    Express Server (server.js)
─────────────────                    ──────────────────────────────────────
bi.auth.signInWithPassword()    →    POST /api/client/login
bi.auth.getSession()            →    GET  /api/client/data  (requires session)
bi.auth.onAuthStateChange()    →    Client polls or receives session cookie
bi.auth.logOut()               →    POST /api/auth/logout  (NEW)
bi.from('pets').select()        →    GET  /api/admin/list_pets
bi.from('documents').insert()    →    POST /api/admin/add_document  (NEW)
bi.from('journeys').update()    →    POST /api/admin/update_service (NEW)
bi.from('quotes').select()      →    GET  /api/admin/list_quotes   (exists, needs docs)
```

All Supabase Storage calls are already polyfilled in `public/CRM/index.html` via fetch/XHR interceptors that route to `/api/files/*`.

---

## Task 1 — Remove Dead Supabase Proxy Stubs

**File:** `~/.hermes/workspace/PetInc/server.js`  
**Lines:** 82–84

The stub routes currently return empty arrays and must be removed so real endpoint routing takes over.

```javascript
// CURRENT (lines 82-84) — DELETE THESE THREE LINES:
app.all('/rest/v1/:table', (req, res) => { res.json([]); });
app.all('/storage/v1/:path(*)', (req, res) => { res.json([]); });
app.all('/auth/v1/:path(*)', (req, res) => { res.json({ data: { session: null, user: null }, error: null }); });
```

**Change:**
- Delete lines 82, 83, 84
- No replacement — removing these lets express fall through to actual route handlers

**Verification:**
```bash
# After change, these should NOT return []:
curl http://localhost:3000/rest/v1/clients     # → 404 or real data
curl http://localhost:3000/auth/v1/token       # → 404 or real auth response
```

---

## Task 2 — Add POST /api/auth/logout Endpoint

**File:** `~/.hermes/workspace/PetInc/server.js`  
**Insert after line 1366 (after the `POST /api/client/login` handler)**

The SPA calls `bi.auth.logOut()` which the current server has no handler for.

```javascript
// =============================================================================
// CLIENT AUTH LOGOUT (maps to bi.auth.logOut())
// =============================================================================
// POST /api/auth/logout — destroy session (maps to bi.auth.logOut())
app.post('/api/auth/logout', (req, res) => {
  if (req.session) {
    req.session.destroy((err) => {
      if (err) {
        return res.status(500).json({ error: 'Logout failed' });
      }
      res.clearCookie('connect.sid');
      res.json({ error: null });
    });
  } else {
    res.json({ error: null });
  }
});
```

**Also add a corresponding GET variant** (some SPA implementations call logout via `<a>` tag or script src):

```javascript
// GET /api/auth/logout — same as POST, destroy session
app.get('/api/auth/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) return res.redirect('/CRM?error=logout');
    res.clearCookie('connect.sid');
    res.redirect('/CRM');
  });
});
```

**Verification:**
```bash
# Login first, then logout
curl -c cookies.txt -X POST http://localhost:3000/api/client/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"demo","password":"demo"}'

curl -b cookies.txt -X POST http://localhost:3000/api/auth/logout
# → {"error":null}

# Verify session destroyed
curl -b cookies.txt http://localhost:3000/api/client/data
# → {"error":"Not logged in"}
```

---

## Task 3 — Add Documents CRUD to Admin API

**File:** `~/.hermes/workspace/PetInc/server.js`  
**Insert inside `app.all('/api/admin/:action')` handler body — after line 937 (before `// ========== STATS` comment)**

Add these actions inside the unified admin handler (the `app.all('/api/admin/:action')` switch block, before the `stats` block at line 940):

```javascript
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
```

**Note:** `client_documents` table is created by the `/api/setup` endpoint (line 1288–1300).

**Verification:**
```bash
# Add a document
curl -X POST http://localhost:3000/api/admin/add_document \
  -H 'Content-Type: application/json' \
  -d '{"client_id":1,"name":"Vaccination Cert","type":"vaccination","expiry_date":"2027-01-01","status":"valid","file_url":""}'
# → {"success":true,"id":1}

# List documents
curl 'http://localhost:3000/api/admin/list_documents'
# → [{"id":1,"client_id":1,...}]

# Get single document
curl 'http://localhost:3000/api/admin/get_document?id=1'
# → {"id":1,"client_id":1,"name":"Vaccination Cert",...}

# Update
curl -X POST http://localhost:3000/api/admin/update_document \
  -H 'Content-Type: application/json' \
  -d '{"id":1,"name":"Vaccination Cert Updated","status":"expired"}'
# → {"success":true}

# Delete
curl -X DELETE 'http://localhost:3000/api/admin/delete_document?id=1'
# → {"success":true}
```

---

## Task 4 — Create Frontend Supabase Replacement Library

**New File:** `~/.hermes/workspace/PetInc/public/CRM/lib/supabase-replace.js`

This module replaces dead Supabase auth calls with equivalents backed by Express sessions.

```javascript
/**
 * supabase-replace.js — replaces dead Supabase auth calls with Express sessions
 * Loaded BEFORE the SPA bundle in public/CRM/index.html
 * 
 * Maps:
 *   bi.auth.signInWithPassword() → POST /api/client/login
 *   bi.auth.logOut()            → POST /api/auth/logout
 *   bi.auth.getSession()        → GET  /api/client/data (checks session)
 *   bi.auth.onAuthStateChange() → polls GET /api/client/data every 5s
 */

(function() {
  'use strict';

  const SESSION_KEY = 'petinc_session';
  const POLL_INTERVAL = 5000;

  // ------------------------------------------------------------------
  // Auth state
  // ------------------------------------------------------------------
  let _session = null;
  let _user = null;
  let _listeners = [];

  function notifyListeners(event, session) {
    _listeners.forEach(fn => {
      try { fn(event, session); } catch(e) { console.error('auth listener error', e); }
    });
  }

  function startPolling() {
    setInterval(async () => {
      try {
        const res = await fetch('/api/client/data', { credentials: 'include' });
        if (res.ok) {
          const data = await res.json();
          const newUser = data.client || null;
          if (JSON.stringify(newUser) !== JSON.stringify(_user)) {
            _user = newUser;
            _session = newUser ? { user: _user, access_token: 'session cookie' } : null;
            notifyListeners(newUser ? 'SIGNED_IN' : 'SIGNED_OUT', _session);
          }
        } else {
          if (_user !== null) {
            _user = null;
            _session = null;
            notifyListeners('SIGNED_OUT', null);
          }
        }
      } catch(e) { /* network error, ignore */ }
    }, POLL_INTERVAL);
  }

  // ------------------------------------------------------------------
  // SupabaseClient mock
  // ------------------------------------------------------------------
  class MockSupabaseAuth {
    constructor() {}

    async signInWithPassword({ email, password }) {
      try {
        const res = await fetch('/api/client/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ username: email, password })
        });
        const data = await res.json();
        if (!res.ok) return { data: null, error: { message: data.error || 'Invalid credentials' } };
        _user = { id: data.id, email: data.email, name: data.name };
        _session = { user: _user, access_token: 'session cookie' };
        localStorage.setItem(SESSION_KEY, JSON.stringify(_user));
        notifyListeners('SIGNED_IN', _session);
        return { data: { session: _session, user: _user }, error: null };
      } catch(e) {
        return { data: null, error: { message: e.message } };
      }
    }

    async logOut() {
      try {
        await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
      } catch(e) { /* ignore */ }
      _user = null;
      _session = null;
      localStorage.removeItem(SESSION_KEY);
      notifyListeners('SIGNED_OUT', null);
      return { error: null };
    }

    async getSession() {
      try {
        const res = await fetch('/api/client/data', { credentials: 'include' });
        if (!res.ok) { _user = null; _session = null; return { data: { session: null, user: null }, error: null }; }
        const data = await res.json();
        if (data.client) {
          _user = data.client;
          _session = { user: _user, access_token: 'session cookie' };
        } else {
          _user = null; _session = null;
        }
        return { data: { session: _session, user: _user }, error: null };
      } catch(e) {
        return { data: null, error: { message: e.message } };
      }
    }

    onAuthStateChange(callback) {
      _listeners.push(callback);
      // Immediately call with current state
      setTimeout(() => { callback(_session ? 'INITIAL_SESSION' : 'SIGNED_OUT', _session); }, 0);
      return { data: { subscription: { unsubscribe: () => {
        _listeners = _listeners.filter(fn => fn !== callback);
      }}}};
    }
  }

  // ------------------------------------------------------------------
  // Database mock (bi.from(...).select/insert/update/delete)
  // ------------------------------------------------------------------
  class MockQueryBuilder {
    constructor(table) {
      this._table = table;
      this._filters = [];
      this._selectCols = '*';
      this._single = false;
    }

    select(cols = '*') { this._selectCols = cols; return this; }
    insert(row) { return this._mutation('POST', `/api/admin/add_${this._table.slice(0, -1)}`, row); }
    insert(rows) { return this._mutation('POST', `/api/admin/add_${this._table.slice(0, -1)}`, Array.isArray(rows) ? rows[0] : rows); }
    update(row) { return this._mutation('POST', `/api/admin/update_${this._table.slice(0, -1)}`, row); }
    upsert(row) { return this._mutation('POST', `/api/admin/update_${this._table.slice(0, -1)}`, row); }
    delete() { return this._mutation('DELETE', `/api/admin/delete_${this._table.slice(0, -1)}`); }

    eq(col, val) { this._filters.push(`${col}=${encodeURIComponent(val)}`); return this; }
    neq(col, val) { return this; }
    single() { this._single = true; return this; }

    async then(resolve, reject) {
      try {
        const filterStr = this._filters.map(f => '&' + f).join('');
        let url = `/api/admin/list_${this._table}${filterStr}`;
        const res = await fetch(url, { credentials: 'include' });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Query failed');
        resolve({ data: this._single ? (data[0] || null) : data, error: null });
      } catch(e) {
        resolve({ data: null, error: { message: e.message } });
      }
    }

    async _mutation(method, url, body) {
      try {
        const opts = { method, credentials: 'include' };
        if (body) { opts.headers = { 'Content-Type': 'application/json' }; opts.body = JSON.stringify(body); }
        const res = await fetch(url, opts);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Mutation failed');
        return { data, error: null };
      } catch(e) {
        return { data: null, error: { message: e.message } };
      }
    }
  }

  class MockSupabaseDatabase {
    from(table) { return new MockQueryBuilder(table); }
  }

  class MockSupabaseClient {
    constructor(url, key, options) {
      this.auth = new MockSupabaseAuth();
      this.from = (t) => new MockQueryBuilder(t);
      this.storage = { from: (bucket) => ({ upload: () => {}, download: () => {} }) };
    }
  }

  // ------------------------------------------------------------------
  // Install bi global BEFORE SPA bundle loads
  // ------------------------------------------------------------------
  window.bi = new MockSupabaseClient(
    window.__SUPABASE_POLYFILL_URL__ || '/api',
    'polyfill-anon-key'
  );

  // Load existing session from localStorage
  const stored = localStorage.getItem(SESSION_KEY);
  if (stored) {
    try { _user = JSON.parse(stored); _session = { user: _user }; } catch {}
  }

  startPolling();

  console.log('[supabase-replace] bi global installed — Supabase calls routed to Express');
})();
```

**Integration:** Add to `~/.hermes/workspace/PetInc/public/CRM/index.html` before the `index-CVJoSUgX.js` script tag (line 96):

```html
<!-- Add BEFORE the SPA bundle (line 96): -->
<script src="/CRM/lib/supabase-replace.js"></script>
```

Resulting `<head>` section (lines 7–98 of index.html):

```html
<head>
  <!-- ... existing polyfill script (lines 7-95 stay unchanged) ... -->
  <script src="/CRM/lib/supabase-replace.js"></script>
  <script type="module" crossorigin src="/CRM/assets/index-CVJoSUgX.js"></script>
  <!-- rest unchanged -->
</head>
```

**Verification:**
```bash
# Start server and open CRM in browser, then check console:
# [supabase-replace] bi global installed — Supabase calls routed to Express
# [supabase-replace] poll started

# Check network tab — bi.auth calls should go to /api/*
curl -c cookies.txt -X POST http://localhost:3000/api/client/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"demo","password":"demo"}' | python3 -m json.tool
# → {"id":1,"username":"demo","name":"Demo Client","email":"demo@petflyinc.com","phone":"+1-555-0100"}
```

---

## Task 5 — Verification Checklist

Run this after all 4 tasks are complete.

```bash
# ── 1. Server starts cleanly ──────────────────────────────────────────────
cd /Users/jz/.hermes/workspace/PetInc
node -e "require('./server.js')" 2>&1 | head -5
# Expected: no import errors

# ── 2. No dead stubs remain ───────────────────────────────────────────────
grep -n '/rest/v1/:table\|/storage/v1/\|/auth/v1/' server.js
# Expected: no output (all three removed)

# ── 3. Logout endpoint exists ───────────────────────────────────────────────
curl -s -X POST http://localhost:3000/api/auth/logout
# Expected: {"error":null}

# ── 4. Documents CRUD ─────────────────────────────────────────────────────
DOC=$(curl -s -X POST http://localhost:3000/api/admin/add_document \
  -H 'Content-Type: application/json' \
  -d '{"client_id":1,"name":"Health Cert","type":"health","status":"valid"}')
echo $DOC
# Expected: {"success":true,"id":<number>}

DOC_ID=$(echo $DOC | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")
curl -s "http://localhost:3000/api/admin/get_document?id=${DOC_ID}"
# Expected: {"id":...,"client_id":1,"name":"Health Cert",...}

curl -s -X DELETE "http://localhost:3000/api/admin/delete_document?id=${DOC_ID}"
# Expected: {"success":true}

# ── 5. Client login + session ─────────────────────────────────────────────
curl -c /tmp/pc.txt -s -X POST http://localhost:3000/api/client/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"demo","password":"demo"}' | python3 -m json.tool
# Expected: client object with id, username, name, email

curl -b /tmp/pc.txt -s http://localhost:3000/api/client/data | python3 -c \
  "import sys,json; d=json.load(sys.stdin); print('client:', d['client']['name'], '| pets:', len(d['pets']), '| services:', len(d['services']))"
# Expected: client: Demo Client | pets: 1 | services: 1

# ── 6. Auth state polling (bi.onAuthStateChange replacement) ───────────────
curl -b /tmp/pc.txt -s http://localhost:3000/api/client/data | python3 -c \
  "import sys,json; d=json.load(sys.stdin); print('session valid' if d['client'] else 'session invalid')"
# Expected: session valid

# ── 7. After logout, session is cleared ────────────────────────────────────
curl -b /tmp/pc.txt -s -X POST http://localhost:3000/api/auth/logout
# Expected: {"error":null}

curl -b /tmp/pc.txt -s http://localhost:3000/api/client/data
# Expected: {"error":"Not logged in"}

# ── 8. SPA file loads ─────────────────────────────────────────────────────
curl -s http://localhost:3000/CRM/ | grep -o 'supabase-replace\|index-CVJoSUgX'
# Expected: supabase-replace index-CVJoSUgX (both in output)
```

---

## File Summary

| File | Change | Location |
|------|--------|----------|
| `server.js` | Delete dead stubs | Lines 82–84 |
| `server.js` | Add POST/GET `/api/auth/logout` | After line 1366 |
| `server.js` | Add documents CRUD actions in `app.all('/api/admin/:action')` | Before line 940 |
| `public/CRM/lib/supabase-replace.js` | **NEW** — Supabase auth/DB replacement | Create |
| `public/CRM/index.html` | Add `<script src="/CRM/lib/supabase-replace.js">` | Before line 96 |

---

## Dependencies

All endpoints use the existing `pool` (MySQL) and `bcrypt` already imported in `server.js`. No new npm packages required.

## Rollback

To revert Task 1 only:
```javascript
// In server.js after line 81, add back:
app.all('/rest/v1/:table', (req, res) => { res.json([]); });
app.all('/storage/v1/:path(*)', (req, res) => { res.json([]); });
app.all('/auth/v1/:path(*)', (req, res) => { res.json({ data: { session: null, user: null }, error: null }); });
```
