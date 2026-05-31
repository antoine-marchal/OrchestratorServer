/**
 * oauth_proxy — tiny OAuth2 (Authorization Code) provider for testing
 * Grafana "Generic OAuth".
 *
 * It owns no password store: authentication is delegated to the CAS-style
 * authent_test_service (/login + /validate). The proxy translates between the
 * two protocols:
 *
 *   OAuth2 (Grafana side)            CAS (authent_test_service side)
 *   ─────────────────────            ───────────────────────────────
 *   GET  /authorize  ───────────►    302 to <CAS>/login?service=<proxy>/cas/callback?sid=
 *   GET  /cas/callback  ◄────────    302 back with ?ticket=  → calls <CAS>/validate
 *   (mints OAuth code) ─────────►    302 to Grafana redirect_uri?code=&state=
 *   POST /token       ──────────►    swaps code for access_token
 *   GET  /userinfo    ──────────►    OpenID UserInfo JSON {sub,email,...}
 *
 * OIDC discovery is served at /.well-known/openid-configuration so Grafana's
 * "OpenID Connect Discovery URL" button can auto-fill Auth/Token/API URLs.
 *
 * NeDB persists three short-lived collections: pending authorize requests,
 * single-use auth codes, and access tokens.
 */
require('dotenv').config();
const crypto = require('crypto');
const path = require('path');
const express = require('express');
const Datastore = require('@seald-io/nedb');

