/**
 * Hand-narrowed shapes for the slice of the Cloud Ops API this portal uses.
 *
 * Field names are the protobuf WIRE names (snake_case), not camelCase. The
 * descriptor-set loader ignores `keepCase` and never camelCases, and protobuf
 * silently drops unknown fields — so a camelCase name here is not a type error,
 * it is a field that quietly vanishes. See src/cloud/client.ts.
 *
 * Types defined by this project (InventoryItem below, and everything in
 * src/temporal and src/course) stay camelCase; only proto shapes are snake.
 */

export type AccountRole =
  | 'ROLE_UNSPECIFIED'
  | 'ROLE_OWNER'
  | 'ROLE_ADMIN'
  | 'ROLE_DEVELOPER'
  | 'ROLE_FINANCE_ADMIN'
  | 'ROLE_READ'
  | 'ROLE_METRICS_READ';

export type ResourceState =
  | 'RESOURCE_STATE_UNSPECIFIED'
  | 'RESOURCE_STATE_ACTIVATING'
  | 'RESOURCE_STATE_ACTIVATION_FAILED'
  | 'RESOURCE_STATE_ACTIVE'
  | 'RESOURCE_STATE_UPDATING'
  | 'RESOURCE_STATE_UPDATE_FAILED'
  | 'RESOURCE_STATE_DELETING'
  | 'RESOURCE_STATE_DELETE_FAILED'
  | 'RESOURCE_STATE_DELETED'
  | 'RESOURCE_STATE_SUSPENDED'
  | 'RESOURCE_STATE_EXPIRED';

/**
 * A protobuf `map<K,V>` as this loader renders it.
 *
 * A map field is sugar for `repeated MapEntry { key, value }`, and loading from
 * a FileDescriptorSet does NOT collapse it back into an object — it arrives as
 * the entry array. Reading `ns.tags?.provisioner` off that is silently
 * `undefined`, which is how every tag checkpoint quietly failed against a
 * namespace that was tagged correctly.
 *
 * Both shapes are typed because a future loader change could switch it back.
 * Always read through `protoMap`.
 */
export type ProtoMap<V = string> = Record<string, V> | Array<{ key: string; value: V }>;

/** Normalises either shape of a protobuf map into a plain object. */
export function protoMap<V = string>(value: ProtoMap<V> | undefined | null): Record<string, V> {
  if (!value) return {};
  if (Array.isArray(value)) {
    return Object.fromEntries(value.map((entry) => [entry.key, entry.value]));
  }
  return value;
}

/** protobuf Timestamp as rendered by proto-loader with `longs: String`. */
export interface ProtoTimestamp {
  seconds?: string | number;
  nanos?: number;
}

export interface AccountAccess {
  role?: AccountRole;
  /** Present but deprecated; lower-case form such as "owner". */
  role_deprecated?: string;
  custom_roles?: string[];
}

export interface Access {
  account_access?: AccountAccess;
  /** Keyed by namespace name — map KEYS are data, never renamed. */
  namespace_accesses?: ProtoMap<{ permission?: string }>;
  project_accesses?: ProtoMap<{ role?: string }>;
}

/** `PERMISSION_WRITE` etc. — the namespace half of a grant. */
export interface NamespaceAccess {
  permission?: string;
  /** Present but deprecated; lower-case form such as "write". */
  permission_deprecated?: string;
}

/**
 * A service account limited to ONE namespace, with no account-wide access block
 * at all. `ServiceAccountSpec` carries either `access` or this — the proto says
 * "one of Access or NamespaceScopedAccess must be provided, but not both" — so
 * anything reading a service account's grants has to look in both places.
 *
 * `namespace` is the namespace id and is immutable after creation; the
 * permission inside it can be changed.
 */
export interface NamespaceScopedAccess {
  namespace?: string;
  access?: NamespaceAccess;
}

export interface CloudUser {
  id: string;
  resource_version: string;
  state: ResourceState;
  created_time?: ProtoTimestamp;
  last_modified_time?: ProtoTimestamp;
  invitation?: { created_time?: ProtoTimestamp; expired_time?: ProtoTimestamp };
  spec?: {
    email?: string;
    access?: Access;
  };
}

export interface CloudNamespace {
  namespace: string;
  resource_version: string;
  state: ResourceState;
  active_region?: string;
  created_time?: ProtoTimestamp;
  tags?: ProtoMap;
  spec?: {
    name?: string;
    retention_days?: number;
    regions?: string[];
    search_attributes?: ProtoMap;
    custom_search_attributes?: ProtoMap;
    api_key_auth?: { enabled?: boolean };
    mtls_auth?: { enabled?: boolean; accepted_client_ca?: string };
    /** Empty `endpoint` means no codec server is configured for the namespace. */
    codec_server?: { endpoint?: string };
    lifecycle?: { enable_delete_protection?: boolean };
    connectivity_rule_ids?: string[];
  };
  replicas?: Array<{ region?: string }>;
}

export interface CloudUserGroup {
  id: string;
  resource_version: string;
  state: ResourceState;
  created_time?: ProtoTimestamp;
  spec?: {
    display_name?: string;
    access?: Access;
    google_group?: { email_address?: string };
    scim_group?: { idp_id?: string };
    cloud_group?: Record<string, never>;
  };
}

export interface CustomRolePermission {
  resources?: { resource_type?: string; resource_ids?: string[]; allow_all?: boolean };
  actions?: string[];
}

