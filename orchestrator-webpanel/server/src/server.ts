import 'dotenv/config';
import fs from 'fs';
import http from 'http';
import https from 'https';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { connectDB, getCollection } from './data/db/index';
import { userRepository, flowRepository, scheduleRepository, executionRepository, workerJobRepository, triggerTokenRepository, workerRepository } from './data/repositories';
import { authMiddleware } from './http/middleware/auth';
import { errorHandler } from './http/middleware/errorHandler';
import { DEFAULT_ROLES } from './data/models/Role';
import { setExecuteFlowFn, loadAll as loadCronSchedules } from './infra/scheduler/cronScheduler';
import { eventBus } from './infra/scheduler/eventBus';
import { executeOrchestratorFlow } from './domain/execution/flowExecutor';
import { gcArtifacts, putArtifacts } from './domain/execution/artifactStore';

import jobsRouter from './http/routes/jobs';
import flowsRouter from './http/routes/flows';
import executionsRouter from './http/routes/executions';
import usersRouter from './http/routes/users';
import secretsRouter from './http/routes/secrets';
import schedulesRouter from './http/routes/schedules';
import triggersRouter from './http/routes/triggers';
import workersRouter from './http/routes/workers';
import { flowGitRepository } from './infra/git/FlowGitRepository';
import { handleReceivePack, handleInfoRefs, handleUploadPack } from './infra/git/receivePack';
import bcrypt from 'bcryptjs';
import { randomUUID as uuidv4 } from 'crypto';

const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3939;

// Resolve the running version once at boot. set-version.bat keeps `.version`
// and every package.json in sync, so read whichever we find first across the
// dev layout and the pkg-bundled layout. Avoids hardcoded drift (e.g. /ping).
const VERSION: string = (() => {
  const candidates = [
    path.join(__dirname, '..', '.version'),
    path.join(__dirname, '..', '..', '.version'),
    path.join(__dirname, '..', '..', '..', '.version'),
    path.join(process.cwd(), '.version'),
  ];
  for (const p of candidates) {
    try { const v = fs.readFileSync(p, 'utf8').trim(); if (v) return v; } catch { /* next */ }
  }
  for (const p of [path.join(__dirname, '..', 'package.json'), path.join(__dirname, '..', '..', 'package.json')]) {
    try { const v = JSON.parse(fs.readFileSync(p, 'utf8')).version; if (v) return v; } catch { /* next */ }
  }
  return 'unknown';
})();

/* ─── Production secret guards ──────────────────────────────────────────────
 * Refuse to start in production if any secret is at its placeholder default.
 * A misconfigured prod deploy with the dev fallbacks would let any attacker
 * mint admin JWTs and decrypt every stored secret, so this is a hard fail.
 */
const DEFAULT_SECRETS: Array<{ name: string; defaults: string[] }> = [
  { name: 'JWT_SECRET', defaults: ['change_me_in_production', 'orchestrator-jwt-secret-change-in-prod', ''] },
  { name: 'ORCHESTRATOR_MASTER_KEY', defaults: ['change_me_in_production', 'orchestrator-default-dev-key-change-in-prod', ''] },
  { name: 'WORKER_REGISTRATION_SECRET', defaults: ['change_me_in_production'] },
  { name: 'ADMIN_PASSWORD', defaults: ['admin'] },
];
if (process.env.NODE_ENV === 'production') {
  const offenders = DEFAULT_SECRETS.filter(s => {
    const v = process.env[s.name] ?? '';
    return s.defaults.includes(v);
  });
  if (offenders.length) {
    console.error('\n[Startup] FATAL: refusing to start in production with default/placeholder secrets:');
    for (const o of offenders) console.error(`  - ${o.name}`);
    console.error('\nSet each variable to a long random value in the environment, then restart.\n');
    process.exit(1);
  }
}

/* ─── pkg asset extraction ──────────────────────────────────────────────── */

const WORK_DIR = process.env.ORCHESTRATOR_WORK_DIR || process.cwd();

function extractGroovyJar(): void {
  const dest = path.join(WORK_DIR, 'groovyExec.jar');
  if (fs.existsSync(dest)) return;
  if (!(process as any).pkg) return;
  try {
    fs.mkdirSync(WORK_DIR, { recursive: true });
    const src = path.join(__dirname, 'groovyExec.jar');
    fs.copyFileSync(src, dest);
    console.log(`[server] Extracted groovyExec.jar → ${dest}`);
  } catch (e: any) {
    console.warn(`[server] Could not extract groovyExec.jar: ${e.message}`);
  }
}

