(function() {
  'use strict';

  const API_BASE = '';

  // ── Helpers ──────────────────────────────────────────────────────────────────

  function toSnakeCase(obj) {
    if (obj === null || obj === undefined) return obj;
    if (typeof obj !== 'object') return obj;
    if (Array.isArray(obj)) return obj.map(toSnakeCase);
    var result = {};
    Object.keys(obj).forEach(function(k) {
      var sn = k.replace(/[A-Z]/g, function(m) { return '_' + m.toLowerCase(); });
      result[sn] = toSnakeCase(obj[k]);
    });
    return result;
  }

  function fromSnakeCase(obj) {
    if (obj === null || obj === undefined) return obj;
    if (typeof obj !== 'object') return obj;
    if (Array.isArray(obj)) return obj.map(fromSnakeCase);
    var result = {};
    Object.keys(obj).forEach(function(k) {
      var cc = k.replace(/_([a-z])/g, function(m) { return m[1].toUpperCase(); });
      result[cc] = fromSnakeCase(obj[k]);
    });
    return result;
  }

  // Build URL with filter params
  // Special case: .eq('id', value) on a GET → /api/crm/table/id/value
  function buildUrl(table, method, filters, offset, limit, orderCol, orderAsc) {
    var url = API_BASE + '/api/crm/' + table;

    // For GET with a single id filter, use /api/crm/table/id/value pattern
    if (method === 'GET' && filters.length === 1 && filters[0].op === '=') {
      var f = filters[0];
      if (f.col === 'id') {
        url = API_BASE + '/api/crm/' + table + '/' + encodeURIComponent(f.val);
      }
    } else {
      // Append filters as query params
      filters.forEach(function(f) {
        if (f.op === '=') {
          url += (url.includes('?') ? '&' : '?') + f.col + '=' + encodeURIComponent(f.val);
        } else if (f.op === '!=') {
          url += (url.includes('?') ? '&' : '?') + f.col + '!=' + encodeURIComponent(f.val);
        } else if (f.op === 'like') {
          var v = f.val.replace(/%/g, '');
          url += (url.includes('?') ? '&' : '?') + f.col + '=' + encodeURIComponent(v);
        } else if (f.op === '>') {
          url += (url.includes('?') ? '&' : '?') + f.col + '_gt=' + encodeURIComponent(f.val);
        } else if (f.op === '<') {
          url += (url.includes('?') ? '&' : '?') + f.col + '_lt=' + encodeURIComponent(f.val);
        } else if (f.op === '>=') {
          url += (url.includes('?') ? '&' : '?') + f.col + '_gte=' + encodeURIComponent(f.val);
        } else if (f.op === '<=') {
          url += (url.includes('?') ? '&' : '?') + f.col + '_lte=' + encodeURIComponent(f.val);
        }
      });
    }

    // Pagination
    if (offset !== undefined && limit !== undefined) {
      url += (url.includes('?') ? '&' : '?') + 'offset=' + offset + '&limit=' + limit;
    } else if (limit !== undefined) {
      url += (url.includes('?') ? '&' : '?') + 'limit=' + limit;
    }

    // Ordering
    if (orderCol) {
      url += (url.includes('?') ? '&' : '?') + 'order=' + orderCol + (orderAsc ? '' : '&desc=1');
    }

    return url;
  }

  // ── Chainable QueryBuilder ───────────────────────────────────────────────────

  function QueryBuilder(table) {
    this._table = table;
    this._method = 'GET';
    this._data = null;
    this._filters = [];
    this._cols = '*';
    this._offset = undefined;
    this._limit = undefined;
    this._orderCol = undefined;
    this._orderAsc = true;
    this._single = false;
  }

  QueryBuilder.prototype.select = function(cols) {
    this._cols = cols || '*';
    return this;
  };

  QueryBuilder.prototype.insert = function(data) {
    this._method = 'POST';
    this._data = Array.isArray(data) ? data.map(toSnakeCase) : toSnakeCase(data);
    return this;
  };

  QueryBuilder.prototype.upsert = function(data) {
    this._method = 'POST';
    this._data = Array.isArray(data) ? data.map(toSnakeCase) : toSnakeCase(data);
    return this;
  };

  QueryBuilder.prototype.update = function(data) {
    this._method = 'PUT';
    this._data = toSnakeCase(data);
    return this;
  };

  QueryBuilder.prototype.delete = function() {
    this._method = 'DELETE';
    return this;
  };

  // Filters
  QueryBuilder.prototype.eq = function(col, val) {
    this._filters.push({ col: col, op: '=', val: val });
    return this;
  };
  QueryBuilder.prototype.neq = function(col, val) {
    this._filters.push({ col: col, op: '!=', val: val });
    return this;
  };
  QueryBuilder.prototype.gt = function(col, val) {
    this._filters.push({ col: col, op: '>', val: val });
    return this;
  };
  QueryBuilder.prototype.lt = function(col, val) {
    this._filters.push({ col: col, op: '<', val: val });
    return this;
  };
  QueryBuilder.prototype.gte = function(col, val) {
    this._filters.push({ col: col, op: '>=', val: val });
    return this;
  };
  QueryBuilder.prototype.lte = function(col, val) {
    this._filters.push({ col: col, op: '<=', val: val });
    return this;
  };
  QueryBuilder.prototype.like = function(col, val) {
    this._filters.push({ col: col, op: 'like', val: val });
    return this;
  };
  QueryBuilder.prototype.ilike = function(col, val) {
    // Treat ilike the same as like for simplicity
    this._filters.push({ col: col, op: 'like', val: val });
    return this;
  };
  QueryBuilder.prototype.is = function(col, val) {
    // Handle .is('col', null) etc.
    this._filters.push({ col: col, op: 'is', val: val });
    return this;
  };
  QueryBuilder.prototype.in = function(col, val) {
    // Handle .in('col', [1,2,3])
    var vals = Array.isArray(val) ? val.join(',') : val;
    this._filters.push({ col: col, op: 'in', val: vals });
    return this;
  };

  // Pagination
  QueryBuilder.prototype.range = function(offset, limit) {
    this._offset = offset;
    this._limit = limit;
    return this;
  };
  QueryBuilder.prototype.limit = function(n) {
    this._limit = n;
    return this;
  };
  QueryBuilder.prototype.offset = function(n) {
    this._offset = n;
    return this;
  };

  // Ordering
  QueryBuilder.prototype.order = function(col, opts) {
    this._orderCol = col;
    this._orderAsc = (opts && opts.ascending !== undefined) ? opts.ascending : true;
    return this;
  };

  // Single result
  QueryBuilder.prototype.single = function() {
    this._single = true;
    return this;
  };

  // Maybe single result (returns null instead of error)
  QueryBuilder.prototype.maybeSingle = function() {
    this._single = true;
    return this;
  };

  // Abort controller for cancellation support
  QueryBuilder.prototype.abort = function() {
    // no-op for compatibility
    return this;
  };

  // Promise-based execution
  QueryBuilder.prototype.then = function(resolve, reject) {
    var self = this;
    var url = buildUrl(this._table, this._method, this._filters, this._offset, this._limit, this._orderCol, this._orderAsc);

    var fetchOpts = {
      method: this._method,
      credentials: 'include',
      headers: {}
    };

    if ((this._method === 'POST' || this._method === 'PUT') && this._data !== null) {
      fetchOpts.headers['Content-Type'] = 'application/json';
      fetchOpts.body = JSON.stringify(this._data);
    }

    fetch(url, fetchOpts).then(function(res) {
      return res.json().then(function(data) {
        if (!res.ok) {
          return resolve({ data: null, error: { message: data.error || 'Request failed', status: res.status } });
        }
        // Normalize response: if our API returns raw array, wrap it
        if (self._method === 'GET') {
          var arr = Array.isArray(data) ? data : (data && Array.isArray(data.data)) ? data.data : [];
          // Convert snake_case to camelCase
          arr = arr.map(fromSnakeCase);
          resolve({ data: self._single ? (arr[0] || null) : arr, error: null });
        } else {
          resolve({ data: fromSnakeCase(data), error: null });
        }
      });
    }).catch(function(e) {
      resolve({ data: null, error: { message: e.message } });
    });
  };

  QueryBuilder.prototype.catch = function(reject) {
    return this.then(function(x) { return x; }, reject);
  };

  QueryBuilder.prototype.finally = function(fn) {
    return this.then(function(x) { fn(); return x; }, function(x) { fn(); throw x; });
  };

  QueryBuilder.prototype.subscribe = function() { return { unsubscribe: function() {} }; };

  // ── Storage Bucket ──────────────────────────────────────────────────────────

  function StorageBucket(bucketName) {
    this._bucket = bucketName;
  }

  StorageBucket.prototype.upload = function(path, file) {
    var self = this;
    return new Promise(function(resolve) {
      var formData = new FormData();
      formData.append('file', file);
      fetch('/api/files/upload', {
        method: 'POST',
        credentials: 'include',
        body: formData
      }).then(function(res) {
        return res.json().then(function(data) {
          if (!res.ok) {
            resolve({ data: null, error: { message: data.error || 'Upload failed' } });
          } else {
            resolve({ data: { path: data.url || data.path || '/' + path }, error: null });
          }
        });
      }).catch(function(e) {
        resolve({ data: null, error: { message: e.message } });
      });
    });
  };

  StorageBucket.prototype.download = function(path) {
    return Promise.resolve({ data: { path: path }, error: null });
  };

  StorageBucket.prototype.remove = function(path) {
    return Promise.resolve({ data: null, error: null });
  };

  StorageBucket.prototype.list = function() {
    return Promise.resolve({ data: [], error: null });
  };

  // ── Auth ────────────────────────────────────────────────────────────────────

  var _session = null;
  var _user = null;
  var _listeners = [];

  function notifyListeners(event, session) {
    _listeners.forEach(function(fn) {
      try { fn(event, session); } catch (e) {}
    });
  }

  window.supabase = {
    from: function(table) {
      return new QueryBuilder(table);
    },

    storage: {
      from: function(bucket) {
        return new StorageBucket(bucket);
      }
    },

    auth: {
      signInWithPassword: async function(credentials) {
        try {
          var res = await fetch('/api/crm/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify(credentials)
          });
          var data = await res.json();
          if (!res.ok) return { data: null, error: { message: data.error || 'Login failed' } };
          _user = fromSnakeCase(data.user || data);
          _session = { user: _user };
          return { data: { session: _session, user: _user }, error: null };
        } catch (e) {
          return { data: null, error: { message: e.message } };
        }
      },

      signUp: async function(credentials) {
        try {
          var res = await fetch('/api/crm/auth/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify(credentials)
          });
          var data = await res.json();
          if (!res.ok) return { data: null, error: { message: data.error || 'Registration failed' } };
          _user = fromSnakeCase(data.user || data);
          _session = { user: _user };
          return { data: { session: _session, user: _user }, error: null };
        } catch (e) {
          return { data: null, error: { message: e.message } };
        }
      },

      signOut: async function() {
        try { await fetch('/api/crm/auth/logout', { method: 'POST', credentials: 'include' }); } catch (e) {}
        _user = null;
        _session = null;
        notifyListeners('SIGNED_OUT', null);
        return { error: null };
      },

      session: async function() {
        return { data: { session: _session }, error: null };
      },

      getSession: async function() {
        return { data: { session: _session }, error: null };
      },

      getUser: async function() {
        return { data: { user: _user }, error: null };
      },

      onAuthStateChange: function(callback) {
        _listeners.push(callback);
        setTimeout(function() { callback(_session ? 'INITIAL_SESSION' : 'SIGNED_OUT', _session); }, 0);
        return {
          data: {
            subscription: {
              unsubscribe: function() {
                _listeners = _listeners.filter(function(fn) { return fn !== callback; });
              }
            }
          }
        };
      }
    },

    removeChannel: function() {},
    channel: function() {
      return {
        on: function() { return this; },
        subscribe: function() { return this; },
        unsubscribe: function() {}
      };
    }
  };

  // ── Install `ye` and `bi` for backward compat ─────────────────────────────────
  window.ye = window.supabase;
  window.bi = {
    auth: {
      signInWithPassword: window.supabase.auth.signInWithPassword,
      signUp: window.supabase.auth.signUp,
      signOut: window.supabase.auth.signOut,
      getSession: window.supabase.auth.getSession,
      getUser: window.supabase.auth.getUser,
      onAuthStateChange: window.supabase.auth.onAuthStateChange,
      logOut: window.supabase.auth.signOut
    },
    from: window.supabase.from,
    storage: window.supabase.storage
  };

  console.log('[supabase-replace] window.supabase, window.ye, window.bi installed — routing to /api/crm/*');
})();