export interface CloudCustomRole {
  id: string;
  resource_version: string;
  state: ResourceState;
  created_time?: ProtoTimestamp;
  spec?: {
    name?: string;
    description?: string;
    permissions?: CustomRolePermission[];
  };
}

/**
 * Who performed an audited operation.
 *
 * `api_key_id` is the interesting field and the one with no equivalent anywhere
 * else in the API: it is set when the call arrived with an API key — Terraform,
 * the CLI, CI — and empty when it came from a browser session. That is the only
 * place Temporal Cloud records *how* a change was made rather than just what it
 * changed.
 */
export interface CloudAuditPrincipal {
  /** "user" or "service-account". */
  type?: string;
  id?: string;
  /** Email address for user principals. */
  name?: string;
  api_key_id?: string;
}

export interface CloudAuditLogRecord {
  emit_time?: ProtoTimestamp;
  /**
   * Observed values include CreateNamespace, UpdateNamespaceTags, CreateUser,
   * DeleteUser, CreateApiKey, CreateCustomRole, DeleteCustomRole and UserLogin.
   *
   * Do not match on a hard-coded list. The documented event names disagree with
   * what the API actually emits — the docs say `CreateUserAPI` and
   * `CreateAPIKey`, the wire says `CreateUser` and `CreateApiKey`, and
   * `UpdateNamespaceTags` and `CreateCustomRole` are not documented at all.
   */
  operation?: string;
  /** "OK" or an error status. */
  status?: string;
  version?: number;
  log_id?: string;
  principal?: CloudAuditPrincipal;
  /** google.protobuf.Struct, so it arrives as `{fields: [{key, value}]}`. */
  raw_details?: unknown;
  x_forwarded_for?: string;
  async_operation_id?: string;
}

export interface CloudConnectivityRule {
  id: string;
  resource_version: string;
  state: ResourceState;
  created_time?: ProtoTimestamp;
  spec?: {
    public_rule?: { enable_stable_ips?: boolean };
    private_rule?: { connection_id?: string; region?: string; azure_pe_resource_id?: string };
  };
}

export interface CloudServiceAccount {
  id: string;
  resource_version: string;
  state: ResourceState;
  created_time?: ProtoTimestamp;
  spec?: {
    name?: string;
    description?: string;
    /** Set on account-scoped service accounts. Mutually exclusive with the next field. */
    access?: Access;
    /** Set on namespace-scoped service accounts — what Session 2's lab builds. */
    namespace_scoped_access?: NamespaceScopedAccess;
  };
}

export interface CloudApiKey {
  id: string;
  resource_version: string;
  state: ResourceState;
  created_time?: ProtoTimestamp;
  spec?: {
    owner_id?: string;
    owner_type?: string;
    display_name?: string;
    expiry_time?: ProtoTimestamp;
    disabled?: boolean;
  };
}

export interface CloudNexusEndpoint {
  id: string;
  resource_version: string;
  state: ResourceState;
  created_time?: ProtoTimestamp;
  spec?: {
    name?: string;
    target_spec?: {
      worker_target_spec?: { namespace_id?: string; task_queue?: string };
    };
    /** The caller allowlist. Empty means nobody may call — the default. */
    policy_specs?: Array<{
      allowed_cloud_namespace_policy_spec?: { namespace_id?: string };
    }>;
  };
}

export interface CloudRegion {
  id: string;
  location?: string;
  cloud_provider?: string;
  cloud_provider_region?: string;
}

export interface AsyncOperation {
  id?: string;
  state?: string;
  operation_type?: string;
  failure_reason?: string;
}

export function timestampToMs(ts?: ProtoTimestamp): number | undefined {
  if (!ts?.seconds) return undefined;
  const seconds = typeof ts.seconds === 'string' ? Number(ts.seconds) : ts.seconds;
  if (!Number.isFinite(seconds)) return undefined;
  return seconds * 1000 + Math.floor((ts.nanos ?? 0) / 1e6);
}

/** Reads the account role regardless of which of the two proto fields is populated. */
export function accountRoleOf(
  principal: { spec?: { access?: Access } } | undefined,
): AccountRole | undefined {
  const access = principal?.spec?.access?.account_access;
  if (access?.role && access.role !== 'ROLE_UNSPECIFIED') return access.role;
  if (!access?.role_deprecated) return undefined;
  // "owner" -> ROLE_OWNER, "financeadmin" -> ROLE_FINANCE_ADMIN
  const legacy: Record<string, AccountRole> = {
    owner: 'ROLE_OWNER',
    admin: 'ROLE_ADMIN',
    developer: 'ROLE_DEVELOPER',
    financeadmin: 'ROLE_FINANCE_ADMIN',
    read: 'ROLE_READ',
    metricsread: 'ROLE_METRICS_READ',
  };
  return legacy[access.role_deprecated.toLowerCase()];
}

/* -------------------------------------------------------------------------- */
/* Project-owned types (camelCase — these never touch the wire)                */
/* -------------------------------------------------------------------------- */

/**
 * The kinds of resource the sweeper tracks. Anything a Global Admin can create
 * that outlives their own deletion belongs on this list.
 */
export type ResourceKind =
  | 'namespace'
  | 'user'
  | 'serviceAccount'
  | 'apiKey'
  | 'userGroup'
  | 'customRole'
  | 'nexusEndpoint';

export interface InventoryItem {
  kind: ResourceKind;
  /** Stable identifier used for deletion. Namespaces use their name, everything else its id. */
  id: string;
  /** Human-readable label for the instructor view. */
  label: string;
  resourceVersion: string;
  createdAtMs?: number;
}
