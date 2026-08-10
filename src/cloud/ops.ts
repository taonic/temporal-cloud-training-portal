import { call, callPaginated, CloudOpsError } from './client';
import {
  protoMap,
  timestampToMs,
  type AccountRole,
  type AsyncOperation,
  type CloudApiKey,
  type CloudAuditLogRecord,
  type CloudConnectivityRule,
  type CloudCustomRole,
  type CloudNamespace,
  type CloudNexusEndpoint,
  type CloudRegion,
  type CloudServiceAccount,
  type CloudUser,
  type CloudUserGroup,
  type InventoryItem,
} from './types';

/**
 * All request and response field names below are protobuf WIRE names
 * (snake_case). Getting one wrong does not raise an error — protobuf drops
 * unknown request fields silently and returns undefined for misspelt response
 * fields. `pnpm check:wire` asserts every request in this file survives a
 * serialise/deserialise round trip.
 */

/* -------------------------------------------------------------------------- */
/* Identity                                                                    */
/* -------------------------------------------------------------------------- */

export async function getCurrentIdentity(): Promise<{
  user?: CloudUser;
  serviceAccount?: CloudServiceAccount;
  apiKey?: CloudApiKey;
}> {
  const res = await call<any>('getCurrentIdentity', {});
  return {
    user: res?.user,
    serviceAccount: res?.service_account,
    apiKey: res?.principal_api_key,
  };
}

/* -------------------------------------------------------------------------- */
/* Users                                                                       */
/* -------------------------------------------------------------------------- */

export async function listUsers(): Promise<CloudUser[]> {
  return callPaginated<CloudUser>('getUsers', {}, (r) => r?.users);
}

export async function findUserByEmail(email: string): Promise<CloudUser | undefined> {
  // GetUsers supports server-side filtering by email, which avoids paging the
  // whole account just to check for an existing invitation.
  const res = await call<any>('getUsers', { email, page_size: 10 });
  const users: CloudUser[] = res?.users ?? [];
  return users.find((u) => u.spec?.email?.toLowerCase() === email.toLowerCase());
}

export async function getUser(userId: string): Promise<CloudUser | undefined> {
  try {
    const res = await call<any>('getUser', { user_id: userId });
    return res?.user;
  } catch (err) {
    if (err instanceof CloudOpsError && err.isNotFound) return undefined;
    throw err;
  }
}

/**
 * Invites a user. Temporal Cloud sends the invitation email itself — the portal
 * deliberately owns no email infrastructure.
 *
 * `async_operation_id` makes this idempotent server-side: replaying the activity
 * with the same id will not create a second user.
 */
export async function createUser(args: {
  email: string;
  role: AccountRole;
  asyncOperationId: string;
  /**
   * Custom roles granted alongside the predefined role. Session 2 needs one —
   * see STUDENT_CUSTOM_ROLE_IDS. `custom_roles` lives on account_access; the
   * top-level spec.access.custom_roles field is deprecated and ignored after
   * api-cloud v0.12.0, and a value there is dropped in silence.
   */
  customRoleIds?: string[];
}): Promise<{ userId: string; asyncOperation?: AsyncOperation }> {
  const res = await call<any>('createUser', {
    spec: {
      email: args.email,
      access: {
        account_access: {
          role: args.role,
          // Omitted rather than sent empty: an empty repeated field is
          // indistinguishable from "no change" and costs nothing to leave out.
          ...(args.customRoleIds?.length ? { custom_roles: args.customRoleIds } : {}),
        },
      },
    },
    async_operation_id: args.asyncOperationId,
  });
  return { userId: res?.user_id, asyncOperation: res?.async_operation };
}

export async function deleteUser(args: {
  userId: string;
  resourceVersion?: string;
  asyncOperationId: string;
}): Promise<AsyncOperation | undefined> {
  try {
    const res = await call<any>('deleteUser', {
      user_id: args.userId,
      resource_version: args.resourceVersion ?? '',
      async_operation_id: args.asyncOperationId,
    });
    return res?.async_operation;
  } catch (err) {
    // Already gone — the student may have been removed by hand, or a previous
    // attempt succeeded before the activity result was recorded.
    if (err instanceof CloudOpsError && err.isNotFound) return undefined;
    throw err;
  }
}

/* -------------------------------------------------------------------------- */
/* Namespaces                                                                  */
/* -------------------------------------------------------------------------- */

