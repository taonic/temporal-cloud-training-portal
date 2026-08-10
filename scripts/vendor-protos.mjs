#!/usr/bin/env node
/**
 * Regenerates proto/cloudservice.binpb from temporalio/api-cloud.
 *
 * There is no official TypeScript SDK for the Cloud Ops API. Rather than commit
 * generated code, we commit a single FileDescriptorSet with every dependency
 * (googleapis, grpc-gateway, temporalio/api) inlined by buf, and build a dynamic
 * gRPC client from it at runtime.
 *
 * Bump API_CLOUD_REF, run `pnpm proto:vendor`, and update
 * CLOUD_OPS_API_VERSION in .env to match the repo's VERSION file.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, copyFileSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const API_CLOUD_REF = 'v0.19.1';
const BUF_VERSION = '1.47.2';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outPath = join(root, 'proto', 'cloudservice.binpb');
const work = mkdtempSync(join(tmpdir(), 'api-cloud-'));

const run = (cmd, args, cwd) =>
  execFileSync(cmd, args, { cwd, stdio: ['ignore', 'inherit', 'inherit'] });

try {
  console.log(`Cloning temporalio/api-cloud@${API_CLOUD_REF}…`);
  run('git', ['clone', '--depth', '1', '--branch', API_CLOUD_REF,
    'https://github.com/temporalio/api-cloud.git', work]);

  const version = readFileSync(join(work, 'VERSION'), 'utf8').trim();
  console.log(`api-cloud VERSION = ${version}`);

  console.log('Building descriptor set…');
  const tmpOut = join(work, 'cloudservice.binpb');
  run('npx', ['--yes', `@bufbuild/buf@${BUF_VERSION}`, 'build',
    '--as-file-descriptor-set', '-o', tmpOut], work);

  mkdirSync(join(root, 'proto'), { recursive: true });
  copyFileSync(tmpOut, outPath);

  console.log(`Wrote ${outPath}`);
  console.log(`Set CLOUD_OPS_API_VERSION=${version} in your environment.`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