extractGroovyJar();

const app = express();

// CORS: in production, restrict to the configured DOMAIN (+ any extras in
// ORCHESTRATOR_CORS_ORIGINS, comma-separated). Same-origin requests from the
// bundled web panel always work because the browser does not send Origin for
// same-origin fetches. Workers use Bearer tokens and aren't browser-origin
// constrained, so they're unaffected.
const corsOrigins = (() => {
  const list: string[] = [];
  if (process.env.DOMAIN) list.push(process.env.DOMAIN.replace(/\/$/, ''));
  if (process.env.ORCHESTRATOR_CORS_ORIGINS) {
    for (const o of process.env.ORCHESTRATOR_CORS_ORIGINS.split(',')) {
      const t = o.trim().replace(/\/$/, '');
      if (t) list.push(t);
    }
  }
  return list;
})();
if (process.env.NODE_ENV === 'production' && corsOrigins.length) {
  app.use(cors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);
      const o = origin.replace(/\/$/, '');
      // Exact match only. A prefix match (startsWith) is unsafe — an allowed
      // origin "https://app.example.com" would also match the attacker-owned
      // "https://app.example.com.evil.com".
      cb(null, corsOrigins.some(allowed => o === allowed));
    },
    credentials: true,
  }));
} else {
  app.use(cors());
}
// Express 5 defaults to the "simple" query parser; keep v4's qs-based parsing
// so nested/array query params (e.g. ?a[b]=c) behave as before.
app.set('query parser', 'extended');
app.use(express.json({ limit: process.env.JSON_BODY_LIMIT || '100mb' }));
// Express 5 leaves req.body undefined when no parser matched (v4 gave {}).
// Handlers destructure req.body, so restore the v4 default.
app.use((req, _res, next) => { if (req.body === undefined) req.body = {}; next(); });

// Serve webpanel static files (if built).
// When packaged with pkg, prepare-pkg copies client/dist → dist/webpanel/
// so we check that bundled path first, then fall back to the dev layout.
const panelDist = fs.existsSync(path.join(__dirname, 'webpanel'))
  ? path.join(__dirname, 'webpanel')
  : path.join(__dirname, '../../client/dist');
app.use(express.static(panelDist));

app.get('/api/v1/ping', (_req, res) => {
  res.json({ status: 'ok', version: VERSION });
});

// Auth routes (no auth required)
app.use('/api/v1', usersRouter);

// Protected routes — job/flow routes use session token for legacy compatibility
app.use('/api/v1/jobs', authMiddleware, jobsRouter);
app.use('/api/v1/flows', authMiddleware, flowsRouter);
app.use('/api/v1/executions', authMiddleware, executionsRouter);
app.use('/api/v1/secrets', authMiddleware, secretsRouter);
app.use('/api/v1/schedules', authMiddleware, schedulesRouter);
app.use('/api/v1', triggersRouter);
// Worker agent endpoints (open — workers self-register without auth)
// UI endpoints (GET /, DELETE /:id/record) protected inline in workers router
app.use('/api/v1/workers', workersRouter);

// Git smart-HTTP endpoints: one repository per flow at /git/:flowId.
// The wrapper stashes flowId on the request because @fusebit/cloud-git mounts
// its routes on a plain Router (no mergeParams), which would otherwise drop the
// :flowId param. Auth is handled inside the repository's authorize() via HTTP
// Basic (login + API key). Git bodies are binary (application/x-git-*), so the
// global express.json() above leaves them untouched.
const stashFlowId = (req: express.Request, _res: express.Response, next: express.NextFunction) => {
  (req as any).gitFlowId = req.params.flowId;
  next();
};
// Full smart-HTTP git endpoints, all implemented here (we no longer route to
// @fusebit/cloud-git): its push parser can't fatten the thin packs git sends by
// default, it never advertises `report-status`, and its upload-pack always
// side-band-frames the pack even when the client didn't negotiate it
// ("expected ACK/NAK, got '?PACK'"). Auth via HTTP Basic in authorize().
const gitAuthorize = (req: express.Request, res: express.Response, next: express.NextFunction) =>
  flowGitRepository.authorize(req, res, next);
app.get('/git/:flowId/info/refs', stashFlowId, gitAuthorize, (req, res) => { void handleInfoRefs(flowGitRepository, req, res); });
app.post('/git/:flowId/git-upload-pack', stashFlowId, gitAuthorize, (req, res) => { void handleUploadPack(req, res); });
app.post('/git/:flowId/git-receive-pack', stashFlowId, gitAuthorize, (req, res) => { void handleReceivePack(req, res); });