export async function listNamespaces(): Promise<CloudNamespace[]> {
  return callPaginated<CloudNamespace>('getNamespaces', {}, (r) => r?.namespaces);
}

export async function deleteNamespace(args: {
  namespace: string;
  resourceVersion?: string;
  asyncOperationId: string;
}): Promise<AsyncOperation | undefined> {
  try {
    const res = await call<any>('deleteNamespace', {
      namespace: args.namespace,
      resource_version: args.resourceVersion ?? '',
      async_operation_id: args.asyncOperationId,
    });
    return res?.async_operation;
  } catch (err) {
    if (err instanceof CloudOpsError && err.isNotFound) return undefined;
    throw err;
  }
}

/** Region of a namespace, tolerating both the deprecated `spec.regions` and `replicas`. */
export function namespaceRegion(ns: CloudNamespace): string | undefined {
  return ns.active_region ?? ns.replicas?.[0]?.region ?? ns.spec?.regions?.[0];
}

export function namespaceSearchAttributes(ns: CloudNamespace): Record<string, string> {
  return {
    ...protoMap(ns.spec?.custom_search_attributes),
    ...protoMap(ns.spec?.search_attributes),
  };
}

/** Namespace tags, normalised out of the protobuf map-entry array. */
export function namespaceTags(ns: CloudNamespace): Record<string, string> {
  return protoMap(ns.tags);
}

export async function listRegions(): Promise<Array<{ id: string; location: string }>> {
  const res = await call<any>('getRegions', {});
  return ((res?.regions ?? []) as CloudRegion[]).map((r) => ({
    id: r.id,
    location: r.location ?? '',
  }));
}

/* -------------------------------------------------------------------------- */
/* Service accounts, API keys, Nexus endpoints                                 */
/* -------------------------------------------------------------------------- */

export async function listServiceAccounts(): Promise<CloudServiceAccount[]> {
  return callPaginated<CloudServiceAccount>(
    'getServiceAccounts',
    {},
    // NB: the response field is singular (`service_account`) despite being repeated.
    (r) => r?.service_account,
  );
}

export async function deleteServiceAccount(args: {
  serviceAccountId: string;
  resourceVersion?: string;
  asyncOperationId: string;
}): Promise<AsyncOperation | undefined> {
  try {
    const res = await call<any>('deleteServiceAccount', {
      service_account_id: args.serviceAccountId,
      resource_version: args.resourceVersion ?? '',
      async_operation_id: args.asyncOperationId,
    });
    return res?.async_operation;
  } catch (err) {
    if (err instanceof CloudOpsError && err.isNotFound) return undefined;
    throw err;
  }
}

export async function listApiKeys(): Promise<CloudApiKey[]> {
  return callPaginated<CloudApiKey>('getApiKeys', {}, (r) => r?.api_keys);
}

export async function deleteApiKey(args: {
  keyId: string;
  resourceVersion?: string;
  asyncOperationId: string;
}): Promise<AsyncOperation | undefined> {
  try {
    const res = await call<any>('deleteApiKey', {
      key_id: args.keyId,
      resource_version: args.resourceVersion ?? '',
      async_operation_id: args.asyncOperationId,
    });
    return res?.async_operation;
  } catch (err) {
    if (err instanceof CloudOpsError && err.isNotFound) return undefined;
    throw err;
  }
}

export async function listUserGroups(): Promise<CloudUserGroup[]> {
  return callPaginated<CloudUserGroup>('getUserGroups', {}, (r) => r?.groups);
}

export async function deleteUserGroup(args: {
  groupId: string;
  resourceVersion?: string;
  asyncOperationId: string;
}): Promise<AsyncOperation | undefined> {
  try {
    const res = await call<any>('deleteUserGroup', {
      group_id: args.groupId,
      resource_version: args.resourceVersion ?? '',
      async_operation_id: args.asyncOperationId,
    });
    return res?.async_operation;
  } catch (err) {
    if (err instanceof CloudOpsError && err.isNotFound) return undefined;
    throw err;
  }
}

/**
 * Custom roles are Pre-release and capped at 25 per account, so both `list` and
 * the sweeper's `delete` matter more than usual — a cohort of 20 students each
 * creating one gets close to the ceiling in a single workshop.
 */
