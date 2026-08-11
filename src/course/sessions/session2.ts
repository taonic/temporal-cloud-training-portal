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
 * Two facts from the docs drive the whole design, and both are counter-intuitive
 * enough that the lab makes students observe them rather than take our word:
 *
 *  1. Custom Roles are ADDITIVE. They cannot narrow or remove what a predefined
 *     role grants; effective access is the union. So `developer` plus a narrow
 *     custom role still grants everything `developer` does.
 *  2. Every principal must have a predefined role, and the floor is `read` —
 *     which already includes GetUsers, GetNamespaces and ListNamespaces across
 *     the whole account. The floor is wider than a Worker needs and no custom
 *     role can bring it down.
 *
 * That second fact is why the section below has students run `temporal cloud
 * user list` and watch it SUCCEED. A least-privilege lab that fakes a denial
 * teaches a control that isn't there. The one account-level thing `read`
 * genuinely cannot do is read the Audit Log — GetAuditLogs is Global Admin and
 * Account Owner only — so that is the denial the lab is built around.
 */
const OVER_PRIVILEGED = new Set(['ROLE_OWNER', 'ROLE_ADMIN', 'ROLE_DEVELOPER']);
const REQUIRED_ACTION = 'cloud.namespace.get';

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
    'as instead. A Worker needs `write` on one namespace and essentially nothing on the account, so ' +
    'start at `read` — the floor — and add only what is genuinely missing. Custom Roles are additive: ' +
    'they can only grant, never revoke, so reaching for `developer` fails the check deliberately. ' +
    'Find out in "Use what you built" how wide that floor really is.',

  references: [
    {
      source: 'Audit Logs',
      links: [
        {
          label: 'Cloud Audit Logs',
          url: 'https://docs.temporal.io/cloud/audit-logs',
          note:
            'Who/when/what for the control plane, retained 30 days over the API. Note the documented ' +
            'event list is not exactly what the API emits — the wire says `CreateApiKey`, the page ' +
            'says `CreateAPIKey`, and `CreateCustomRole` is not listed at all.',
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
    {
      source: 'Access control',
      links: [
        {
          label: 'temporalcloud_custom_role',
          url: 'https://registry.terraform.io/providers/temporalio/temporalcloud/latest/docs/resources/custom_role',
          note: 'Note `resource_ids` is required on every permission block even when `allow_all` is true.',
        },
        {
          label: 'Cloud RBAC roles and permissions',
          url: 'https://docs.temporal.io/cloud/users',
          note: 'What each predefined role already grants — which is what a custom role can only add to.',
        },
      ],
    },
  ],

  labSteps: [
    'Create a custom role granting only what the Worker genuinely needs on the control plane: read ITS OWN namespace, by id. Not `allow_all`, and no account-wide grant — a Worker never enumerates the account.',
    'Create the service account with the predefined role `read` — the floor, because every principal must have one — and assign the custom role on top.',
    'Give it `write` on your namespace. This is the grant that actually matters: `write` is what lets a Worker poll task queues and complete tasks.',
    'Issue an API key owned by the service account, not by you. A key owned by a person dies with the person.',
    'Create a group for your on-call operators, and a separate access block granting it namespace permission. The group is the identity; the access block is the entitlement. Membership stays empty — that half comes from your IdP over SCIM.',
    'Put the configuration below into `labs/lab2.tf` — a new file alongside `lab1.tf`, not a replacement for it. Two of its resources carry `provider = temporalcloud.elevated`: creating a custom role, and attaching one to a principal, are Account Owner permissions that your Global Admin does not have. A shared service account holds that delegation, and its key is already in your sandbox — you do not need to fetch or paste anything. Read `labs/providers.tf` for why the workshop hands you a second identity rather than a bigger one.',
    'Run `terraform plan` and read it before applying. Everything except those two resources still runs as you.',
    'Run `terraform apply`, then hit Re-check. Work through "Use what you built" at the foot of the page afterwards — that is where the lesson actually lands.',
  ],

  snippetLang: 'hcl',
  snippet: ({ serviceAccountName, customRoleName, namespaceId }) => `# Goes in labs/lab2.tf.
#
# The terraform block, provider and API-key variable already live in labs/ —
# versions.tf and providers.tf. Declaring them again here is a
# duplicate-declaration error, so this file holds resources only.
#
# It references temporalcloud_namespace.lab from lab1.tf. Terraform reads every
# .tf file in the directory as one module, so that works — as long as lab1.tf is
# still there. Do not move Session 1's resources into this file.
#
# Two resources below carry "provider = temporalcloud.elevated". That is not
# decoration. Creating a custom role, and attaching one to a principal, are
# Account Owner permissions — your Global Admin cannot do either. A shared
# service account holds that delegation and those two resources run as it;
# everything else in labs/ still runs as you. See providers.tf for why the
# workshop does not simply grant you the permission instead.

# The control-plane access a Worker needs, which is very nearly none.
# A Worker polls a task queue and completes tasks; it never calls the Cloud Ops
# API to do its job. So this grants ONE action, on ONE namespace, by id.
# No allow_all, and no account-scoped grant — a Worker does not enumerate the
# account it runs in.
resource "temporalcloud_custom_role" "worker" {
  # Creating a custom role is an Account Owner permission.
  provider = temporalcloud.elevated

  name        = "${customRoleName}"
  description = "Read one namespace. Nothing else."

  permissions = [
    {
      actions = ["cloud.namespace.get"]
      resources = {
        resource_type = "namespaces"
        resource_ids  = ["${namespaceId}"]
        allow_all     = false
      }
    },
  ]
}

resource "temporalcloud_service_account" "worker" {
  # Elevated too, and this one surprises people: account_access_custom_roles
  # below is cloud.customrole.ASSIGN, which is the same restricted permission
  # as creating the role. Leave this line off and the apply fails one
  # resource later than you expect.
  provider = temporalcloud.elevated

  name = "${serviceAccountName}"

  # The FLOOR, not "developer". Every principal must carry a predefined role,
  # and custom roles cannot take permissions away — so whatever you pick here is
  # the minimum this identity will ever have. Read what "read" really covers in
  # the section below before you assume it is tight.
  account_access              = "read"
  account_access_custom_roles = [temporalcloud_custom_role.worker.id]

  # The grant that actually matters. "write" is the namespace permission that
  # lets a Worker poll task queues and complete Workflow and Activity Tasks —
  # and it is scoped per namespace, entirely separately from the account role.
  namespace_accesses = [
    {
      namespace_id = temporalcloud_namespace.lab.id
      permission   = "write"
    }
  ]
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
          'entirely separately from the account role.',
      },
      {
        label: 'As the Worker: find the floor — the two things it should not be able to do',
        command:
          'temporal cloud user list --api-key $WORKER_API_KEY\ntemporal cloud namespace list --api-key $WORKER_API_KEY',
        expect:
          '**Both succeed, and that is the lesson.** The predefined `read` role already grants GetUsers ' +
          'and ListNamespaces across the whole account, and every principal must carry a predefined ' +
          'role. Custom Roles are additive, so nothing you wrote could take those away. The identity ' +
          'your Worker runs as can enumerate every colleague and every namespace in the account — ' +
          'not because you granted it, but because `read` is the floor and the floor is not that low. ' +
          'Check it yourself in the account-level role table (linked below) before you design around it.',
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
        label: 'Hand the Worker its own credential',
        command: `cat > worker/.env <<EOF\nTEMPORAL_ADDRESS=${namespaceId}.tmprl.cloud:7233\nTEMPORAL_NAMESPACE=${namespaceId}\nTEMPORAL_API_KEY=$(terraform output -raw worker_api_key)\nEOF\n\ncd worker && dotnet run -- worker`,
        expect:
          'The Worker starts and polls, now authenticating as the service account rather than as you — ' +
          'which is how it should run from Session 3 onward. Run this from `labs/`, where you ran ' +
          'Terraform. **It replaces `labs/worker/.env`**; those three lines are everything the Worker ' +
          'reads. Note the file is gitignored and the key is a real credential: it is the one thing ' +
          'here worth treating like a secret.',
      },
    ],
    }),

  checkpoints: [
    {
      id: 'custom-role-exists',
      title: 'Custom role exists',
      detail: 'A custom role with your assigned name is present in the account.',
    },
    {
      id: 'custom-role-scoped',
      title: 'Custom role is scoped to one namespace, and nothing wider',
      detail:
        `Grants ${REQUIRED_ACTION} against your namespace id specifically, and carries no ` +
        '`allow_all` permission at all. A Worker reads the namespace it runs in; it has no business ' +
        'enumerating the account, and a role that grants everything to everything is a predefined ' +
        'role with extra steps.',
    },
    {
      id: 'service-account-exists',
      title: 'Worker service account exists',
      detail: 'A service account with your assigned name is present and active.',
    },
    {
      id: 'service-account-least-privilege',
      title: 'Built from the floor up',
      detail:
        'The predefined role must be `read` (or lower) and the custom role must be attached. Custom ' +
        'roles are additive, so a `developer` base means the custom role narrows nothing.',
    },
    {
      id: 'service-account-namespace-scoped',
      title: 'Namespace access granted explicitly',
      detail:
        'The service account holds an explicit permission on your namespace, separate from its account ' +
        'role. This is the grant a Worker actually runs on — `write` is what permits polling task ' +
        'queues and completing tasks.',
    },
    {
      id: 'service-account-api-key',
      title: 'API key owned by the service account',
      detail: 'At least one API key whose owner is the service account, not a person.',
    },
  ],

  async grade(ctx) {
    const ns = await ctx.labNamespace();
    if (!ns) {
      return ctx.blockedAll(`No namespace named "${ctx.namespaceName}" — complete Session 1 first.`);
    }

    const [serviceAccounts, apiKeys, customRoles] = await Promise.all([
      ctx.serviceAccounts(),
      ctx.apiKeys(),
      ctx.customRoles(),
    ]);

    // Namespace access maps are keyed by namespace id (`name.account`), but be
    // lenient and match the bare name too.
    const matchesNamespace = (key: string) =>
      key === ns.namespace || key === ctx.namespaceName || key.startsWith(`${ctx.namespaceName}.`);

    /* -- Custom role ---------------------------------------------------- */
    const role = customRoles.find((r) => r.spec?.name === ctx.customRoleName);
    const scopedGrant = role?.spec?.permissions?.find(
      (p) =>
        (p.actions ?? []).includes(REQUIRED_ACTION) &&
        !p.resources?.allow_all &&
        (p.resources?.resource_ids ?? []).some(matchesNamespace),
    );
    // A Worker has no reason to enumerate the account, so one allow_all
    // anywhere in the role fails it — including the account-scoped
    // cloud.namespace.list grant this lab used to hand out by default.
    const wideGrant = (role?.spec?.permissions ?? []).find((p) => p.resources?.allow_all);

    const roleResults = role
      ? [
          ctx.mk('custom-role-exists', 'pass', `Found "${role.spec?.name}" (${role.state}).`),
          ctx.check(
            'custom-role-scoped',
            scopedGrant !== undefined && wideGrant === undefined,
            `Grants ${REQUIRED_ACTION} on ${scopedGrant?.resources?.resource_ids?.join(', ')}, and nothing account-wide.`,
            wideGrant
              ? `Grants ${wideGrant.actions?.join(', ')} with allow_all on ${wideGrant.resources?.resource_type}. ` +
                'Drop it — a Worker reads its own namespace by id and never enumerates the account.'
              : `No permission granting ${REQUIRED_ACTION} scoped to your namespace id.`,
          ),
        ]
      : [
          ctx.mk('custom-role-exists', 'fail', `No custom role named "${ctx.customRoleName}".`),
          ctx.mk('custom-role-scoped', 'blocked', 'Waiting on the custom role.'),
        ];

    /* -- Service account ------------------------------------------------ */
    const sa = serviceAccounts.find((s) => s.spec?.name === ctx.serviceAccountName);

    const saResults = !sa
      ? [
          ctx.mk('service-account-exists', 'fail', `No service account named "${ctx.serviceAccountName}".`),
          ctx.mk('service-account-least-privilege', 'blocked', 'Waiting on the service account.'),
          ctx.mk('service-account-namespace-scoped', 'blocked', 'Waiting on the service account.'),
          ctx.mk('service-account-api-key', 'blocked', 'Waiting on the service account.'),
        ]
      : (() => {
          const accountRole = accountRoleOf(sa);
          const attachedRoles = sa.spec?.access?.account_access?.custom_roles ?? [];
          const hasCustomRole = role ? attachedRoles.includes(role.id) : attachedRoles.length > 0;
          const overPrivileged = accountRole !== undefined && OVER_PRIVILEGED.has(accountRole);

          const nsAccesses = protoMap(sa.spec?.access?.namespace_accesses);
          const scoped = Object.entries(nsAccesses).find(([key]) => matchesNamespace(key));
          const owned = apiKeys.filter((k) => k.spec?.owner_id === sa.id);

          return [
            ctx.mk('service-account-exists', 'pass', `Found ${sa.spec?.name} (${sa.state}).`),
            ctx.check(
              'service-account-least-privilege',
              !overPrivileged && hasCustomRole,
              `Predefined role ${accountRole} with the custom role attached — built from the floor up.`,
              overPrivileged
                ? `Predefined role is ${accountRole}. Custom roles are additive, so this grants everything ` +
                  `${accountRole} grants regardless of how narrow your custom role is. Start at read.`
                : `Predefined role is ${accountRole}, but no custom role is attached — this identity ` +
                  'cannot do its job. Attach the custom role rather than raising the predefined one.',
            ),
            ctx.check(
              'service-account-namespace-scoped',
              scoped !== undefined,
              `Holds ${scoped?.[1]?.permission} on ${scoped?.[0]}.`,
              'No explicit permission on your namespace.',
            ),
            ctx.check(
              'service-account-api-key',
              owned.length > 0,
              `${owned.length} API key(s) owned by the service account.`,
              'No API key owned by the service account — owner_type "service-account" is what makes it outlive you.',
            ),
          ];
        })();

    return [...roleResults, ...saResults];
  },
};
