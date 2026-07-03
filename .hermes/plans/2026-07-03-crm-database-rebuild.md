# CRM Database Rebuild — Hostinger MySQL

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Replace all Supabase CRM calls with a full native MySQL backend on Hostinger — same API contract, no frontend changes needed.

**Architecture:** Five core tables (clients, pets, documents, quotes, journeys) with a REST API layer that mirrors the existing `/api/client/*` and `/api/admin/*` patterns already in server.js. Auth stays session-based. File uploads go through the existing `/api/files/upload` (already working).

**Tech Stack:** Node.js + Express + mysql2, existing session auth.

---

## CRM Data Model (from bundle analysis)

### 5 Core Tables
```
clients      — id, name, initials, location, address, phone, email, status, password
pets         — id, client_id, name, breed, type, origin, destination, image, status, status_color, details (JSON)
documents    — id, client_id, pet_id (nullable), name, type, expiry_date, status, icon, file_url
quotes       — id, client_id, ref, route, status, pet_quotes (JSON)
journeys     — id, client_id, pet_id, overall_progress, current_location, estimated_arrival, airline, flight_no, tracking_id, stages (JSON)
```

### No DB needed
- `petmove_auth` (sessions) — handled by existing Express session middleware
- `petmove_payment_settings` — stored in localStorage, no DB needed

---

## Task 1: Create MySQL tables

**File:** `migrations/001_crm_tables.sql`

```sql
CREATE TABLE IF NOT EXISTS crm_clients (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  initials VARCHAR(10),
  location VARCHAR(255),
  address TEXT,
  phone VARCHAR(50),
  email VARCHAR(255) UNIQUE NOT NULL,
  status VARCHAR(50) DEFAULT 'active',
  password VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS crm_pets (
  id INT AUTO_INCREMENT PRIMARY KEY,
  client_id INT NOT NULL,
  name VARCHAR(255) NOT NULL,
  breed VARCHAR(255),
  type VARCHAR(50),
  origin VARCHAR(255),
  destination VARCHAR(255),
  image TEXT,
  status VARCHAR(100),
  status_color VARCHAR(100),
  details JSON,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (client_id) REFERENCES crm_clients(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS crm_documents (
  id INT AUTO_INCREMENT PRIMARY KEY,
  client_id INT NOT NULL,
  pet_id INT,
  name VARCHAR(255) NOT NULL,
  type VARCHAR(100),
  expiry_date VARCHAR(50),
  status VARCHAR(50),
  icon VARCHAR(50),
  file_url TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (client_id) REFERENCES crm_clients(id) ON DELETE CASCADE,
  FOREIGN KEY (pet_id) REFERENCES crm_pets(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS crm_quotes (
  id VARCHAR(50) PRIMARY KEY,
  client_id INT NOT NULL,
  ref VARCHAR(50),
  route TEXT,
  status VARCHAR(50) DEFAULT 'Awaiting Approval',
  pet_quotes JSON,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (client_id) REFERENCES crm_clients(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS crm_journeys (
  id VARCHAR(50) PRIMARY KEY,
  client_id INT NOT NULL,
  pet_id INT NOT NULL,
  overall_progress INT DEFAULT 0,
  current_location VARCHAR(255),
  estimated_arrival VARCHAR(255),
  airline VARCHAR(255),
  flight_no VARCHAR(50),
  tracking_id VARCHAR(100),
  stages JSON,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (client_id) REFERENCES crm_clients(id) ON DELETE CASCADE,
  FOREIGN KEY (pet_id) REFERENCES crm_pets(id) ON DELETE CASCADE
);
```

**Step 1:** Create `migrations/001_crm_tables.sql` with the above SQL.

**Step 2:** Create `migrations/run.js` — reads and executes all `.sql` files in `migrations/` folder.

**Step 3:** Run via `node migrations/run.js` — verify tables exist with `SHOW TABLES`.

**Step 4:** Commit.

---

## Task 2: Create `db/crm.js` — MySQL connection pool

**File:** `db/crm.js` (create folder `db/`)

```js
const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'srv1134.hstgr.io',
  port: 3306,
  user: process.env.DB_USER || 'u884869254_petflyinc',
  password: process.env.DB_PASSWORD || 'Jz10191019@@',
  database: process.env.DB_NAME || 'u884869254_petflyinc',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  enableKeepAlive: true,
  keepAliveInitialDelay: 0
});

module.exports = pool;
```

**Verify:** `node -e "require('./db/crm')" && echo "pool ok"`

**Commit.**

---

## Task 3: Add CRM REST routes to server.js

**Existing patterns to reuse** (lines 1395–2200 of current server.js handle `/api/client/*` and `/api/admin/*` for landing/MySQL — we add identical patterns for CRM):

Add these routes AFTER the existing `/api/client/*` routes (around line 1700) and BEFORE any static file serving.

### CRM Client Routes (`/api/crm/clients/*`)
```
GET    /api/crm/clients              → list all clients (admin)
GET    /api/crm/clients/:id         → get single client
POST   /api/crm/clients              → create client
PUT    /api/crm/clients/:id          → update client
DELETE /api/crm/clients/:id          → delete client
```

### CRM Pets Routes (`/api/crm/pets/*`)
```
GET    /api/crm/pets                 → list all pets
GET    /api/crm/pets?client_id=X     → list pets by client
GET    /api/crm/pets/:id             → get single pet
POST   /api/crm/pets                 → create pet
PUT    /api/crm/pets/:id             → update pet
DELETE /api/crm/pets/:id             → delete pet
```

