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
  needsWorker: true,

  prerequisites: (ctx) => [
    {
      name: 'Run workshop-creds first — nothing works before it',
      why:
        'The sandbox does not know who you are. It needs three values, and two of them are yours ' +
        `alone. **Address** — \`${ctx.namespaceId}.tmprl.cloud:7233\`. **Namespace** — ` +
        `\`${ctx.namespaceId}\`, where the \`.${ctx.accountId}\` account suffix is part of the name; ` +
        'dropping it fails with an authorization error that reads exactly like a bad key, and is the ' +
        'most common way to lose ten minutes here. **API key** — the one you create in step 1 below, ' +
        'shown once and never again. Paste the command below with your key in place of the ' +
        'placeholder, or run `workshop-creds` with no arguments to be prompted for all three (the ' +
        'key is not echoed). From those it writes four variables to the two places that read them: ' +
        'your shell (`TEMPORAL_API_KEY` for both CLIs, `TEMPORAL_CLOUD_API_KEY` for the Terraform ' +
        'provider — two names, one key) and `labs/worker/.env` for the C# worker.',
      install:
        `workshop-creds ${ctx.namespaceId}.tmprl.cloud:7233 ${ctx.namespaceId} <YOUR-API-KEY>\n` +
        'source ~/.workshop-env',
    },
    {
      name: 'Then workshop-check — before you write any Terraform',
      why: 'Probes the tools, the outbound gRPC on 7233 that every lab depends on, and whether your key reaches the Cloud Ops API. Green here means a failure later is your Terraform, not your setup. Expect one `warn`: your namespace does not exist yet, because `terraform apply` is what creates it. That line turns green when you re-run this after the lab; everything else should be green now.',
      install: 'workshop-check',
    },
    {
      name: 'Everything else is already installed',
      why: 'The Temporal CLI and its `cloud` extension, Terraform, .NET 8 and Docker are all in the sandbox at the right version, and `terraform init` and `dotnet build` have already run. Work in the Terminal and Editor tabs — not on your laptop, which needs nothing installed on it. `workshop-help` reprints the command list.',
      install: 'workshop-help',
    },
  ],

  labSteps: [
    'Create an API Key for yourself in the Cloud UI (Settings → API Keys). **Copy it into your password manager now** — Temporal shows it once and there is no way to read it back. Everything you do for the next two days authenticates with this key.',
    'In the sandbox Terminal tab, run `workshop-creds`. It asks for three values: the **address** (`<namespace>.<account>.tmprl.cloud:7233`), the **namespace** (`<namespace>.<account>` — account suffix included) and the **API key** from step 1. The Connection details block further down this page has the first two filled in with your own namespace, as a command you can paste whole. It sets `TEMPORAL_API_KEY` for the `temporal` CLIs and `TEMPORAL_CLOUD_API_KEY` for the Terraform provider — two names, one key — and writes `labs/worker/.env` for the C# worker. It writes a file rather than exporting into one shell on purpose: later labs run three or four terminals at once, and a value set in only one of them is a confusing way to lose an afternoon.',
    'Run `workshop-check`. Tools, outbound 7233 and the Cloud Ops API should all be green before you write any Terraform. **Your namespace will show a `warn` saying it does not exist yet — that is correct at this point**, because the `terraform apply` below is what creates it. Re-run `workshop-check` after the apply and that line goes green too.',
    'Run `labs` to reach `/workspace/workshop/labs`. `terraform init` is already done and the provider and version pin are set up — you write the resources.',
    'Put the configuration below into `labs/lab1.tf`, then run `terraform plan` and read it before applying.',
    'Run `terraform apply`.',
    'Hit "Re-check" below. Every objective checkpoint should go green within a few seconds of apply completing.',
  ],

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
        'The starter worker in labs/worker is a C# worker and a one-activity workflow. Point it at ' +
        'your namespace and run it — that is the difference between "provisioned" and "working". ' +
        'Note the worker must be running before you start the workflow; with no worker polling, the ' +
        'workflow sits in schedule-to-start and goes nowhere, which is itself worth seeing once.',
      command: `cd labs/worker\n\ndotnet run -- worker      # terminal 1\ndotnet run -- start       # terminal 2 \n# now run temporal workflow list command above or UI to see the workflow complete`,
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