export async function listCustomRoles(): Promise<CloudCustomRole[]> {
  return callPaginated<CloudCustomRole>('getCustomRoles', {}, (r) => r?.custom_roles);
}

export async function deleteCustomRole(args: {
  roleId: string;
  resourceVersion?: string;
  asyncOperationId: string;
}): Promise<AsyncOperation | undefined> {
  try {
    const res = await call<any>('deleteCustomRole', {
      role_id: args.roleId,
      resource_version: args.resourceVersion ?? '',
      async_operation_id: args.asyncOperationId,
    });
    return res?.async_operation;
  } catch (err) {
    if (err instanceof CloudOpsError && err.isNotFound) return undefined;
    throw err;
  }
}

/**
 * Reads the account Audit Log — the control plane's record of who did what.
 *
 * This is the only read in the whole API that answers a question about the
 * *past*. Everything else describes current state, which is why "was this
 * created by Terraform or by hand" reads as unanswerable until you get here.
 *
 * Deliberately not `callPaginated`: that drains every page, and the log holds
 * 30 days of account-wide activity. A cohort's worth of that is a lot of pages
 * to walk for a checkpoint, so this takes an explicit window and a page cap and
 * reports when it stopped early rather than silently truncating.
 *
 * Audit Logs need Account Owner or Global Administrator. The portal's key is an
 * Account Owner key, so it can always read them; a least-privilege service
 * account cannot, which is a lesson in its own right.
 */
export async function listAuditLogs(args: {
  sinceMs: number;
  untilMs?: number;
  /** Max pages of 1000. The API caps page_size at 1000. */
  maxPages?: number;
}): Promise<{ records: CloudAuditLogRecord[]; truncated: boolean }> {
  const maxPages = args.maxPages ?? 3;
  const records: CloudAuditLogRecord[] = [];
  let pageToken = '';
  let pages = 0;

  do {
    const res = await call<any>('getAuditLogs', {
      page_size: 1000,
      page_token: pageToken,
      start_time_inclusive: msToTimestamp(args.sinceMs),
      ...(args.untilMs ? { end_time_exclusive: msToTimestamp(args.untilMs) } : {}),
    });
    records.push(...((res?.logs ?? []) as CloudAuditLogRecord[]));
    pageToken = res?.next_page_token ?? '';
    pages++;
  } while (pageToken && pages < maxPages);

  return { records, truncated: pageToken !== '' };
}

function msToTimestamp(ms: number) {
  return { seconds: String(Math.floor(ms / 1000)), nanos: (ms % 1000) * 1e6 };
}

export async function listConnectivityRules(): Promise<CloudConnectivityRule[]> {
  return callPaginated<CloudConnectivityRule>(
    'getConnectivityRules',
    {},
    (r) => r?.connectivity_rules,
  );
}

export async function listNexusEndpoints(): Promise<CloudNexusEndpoint[]> {
  return callPaginated<CloudNexusEndpoint>('getNexusEndpoints', {}, (r) => r?.endpoints);
}

export async function deleteNexusEndpoint(args: {
  endpointId: string;
  resourceVersion?: string;
  asyncOperationId: string;
}): Promise<AsyncOperation | undefined> {
  try {
    const res = await call<any>('deleteNexusEndpoint', {
      endpoint_id: args.endpointId,
      resource_version: args.resourceVersion ?? '',
      async_operation_id: args.asyncOperationId,
    });
    return res?.async_operation;
  } catch (err) {
    if (err instanceof CloudOpsError && err.isNotFound) return undefined;
    throw err;
  }
}

/* -------------------------------------------------------------------------- */
/* Inventory                                                                   */
/* -------------------------------------------------------------------------- */

const LIVE_STATES = new Set([
  'RESOURCE_STATE_ACTIVATING',
  'RESOURCE_STATE_ACTIVE',
  'RESOURCE_STATE_UPDATING',
  'RESOURCE_STATE_SUSPENDED',
]);

const isLive = (state?: string) => !state || LIVE_STATES.has(state);

/**
 * A full inventory of every resource kind a Global Admin can leave behind.
 * Used both for the baseline snapshot and for each sweeper pass — the diff
 * between two of these is what the sweeper acts on.
 */
