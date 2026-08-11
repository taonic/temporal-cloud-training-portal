import { accountRoleOf, protoMap } from '@/cloud/types';
import type { SessionDef } from '../types';

/**
 * Session 2 — AuthN/Z, RBAC & Deployment Patterns.
 *
 * The most gradable session: access control *is* control-plane state.
 *
 * The identity being built is the one a **Worker** runs as, which is the honest
 * version of this exercise. A Worker's job is entirely on the data plane — it
 * polls a task queue and completes tasks — so the interesting grant is the
 * namespace permission, and its control-plane access should be as close to
 * nothing as the product allows.
 *
 * The lab builds a NAMESPACE-SCOPED service account: `namespace_scoped_access`
 * with `write`, and no account-wide access block at all. That is Temporal's own
 * documented recommendation for Worker API keys, and it is the least-privilege
 * shape the product actually offers.
 *
 * It used to build an account-scoped service account plus a hand-written custom
 * role, and that cost far more than it taught:
 *
 *  - Creating a custom role and attaching one are Account Owner permissions, so
 *    students needed a second, elevated credential threaded through an aliased
 *    provider — a workshop-shaped workaround, not a pattern anyone would copy.
 *  - Custom Roles are Pre-release, capped at 25 per account, and carry a
 *    confirmed bug where an account-level custom role costs the principal its
 *    data-plane access.
 *  - The role itself granted one action a Worker never calls.
 *
 * The two facts that made the old lab worth doing survive without it, because
 * they are properties of the model rather than of custom roles:
 *
 *  1. A namespace-scoped service account still carries an implicit `Read`
 *     account role — the docs are explicit — and `read` already includes
 *     GetUsers, GetNamespaces and ListNamespaces across the whole account. There
 *     is no knob that lowers it, which is exactly why the lab has students
 *     observe it instead of assuming.
 *  2. The precision the product does offer is at the namespace, not the account:
 *     one namespace, one permission, immutable after creation.
 *
 * That is why the section below has students run `temporal cloud user list` and
 * watch it SUCCEED. A least-privilege lab that fakes a denial teaches a control
 * that isn't there. The one account-level thing the floor genuinely cannot do is
 * read the Audit Log — GetAuditLogs is Global Admin and Account Owner only — so
 * that is the denial the lab is built around.
 */
const REQUIRED_PERMISSION = 'PERMISSION_WRITE';
/** Anything at or above these on the account makes the namespace grant irrelevant. */
const OVER_PRIVILEGED = new Set(['ROLE_OWNER', 'ROLE_ADMIN', 'ROLE_DEVELOPER']);

