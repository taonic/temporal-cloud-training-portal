/**
 * Guards against the worst failure mode in this codebase.
 *
 *   pnpm check:wire
 *
 * The Cloud Ops client is built from a FileDescriptorSet, where proto-loader
 * ignores `keepCase` and field names are always the wire names (snake_case).
 * Protobuf then discards unknown fields *silently*: a camelCase request field
 * is not a type error, not a runtime error, just a value that never arrives.
 *
 * That is how `{pageSize: 100}` came to serialise to zero bytes, and how
 * CreateUser could have invited students with no account role at all.
 *
 * So: build every request shape the portal actually sends, round-trip it
 * through the real serializer, and assert each field survives.
 */
import { loadCloudPackageDefinition } from '../src/cloud/client';

interface Case {
  rpc: string;
  why: string;
  request: Record<string, unknown>;
}

const CASES: Case[] = [
  {
    rpc: 'CreateUser',
    why: 'a dropped role invites students with no permissions at all',
    request: {
      spec: { email: 'student@example.com', access: { account_access: { role: 'ROLE_ADMIN' } } },
      async_operation_id: 'invite-abc',
    },
  },
  {
    rpc: 'CreateUser',
    why: 'a dropped custom_roles list fails Session 2 with PermissionDenied, hours later',
    request: {
      spec: {
        email: 'student@example.com',
        access: { account_access: { role: 'ROLE_ADMIN', custom_roles: ['role-1', 'role-2'] } },
      },
      async_operation_id: 'invite-abc',
    },
  },
  {
    rpc: 'DeleteUser',
    why: 'a dropped user_id would revoke nothing',
    request: { user_id: 'u-1', resource_version: 'v1', async_operation_id: 'revoke-abc' },
  },
  {
    rpc: 'GetUsers',
    why: 'a dropped page_size silently truncates the inventory the sweeper diffs',
    request: { page_size: 100, page_token: '', email: 'student@example.com' },
  },
  {
    rpc: 'GetUser',
    why: '',
    request: { user_id: 'u-1' },
  },
  {
    rpc: 'GetNamespaces',
    why: '',
    request: { page_size: 100, page_token: '' },
  },
  {
    rpc: 'DeleteNamespace',
    why: 'a dropped namespace would delete nothing, or the wrong thing',
    request: { namespace: 'training-tao.bvmon', resource_version: 'v1', async_operation_id: 'sweep-1' },
  },
  {
    rpc: 'GetServiceAccounts',
    why: '',
    request: { page_size: 100, page_token: '' },
  },
  {
    rpc: 'DeleteServiceAccount',
    why: '',
    request: { service_account_id: 'sa-1', resource_version: 'v1', async_operation_id: 'sweep-2' },
  },
  {
    rpc: 'GetApiKeys',
    why: '',
    request: { page_size: 100, page_token: '' },
  },
  {
    rpc: 'DeleteApiKey',
    why: '',
    request: { key_id: 'k-1', resource_version: 'v1', async_operation_id: 'sweep-3' },
  },
  {
    rpc: 'GetNexusEndpoints',
    why: '',
    request: { page_size: 100, page_token: '' },
  },
  {
    rpc: 'DeleteNexusEndpoint',
    why: '',
    request: { endpoint_id: 'e-1', resource_version: 'v1', async_operation_id: 'sweep-4' },
  },
  {
    rpc: 'GetUserGroups',
    why: 'Session 3 grades groups, and the sweeper deletes the ones students create',
    request: { page_size: 100, page_token: '' },
  },
  {
    rpc: 'DeleteUserGroup',
    why: 'a dropped group_id leaves Session 2 debris in the account forever',
    request: { group_id: 'g-1', resource_version: 'v1', async_operation_id: 'sweep-5' },
  },
  {
    rpc: 'GetCustomRoles',
    why: 'Session 2 grades custom roles against a 25-per-account cap',
    request: { page_size: 100, page_token: '' },
  },
  {
    rpc: 'DeleteCustomRole',
    why: 'a dropped role_id burns one of only 25 custom role slots, permanently',
    request: { role_id: 'r-1', resource_version: 'v1', async_operation_id: 'sweep-6' },
  },
  {
    rpc: 'GetConnectivityRules',
    why: '',
    request: { page_size: 100, page_token: '' },
  },
  {
    rpc: 'GetAuditLogs',
    why:
      "Session 2's attribution check reads the account Audit Log. The window is nested " +
      'protobuf Timestamps — a dropped start_time_inclusive silently widens the query to ' +
      'the full 30 days and buries the student under the whole cohort',
    request: {
      page_size: 1000,
      page_token: '',
      start_time_inclusive: { seconds: '1786233782', nanos: 876000000 },
      end_time_exclusive: { seconds: '1786320182', nanos: 0 },
    },
  },
  { rpc: 'GetRegions', why: '', request: {} },
  { rpc: 'GetCurrentIdentity', why: '', request: {} },
];

/** Every leaf path in an object, as ["a.b.c", value] pairs. */
function leaves(value: unknown, prefix = ''): Array<[string, unknown]> {
  // Repeated fields index in, so each element is compared as a scalar. Treating
  // the array itself as a leaf made every repeated field report as lost: the
  // check below is `!==`, and two arrays holding equal values are never ===.
  if (Array.isArray(value)) {
    return value.flatMap((v, i) => leaves(v, prefix ? `${prefix}.${i}` : String(i)));
  }
  if (value === null || typeof value !== 'object') {
    return [[prefix, value]];
  }
  return Object.entries(value as Record<string, unknown>).flatMap(([k, v]) =>
    leaves(v, prefix ? `${prefix}.${k}` : k),
  );
}

const at = (obj: unknown, path: string): unknown =>
  path.split('.').reduce<any>((acc, key) => (acc == null ? undefined : acc[key]), obj);

const definition = loadCloudPackageDefinition() as any;
const service = definition['temporal.api.cloud.cloudservice.v1.CloudService'];

let failures = 0;

for (const testCase of CASES) {
  const method = service?.[testCase.rpc];
  if (!method) {
    console.log(`  ✗ ${testCase.rpc}: RPC not found in the descriptor set`);
    failures++;
    continue;
  }

  const roundTripped = method.requestDeserialize(method.requestSerialize(testCase.request));
  const lost = leaves(testCase.request).filter(([path, expected]) => {
    // Empty strings are indistinguishable from unset on the wire; skip them.
    if (expected === '') return false;
    return at(roundTripped, path) !== expected;
  });

  if (lost.length === 0) {
    const fieldCount = leaves(testCase.request).length;
    console.log(`  ✓ ${testCase.rpc} (${fieldCount} field${fieldCount === 1 ? '' : 's'})`);
  } else {
    failures++;
    console.log(`  ✗ ${testCase.rpc}: ${lost.length} field(s) lost on the wire`);
    for (const [path, expected] of lost) {
      console.log(`      ${path} = ${JSON.stringify(expected)} -> ${JSON.stringify(at(roundTripped, path))}`);
    }
    if (testCase.why) console.log(`      impact: ${testCase.why}`);
  }
}

console.log(
  failures === 0
    ? `\nAll ${CASES.length} request shapes survive serialisation.\n`
    : `\n${failures} RPC(s) LOSING FIELDS.\n`,
);
process.exit(failures === 0 ? 0 : 1);
