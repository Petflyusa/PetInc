/**
 * supabase-replace.js — Replaces dead Supabase JS client calls with Express sessions.
 *
 * Loaded BEFORE the SPA bundle in public/CRM/index.html
 * Installs a `bi` global that the minified bundle already calls.
 *
 * Maps:
 *   bi.auth.signInWithPassword() → POST /api/client/login
 *   bi.auth.logOut()            → POST /api/auth/logout
 *   bi.auth.getSession()        → GET  /api/client/data
 *   bi.auth.onAuthStateChange() → polls GET /api/client/data every 5s
 *   bi.from('clients').select() → GET  /api/client/data
 *   bi.from('pets').select()    → GET  /api/client/data (included)
 *   bi.from('documents').select()→ GET  /api/client/data (included)
 *   bi.from('journeys').select()→ GET  /api/client/data (included)
 *   bi.from('quotes').select()   → GET  /api/client/data (included)
 *   bi.from('X').insert/upsert/update/delete → POST|PUT|DELETE /api/client/X
 */
(function () {
  'use strict';

  // ── GLOBAL FETCH INTERCEPTOR ────────────────────────────────────────────────
  // Route all Supabase JS client fetch calls to our Express server with session cookies
  const _originalFetch = window.fetch;
  window.fetch = function (input, init) {
    const url = typeof input === 'string' ? input : input instanceof Request ? input.url : (input && input.url) || '';
    const supabaseMatch = url.match(/https?:\/\/([^\/]+)\.supabase\.co(\/.*)/);
    if (supabaseMatch) {
      const path = supabaseMatch[2]; // e.g. /rest/v1/clients
      const rewriteMap = {
        '/rest/v1': '/api/client/data',
        '/storage/v1/object/public': '/api/files/public',
        '/storage/v1/object/upload': '/api/files/upload'
      };
      let mapped = rewriteMap[path];
      if (!mapped) {
        // Generic: /rest/v1/table → /api/client/data (for reads)
        if (path.startsWith('/rest/v1/')) mapped = '/api/client/data';
      }
      if (mapped) {
        const opts = init || {};
        opts.credentials = 'include';
        return _originalFetch.call(window, mapped + (url.includes('?') ? '?' + url.split('?')[1] : ''), opts);
      } else if (url.includes('.supabase.co/storage/')) {
        // Route all storage URLs to our file API
        const opts = init || {};
        opts.credentials = 'include';
        return _originalFetch.call(window, '/api/files/upload' + (url.includes('?') ? '?' + url.split('?')[1] : ''), opts);
      }
    }
    return _originalFetch.apply(window, arguments);
  };

  const SESSION_KEY = 'vg'; // matches the SPA's existing localStorage key
  const POLL_INTERVAL = 5000;
  const MAX_POLLS = 3; // hard cap to prevent flooding after 401
  const BASE = '/api';

  // ── Auth state ──────────────────────────────────────────────────────────────
  let _session = null;
  let _user = null;
  let _listeners = [];
  let _pollTimer = null;
  let _polling = false;
  let _pollCount = 0;

  function notifyListeners(event, session) {
    _listeners.forEach(function (fn) {
      try { fn(event, session); } catch (e) { console.error('[supabase-replace] auth listener error', e); }
    });
  }

  function startPolling() {
    if (_polling) return;
    _polling = true;
    _pollTimer = setInterval(async function () {
      _pollCount++;
      if (_pollCount > MAX_POLLS) {
        if (_pollTimer) { clearInterval(_pollTimer); _pollTimer = null; }
        _polling = false;
        return;
      }
      try {
        const res = await fetch(BASE + '/client/data', { credentials: 'include' });
        if (res.ok) {
          _pollCount = 0; // reset on success
          const data = await res.json();
          const newUser = (data && data.client) ? data.client : null;
          if (JSON.stringify(newUser) !== JSON.stringify(_user)) {
            _user = newUser;
            _session = _user ? { user: _user } : null;
            notifyListeners(_user ? 'SIGNED_IN' : 'SIGNED_OUT', _session);
          }
        } else {
          // 401 — clear session and stop polling to prevent flood
          if (_user !== null || _session !== null) {
            _user = null;
            _session = null;
            notifyListeners('SIGNED_OUT', null);
          }
          if (_pollTimer) { clearInterval(_pollTimer); _pollTimer = null; }
          _polling = false;
        }
      } catch (e) { /* network error, ignore */ }
    }, POLL_INTERVAL);
  }

  // ── Auth mock ────────────────────────────────────────────────────────────────
  class MockSupabaseAuth {
    async signInWithPassword(_a) {
      var email = _a.email, password = _a.password;
      try {
        var res = await fetch(BASE + '/client/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ username: email, password: password })
        });
        var data = await res.json();
        if (!res.ok) return { data: null, error: { message: data.error || 'Invalid credentials' } };
        _user = data;
        _session = { user: _user };
        localStorage.setItem(SESSION_KEY, JSON.stringify(_user));
        notifyListeners('SIGNED_IN', _session);
        return { data: { session: _session, user: _user }, error: null };
      } catch (e) {
        return { data: null, error: { message: e.message } };
      }
    }

    async logOut() {
      try { await fetch(BASE + '/auth/logout', { method: 'POST', credentials: 'include' }); } catch (e) { /* ignore */ }
      _user = null;
      _session = null;
      localStorage.removeItem(SESSION_KEY);
      notifyListeners('SIGNED_OUT', null);
      return { error: null };
    }

    async getSession() {
      try {
        var res = await fetch(BASE + '/client/data', { credentials: 'include' });
        if (!res.ok) { _user = null; _session = null; return { data: { session: null, user: null }, error: null }; }
        var data = await res.json();
        if (data && data.client) {
          _user = data.client;
          _session = { user: _user };
        } else {
          _user = null; _session = null;
        }
        return { data: { session: _session, user: _user }, error: null };
      } catch (e) {
        return { data: null, error: { message: e.message } };
      }
    }

    async getUser() { return this.getSession(); }

    onAuthStateChange(callback) {
      _listeners.push(callback);
      setTimeout(function () { callback(_session ? 'INITIAL_SESSION' : 'SIGNED_OUT', _session); }, 0);
      return { data: { subscription: { unsubscribe: function () { _listeners = _listeners.filter(function (fn) { return fn !== callback; }); } } } };
    }
  }

  // ── QueryBuilder mock ────────────────────────────────────────────────────────
  var METHOD_MAP = { insert: 'POST', upsert: 'POST', update: 'POST', delete: 'DELETE' };
  var ENDPOINT_MAP = {
    clients:   { read: BASE + '/client/data',    write: BASE + '/client/clients' },
    pets:     { read: BASE + '/client/data',    write: BASE + '/client/pets' },
    documents:{ read: BASE + '/client/data',    write: BASE + '/client/documents' },
    journeys: { read: BASE + '/client/data',    write: BASE + '/client/journeys' },
    quotes:   { read: BASE + '/client/data',    write: BASE + '/client/quotes' }
  };

  function toSnakeCase(obj) {
    if (obj === null || obj === undefined) return obj;
    if (typeof obj !== 'object') return obj;
    if (Array.isArray(obj)) return obj.map(toSnakeCase);
    var result = {};
    Object.keys(obj).forEach(function (k) {
      var sn = k.replace(/[A-Z]/g, function (m) { return '_' + m.toLowerCase(); });
      result[sn] = toSnakeCase(obj[k]);
    });
    return result;
  }

  function fromSnakeCase(obj) {
    if (obj === null || obj === undefined) return obj;
    if (typeof obj !== 'object') return obj;
    if (Array.isArray(obj)) return obj.map(fromSnakeCase);
    var result = {};
    Object.keys(obj).forEach(function (k) {
      var cc = k.replace(/_([a-z])/g, function (m) { return m[1].toUpperCase(); });
      result[cc] = fromSnakeCase(obj[k]);
    });
    return result;
  }

  function MockQueryBuilder(table) {
    this._table = table;
    this._filters = [];
    this._single = false;
    this._method = 'GET';
    this._body = null;
  }

  MockQueryBuilder.prototype.select = function (cols) {
    this._selectCols = cols || '*';
    return this;
  };

  MockQueryBuilder.prototype.eq = function (col, val) {
    this._filters.push(col + '=' + encodeURIComponent(val));
    return this;
  };

  MockQueryBuilder.prototype.neq = function () { return this; };
  MockQueryBuilder.prototype.gt = function () { return this; };
  MockQueryBuilder.prototype.lt = function () { return this; };
  MockQueryBuilder.prototype.is_ = function () { return this; };
  MockQueryBuilder.prototype.order = function () { return this; };
  MockQueryBuilder.prototype.limit = function () { return this; };

  MockQueryBuilder.prototype.single = function () {
    this._single = true;
    return this;
  };

  MockQueryBuilder.prototype.insert = function (row) {
    this._method = 'POST';
    this._body = Array.isArray(row) ? row.map(toSnakeCase) : toSnakeCase(row);
    return this;
  };

  MockQueryBuilder.prototype.upsert = function (row) {
    this._method = 'POST';
    this._body = Array.isArray(row) ? row.map(toSnakeCase) : toSnakeCase(row);
    return this;
  };

  MockQueryBuilder.prototype.update = function (row) {
    this._method = 'POST';
    this._body = toSnakeCase(row);
    return this;
  };

  MockQueryBuilder.prototype.delete = function () {
    this._method = 'DELETE';
    return this;
  };

  MockQueryBuilder.prototype.then = function (resolve, reject) {
    var self = this;
    var endpoint = ENDPOINT_MAP[this._table] || { read: BASE + '/' + this._table, write: BASE + '/' + this._table };
    var url = endpoint.read;

    if (this._method !== 'GET' && this._method !== 'DELETE') {
      url = endpoint.write;
    }

    if (this._filters.length > 0) {
      url += '?' + this._filters.join('&');
    }

    var fetchOpts = { method: this._method, credentials: 'include' };
    if (this._body && (this._method === 'POST' || this._method === 'PUT')) {
      fetchOpts.headers = { 'Content-Type': 'application/json' };
      fetchOpts.body = JSON.stringify(this._body);
    }

    fetch(url, fetchOpts).then(function (res) {
      return res.json().then(function (data) {
        if (!res.ok) return resolve({ data: null, error: { message: data.error || 'Request failed' } });
        // GET /api/client/data returns {client, pets, services, quotes, documents, messages}
        // Wrap in array to match Supabase's expected array response
        if (self._method === 'GET') {
          var tableKey = self._table === 'clients' ? 'client' :
                         self._table === 'pets' ? 'pets' :
                         self._table === 'documents' ? 'documents' :
                         self._table === 'journeys' ? 'services' :
                         self._table === 'quotes' ? 'quotes' : null;
          var arr = (tableKey && data && Array.isArray(data[tableKey])) ? data[tableKey] :
                    (data && Array.isArray(data)) ? data : [];
          // apply .eq() filters client-side
          if (self._filters.length > 0) {
            arr = arr.filter(function (row) {
              return self._filters.every(function (f) {
                var parts = f.split('=');
                var k = parts[0];
                var v = decodeURIComponent(parts[1]);
                return String(fromSnakeCase(row)[k]) === v;
              });
            });
          }
          resolve({ data: self._single ? (arr[0] || null) : arr, error: null });
        } else {
          resolve({ data: data, error: null });
        }
      });
    }).catch(function (e) {
      resolve({ data: null, error: { message: e.message } });
    });
  };

  // ── Install global `bi` ───────────────────────────────────────────────────────
  window.bi = {
    auth: new MockSupabaseAuth(),
    from: function (table) { return new MockQueryBuilder(table); },
    storage: {
      from: function () {
        return {
          upload: function () { return Promise.resolve({ data: { path: '' }, error: null }); },
          download: function () { return Promise.reject('not implemented'); }
        };
      }
    }
  };

  // Restore session from localStorage
  var stored = localStorage.getItem(SESSION_KEY);
  if (stored) {
    try { _user = JSON.parse(stored); _session = _user ? { user: _user } : null; } catch (e) {}
  }

  startPolling();
  console.log('[supabase-replace] bi global installed — Supabase calls routed to Express');
})();
