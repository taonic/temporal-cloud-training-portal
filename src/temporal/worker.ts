import { NativeConnection, Worker } from '@temporalio/worker';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { config } from '@/config';
import * as activities from './activities';
import { connectionOptions, ensureSingletonsRunning } from './client';

const here = dirname(fileURLToPath(import.meta.url));

export async function createWorker(): Promise<Worker> {
  const cfg = config();

  const connection = await NativeConnection.connect(connectionOptions());

  return Worker.create({
    connection,
    namespace: cfg.TEMPORAL_NAMESPACE,
    taskQueue: cfg.TEMPORAL_TASK_QUEUE,
    workflowsPath: join(here, 'workflows', 'index.ts'),
    activities,
  });
}

export async function runWorker(): Promise<void> {
  const worker = await createWorker();

  // Start the registry and canary once the worker can actually serve them.
  // Deliberately does NOT exit the process: `pnpm start` runs the web server in
  // here too, and a Temporal outage should not take the course material and the
  // instructor view down with it. The failure is loud, /instructor shows the
  // registry as not running, and /api/health reports registryRunning: false.
  void worker.run().catch((err) => {
    console.error('[worker] STOPPED — invitations and revocations are not running');
    console.error(err);
  });

  await ensureSingletonsRunning();
  console.log(
    `[worker] polling ${config().TEMPORAL_NAMESPACE} / ${config().TEMPORAL_TASK_QUEUE} ` +
      `(sweeper mode: ${config().SWEEPER_MODE})`,
  );
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';

if (invokedPath === fileURLToPath(import.meta.url)) {
  runWorker().catch((err) => {
    const message = err instanceof Error ? err.message : String(err);
    const cfg = config();

    // Connection failures dominate here, and the raw gRPC error buries the one
    // thing that fixes them: the two endpoint styles are not interchangeable.
    if (/unauthorized|PermissionDenied|not found or otherwise could not be described|deadline/i.test(message)) {
      console.error(`\n[worker] cannot reach ${cfg.TEMPORAL_NAMESPACE} at ${cfg.TEMPORAL_ADDRESS}\n`);
      console.error('  API key auth needs the REGIONAL address:');
      console.error('    <region>.<provider>.api.temporal.io:7233');
      console.error('  and the namespace must have API key auth enabled.\n');
      console.error('  mTLS needs the NAMESPACE address:');
      console.error('    <namespace>.<account>.tmprl.cloud:7233');
      console.error('  with TEMPORAL_TLS_CLIENT_CERT_DATA / _KEY_DATA (base64 PEM) or the *_PATH pair.\n');
      console.error('  Check which your namespace supports in the Cloud UI Connect box, then rerun');
      console.error('  `pnpm ops:preflight` — it tests this exact connection.\n');
      console.error(`  Original error: ${message}\n`);
    } else {
      console.error(err);
    }
    process.exit(1);
  });
}
