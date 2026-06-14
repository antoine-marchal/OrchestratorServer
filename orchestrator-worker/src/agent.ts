// Worker entrypoint / composition root. Wires lifecycle (register/heartbeat/
// shutdown), the long-poll loop, and graceful shutdown. All real work lives in
// the modules imported below; this file only orchestrates them.
//
// Kept named `agent.ts` (compiles to dist/agent.js) because the pkg build,
// `npm start`, and the systemd/RPM packaging all reference that path.
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import {
  ORCHESTRATOR_URL, WORKER_NAME, WORK_DIR, IS_PKG,
  POLL_INTERVAL_MS, HEARTBEAT_INTERVAL_MS, EXECUTION_MODE,
} from './config';
import { setWorkerToken } from './transport/httpClient';
import { register, sendHeartbeat, deregister } from './lifecycle';
import { poll } from './poller';

/* ─── pkg asset extraction ──────────────────────────────────────────────── */

function extractGroovyJar(): void {
  const dest = path.join(WORK_DIR, 'groovyExec.jar');
  if (fs.existsSync(dest)) return;
  if (!IS_PKG) return;
  try {
    fs.mkdirSync(WORK_DIR, { recursive: true });
    // Inside a pkg binary __dirname is the snapshot path where the asset lives
    const src = path.join(__dirname, 'groovyExec.jar');
    fs.copyFileSync(src, dest);
    console.log(`[worker] Extracted groovyExec.jar → ${dest}`);
  } catch (e: any) {
    console.warn(`[worker] Could not extract groovyExec.jar: ${e.message}`);
  }
}

/* ─── Main ──────────────────────────────────────────────────────────────── */

async function main(): Promise<void> {
  extractGroovyJar();
  console.log(`[worker] Starting "${WORKER_NAME}" (${process.platform}), connecting to ${ORCHESTRATOR_URL}`);
  console.log(`[worker] Execution mode: ${EXECUTION_MODE}`);

  let workerId = '';
  const registerAndAuth = async () => {
    const { workerId: id, token } = await register();
    workerId = id;
    setWorkerToken(token);
    return id;
  };
  while (true) {
    try {
      await registerAndAuth();
      console.log(`[worker] Registered as ${workerId}`);
      break;
    } catch (e: any) {
      console.error('[worker] Registration failed, retrying in 5s:', e.message);
      await new Promise(r => setTimeout(r, 5000));
    }
  }

  // Long-poll loop: re-issue immediately after each poll completes. The
  // server holds the connection open up to ~25s, so this naturally throttles
  // and we don't need POLL_INTERVAL_MS as a wait — only as a back-off after
  // an error/disconnect.
  let pollErrCount = 0;
  const pollLoop = async () => {
    while (true) {
      try {
        await poll(workerId);
        pollErrCount = 0;
      } catch (e: any) {
        pollErrCount++;
        // On 401 the token was invalidated (server restart / re-register
        // elsewhere). Re-register transparently to get a fresh token.
        if (e?.response?.status === 401) {
          try {
            await registerAndAuth();
            pollErrCount = 0;
            continue;
          } catch (re: any) {
            console.error('[worker] Re-registration failed:', re.message);
          }
        }
        const wait = Math.min(POLL_INTERVAL_MS * Math.pow(2, Math.min(pollErrCount, 6)), 60000);
        await new Promise(r => setTimeout(r, wait));
      }
    }
  };
  pollLoop();

  setInterval(() => { sendHeartbeat(workerId); }, HEARTBEAT_INTERVAL_MS);

  const shutdown = async () => {
    console.log('[worker] Shutting down...');
    await deregister(workerId);
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main();
