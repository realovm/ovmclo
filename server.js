#!/usr/bin/env node
/**
 * OVM CLO — Backend Server
 * Pure Node.js built-ins only. No npm dependencies.
 * SQLite via Python bridge (db/db_bridge.py)
 */

const http       = require('http');
const https      = require('https');
const fs         = require('fs');
const path       = require('path');
const url        = require('url');
const crypto     = require('crypto');
const { execFileSync } = require('child_process');

const PORT       = process.env.PORT || 3000;
const DB_BRIDGE  = path.join(__dirname, 'db', 'db_bridge.py');
const STATIC_DIR = path.join(__dirname, 'public');

// ── JWT-LITE (no deps) ──────────────────────────────────────────────────────
const JWT_SECRET = process.env.JWT_SECRET || 'ovmclo_jwt_secret_2025_!@#';

function b64url(str) {
  return Buffer.from(str).toString('base64url');
}
function signToken(payload, expiresInH = 168) {
  const header  = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  payload.exp   = Math.floor(Date.now() / 1000) + expiresInH * 3600;
  payload.iat   = Math.floor(Date.now() / 1000);
  const body    = b64url(JSON.stringify(payload));
  const sig     = crypto.createHmac('sha256', JWT_SECRET)
                        .update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${sig}`;
}
function verifyToken(token) {
  try {
    const [h, b, s] = token.split('.');
    const expected  = crypto.createHmac('sha256', JWT_SECRET)
                            .update(`${h}.${b}`).digest('base64url');
    if (expected !== s) return null;
    const payload = JSON.parse(Buffer.from(b, 'base64url').toString());
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch { return null; }
}

// ── DB HELPER ───────────────────────────────────────────────────────────────
function db(action, params = {}) {
  const input  = JSON.stringify({ action, params });
  const output = execFileSync('python3', [DB_BRIDGE], {
    input,
    timeout: 10000,
    maxBuffer: 10 * 1024 * 1024,
  });
  return JSON.parse(output.toString());
}

// ── REQUEST HELPERS ─────────────────────────────────────────────────────────
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString() || '{}')); }
      catch { resolve({}); }
    });
    req.on('error', reject);
  });
}

function send(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type':  'application/json',
    'Content-Length': Buffer.byteLength(body),
    'X-Powered-By': 'ovmclo API',
  });
  res.end(body);
}

function ok(res, data, status = 200) { send(res, status, { ok: true, data }); }
function err(res, msg, status = 400) { send(res, status, { ok: false, error: msg }); }

function getSession(req) {
  const cookies = parseCookies(req.headers.cookie || '');
  return cookies.session_id || generateSession();
}

function parseCookies(str) {
  const obj = {};
  str.split(';').forEach(p => {
    const [k, ...v] = p.trim().split('=');
    if (k) obj[k.trim()] = decodeURIComponent(v.join('='));
  });
  return obj;
}

function generateSession() {
  return crypto.randomBytes(16).toString('hex');
}

function getAuth(req) {
  const auth  = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  return token ? verifyToken(token) : null;
}

function requireAdmin(req, res) {
  const user = getAuth(req);
  if (!user || user.role !== 'admin') {
    err(res, 'Unauthorized — admin only', 401);
    return null;
  }
  return user;
}

// ── STATIC FILE SERVER ───────────────────────────────────────────────────────
const MIME = {
  '.html': 'text/html',
  '.css':  'text/css',
  '.js':   'application/javascript',
  '.json': 'application/json',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
  '.woff2':'font/woff2',
};

function serveStatic(req, res, pathname) {
  let filePath = path.join(STATIC_DIR, pathname === '/' ? 'index.html' : pathname);
  if (!filePath.startsWith(STATIC_DIR)) { err(res, 'Forbidden', 403); return; }
  fs.readFile(filePath, (readErr, data) => {
    if (readErr) {
      // SPA fallback
      fs.readFile(path.join(STATIC_DIR, 'index.html'), (e2, d2) => {
        if (e2) { err(res, 'Not found', 404); return; }
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(d2);
      });
      return;
    }
    const ext  = path.extname(filePath).toLowerCase();
    const mime = MIME[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'no-cache' });
    res.end(data);
  });
}

// ── ROUTER ───────────────────────────────────────────────────────────────────
async function router(req, res) {
  const parsed   = url.parse(req.url, true);
  const pathname = parsed.pathname;
  const method   = req.method.toUpperCase();

  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,PATCH,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  // Set session cookie if missing
  const cookies    = parseCookies(req.headers.cookie || '');
  let   session_id = cookies.session_id;
  if (!session_id) {
    session_id = generateSession();
    res.setHeader('Set-Cookie', `session_id=${session_id}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`);
  }

  // ── API routes ───────────────────────────────────────────────────────────
  if (pathname.startsWith('/api/')) {
    try {
      await handleAPI(req, res, pathname, method, parsed.query, session_id);
    } catch (e) {
      console.error('[API Error]', e.message);
      err(res, 'Internal server error', 500);
    }
    return;
  }

  // ── Static files ─────────────────────────────────────────────────────────
  serveStatic(req, res, pathname);
}

// ── API HANDLER ──────────────────────────────────────────────────────────────
async function handleAPI(req, res, pathname, method, query, session_id) {
  const segments = pathname.slice(5).split('/').filter(Boolean); // strip /api/
  const resource = segments[0];
  const id       = segments[1];

  // ── HEALTH ──────────────────────────────────────────────────────────────
  if (resource === 'health' && method === 'GET') {
    ok(res, { status: 'ok', service: 'OVM CLO API', version: '1.0.0', time: new Date().toISOString() });
  }

  // ── PRODUCTS ─────────────────────────────────────────────────────────────
  if (resource === 'products') {
    if (method === 'GET' && !id) {
      const result = db('products.list', {
        category: query.category,
        featured: query.featured === 'true' ? true : undefined,
        search:   query.search,
        limit:    query.limit  || 50,
        offset:   query.offset || 0,
      });
      result.ok ? ok(res, result.data) : err(res, result.error);
      return;
    }
    if (method === 'GET' && id) {
      const result = db('products.get', { slug: id, id: parseInt(id) || 0 });
      result.ok ? ok(res, result.data) : err(res, result.error, 404);
      return;
    }
    if (method === 'PUT' && id) {
      const admin = requireAdmin(req, res); if (!admin) return;
      const body  = await readBody(req);
      const result = db('admin.products.update', { id: parseInt(id), ...body });
      result.ok ? ok(res, { message: 'Product updated' }) : err(res, result.error);
      return;
    }
  }

  // ── CART ─────────────────────────────────────────────────────────────────
  if (resource === 'cart') {
    if (method === 'GET') {
      const result = db('cart.get', { session_id });
      result.ok ? ok(res, result.data) : err(res, result.error);
      return;
    }
    if (method === 'POST' && !id) {
      const body   = await readBody(req);
    
      // If items sent directly from client, create order without DB cart
      if (body.items && body.items.length) {
        const onum = 'OVM-' + Date.now().toString(36).toUpperCase().slice(-6) + '-' +
                     Math.random().toString(36).toUpperCase().slice(2,6);
        const result = db('orders.create_direct', {
          order_number:  onum,
          session_id,
          user_id:       user?.id,
          items:         body.items,
          subtotal:      body.subtotal,
          shipping:      body.shipping,
          total:         body.total,
          shipping_info: body.shipping,
          payment_method: body.payment_method,
        });
        result.ok ? ok(res, result.data, 201) : err(res, result.error);
        return;
      }
    
      const result = db('orders.create', { session_id, user_id: user?.id, ...body }); 
    result.ok ? ok(res, result.data, 201) : err(res, result.error);
      return;
    }
    if (method === 'PATCH' && id) {
      const body = await readBody(req);
      const result = db('cart.update', { session_id, item_id: parseInt(id), ...body });
      result.ok ? ok(res, { message: 'Updated' }) : err(res, result.error);
      return;
    }
    if (method === 'DELETE' && id) {
      if (id === 'clear') {
        const result = db('cart.clear', { session_id });
        result.ok ? ok(res, { message: 'Cart cleared' }) : err(res, result.error);
      } else {
        const result = db('cart.remove', { session_id, item_id: parseInt(id) });
        result.ok ? ok(res, { message: 'Item removed' }) : err(res, result.error);
      }
      return;
    }
  }

  // ── ORDERS ───────────────────────────────────────────────────────────────
  if (resource === 'orders') {
    const user = getAuth(req);

    if (method === 'POST' && !id) {
      const body = await readBody(req);
      if (body.items && body.items.length) {
        const onum = 'OVM-' + Date.now().toString(36).toUpperCase().slice(-6) + '-' +
                     Math.random().toString(36).toUpperCase().slice(2,6);
        const result = db('orders.create_direct', {
          order_number:   onum,
          session_id,
          user_id:        user?.id,
          items:          body.items,
          subtotal:       body.subtotal,
          shipping:       body.shipping_cost,
          total:          body.total,
          shipping_info:  body.shipping_info,
          payment_method: body.payment_method,
        });
        result.ok ? ok(res, result.data, 201) : err(res, result.error);
        return;
      }
      const result = db('orders.create', { session_id, user_id: user?.id, ...body });
      result.ok ? ok(res, result.data, 201) : err(res, result.error);
      return;
    }
    if (method === 'GET' && !id) {
      const result = db('orders.list', { session_id, user_id: user?.id });
      result.ok ? ok(res, result.data) : err(res, result.error);
      return;
    }
    if (method === 'GET' && id) {
      const result = db('orders.get', { order_number: id, id: parseInt(id) || 0 });
      result.ok ? ok(res, result.data) : err(res, result.error, 404);
      return;
    }
    if (method === 'PATCH' && id) {
      const admin = requireAdmin(req, res); if (!admin) return;
      const body   = await readBody(req);
      const result = db('orders.update_status', { id: parseInt(id), status: body.status, payment_status: body.payment_status });
      result.ok ? ok(res, { message: 'Order updated' }) : err(res, result.error);
      return;
    }
  }

  // ── AUTH ─────────────────────────────────────────────────────────────────
  if (resource === 'auth') {
    const body = await readBody(req);

    if (segments[1] === 'register' && method === 'POST') {
      if (!body.email || !body.password) { err(res, 'Email and password required'); return; }
      if (body.password.length < 6)      { err(res, 'Password must be at least 6 characters'); return; }
      const result = db('auth.register', body);
      if (result.ok) {
        const token = signToken({ id: result.data.id, email: result.data.email, role: result.data.role });
        ok(res, { user: result.data, token }, 201);
      } else {
        err(res, result.error, 409);
      }
      return;
    }

    if (segments[1] === 'login' && method === 'POST') {
      if (!body.email || !body.password) { err(res, 'Email and password required'); return; }
      const result = db('auth.login', body);
      if (result.ok) {
        const token = signToken({ id: result.data.id, email: result.data.email, role: result.data.role });
        ok(res, { user: result.data, token });
      } else {
        err(res, result.error, 401);
      }
      return;
    }

    if (segments[1] === 'me' && method === 'GET') {
      const user = getAuth(req);
      if (!user) { err(res, 'Unauthorized', 401); return; }
      const result = db('auth.get_user', { id: user.id });
      result.ok ? ok(res, result.data) : err(res, result.error, 404);
      return;
    }

    if (segments[1] === 'me' && method === 'PATCH') {
      const user = getAuth(req);
      if (!user) { err(res, 'Unauthorized', 401); return; }
      const result = db('auth.update_profile', { id: user.id, ...body });
      result.ok ? ok(res, { message: 'Profile updated' }) : err(res, result.error);
      return;
    }
  }

  // ── NEWSLETTER ───────────────────────────────────────────────────────────
  if (resource === 'newsletter' && segments[1] === 'list' && method === 'GET') {
    const result = db('newsletter.list', {});
    result.ok ? ok(res, result.data) : err(res, result.error);
    return;
  }
  if (resource === 'newsletter' && method === 'POST') {
    const body = await readBody(req);
    if (!body.email) { err(res, 'Email required'); return; }
    const result = db('newsletter.subscribe', { email: body.email });
    result.ok ? ok(res, result.data) : err(res, result.error);
    return;
  }

  // ── REVIEWS ──────────────────────────────────────────────────────────────
  if (resource === 'reviews' && method === 'POST') {
    const body = await readBody(req);
    if (!body.product_id || !body.rating || !body.body) {
      err(res, 'product_id, rating, and body required'); return;
    }
    const user   = getAuth(req);
    const result = db('reviews.add', { user_id: user?.id, ...body });
    result.ok ? ok(res, result.data, 201) : err(res, result.error);
    return;
  }

  // ── CONTACT ──────────────────────────────────────────────────────────────
  if (resource === 'contact' && method === 'POST') {
    const body = await readBody(req);
    if (!body.name || !body.email || !body.message) {
      err(res, 'name, email, and message required'); return;
    }
    const result = db('contact.send', body);
    result.ok ? ok(res, result.data, 201) : err(res, result.error);
    return;
  }

  // ── ADMIN ─────────────────────────────────────────────────────────────────
  if (resource === 'admin') {

    if (segments[1] === 'dashboard' && method === 'GET') {
      const result = db('admin.dashboard', {});
      result.ok ? ok(res, result.data) : err(res, result.error);
      return;
    }
    if (segments[1] === 'orders' && method === 'GET') {
      const result = db('admin.orders', { status: query.status });
      result.ok ? ok(res, result.data) : err(res, result.error);
      return;
    }
  }

  // ── 404 ───────────────────────────────────────────────────────────────────
  err(res, `Route not found: ${req.method} ${pathname}`, 404);
}

// ── BOOT ─────────────────────────────────────────────────────────────────────
const server = http.createServer((req, res) => {
  router(req, res).catch(e => {
    console.error('[Unhandled]', e);
    try { err(res, 'Internal error', 500); } catch {}
  });
});

server.listen(PORT, () => {
  console.log(`
    ╔══════════════════════════════════════════════╗
║           OVM CLO — API SERVER               ║
║         http://localhost:${PORT}                ║
...
  `);
});

server.on('error', e => console.error('[Server Error]', e));
process.on('uncaughtException', e => console.error('[Uncaught]', e.message));
