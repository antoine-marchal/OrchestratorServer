/**
 * authent_test_service — tiny CAS/SSO simulation.
 *
 * Mirrors the contract the Orchestrator server expects (see server.env.example,
 * "Proxy / SSO authentication"):
 *
 *   GET /login?service=<url>
 *       Mints a single-use service ticket (ST-...), stores it in NeDB, then
 *       302-redirects the browser to  <service>?ticket=ST-...
 *
 *   GET /validate?ticket=<ticket>&service=<url>
 *       Validates the ticket exactly once. On success returns CAS XML:
 *           <cas:serviceResponse ...><cas:authenticationSuccess>
 *             <cas:user>marchala</cas:user>
 *           </cas:authenticationSuccess></cas:serviceResponse>
 *       Group 1 of the server's ORCHESTRATOR_PROXYAUTH_REGEX
 *       (<cas:user>([^<]+)</cas:user>) captures the login.
 *
 * A ticket is generated once (one row inserted at /login) and validated once
 * (the row is consumed/removed at the first /validate). Replays fail.
 */
require('dotenv').config();
const crypto = require('crypto');
const path = require('path');
const express = require('express');
const Datastore = require('@seald-io/nedb');

const PORT = parseInt(process.env.PORT || '8443', 10);
// Login returned to the relying party on every successful validation.
const DEFAULT_USER = process.env.DEFAULT_USER || 'marchala';
// Tickets older than this (ms) are rejected even if never validated. CAS default ~5min.
const TICKET_TTL_MS = parseInt(process.env.TICKET_TTL_MS || '300000', 10);

const db = new Datastore({
  filename: path.join(__dirname, 'data', 'tickets.db'),
  autoload: true,
});

const app = express();

const mintTicket = () => 'ST-' + crypto.randomBytes(20).toString('hex');

// CAS XML envelopes — match the regex <cas:user>([^<]+)</cas:user>.
const successXml = (user) =>
  `<cas:serviceResponse xmlns:cas="http://www.yale.edu/tp/cas">\n` +
  `  <cas:authenticationSuccess>\n` +
  `    <cas:user>${user}</cas:user>\n` +
  `  </cas:authenticationSuccess>\n` +
  `</cas:serviceResponse>\n`;

const failureXml = (code, message) =>
  `<cas:serviceResponse xmlns:cas="http://www.yale.edu/tp/cas">\n` +
  `  <cas:authenticationFailure code="${code}">${message}</cas:authenticationFailure>\n` +
  `</cas:serviceResponse>\n`;

/**
 * GET /login?service=http://domain:port/authen
 * Mints a single-use ticket bound to `service`, then redirects back to it.
 */
app.get('/login', async (req, res) => {
  const service = req.query.service;
  if (!service) {
    return res.status(400).send('Missing required query param: service');
  }

  const ticket = mintTicket();
  await db.insertAsync({
    ticket,
    service,
    user: DEFAULT_USER,
    consumed: false,
    createdAt: Date.now(),
  });

  // Append ticket to the service URL (CAS redirect contract).
  const sep = service.includes('?') ? '&' : '?';
  const redirectTo = `${service}${sep}ticket=${encodeURIComponent(ticket)}`;
  console.log(`[login]    minted ${ticket} for user=${DEFAULT_USER} service=${service}`);
  res.redirect(302, redirectTo);
});

/**
 * GET /validate?ticket=<ticket>&service=<url>
 * Consumes the ticket exactly once. Service must match the one it was issued for.
 */
app.get('/validate', async (req, res) => {
  res.type('application/xml');
  const { ticket, service } = req.query;

  if (!ticket) {
    return res.send(failureXml('INVALID_REQUEST', 'Missing ticket parameter'));
  }

  const row = await db.findOneAsync({ ticket });
  if (!row) {
    console.log(`[validate] reject ${ticket} — unknown or already consumed`);
    return res.send(failureXml('INVALID_TICKET', 'Ticket not recognized'));
  }

  // Single-use: remove first so a concurrent replay can't reuse it.
  await db.removeAsync({ ticket }, {});

  if (row.consumed) {
    return res.send(failureXml('INVALID_TICKET', 'Ticket already consumed'));
  }
  if (Date.now() - row.createdAt > TICKET_TTL_MS) {
    console.log(`[validate] reject ${ticket} — expired`);
    return res.send(failureXml('INVALID_TICKET', 'Ticket expired'));
  }
  // CAS requires the validating service to match the issuing service.
  if (service && row.service && service !== row.service) {
    console.log(`[validate] reject ${ticket} — service mismatch`);
    return res.send(failureXml('INVALID_SERVICE', 'Service does not match ticket'));
  }

  console.log(`[validate] accept ${ticket} — user=${row.user}`);
  res.send(successXml(row.user));
});

app.get('/', (_req, res) => {
  res.send(
    'authent_test_service (CAS sim)\n' +
    `default user: ${DEFAULT_USER}\n` +
    'GET /login?service=<url>\n' +
    'GET /validate?ticket=<ticket>&service=<url>\n'
  );
});

app.listen(PORT, () => {
  console.log(`authent_test_service listening on http://localhost:${PORT}`);
  console.log(`default user: ${DEFAULT_USER}`);
});