export const session2: SessionDef = {
  number: 2,
  title: 'AuthN/Z, RBAC & Deployment Patterns',
  outcome:
    'The identity your Workers run as, built from the floor up, plus an honest map of where that floor ' +
    'actually sits.',
  exitCheck:
    'RBAC model, service-account pattern, and worker/application deployment recommendation documented.',
  labTitle: 'Build the identity your Worker runs as',
  labMinutes: 15,

  note:
    'You are holding Global Admin right now. This lab builds the identity your **Workers** should run ' +
    'as instead: a **namespace-scoped** service account with `write` on one namespace and no ' +
    'account-wide access block at all. That is what Temporal recommends for Worker API keys, and it ' +
    'needs no custom role — every resource in this lab runs as you. Then find out in "Use what you ' +
    'built" how much account access it still has anyway, because the answer is not none.',

  references: [
    {
      source: 'Access control',
      links: [
        {
          label: 'Namespace-scoped Service Accounts',
          url: 'https://docs.temporal.io/cloud/manage-access/service-accounts#scoped',
          note:
            'Read the constraints: always a `Read` account role, exactly one namespace permission, ' +
            'and the namespace cannot be changed afterwards. Deleting the namespace deletes these ' +
            'service accounts and their keys with it.',
        },
        {
          label: 'temporalcloud_service_account',
          url: 'https://registry.terraform.io/providers/temporalio/temporalcloud/latest/docs/resources/service_account',
          note:
            '`namespace_scoped_access` cannot be combined with `account_access`, ' +
            '`account_access_custom_roles` or `namespace_accesses` — the provider rejects it at ' +
            '`validate` time, before it talks to the API.',
        },
        {
          label: 'Cloud RBAC roles and permissions',
          url: 'https://docs.temporal.io/cloud/manage-access/roles-and-permissions',
          note: 'What each account role already grants, and the three namespace permissions.',
        },
        {
          label: 'Permissions reference',
          url: 'https://docs.temporal.io/cloud/manage-access/permissions-reference',
          note:
            'The per-endpoint table. Worth reading once for `Read-Only`: it is the floor every ' +
            'principal sits on, and it is wider than the name suggests.',
        },
      ],
    },
    {
      source: 'Audit Logs',
      links: [
        {
          label: 'Cloud Audit Logs',
          url: 'https://docs.temporal.io/cloud/audit-logs',
          note:
            'Who/when/what for the control plane, retained 30 days over the API. Note the documented ' +
            'event list is not exactly what the API emits — the wire says `CreateApiKey`, the page ' +
            'says `CreateAPIKey`.',
        },
        {
          label: 'temporal cloud account audit-log',
          url: 'https://docs.temporal.io/cli/command-reference/cloud/account',
          note: 'The `list` command and its time-range flags. The example on that page says `get`; the command is `list`.',
        },
        {
          label: 'Audit Log sinks — AWS Kinesis',
          url: 'https://docs.temporal.io/cloud/audit-logs-aws',
          note: 'What you would wire up in production to stream this into a SIEM. Not built in the lab — it needs a cloud account.',
        },
      ],
    },
  ],

  labSteps: [
    'Create the Worker\'s service account as **namespace-scoped**: `namespace_scoped_access` naming your namespace, with permission `write`. `write` is the grant that actually matters — it is what lets a Worker poll task queues and complete Workflow and Activity Tasks.',
    'Do not give it `account_access`, `account_access_custom_roles` or `namespace_accesses`. The provider rejects those alongside `namespace_scoped_access`, and `terraform validate` says so before any API call. A namespace-scoped service account is the one identity shape in the product that has no account-wide access block of its own.',
    'Note what you are NOT building: a custom role. It would be Account Owner permissions to create, Pre-release, capped at 25 per account, and additive — a custom role can only ever grant more, never less. There is nothing here for one to add.',
    'Issue an API key owned by the service account, not by you. A key owned by a person dies with the person — and this one is what goes into the Worker\'s environment as `TEMPORAL_API_KEY`.',
    'Create a group for your on-call operators, and a separate access block granting it namespace permission. The group is the identity; the access block is the entitlement. Membership stays empty — that half comes from your IdP over SCIM.',
    'Put the configuration below into `labs/lab2.tf` — a new file alongside `lab1.tf`, not a replacement for it. Every resource in it runs as you: Global Admin can create service accounts, groups and keys, so there is no second credential and no aliased provider anywhere in this lab.',
    'Run `terraform plan` and read it before applying.',
    'Run `terraform apply`, then hit Re-check. Work through "Use what you built" at the foot of the page afterwards — that is where the lesson actually lands, and its **last step is not optional**: it writes `labs/worker/.env` with the Worker\'s own key, which is the credential every Worker in Sessions 3 to 6 runs on.',
  ],

  snippetLang: 'hcl',
  snippet: ({ serviceAccountName, groupName, namespaceId }) => `# Goes in labs/lab2.tf.
#
# The terraform block, provider and API-key variable already live in labs/ —
# versions.tf and providers.tf. Declaring them again here is a
# duplicate-declaration error, so this file holds resources only.
#
# It references temporalcloud_namespace.lab from lab1.tf. Terraform reads every
# .tf file in the directory as one module, so that works — as long as lab1.tf is
# still there. Do not move Session 1's resources into this file.
#
# Everything below runs as YOU. Global Admin can create service accounts,
# groups and API keys, so this lab needs no second credential.

# The identity your Worker runs as.
#
# NAMESPACE-SCOPED: one namespace, one permission, and no account-wide access
# block at all. This is Temporal's documented recommendation for a Worker's API
# key, and it is as close to nothing as the product goes.
#
# "write" is the grant that does the work: it permits polling task queues and
# completing Workflow and Activity Tasks. It is scoped to this namespace and
# nowhere else.
resource "temporalcloud_service_account" "worker" {
  name        = "${serviceAccountName}"
  description = "Worker identity for ${namespaceId}. Namespace-scoped."

  namespace_scoped_access = {
    namespace_id = temporalcloud_namespace.lab.id
    permission   = "write"
  }

  # Deliberately absent: account_access, account_access_custom_roles and
  # namespace_accesses. The provider rejects any of them alongside
  # namespace_scoped_access — try adding account_access = "read" and run
  # terraform validate to watch it refuse. No custom role either: creating one
  # is an Account Owner permission, and custom roles are ADDITIVE, so a role
  # could only ever grant this identity more than it has.
  #
  # Two constraints worth knowing before you build on this shape:
  #   · the namespace is IMMUTABLE — changing it replaces the service account
  #   · the account role is implicitly "read". You cannot set it to none, and
  #     read is wider than it sounds. You will see exactly how wide below.
}

# Owned by the service account, so it outlives any individual. This is the key
# you would put in the Worker's environment as TEMPORAL_API_KEY.
resource "temporalcloud_apikey" "worker" {
  display_name = "${serviceAccountName}"
  owner_type   = "service-account"
  owner_id     = temporalcloud_service_account.worker.id
  expiry_time  = "2026-12-31T00:00:00Z"
  disabled     = false
}

# Your on-call operators. Two resources, because identity and entitlement are
# two decisions with two owners: temporalcloud_group creates the group and
# entitles nobody, and the access block below is what grants it anything.
resource "temporalcloud_group" "operators" {
  name = "${groupName}"
}

resource "temporalcloud_group_access" "operators" {
  id             = temporalcloud_group.operators.id
  account_access = "read"

  namespace_accesses = [
    {
      namespace_id = temporalcloud_namespace.lab.id
      permission   = "write"
    }
  ]

  # No membership here on purpose. Who is in this group arrives from your IdP
  # over SCIM — which is why removing someone in Azure AD removes their
  # Temporal access without anyone touching Terraform.
}

# The "Use what you built" section needs this key. Terraform will not print a
# sensitive value unless you ask for it by name:
#   terraform output -raw worker_api_key
output "worker_api_key" {
  value     = temporalcloud_apikey.worker.token
  sensitive = true
}`,

  use: ({ namespaceId, serviceAccountName }) => ({
    intro:
      'You now hold **two** credentials, and keeping them apart is the exercise. Your own admin key ' +
      'from Session 1 is in `$TEMPORAL_API_KEY`; the Worker key belongs to a service account and goes ' +
      'in a variable of its own. Every command below names the identity it runs as with `--api-key`, ' +
      'so nothing depends on which key happened to be exported last. Two of these will surprise you, ' +
      'and the surprises are the point — a least-privilege model you have not tested is a diagram, ' +
      'not a control. None of this is graded; the output is for you.',
    steps: [
      {
        label: 'As the admin: see who can reach your namespace, directly or by inheritance',
        command:
          `temporal cloud namespace service-account list -n ${namespaceId} --api-key $TEMPORAL_API_KEY\n` +
          `temporal cloud namespace user list -n ${namespaceId} --api-key $TEMPORAL_API_KEY\n` +
          `temporal cloud namespace user-group list -n ${namespaceId} --api-key $TEMPORAL_API_KEY`,
        expect:
          'Three principal types, three separate commands — a principal missing from one list is not ' +
          `absent, it is in another. You should see ${serviceAccountName} with the write permission you ` +
          'granted; every Global Admin in the account, including all your colleagues, marked ' +
          '`InheritedAccess` — that is the part people forget when they design RBAC; and your operators ' +
          'group holding `PERMISSION_WRITE`. That last line is `temporalcloud_group_access` doing its ' +
          'job: `temporalcloud_group` only creates the identity, and a group without an access block ' +
          'entitles nobody.',
      },
      {
        label: 'As the admin: notice the operators group is entitled but empty',
        command:
          'temporal cloud user-group list --api-key $TEMPORAL_API_KEY\ntemporal cloud user-group members list --group-id <id from above> --api-key $TEMPORAL_API_KEY',
        expect:
          'No members. The group holds write on your namespace and there is nobody in it — which is ' +
          'the correct end state for this lab, not an omission. Entitlement and membership are ' +
          'separate concerns with separate owners: Terraform declares what a group may do, and your ' +
          'IdP decides who is in it, arriving over SCIM. Staging the entitlement before anyone holds ' +
          'it is exactly how you would roll out access to a new team. It is also why removing someone ' +
          'in Azure AD removes their Temporal access without anyone touching Terraform.',
      },
      {
        label: 'As the admin: read the account Audit Log — who changed what, and how',
        command: 'temporal cloud account audit-log list --page-size 100 --api-key $TEMPORAL_API_KEY',
        expect:
          'The operations from the apply you just ran, attributed to your email, each carrying an ' +
          '`apiKeyId` — because Terraform authenticated with your key. Your own `UserLogin` rows have ' +
          'no key id at all. That field is the difference between a change made by automation and one ' +
          'made by hand in the console, and it is the only place Temporal Cloud records *how* a change ' +
          'arrived. Note what else is on screen: the log is account-wide, so Global Admin means reading ' +
          "every colleague's activity too. Audit access is itself a privilege worth scoping.",
      },
      {
        label: 'Capture the Worker key into a variable of its own',
        command:
          'export WORKER_API_KEY=$(terraform output -raw worker_api_key)\ntemporal cloud whoami --api-key $WORKER_API_KEY',
        expect:
          `The service account, not you. Note what this step does NOT do: it does not export over ` +
          '`TEMPORAL_API_KEY`. Overwriting your admin key with a least-privilege one is how people ' +
          'spend twenty minutes debugging a `PERMISSION_DENIED` that is really a shell variable — and ' +
          'in the other direction, leaving an admin key exported is how a Worker ends up running with ' +
          'far more access than anyone intended. Both keys now exist side by side, and every command ' +
          'below says which one it means.',
      },
      {
        label: 'As the Worker: do the job it actually exists to do',
        command: `temporal workflow list \\\n  --address ${namespaceId}.tmprl.cloud:7233 \\\n  --namespace ${namespaceId} \\\n  --api-key $WORKER_API_KEY`,
        expect:
          'Succeeds — and this is the only permission a Worker genuinely needs. `write` on the namespace ' +
          'is what lets it poll task queues and complete tasks, and it is granted per namespace, ' +
          'entirely separately from any account role.',
      },
      {
        label: 'As the Worker: find the floor — the two things it should not be able to do',
        command:
          'temporal cloud user list --api-key $WORKER_API_KEY\ntemporal cloud namespace list --api-key $WORKER_API_KEY',
        expect:
          '**Both succeed, and that is the lesson.** You wrote no account access at all, and this ' +
          'identity still has some: a namespace-scoped service account always carries an implicit ' +
          '`Read` account role, and `Read` already includes GetUsers, GetNamespaces and ListNamespaces ' +
          'across the whole account. There is no argument that lowers it — not `none`, not a custom ' +
          'role, which could only add. The identity your Worker runs as can enumerate every colleague ' +
          'and every namespace in the account, not because you granted it, but because that is the ' +
          'floor. Check it yourself in the permissions reference (linked below) before you design ' +
          'around where you assume the floor sits.',
      },
      {
        label: 'The one account-level thing the floor really does deny',
        command:
          'temporal cloud account audit-log list --page-size 5 --api-key $WORKER_API_KEY\ntemporal cloud account audit-log list --page-size 5 --api-key $TEMPORAL_API_KEY',
        expect:
          'The first is PERMISSION_DENIED; the second, as the admin, works. `GetAuditLogs` is Global ' +
          'Admin and Account Owner only — one of the few account reads `read` does not carry. Same ' +
          'command, same terminal, two identities: the credential in your Worker cannot read, or ' +
          'quietly tamper with its own trail in, the forensic record, while yours can. That asymmetry ' +
          'is what makes the Audit Log worth anything.',
      },
      {
        label: 'As the Worker: try to reach a namespace it was not scoped to',
        command: `temporal workflow list \\\n  --address ${namespaceId}.tmprl.cloud:7233 \\\n  --namespace <a colleague's namespace> \\\n  --api-key $WORKER_API_KEY`,
        expect:
          'PERMISSION_DENIED. Pick any namespace from the `namespace list` two steps up — it can *see* ' +
          'them all through the account floor, and it can act in exactly one. That gap between what an ' +
          'identity can enumerate and what it can touch is the whole reason namespace permissions ' +
          'exist separately from account roles, and it is what your own Worker key buys you.',
      },
      {
        label: 'Hand the Worker its own credential — do not leave the session without this',
        required: 'Sessions 3-6 run on this file',
        command: `cat > worker/.env <<EOF\nTEMPORAL_ADDRESS=${namespaceId}.tmprl.cloud:7233\nTEMPORAL_NAMESPACE=${namespaceId}\nTEMPORAL_API_KEY=$(terraform output -raw worker_api_key)\nEOF\n\ncd worker && dotnet run -- worker`,
        expect:
          'The Worker starts and polls, now authenticating as the service account rather than as you. ' +
          '**This is the one step in this section the rest of the workshop depends on:** every Worker ' +
          'you run in Sessions 3, 4, 5 and 6 reads `labs/worker/.env`, and skipping this leaves them ' +
          'running on your personal admin key — which works, and quietly undoes the whole point of ' +
          'the session. Run it from `labs/`, where you ran Terraform. **It replaces ' +
          '`labs/worker/.env`**; those three lines are everything the Worker reads. The file is ' +
          'gitignored and the key is a real credential: it is the one thing here worth treating like ' +
          'a secret.',
      },
    ],
  }),

  checkpoints: [
    {
      id: 'service-account-exists',
      title: 'Worker service account exists',
      detail: 'A service account with your assigned name is present and active.',
    },
    {
      id: 'service-account-namespace-scoped',
      title: 'Namespace-scoped — no account-wide access block',
      detail:
        'The service account carries `namespace_scoped_access` rather than `account_access`. This is ' +
        'the least-privilege identity shape the product offers: no account role of its own to grant, ' +
        'no custom role to attach, and nothing account-wide to get wrong later.',
    },
    {
      id: 'service-account-write-on-namespace',
      title: 'Scoped to your namespace with `write`',
      detail:
        'The single namespace permission targets your namespace and is `write` — the grant that lets ' +
        'a Worker poll task queues and complete Workflow and Activity Tasks. `read` cannot do the job; ' +
        '`admin` lets the Worker reconfigure the namespace it runs in.',
    },
    {
      id: 'service-account-api-key',
      title: 'API key owned by the service account',
      detail: 'At least one API key whose owner is the service account, not a person.',
    },
    {
      id: 'operators-group-entitled',
      title: 'Operators group holds `write`, and holds no members',
      detail:
        'The group exists and its access block grants `write` on your namespace. Membership is ' +
        'deliberately empty: Terraform declares what a group may do, and your IdP decides who is in ' +
        'it over SCIM. A group with an entitlement and no members is the correct end state here.',
    },
  ],

  async grade(ctx) {
    const ns = await ctx.labNamespace();
    if (!ns) {
      return ctx.blockedAll(`No namespace named "${ctx.namespaceName}" — complete Session 1 first.`);
    }

    const [serviceAccounts, apiKeys, userGroups] = await Promise.all([
      ctx.serviceAccounts(),
      ctx.apiKeys(),
      ctx.userGroups(),
    ]);

    // Namespace access is keyed by namespace id (`name.account`), but be lenient
    // and match the bare name too.
    const matchesNamespace = (key: string) =>
      key === ns.namespace || key === ctx.namespaceName || key.startsWith(`${ctx.namespaceName}.`);

    /* -- Service account ------------------------------------------------ */
    const sa = serviceAccounts.find((s) => s.spec?.name === ctx.serviceAccountName);

    const saResults = !sa
      ? [
          ctx.mk('service-account-exists', 'fail', `No service account named "${ctx.serviceAccountName}".`),
          ctx.mk('service-account-namespace-scoped', 'blocked', 'Waiting on the service account.'),
          ctx.mk('service-account-write-on-namespace', 'blocked', 'Waiting on the service account.'),
          ctx.mk('service-account-api-key', 'blocked', 'Waiting on the service account.'),
        ]
      : (() => {
          const scoped = sa.spec?.namespace_scoped_access;
          const accountRole = accountRoleOf(sa);
          // An account-scoped service account keeps its grants in a map instead.
          const fromAccountScoped = Object.entries(
            protoMap(sa.spec?.access?.namespace_accesses),
          ).find(([key]) => matchesNamespace(key));

          const scopedNamespace = scoped?.namespace;
          const permission = scoped
            ? scoped.access?.permission
            : fromAccountScoped?.[1]?.permission;
          const owned = apiKeys.filter((k) => k.spec?.owner_id === sa.id);

          return [
            ctx.mk('service-account-exists', 'pass', `Found ${sa.spec?.name} (${sa.state}).`),
            ctx.check(
              'service-account-namespace-scoped',
              scoped !== undefined,
              `Namespace-scoped to ${scopedNamespace} — no account-wide access block.`,
              accountRole && OVER_PRIVILEGED.has(accountRole)
                ? `Account-scoped with the predefined role ${accountRole}, which carries every ` +
                  'namespace in the account. Replace account_access with namespace_scoped_access.'
                : accountRole
                  ? `Account-scoped with the predefined role ${accountRole}. Use ` +
                    'namespace_scoped_access instead — it is the one shape with no account-wide ' +
                    'grant of its own, and the provider will not let you write both.'
                  : 'No namespace_scoped_access block on the service account.',
            ),
            ctx.check(
              'service-account-write-on-namespace',
              scopedNamespace !== undefined &&
                matchesNamespace(scopedNamespace) &&
                permission === REQUIRED_PERMISSION,
              `Holds ${permission} on ${scopedNamespace}.`,
              scopedNamespace === undefined
                ? fromAccountScoped
                  ? `Holds ${permission} on ${fromAccountScoped[0]}, but through namespace_accesses ` +
                    'alongside an account role. Move the grant into namespace_scoped_access — the ' +
                    'provider will not accept both.'
                  : 'No permission on your namespace at all.'
                : !matchesNamespace(scopedNamespace)
                  ? `Scoped to ${scopedNamespace}, not ${ns.namespace}. The namespace is immutable — ` +
                    'this one has to be destroyed and recreated.'
                  : `Permission is ${permission}, expected ${REQUIRED_PERMISSION}. ` +
                    'read cannot poll a task queue; admin can reconfigure the namespace.',
            ),
            ctx.check(
              'service-account-api-key',
              owned.length > 0,
              `${owned.length} API key(s) owned by the service account.`,
              'No API key owned by the service account — owner_type "service-account" is what makes it outlive you.',
            ),
          ];
        })();

    /* -- Operators group ------------------------------------------------ */
    const group = userGroups.find((g) => g.spec?.display_name === ctx.groupName);
    const groupGrant = group
      ? Object.entries(protoMap(group.spec?.access?.namespace_accesses)).find(([key]) =>
          matchesNamespace(key),
        )
      : undefined;

    const groupResult = !group
      ? ctx.mk('operators-group-entitled', 'fail', `No group named "${ctx.groupName}".`)
      : ctx.check(
          'operators-group-entitled',
          groupGrant?.[1]?.permission === REQUIRED_PERMISSION,
          `Group holds ${groupGrant?.[1]?.permission} on ${groupGrant?.[0]}.`,
          groupGrant
            ? `Group holds ${groupGrant[1]?.permission} on your namespace, expected ${REQUIRED_PERMISSION}.`
            : 'The group exists but has no permission on your namespace — temporalcloud_group creates ' +
              'the identity, and temporalcloud_group_access is what entitles it.',
        );

    return [...saResults, groupResult];
  },
};
