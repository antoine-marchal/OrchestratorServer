import 'dotenv/config';
import fs from 'fs';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { connectDB, getCollection } from './services/db/index';
import { authMiddleware } from './middleware/auth';
import { DEFAULT_ROLES } from './services/db/models/Role';
import { setExecuteFlowFn, loadAll as loadCronSchedules } from './services/scheduler/cronScheduler';
import { eventBus } from './services/scheduler/eventBus';
import { executeOrchestratorFlow } from './services/executor/flowExecutor';

import jobsRouter from './routes/jobs';
import flowsRouter from './routes/flows';
import executionsRouter from './routes/executions';
import usersRouter from './routes/users';
import secretsRouter from './routes/secrets';
import schedulesRouter from './routes/schedules';
import triggersRouter from './routes/triggers';
import workersRouter from './routes/workers';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';

const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3939;

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
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Serve webpanel static files (if built).
// When packaged with pkg, prepare-pkg copies client/dist → dist/webpanel/
// so we check that bundled path first, then fall back to the dev layout.
const panelDist = fs.existsSync(path.join(__dirname, 'webpanel'))
  ? path.join(__dirname, 'webpanel')
  : path.join(__dirname, '../../client/dist');
app.use(express.static(panelDist));

app.get('/api/v1/ping', (_req, res) => {
  res.json({ status: 'ok', version: '2.2.0' });
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

// Fallback to webpanel index for SPA routing
app.get('*', (req, res) => {
  const indexPath = path.join(panelDist, 'index.html');
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.status(404).json({ error: 'Not found' });
  }
});

/* ============================
   Startup
   ============================ */

async function seedDefaultData(): Promise<void> {
  const usersCol = getCollection('users');
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
async function migrateLegacyFlowSchedules(): Promise<void> {
  try {
    const flowsCol = getCollection('flows');
    const schedulesCol = getCollection('schedules');
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

async function start(): Promise<void> {
  await connectDB();
  await seedDefaultData();
  await migrateLegacyFlowSchedules();

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
      const col = getCollection('schedules');
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
  setInterval(async () => {
    try {
      const col = getCollection('trigger_tokens');
      const now = new Date().toISOString();
      await col.update(
        { expiresAt: { $lt: now }, revokedAt: { $exists: false } },
        { $set: { revokedAt: now } },
        { multi: true }
      );
    } catch { }
  }, 60000);

  const server = app.listen(PORT, () => {
    console.log(`\n🚀 Orchestrator started on port ${PORT}`);
    console.log(`   API: http://localhost:${PORT}/api/v1`);
    console.log(`   Env: ${process.env.NODE_ENV || 'development'}`);
  });

  const shutdown = (signal: string) => {
    console.log(`\nReceived ${signal}. Shutting down...`);
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