// Fallback to webpanel index for SPA routing
app.get('/{*splat}', (req, res) => {
  const indexPath = path.join(panelDist, 'index.html');
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.status(404).json({ error: 'Not found' });
  }
});

// Central error handler — registered last so thrown ApiError / async rejections
// (e.g. from validateBody) become a consistent { error: { code, message } } response.
app.use(errorHandler);

/* ============================
   Startup
   ============================ */

async function seedDefaultData(): Promise<void> {
  const usersCol = userRepository;
  const rolesCol = getCollection('roles');

  // Seed roles
  for (const role of DEFAULT_ROLES) {
    const existing = await rolesCol.findOne({ name: role.name });
    if (!existing) {
      await rolesCol.insert({ _id: uuidv4(), ...role });
    }
  }

  // Create default admin user if no users exist
  const userCount = await usersCol.count({});
  if (userCount === 0) {
    const password = process.env.ADMIN_PASSWORD || 'admin';
    const passwordHash = await bcrypt.hash(password, 12);
    const now = new Date().toISOString();
    await usersCol.insert({
      _id: uuidv4(), login: 'admin',
      passwordHash, role: 'admin', apiKeys: [], createdAt: now, updatedAt: now,
    });
    console.log(`[Startup] Created default admin user: admin / ${password}`);
    console.log('[Startup] Change the password after first login!');
  }
}

// One-time back-fill: earlier versions stored a flow's cron under
// flow.schedule.{cron,enabled} but never created a row in the schedules
// collection (which is what the cron service watches), so those schedules
// silently never fired. Mirror them into the schedules collection on
// startup so they start firing without requiring the user to re-save.
async function backfillFlowOwners(): Promise<void> {
  try {
    const flowsCol = flowRepository;
    const flows: any[] = await flowsCol.find({});
    let n = 0;
    for (const f of flows) {
      if (!f.owner) {
        await flowsCol.update({ _id: f._id }, { $set: { owner: 'admin' } });
        n++;
      }
    }
    if (n > 0) console.log(`[Startup] Backfilled owner=admin on ${n} legacy flow(s)`);
  } catch (err) {
    console.warn('[Startup] flow owner backfill failed:', (err as Error).message);
  }
}

// One-time: earlier versions stored a flow's artifacts inline as base64 on the
// flow doc (flow.artifacts = [{name,data}]). That bloated the flows collection
// and made the save PUT body huge. Move each body into the content-addressed
// artifact_blobs store and replace the doc field with {name,sha} refs.
async function migrateInlineArtifacts(): Promise<void> {
  try {
    const flowsCol = flowRepository;
    const flows: any[] = await flowsCol.find({});
    let migrated = 0;
    for (const f of flows) {
      const arts = Array.isArray(f.artifacts) ? f.artifacts : [];
      if (!arts.length || !arts.some((a: any) => typeof a?.data === 'string')) continue;
      const refs = await putArtifacts(arts.map((a: any) => ({ name: a.name, data: a.data ?? '' })));
      await flowsCol.update({ _id: f._id }, { $set: { artifacts: refs } });
      migrated++;
    }
    if (migrated > 0) console.log(`[Startup] Migrated inline artifacts on ${migrated} flow(s) to content-addressed refs`);
  } catch (err) {
    console.warn('[Startup] Inline artifact migration failed:', (err as Error).message);
  }
}

async function migrateLegacyFlowSchedules(): Promise<void> {
  try {
    const flowsCol = flowRepository;
    const schedulesCol = scheduleRepository;
    const flows: any[] = await flowsCol.find({});
    let migrated = 0;
    for (const flow of flows) {
      const sched = flow.schedule;
      if (!sched?.cron) continue;
      const existing = await schedulesCol.findOne({ flowId: flow._id, type: 'cron' });
      if (existing) continue;
      const now = new Date().toISOString();
      await schedulesCol.insert({
        _id: uuidv4(), flowId: flow._id, type: 'cron',
        cronExpr: sched.cron, label: sched.cron,
        enabled: sched.enabled !== false,
        createdBy: 'migration', createdAt: now, updatedAt: now,
      });
      migrated++;
    }
    if (migrated > 0) console.log(`[Startup] Back-filled ${migrated} legacy flow.schedule entries into schedules collection`);
  } catch (err) {
    console.warn('[Startup] Legacy schedule back-fill failed:', (err as Error).message);
  }
}

