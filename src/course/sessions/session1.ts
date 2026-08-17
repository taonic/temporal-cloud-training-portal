import { namespaceRegion, namespaceTags } from '@/cloud/ops';
import type { SessionDef } from '../types';

/**
 * Session 1 — Foundations & Control Plane.
 *
 * Lab only: the teaching content is delivered live. Four of the five
 * checkpoints are objective; the provenance one cannot be, and says so.
 */
export const session1: SessionDef = {
  number: 1,
  title: 'Foundations & Control Plane',
  outcome: 'Namespaces provisioned via IaC.',
  exitCheck: 'Namespaces exist in IaC; region set to Azure Australia East.',
  labTitle: 'Provision a namespace with Terraform',
  labMinutes: 15,

  note:
    '**Everything in this workshop runs in the browser sandbox — open it now and keep it open for ' +
    'the next two days.** Terraform, the Temporal CLI and its `cloud` extension, Python with `uv` ' +
    'and Docker are ' +
    'all installed there at the right versions, and every command on this page and on Sessions 2 to ' +
    '6 is typed in its **Terminal** tab, with files edited in its **Editor** tab. Your laptop needs ' +
    'nothing installed on it and nothing you run locally is graded. The sandbox is also where your ' +
    'credentials live, so work that you do somewhere else does not carry over.',
  noteLink: {
    label: 'Open the workshop sandbox',
    url: 'https://play.instruqt.com/temporal/invite/rjmcyqr5pc2z',
  },

  /**
   * Setup lives in the lab, not in a Prerequisites block above it.
   *
   * It used to be both: the block described `workshop-creds` and `workshop-check`
   * with the student's real address filled in, and then steps 2 and 3 described
   * the same two commands again in prose with a pointer to a third copy further
   * down the page. Three renderings of one instruction is how a student ends up
   * reading none of them. `labCommands` gets the SnippetContext, so the one
   * remaining copy is the one with their own namespace already substituted —
   * which is the whole reason the values were up in the prerequisites.
   */
  labCommands: ({ namespaceName, namespaceId, accountId }) => {
    const address = `${namespaceId}.tmprl.cloud:7233`;
    return [
      {
        label: 'In the sandbox Terminal, see what it gives you',
        command: 'workshop-help',
        expect:
          'The list of `workshop-*` helper commands, which the sessions refer to by name. ' +
          '`terraform init` and `uv sync` have already run, so the toolchain is warm — ' +
          'nothing here is waiting on a download.',
      },
      {
        label: 'Create an API Key for yourself in the Cloud UI — Settings → API Keys',
        expect:
          `Name it \`${namespaceName}-admin\` — the key list is account-wide, so a name that ` +
          'identifies you is what makes yours findable among two dozen others. **That list is ' +
          'everyone\'s keys, and you are a Global Admin: do not delete a key that is not yours.** ' +
          'Deleting someone else\'s ends their workshop, and one of the keys in there belongs to ' +
          'the identity this portal grades with — deleting that one ends everybody\'s. Your own ' +
          'key is shown **once**, with no way to read it back: copy it into your password manager ' +
          'before you leave the page. Everything you do for the next two days authenticates with ' +
          'it, and the only recovery is creating another one.',
        grades: 'api-key-created',
      },
      {
        label: 'Tell the sandbox who you are — three values, two already filled in below',
        command:
          `workshop-creds ${address} ${namespaceId} <YOUR-API-KEY>\n` +
          'source ~/.workshop-env\n' +
          '\n' +
          '# address    the namespace id + .tmprl.cloud:7233\n' +
          `# namespace  ${namespaceId} — the .${accountId} account suffix is PART OF THE NAME.\n` +
          '#            Dropping it fails with an authorization error that reads exactly\n' +
          '#            like a bad key, and is the most common way to lose ten minutes here.\n' +
          '# api key    the one you just created. Run `workshop-creds` bare to be prompted\n' +
          '#            for all three instead — the key is not echoed.',
        expect:
          'Four variables written to the two places that read them: your shell ' +
          '(`TEMPORAL_API_KEY` for both CLIs, `TEMPORAL_CLOUD_API_KEY` for the Terraform ' +
          'provider — two names, one key) and `labs/worker/.env` for the Python worker. It writes a ' +
          'file rather than exporting into one shell on purpose: later labs run three or four ' +
          'terminals at once, and a value set in only one of them is a confusing way to lose an ' +
          'afternoon.',
      },
      {
        label: 'Prove the setup before you write any Terraform',
        command: 'workshop-check',
        expect:
          'Tools, outbound gRPC on 7233 and the Cloud Ops API all green. **Your namespace will ' +
          'show a `warn` saying it does not exist yet — that is correct at this point**, because ' +
          'the `terraform apply` below is what creates it. Everything else should be green now; ' +
          're-run this after the apply and that line goes green too. Green here means a later ' +
          'failure is your Terraform, not your setup.',
      },
      {
        label: 'Go to the Terraform workspace',
        command: 'labs',
        expect:
          '`/workspace/workshop/labs`. `terraform init` is done and the provider and version pin ' +
          'are already set up — you write the resources.',
      },
      {
        label: 'Write the resources — this configuration goes into labs/lab1.tf',
        snippet: true,
        expect:
          'A file with two resources and one output. Type it rather than pasting it if you have ' +
          'the time; the arguments are the lesson.',
      },
      {
        label: 'Read the plan before you change anything',
        command: 'terraform plan',
        expect:
          'Two resources to add and one output. Read it — an unread plan is the habit this session ' +
          'is trying to build against, and it is the last point at which a wrong region costs you ' +
          'nothing.',
      },
      {
        label: 'Create the namespace',
        command: 'terraform apply',
        expect:
          'Apply completes and the `namespace_endpoint` output prints. Provisioning takes a few ' +
          'seconds longer than the apply does.',
        grades: 'namespace-exists',
      },
      {
        label: 'Hit "Re-check" below',
        expect:
          'Every objective checkpoint green within a few seconds of the apply completing. If the ' +
          'region or retention check is red, fix the argument in `labs/lab1.tf` and apply again.',
      },
    ];
  },

  references: [
    {
      source: 'Terraform provider docs',
      placement: 'lab',
      links: [
        {
          label: 'temporalcloud_namespace',
          url: 'https://registry.terraform.io/providers/temporalio/temporalcloud/latest/docs/resources/namespace',
          note: 'Every argument the lab sets, plus the ones it does not — regions, retention, auth, delete protection.',
        },
        {
          label: 'temporalcloud_namespace_tags',
          url: 'https://registry.terraform.io/providers/temporalio/temporalcloud/latest/docs/resources/namespace_tags',
          note: 'Read the first line: it manages the COMPLETE tag set, which is why there is only ever one of these blocks.',
        },
        {
          label: 'Managing Temporal Cloud with Terraform',
          url: 'https://docs.temporal.io/cloud/terraform-provider',
          note: 'Provider setup and the wider resource catalogue.',
        },
      ],
    },
    {
      source: 'Temporal CLI',
      links: [
        {
          label: 'temporal cloud namespace',
          url: 'https://docs.temporal.io/cli/command-reference/cloud/namespace',
          note: 'The `list` / `get` commands in the section below, and every flag they take.',
        },
        {
          label: 'Using the CLI with Temporal Cloud',
          url: 'https://docs.temporal.io/cli/cloud',
          note: 'How --address, --namespace and --api-key fit together. Worth reading once properly.',
        },
      ],
    },
    {
      source: 'Temporal Cloud',
      links: [
        {
          label: 'Namespaces',
          url: 'https://docs.temporal.io/cloud/namespaces',
          note: 'Naming rules (39 chars, lowercase), the namespace id format, and the two endpoint types.',
        },
        {
          label: 'API keys',
          url: 'https://docs.temporal.io/cloud/api-keys',
          note: 'What you create in step 1, and why a namespace must be created with API key auth to accept one.',
        },
        {
          label: 'System limits',
          url: 'https://docs.temporal.io/cloud/limits',
          note: 'The 10-namespace default that makes your name matter.',
        },
      ],
    },
  ],

  snippetLang: 'hcl',
  snippet: ({ namespaceName, region }) => `# Goes in labs/lab1.tf.
#
# The terraform block, provider and API-key variable already live in labs/ —
# versions.tf and providers.tf. Declaring them again here is a
# duplicate-declaration error, so this file holds resources only.

resource "temporalcloud_namespace" "lab" {
  name           = "${namespaceName}"
  regions        = ["${region}"]
  retention_days = 7
  api_key_auth   = true
}

resource "temporalcloud_namespace_tags" "lab" {
  namespace_id = temporalcloud_namespace.lab.id

  tags = {
    "provisioner" = "terraform"
  }
}

output "namespace_endpoint" {
  value = temporalcloud_namespace.lab.endpoints
}`,

  use: ({ namespaceName, namespaceId }) => ({
    intro:
      'A namespace that exists is a row in a database. Prove yours is a running service you can ' +
      'reach. These are not graded — nothing you type in your terminal is visible to the Cloud Ops ' +
      'API — so check your own output against what each step says you should see.',
    steps: [
      {
        label: 'Read the namespaces created by you and other trainees',
        command: `temporal cloud namespace list`,
        expect: `Your namespace ${namespaceName} in the list, alongside everyone else's. Same GetNamespaces call the grader above makes.`,
      },
      {
        label: 'Inspect its configuration',
        command: `temporal cloud namespace get -n ${namespaceId}`,
        expect: 'Region, retention days and auth method — the three things Terraform just set.',
      },
      {
        label: 'Now leave the control plane and talk to the namespace itself',
        command: `temporal workflow list \\\n  --address ${namespaceId}.tmprl.cloud:7233 \\\n  --namespace ${namespaceId} \\\n  --api-key $TEMPORAL_API_KEY`,
        expect:
          'An empty list, and no error. Empty is the point: the namespace is live and authenticating you. ' +
          'A permission error here means the namespace was created without API key auth.',
      },
    ],
    stretch: {
      title: 'Stretch: actually run something',
      body:
        'The starter worker in labs/worker is a Python worker and a one-activity workflow. It reads ' +
        '`labs/worker/.env`, which `workshop-creds` already wrote in the lab, so there is nothing ' +
        'to configure — run it and it is pointed at your namespace. That is the difference between ' +
        '"provisioned" and "working". Note the worker must be running before you start the ' +
        'workflow; with no worker polling, the workflow sits in schedule-to-start and goes ' +
        'nowhere, which is itself worth seeing once. Every mode also runs against a local dev ' +
        'server (`dev-server-up`, then `uv run main.py worker --local`), which needs no Cloud ' +
        'credentials at all — `dev-server-down` stops it.',
      command: `cd labs/worker\n\nuv run main.py worker      # terminal 1\nuv run main.py start       # terminal 2`,
      link: {
        label: `Watch it land in the Cloud UI — Workflows in ${namespaceId}`,
        url: `https://cloud.temporal.io/namespaces/${namespaceId}/workflows`,
      },
    },
  }),

  checkpoints: [
    {
      id: 'namespace-exists',
      title: 'Namespace exists',
      detail: 'A namespace with your assigned name is present and active in the training account.',
    },
    {
      id: 'region-correct',
      title: 'Region is Azure Australia East',
      detail: 'The namespace is hosted in the region the exit check requires.',
    },
    {
      id: 'retention-correct',
      title: 'Retention set to 7 days',
      detail: 'Event History retention is explicitly configured rather than left at the default.',
    },
    {
      id: 'provisioned-by-terraform',
      title: 'Tagged provisioner=terraform',
      detail:
        'The namespace carries a `provisioner` tag set to `terraform`. Note what this does and does ' +
        'not say: the Cloud Ops API records no provenance, so nothing can prove Terraform created ' +
        'the namespace. The tag is a label you apply and the grader verifies the label — which is ' +
        'exactly how the tag-based attestations in Sessions 3, 5 and 6 work.',
    },
    {
      id: 'api-key-created',
      title: 'You created an API Key',
      detail: 'At least one API Key owned by your user exists in the account.',
    },
    {
      id: 'workflow-completed',
      title: 'A workflow completed in your namespace',
      detail:
        'The stretch goal. "The namespace exists" is a control-plane fact; a completed workflow is ' +
        'proof it is a running service you can reach. Optional — it does not count against the session.',
      optional: true,
    },
  ],

  async grade(ctx) {
    const ns = await ctx.labNamespace();

    if (!ns) {
      return [
        ctx.mk('namespace-exists', 'fail', `No namespace named "${ctx.namespaceName}" in the account.`),
        ctx.mk('region-correct', 'blocked', 'Waiting on the namespace.'),
        ctx.mk('retention-correct', 'blocked', 'Waiting on the namespace.'),
        ctx.mk('provisioned-by-terraform', 'blocked', 'Waiting on the namespace.'),
        ...(await gradeApiKey(ctx)),
      ];
    }

    const region = namespaceRegion(ns);
    const retention = ns.spec?.retention_days;
    const provisioner = (namespaceTags(ns).provisioner ?? '').trim().toLowerCase();

    return [
      ctx.mk('namespace-exists', 'pass', `Found ${ns.namespace} (${ns.state}).`),
      ctx.check(
        'region-correct',
        region === ctx.requiredRegion,
        `Region is ${region}.`,
        `Region is ${region ?? 'unknown'}, expected ${ctx.requiredRegion}.`,
      ),
      ctx.check(
        'retention-correct',
        retention === 7,
        'Retention is 7 days.',
        `Retention is ${retention ?? 'unset'} days, expected 7.`,
      ),
      ctx.check(
        'provisioned-by-terraform',
        provisioner === 'terraform',
        'Tagged provisioner=terraform.',
        provisioner
          ? `provisioner tag is "${provisioner}", expected "terraform".`
          : 'No provisioner tag on the namespace.',
      ),
      ...(await gradeApiKey(ctx)),
    ];
  },
};

