import { credentials, Metadata, type ServiceError } from '@grpc/grpc-js';
import { loadFileDescriptorSetFromBuffer } from '@grpc/proto-loader';
import { loadPackageDefinition, type GrpcObject } from '@grpc/grpc-js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { config } from '@/config';

/**
 * The Cloud Ops API has no official TypeScript SDK. Rather than generate code,
 * we ship a FileDescriptorSet built from temporalio/api-cloud (see
 * `scripts/vendor-protos.mjs`) and build a dynamic client from it at runtime.
 * That keeps the whole API surface available without a codegen step, at the
 * cost of the responses being plain JS objects rather than generated types —
 * `src/cloud/types.ts` narrows the handful of shapes we actually use.
 */

const DESCRIPTOR_PATH = join(process.cwd(), 'proto', 'cloudservice.binpb');

type UnaryCall = (
  request: unknown,
  metadata: Metadata,
  callback: (err: ServiceError | null, response: unknown) => void,
) => void;

export type CloudServiceClient = Record<string, UnaryCall> & { close(): void };

let clientPromise: Promise<CloudServiceClient> | undefined;

/**
 * Exported so `scripts/check-wire.ts` verifies requests against the exact same
 * loader options production uses — a drifting copy would defeat the point.
 */
export function loadCloudPackageDefinition() {
  const descriptor = readFileSync(DESCRIPTOR_PATH);

  return loadFileDescriptorSetFromBuffer(descriptor, {
    // `keepCase` is IGNORED on this code path — proto-loader only applies
    // camelCasing when parsing .proto source, not a FileDescriptorSet. Field
    // names are always the wire names (snake_case), in both directions.
    //
    // This matters far more than it looks: protobuf silently discards unknown
    // fields, so a camelCase request field is dropped with no error at all.
    // `{pageSize: 100}` serialises to zero bytes; a camelCase `accountAccess`
    // would invite users with no role. `scripts/check-wire.ts` guards this.
    keepCase: true,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true,
  });
}

function buildClient(): CloudServiceClient {
  const cfg = config();
  const proto = loadPackageDefinition(loadCloudPackageDefinition()) as GrpcObject;
  const cloudService = (proto as any).temporal.api.cloud.cloudservice.v1.CloudService;

  return new cloudService(
    cfg.CLOUD_OPS_ADDRESS,
    credentials.createSsl(),
  ) as CloudServiceClient;
}

async function getClient(): Promise<CloudServiceClient> {
  clientPromise ??= Promise.resolve(buildClient());
  return clientPromise;
}

function authMetadata(): Metadata {
  const cfg = config();
  const md = new Metadata();
  md.set('authorization', `Bearer ${cfg.CLOUD_OPS_API_KEY}`);
  // gRPC clients must send this on every request; the server rejects calls without it.
  md.set('temporal-cloud-api-version', cfg.CLOUD_OPS_API_VERSION);
  return md;
}

export class CloudOpsError extends Error {
  constructor(
    readonly rpc: string,
    readonly code: number | undefined,
    message: string,
  ) {
    super(`${rpc} failed (grpc code ${code ?? 'unknown'}): ${message}`);
    this.name = 'CloudOpsError';
  }

  /** Auth failures mean the portal's credential is broken — the canary escalates these. */
  get isAuthFailure(): boolean {
    // 7 = PERMISSION_DENIED, 16 = UNAUTHENTICATED
    return this.code === 7 || this.code === 16;
  }

  /** Not-found on a delete means someone beat us to it; that is success, not failure. */
  get isNotFound(): boolean {
    return this.code === 5;
  }
}

export async function call<T>(rpc: string, request: Record<string, unknown>): Promise<T> {
  const client = await getClient();
  const method = client[rpc];
  if (typeof method !== 'function') {
    throw new Error(`Unknown Cloud Ops RPC: ${rpc}`);
  }

  return new Promise<T>((resolve, reject) => {
    method.call(client, request, authMetadata(), (err, response) => {
      if (err) {
        reject(new CloudOpsError(rpc, err.code, err.details || err.message));
        return;
      }
      resolve(response as T);
    });
  });
}

/** Drains a page-token paginated RPC into a single array. */
export async function callPaginated<TItem>(
  rpc: string,
  request: Record<string, unknown>,
  extract: (response: any) => TItem[] | undefined,
): Promise<TItem[]> {
  const items: TItem[] = [];
  let pageToken = '';

  do {
    // snake_case is load-bearing: `pageSize` serialises to nothing at all, and
    // this loop would then silently return only the server's default page.
    const response = await call<any>(rpc, { ...request, page_size: 100, page_token: pageToken });
    items.push(...(extract(response) ?? []));
    pageToken = response?.next_page_token ?? '';
  } while (pageToken);

  return items;
}