// On startup, mark every execution still flagged RUNNING (and every worker_job
// still pending/acked/running) as FAILED. The in-memory `jobs` map and the
// completion-monitor setInterval are reset on every process restart, so an
// exec that was RUNNING when the server died will never transition. Without
// this, the UI shows a permanently-spinning execution and FlowsList badges
// stay "running" forever.
async function reconcileStrandedExecutions(): Promise<void> {
  try {
    const execsCol = executionRepository;
    const flowsCol = flowRepository;
    const workerJobsCol = workerJobRepository;
    const stranded: any[] = await execsCol.find({ status: 'RUNNING' });
    const now = new Date().toISOString();
    const reason = 'Server restarted while execution was running';
    for (const e of stranded) {
      const duration = new Date(now).getTime() - new Date(e.startTime).getTime();
      await execsCol.update({ _id: e._id }, { $set: { status: 'FAILED', endTime: now, duration, error: reason } });
      await flowsCol.update({ _id: e.flowId }, { $set: { lastExecution: { id: e._id, status: 'FAILED', startTime: e.startTime, endTime: now, duration } } });
    }
    const orphanedJobs = await workerJobsCol.find({ status: { $in: ['pending', 'acked', 'running'] } });
    for (const j of orphanedJobs) {
      await workerJobsCol.update({ _id: j._id }, { $set: { status: 'cancelled', error: reason, completedAt: now } });
    }
    if (stranded.length || orphanedJobs.length) {
      console.log(`[Startup] Reconciled ${stranded.length} stranded execution(s) and ${orphanedJobs.length} worker job(s)`);
    }
  } catch (err) {
    console.warn('[Startup] Stranded execution reconciliation failed:', (err as Error).message);
  }
}