async function gradeApiKey(ctx: Parameters<SessionDef['grade']>[0]) {
  const user = await ctx.cloudUser();
  const keyResult = !user
    ? ctx.mk(
        'api-key-created',
        'blocked',
        `No Cloud user found for ${ctx.email} — has the invitation been accepted?`,
      )
    : ctx.check(
        'api-key-created',
        (await ctx.apiKeys()).filter((k) => k.spec?.owner_id === user.id).length > 0,
        `API key(s) owned by your user.`,
        'No API keys owned by your user yet.',
      );

  return [keyResult, await gradeStretchWorkflow(ctx)];
}

/**
 * The stretch goal, graded through the data plane. Marked optional, so skipping
 * it leaves the session's verified count intact.
 */
async function gradeStretchWorkflow(ctx: Parameters<SessionDef['grade']>[0]) {
  const reader = await ctx.dataPlane();
  if (!reader) {
    return ctx.mk(
      'workflow-completed',
      'blocked',
      'Namespace not reachable yet — it may still be provisioning.',
    );
  }

  try {
    const count = await reader.countWorkflows('ExecutionStatus = "Completed"');
    return ctx.check(
      'workflow-completed',
      count > 0,
      `${count} completed workflow execution(s).`,
      'No completed workflows yet — run labs/worker against your namespace.',
    );
  } catch (err) {
    return ctx.mk(
      'workflow-completed',
      'blocked',
      `Could not query your namespace: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