const PORT = parseInt(process.env.PORT || '9000', 10);
// Public base URL of THIS proxy (must be reachable by both the browser and Grafana).
const PUBLIC_URL = (process.env.PUBLIC_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
// Base URL of the CAS-style authent_test_service.
const CAS_BASE = (process.env.CAS_BASE || 'http://localhost:8443').replace(/\/$/, '');
// OAuth client credentials Grafana must present.
const CLIENT_ID = process.env.CLIENT_ID || 'some_id';
const CLIENT_SECRET = process.env.CLIENT_SECRET || ''; // empty = secret not enforced
// Email synthesized from the CAS login when the SSO has none (scope user:email).
const EMAIL_DOMAIN = process.env.EMAIL_DOMAIN || 'example.com';
const CODE_TTL_MS = parseInt(process.env.CODE_TTL_MS || '120000', 10);
const TOKEN_TTL_MS = parseInt(process.env.TOKEN_TTL_MS || '3600000', 10);

const mkStore = (name) =>
  new Datastore({ filename: path.join(__dirname, 'data', `${name}.db`), autoload: true });
const authReqs = mkStore('authreqs'); // pending /authorize requests, keyed by sid
const codes = mkStore('codes');       // single-use authorization codes
const tokens = mkStore('tokens');     // issued access tokens

const rnd = (n = 24) => crypto.randomBytes(n).toString('hex');

const app = express();

// Permissive CORS (test tool): echo Origin, allow the OAuth/token verbs, and
// short-circuit preflight. Without Access-Control-Allow-Origin the browser hides
// the /token and /userinfo response bodies ("CORS Missing Allow Origin").
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.header('Access-Control-Allow-Credentials', 'true');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  // Reflect whatever headers the preflight asks for (Grafana adds its own), else
  // a fixed list misses one → "CORS Missing Allow Header".
  res.header('Access-Control-Allow-Headers', req.headers['access-control-request-headers'] || 'Authorization, Content-Type');
  res.header('Vary', 'Origin, Access-Control-Request-Headers');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// ── OIDC discovery ──────────────────────────────────────────────────────────
app.get('/.well-known/openid-configuration', (_req, res) => {
  res.json({
    issuer: PUBLIC_URL,
    authorization_endpoint: `${PUBLIC_URL}/authorize`,
    token_endpoint: `${PUBLIC_URL}/token`,
    userinfo_endpoint: `${PUBLIC_URL}/userinfo`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code'],
    scopes_supported: ['openid', 'profile', 'email', 'user:email'],
    token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post'],
    subject_types_supported: ['public'],
  });
});

// ── 1. Authorization endpoint (Grafana entry point) ──────────────────────────
// GET /authorize?response_type=code&client_id=&redirect_uri=&scope=&state=
app.get('/authorize', async (req, res) => {
  const { response_type, client_id, redirect_uri, scope, state } = req.query;

  if (response_type !== 'code') {
    return res.status(400).send('unsupported response_type (only "code")');
  }
  if (client_id !== CLIENT_ID) {
    return res.status(401).send('invalid client_id');
  }
  if (!redirect_uri) {
    return res.status(400).send('missing redirect_uri');
  }

  const sid = rnd(16);
  await authReqs.insertAsync({
    sid,
    clientId: client_id,
    redirectUri: redirect_uri,
    scope: scope || '',
    state: state || '',
    createdAt: Date.now(),
  });

  // Bridge to CAS. The `service` carries our sid so the callback can recover the
  // pending request. It MUST be byte-identical at /login and /validate.
  const service = `${PUBLIC_URL}/cas/callback?sid=${sid}`;
  const loginUrl = `${CAS_BASE}/login?service=${encodeURIComponent(service)}`;
  console.log(`[authorize] sid=${sid} client=${client_id} → CAS login`);
  res.redirect(302, loginUrl);
});

// ── 2. CAS callback — validate ticket, mint OAuth code ───────────────────────
// GET /cas/callback?sid=&ticket=
app.get('/cas/callback', async (req, res) => {
  const { sid, ticket } = req.query;
  const areq = sid ? await authReqs.findOneAsync({ sid }) : null;
  if (!areq) {
    return res.status(400).send('unknown or expired authorize session');
  }
  await authReqs.removeAsync({ sid }, {});

  if (!ticket) {
    return res.status(401).send('missing CAS ticket');
  }

  // Re-build the exact `service` used at /login so the CAS service check passes.
  const service = `${PUBLIC_URL}/cas/callback?sid=${sid}`;
  const validateUrl = `${CAS_BASE}/validate?ticket=${encodeURIComponent(ticket)}&service=${encodeURIComponent(service)}`;

  let login;
  try {
    const body = await (await fetch(validateUrl)).text();
    const m = body.match(/<cas:user>([^<]+)<\/cas:user>/i);
    if (!m) {
      console.log(`[callback] sid=${sid} validation failed`);
      return res.status(401).send('CAS validation failed');
    }
    login = m[1].trim().toLowerCase();
  } catch (e) {
    return res.status(502).send(`CAS unreachable: ${e.message}`);
  }

  const code = rnd(24);
  await codes.insertAsync({
    code,
    login,
    clientId: areq.clientId,
    redirectUri: areq.redirectUri,
    scope: areq.scope,
    createdAt: Date.now(),
  });

  const sep = areq.redirectUri.includes('?') ? '&' : '?';
  let back = `${areq.redirectUri}${sep}code=${encodeURIComponent(code)}`;
  if (areq.state) back += `&state=${encodeURIComponent(areq.state)}`;
  console.log(`[callback] sid=${sid} user=${login} → code → ${areq.redirectUri}`);
  res.redirect(302, back);
});

// Extract client credentials from Basic header or POST body (AutoDetect).
function clientCreds(req) {
  const hdr = req.headers.authorization || '';
  if (hdr.startsWith('Basic ')) {
    const [id, secret] = Buffer.from(hdr.slice(6), 'base64').toString().split(':');
    return { id, secret };
  }
  return { id: req.body.client_id, secret: req.body.client_secret };
}

// ── 3. Token endpoint ────────────────────────────────────────────────────────
// POST /token  grant_type=authorization_code&code=&redirect_uri=
app.post('/token', async (req, res) => {
  const { grant_type, code, redirect_uri } = req.body;
  const { id, secret } = clientCreds(req);

  if (grant_type !== 'authorization_code') {
    return res.status(400).json({ error: 'unsupported_grant_type' });
  }
  if (id !== CLIENT_ID || (CLIENT_SECRET && secret !== CLIENT_SECRET)) {
    return res.status(401).json({ error: 'invalid_client' });
  }

  const row = code ? await codes.findOneAsync({ code }) : null;
  if (!row) {
    return res.status(400).json({ error: 'invalid_grant', error_description: 'unknown code' });
  }
  await codes.removeAsync({ code }, {}); // single-use

  if (Date.now() - row.createdAt > CODE_TTL_MS) {
    return res.status(400).json({ error: 'invalid_grant', error_description: 'code expired' });
  }
  if (redirect_uri && redirect_uri !== row.redirectUri) {
    return res.status(400).json({ error: 'invalid_grant', error_description: 'redirect_uri mismatch' });
  }

  const accessToken = rnd(32);
  await tokens.insertAsync({
    token: accessToken,
    login: row.login,
    scope: row.scope,
    createdAt: Date.now(),
  });

  console.log(`[token] user=${row.login} → access_token`);
  res.json({
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: Math.floor(TOKEN_TTL_MS / 1000),
    scope: row.scope,
  });
});

// ── 4. UserInfo endpoint (OpenID UserInfo compatible) ────────────────────────
app.get('/userinfo', async (req, res) => {
  const hdr = req.headers.authorization || '';
  if (!hdr.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'invalid_token' });
  }
  const row = await tokens.findOneAsync({ token: hdr.slice(7).trim() });
  if (!row || Date.now() - row.createdAt > TOKEN_TTL_MS) {
    return res.status(401).json({ error: 'invalid_token' });
  }
  const email = `${row.login}@${EMAIL_DOMAIN}`;
  res.json({
    sub: row.login,
    login: row.login,
    preferred_username: row.login,
    name: row.login,
    email,
    email_verified: true,
  });
});

app.get('/', (_req, res) => {
  res.type('text/plain').send(
    'oauth_proxy — OAuth2 bridge to CAS authent_test_service\n' +
    `issuer:    ${PUBLIC_URL}\n` +
    `cas base:  ${CAS_BASE}\n` +
    `client_id: ${CLIENT_ID}\n` +
    'endpoints: /authorize /token /userinfo /.well-known/openid-configuration\n'
  );
});

app.listen(PORT, () => {
  console.log(`oauth_proxy listening on ${PUBLIC_URL}`);
  console.log(`bridging to CAS at ${CAS_BASE}, client_id=${CLIENT_ID}`);
});