async function start(): Promise<void> {
  await connectDB();
  await seedDefaultData();
  await migrateLegacyFlowSchedules();
  await migrateInlineArtifacts();
  await backfillFlowOwners();
  await reconcileStrandedExecutions();

  // Set executor function for cron scheduler
  setExecuteFlowFn(executeOrchestratorFlow);
  await loadCronSchedules();

  // Start inbox watcher for event-based schedules
  const WORK_DIR = process.env.ORCHESTRATOR_WORK_DIR || process.cwd();
  const INBOX = require('path').join(WORK_DIR, 'inbox');
  eventBus.watchInbox(INBOX);

  // Wire event bus to event-based schedules
  const scheduleEventHandler = async (eventName: string, data: any) => {
    try {
      const col = scheduleRepository;
      const schedules = await col.find({ type: 'event', eventName, enabled: true });
      for (const s of schedules) {
        console.log(`[EventBus] Triggering flow ${s.flowId} for event ${eventName}`);
        await executeOrchestratorFlow(s.flowId, 'event');
        await col.update({ _id: s._id }, { $set: { lastFiredAt: new Date().toISOString() } });
      }
    } catch (err) {
      console.error(`[EventBus] Error handling event ${eventName}:`, (err as Error).message);
    }
  };

  eventBus.on('flow.completed', (data: any) => scheduleEventHandler('flow.completed', data));
  eventBus.on('flow.failed', (data: any) => scheduleEventHandler('flow.failed', data));
  eventBus.on('file.arrived', (data: any) => scheduleEventHandler('file.arrived', data));

  // Auto-expire trigger tokens every minute
  const tokenExpiryTimer = setInterval(async () => {
    try {
      const col = triggerTokenRepository;
      const now = new Date().toISOString();
      await col.update(
        { expiresAt: { $lt: now }, revokedAt: { $exists: false } },
        { $set: { revokedAt: now } },
        { multi: true }
      );
    } catch { }
  }, 60000);

  // Worker reaper: when a worker stops heartbeating but had in-flight jobs,
  // those worker_jobs would stay 'running' (and the parent execution would
  // sit waiting on the 5-min hard timeout in dispatchToWorker). Sweep every
  // 30s — workers untouched for > WORKER_OFFLINE_TIMEOUT_MS get their pending
  // jobs flipped to 'cancelled' with a reason; the awaiting executor then
  // rejects on its next poll.
  const WORKER_OFFLINE_TIMEOUT_MS = parseInt(process.env.WORKER_OFFLINE_TIMEOUT_MS || '60000');
  const reaperTimer = setInterval(async () => {
    try {
      const workersCol = workerRepository;
      const jobsCol = workerJobRepository;
      const cutoff = new Date(Date.now() - WORKER_OFFLINE_TIMEOUT_MS).toISOString();
      const offlineWorkers: any[] = await workersCol.find({ lastSeenAt: { $lt: cutoff } });
      if (!offlineWorkers.length) return;
      const now = new Date().toISOString();
      for (const w of offlineWorkers) {
        const stale: any[] = await jobsCol.find({
          workerId: w._id,
          status: { $in: ['pending', 'acked', 'running'] },
        });
        for (const j of stale) {
          await jobsCol.update(
            { _id: j._id },
            { $set: { status: 'cancelled', error: `Worker "${w.name}" offline`, completedAt: now } },
          );
          // Notify in-memory awaiter so dispatchToWorker resolves immediately
          // rather than waiting for its 5-minute hard timeout.
          try {
            const { pendingWorkerJobs } = await import('./domain/workers/workerService');
            const pending = pendingWorkerJobs.get(j._id);
            if (pending) {
              pendingWorkerJobs.delete(j._id);
              pending.reject(new Error(`Worker "${w.name}" went offline mid-job`));
            }
          } catch { /* non-fatal */ }
        }
        if (stale.length) {
          console.log(`[Reaper] worker "${w.name}" offline — cancelled ${stale.length} stale job(s)`);
        }
      }
    } catch (err) {
      console.warn('[Reaper] sweep failed:', (err as Error).message);
    }
  }, 30000);

  // Janitor: prune finished worker_jobs (and the artifact blobs they were the
  // last to reference) after a retention window. worker_jobs used to accumulate
  // forever — each carried a full node + (previously) inlined artifacts — so the
  // queue grew without bound. We keep terminal jobs briefly so a late/retried
  // /complete (or a server restart that lost the in-memory awaiter) still finds
  // the record, then delete. Override retention via WORKER_JOB_RETENTION_MS.
  const WORKER_JOB_RETENTION_MS = parseInt(process.env.WORKER_JOB_RETENTION_MS || '3600000');
  const JANITOR_INTERVAL_MS = parseInt(process.env.JANITOR_INTERVAL_MS || '300000');
  const janitorTimer = setInterval(async () => {
    try {
      const jobsCol = workerJobRepository;
      const cutoff = new Date(Date.now() - WORKER_JOB_RETENTION_MS).toISOString();
      const removed = await jobsCol.remove(
        { status: { $in: ['success', 'failed', 'cancelled'] }, completedAt: { $lt: cutoff } },
        { multi: true },
      );
      const blobsRemoved = await gcArtifacts();
      if (removed || blobsRemoved) {
        console.log(`[Janitor] pruned ${removed} worker_job(s), ${blobsRemoved} artifact blob(s)`);
      }
    } catch (err) {
      console.warn('[Janitor] sweep failed:', (err as Error).message);
    }
  }, JANITOR_INTERVAL_MS);

  const httpsEnabled = process.env.HTTPS === 'true' || process.env.ORCHESTRATOR_HTTPS === 'true';
  let server: http.Server | https.Server;
  if (httpsEnabled) {
    const certPath = process.env.HTTPS_CERT || path.join(WORK_DIR, 'certs', 'server.crt');
    const keyPath = process.env.HTTPS_KEY || path.join(WORK_DIR, 'certs', 'server.key');
    if (!fs.existsSync(certPath) || !fs.existsSync(keyPath)) {
      throw new Error(`HTTPS enabled but cert/key not found:\n  cert: ${certPath}\n  key:  ${keyPath}\nRun scripts/gen-cert.bat to generate a self-signed pair.`);
    }
    const credentials = { cert: fs.readFileSync(certPath), key: fs.readFileSync(keyPath) };
    server = https.createServer(credentials, app).listen(PORT, () => {
      console.log(`\n🚀 Orchestrator started on port ${PORT} (HTTPS)`);
      console.log(`   API: https://localhost:${PORT}/api/v1`);
      console.log(`   Env: ${process.env.NODE_ENV || 'development'}`);
    });
  } else {
    server = app.listen(PORT, () => {
      console.log(`\n🚀 Orchestrator started on port ${PORT}`);
      console.log(`   API: http://localhost:${PORT}/api/v1`);
      console.log(`   Env: ${process.env.NODE_ENV || 'development'}`);
    });
  }

  const shutdown = (signal: string) => {
    console.log(`\nReceived ${signal}. Shutting down...`);
    clearInterval(tokenExpiryTimer);
    clearInterval(reaperTimer);
    clearInterval(janitorTimer);
    eventBus.stopWatcher();
    server.close(() => {
      console.log('Server shut down successfully.');
      process.exit(0);
    });
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

start().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