export async function snapshotInventory(): Promise<InventoryItem[]> {
  const [namespaces, users, serviceAccounts, apiKeys, userGroups, customRoles, nexusEndpoints] =
    await Promise.all([
      listNamespaces(),
      listUsers(),
      listServiceAccounts(),
      listApiKeys(),
      // Session 3 has students create groups and custom roles; without these
      // they would survive the sweep. Tolerate failure — groups and custom
      // roles are not enabled on every account (custom roles are Pre-release).
      listUserGroups().catch(() => [] as CloudUserGroup[]),
      listCustomRoles().catch(() => [] as CloudCustomRole[]),
      listNexusEndpoints().catch(() => [] as CloudNexusEndpoint[]),
    ]);

  const items: InventoryItem[] = [];

  for (const ns of namespaces) {
    if (!isLive(ns.state)) continue;
    items.push({
      kind: 'namespace',
      id: ns.namespace,
      label: `${ns.namespace} (${namespaceRegion(ns) ?? 'region unknown'})`,
      resourceVersion: ns.resource_version,
      createdAtMs: timestampToMs(ns.created_time),
    });
  }

  for (const u of users) {
    if (!isLive(u.state)) continue;
    items.push({
      kind: 'user',
      id: u.id,
      label: `${u.spec?.email ?? u.id} (${u.spec?.access?.account_access?.role ?? 'no role'})`,
      resourceVersion: u.resource_version,
      createdAtMs: timestampToMs(u.created_time),
    });
  }

  for (const sa of serviceAccounts) {
    if (!isLive(sa.state)) continue;
    items.push({
      kind: 'serviceAccount',
      id: sa.id,
      label: sa.spec?.name ?? sa.id,
      resourceVersion: sa.resource_version,
      createdAtMs: timestampToMs(sa.created_time),
    });
  }

  for (const key of apiKeys) {
    if (!isLive(key.state)) continue;
    items.push({
      kind: 'apiKey',
      id: key.id,
      label: key.spec?.display_name ?? key.id,
      resourceVersion: key.resource_version,
      createdAtMs: timestampToMs(key.created_time),
    });
  }

  for (const group of userGroups) {
    if (!isLive(group.state)) continue;
    items.push({
      kind: 'userGroup',
      id: group.id,
      label: group.spec?.display_name ?? group.id,
      resourceVersion: group.resource_version,
      createdAtMs: timestampToMs(group.created_time),
    });
  }

  for (const role of customRoles) {
    if (!isLive(role.state)) continue;
    items.push({
      kind: 'customRole',
      id: role.id,
      label: role.spec?.name ?? role.id,
      resourceVersion: role.resource_version,
      createdAtMs: timestampToMs(role.created_time),
    });
  }

  for (const ep of nexusEndpoints) {
    if (!isLive(ep.state)) continue;
    items.push({
      kind: 'nexusEndpoint',
      id: ep.id,
      label: ep.spec?.name ?? ep.id,
      resourceVersion: ep.resource_version,
      createdAtMs: timestampToMs(ep.created_time),
    });
  }

  return items;
}

export async function deleteInventoryItem(
  item: InventoryItem,
  asyncOperationId: string,
): Promise<void> {
  switch (item.kind) {
    case 'namespace':
      await deleteNamespace({
        namespace: item.id,
        resourceVersion: item.resourceVersion,
        asyncOperationId,
      });
      return;
    case 'user':
      await deleteUser({
        userId: item.id,
        resourceVersion: item.resourceVersion,
        asyncOperationId,
      });
      return;
    case 'serviceAccount':
      await deleteServiceAccount({
        serviceAccountId: item.id,
        resourceVersion: item.resourceVersion,
        asyncOperationId,
      });
      return;
    case 'apiKey':
      await deleteApiKey({
        keyId: item.id,
        resourceVersion: item.resourceVersion,
        asyncOperationId,
      });
      return;
    case 'userGroup':
      await deleteUserGroup({
        groupId: item.id,
        resourceVersion: item.resourceVersion,
        asyncOperationId,
      });
      return;
    case 'customRole':
      await deleteCustomRole({
        roleId: item.id,
        resourceVersion: item.resourceVersion,
        asyncOperationId,
      });
      return;
    case 'nexusEndpoint':
      await deleteNexusEndpoint({
        endpointId: item.id,
        resourceVersion: item.resourceVersion,
        asyncOperationId,
      });
      return;
  }
}

export { CloudOpsError };
