import { createServer } from 'node:http';
import next from 'next';
import { runWorker } from './temporal/worker';

/**
 * Production entrypoint: Next.js and the Temporal Worker in one process, so
 * there is one container, one deploy and one set of secrets.
 */
const port = Number(process.env.PORT ?? 3000);

async function main() {
  const app = next({ dev: false });
  await app.prepare();
  const handle = app.getRequestHandler();

  await new Promise<void>((resolve) => {
    createServer((req, res) => void handle(req, res)).listen(port, resolve);
  });
  console.log(`[web] listening on :${port}`);

  // The web server is already accepting requests. If the worker cannot reach
  // Temporal, keep serving — students can still read the session material, and
  // the instructor page will show the registry and canary as not running rather
  // than the whole site being down.
  try {
    await runWorker();
  } catch (err) {
    console.error('\n[worker] FAILED TO START — no invitations, no revocations, no sweeps.');
    console.error('[worker] The web server is still up. Fix the connection and restart.\n');
    console.error(err instanceof Error ? err.message : err);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