### CRM Documents Routes (`/api/crm/documents/*`)
```
GET    /api/crm/documents             → list all
GET    /api/crm/documents?client_id=X → list by client
GET    /api/crm/documents?pet_id=X    → list by pet
GET    /api/crm/documents/:id         → get single
POST   /api/crm/documents             → create
PUT    /api/crm/documents/:id         → update
DELETE /api/crm/documents/:id         → delete
```

### CRM Quotes Routes (`/api/crm/quotes/*`)
```
GET    /api/crm/quotes                → list all
GET    /api/crm/quotes?client_id=X    → by client
GET    /api/crm/quotes/:id             → get single
POST   /api/crm/quotes                → create/upsert
PUT    /api/crm/quotes/:id            → update
DELETE /api/crm/quotes/:id            → delete
```

### CRM Journeys Routes (`/api/crm/journeys/*`)
```
GET    /api/crm/journeys               → list all
GET    /api/crm/journeys?client_id=X   → by client
GET    /api/crm/journeys?pet_id=X      → by pet
GET    /api/crm/journeys/:id           → get single
POST   /api/crm/journeys               → create
PUT    /api/crm/journeys/:id           → update
DELETE /api/crm/journeys/:id           → delete
```

### File Upload (`/api/crm/upload`) — reuse existing
Point CRM uploads at the existing `/api/files/upload` handler. No new code needed — just ensure the frontend upload URL works.

---

## Task 4: Build CRM Admin API routes

**File:** `routes/crm-admin.js` (new)

Exports Express router for `/api/admin/crm/*`:
- `GET /list_crm_clients` — paginated list
- `GET /get_crm_client/:id`
- `POST /add_crm_client`
- `PUT /update_crm_client/:id`
- `DELETE /delete_crm_client/:id`
- `GET /crm_stats` — counts for dashboard

**Step 1:** Create `routes/crm-admin.js` with the router.
**Step 2:** Add `app.use('/api/admin/crm', requireAdmin, require('./routes/crm-admin'));` to server.js (near line 548 where other admin routes are registered).
**Step 3:** Test with curl using admin session cookie.

**Commit.**

---

## Task 5: Remove Supabase polyfill — point CRM to native API

**File:** `public/CRM/lib/supabase-replace.js`

Replace the entire file with a new version that:
1. Intercepts `from('clients').select('*')` → calls `GET /api/crm/clients`
2. Intercepts `from('pets').select('*')` → calls `GET /api/crm/pets`
3. Intercepts `from('documents').select('*')` → calls `GET /api/crm/documents`
4. Intercepts `from('quotes').select('*')` → calls `GET /api/crm/quotes`
5. Intercepts `from('journeys').select('*')` → calls `GET /api/crm/journeys`
6. Intercepts `.insert()`, `.upsert()`, `.update()`, `.delete()` → calls appropriate POST/PUT/DELETE
7. Storage uploads (`/storage/v1/object/*`) → call `POST /api/files/upload` (FormData, not base64)
8. Remove all base64 upload-json logic — use existing `/api/files/upload` with FormData directly

**Key insight:** Since the frontend localStorage cache mirrors the Supabase tables, we can keep localStorage for read caching and sync to MySQL via our REST API. The data flow becomes:

```
Frontend → localStorage (cache) → REST API → MySQL
         ↓
    Also writes to localStorage on reads (seed on first load)
```

**Upload path (simplified):**
- FormData → `POST /api/files/upload` → file saved to `public/uploads/` → return URL
- No more base64 encoding needed

**Step 1:** Write new `supabase-replace.js` — clean REST-based interception
**Step 2:** Update `index.html` to remove `window.__supabaseUrlOverride__` (no longer needed)
**Step 3:** Verify upload works via Network tab

**Commit.**

---

## Task 6: Supabase seed data migration endpoint (optional helper)

**File:** `server.js` — add `/api/admin/seed-crm` endpoint

Accepts POST with JSON array of clients/pets/documents/quotes/journeys, inserts into MySQL. User can call this once after DB is set up to seed initial data.

---

## Files to Create
- `migrations/001_crm_tables.sql`
- `migrations/run.js`
- `db/crm.js`
- `routes/crm-admin.js`
- `public/CRM/lib/supabase-replace.js` (rewritten)

## Files to Modify
- `server.js` — add CRM routes, add `require('./routes/crm-admin')`, add `require('mysql2/promise')`
- `public/CRM/index.html` — remove `__supabaseUrlOverride__` line, update supabase-replace.js version
- `package.json` — add `mysql2` dependency (if not present)

## Verification Steps
1. `curl -b cookies.txt https://petflyinc.com/api/crm/clients` → returns JSON array
2. `curl -b cookies.txt -X POST https://petflyinc.com/api/crm/pets -d '{"client_id":1,"name":"Test"}' -H "Content-Type: application/json"` → inserts
3. Upload in CRM UI → file appears in `/uploads/`
4. Hard refresh CRM → data persists from MySQL

## Risks & Open Questions
- **JSON columns** (details, pet_quotes, stages): MySQL 5.7 doesn't support JSON type — use `TEXT` and `JSON.stringify()`/`JSON.parse()` in JS
- **Existing `/api/client/*` routes** (lines 1395+): These handle the legacy client portal. CRM uses different table names (`crm_*` prefix) — keep them separate
- **Auth**: Admin uses existing `requireAdmin` session middleware; no Supabase auth needed
- **Dashboard (index.html loads real data)**: Should work because `supabase-replace.js` intercepts all Supabase calls and redirects to our REST API
