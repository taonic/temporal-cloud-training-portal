import {
  LAB_BUILD_ID_V1,
  LAB_BUILD_ID_V2,
  LAB_DEPLOYMENT_NAME,
  LAB_TASK_QUEUE,
} from '../naming';
import type { SessionDef } from '../types';

/**
 * Session 3 — Worker Config, Versioning & Bug-fix Rollouts.
 *
 * Graded through the *data plane*, not the Cloud Ops API: worker deployments,
 * build IDs and task queues have no control-plane representation at all.
 *
 * Teaches Worker Deployments (`DeploymentOptions` + `WorkerDeploymentVersion`),
 * not Build ID compatibility sets — the latter are deprecated in every SDK and
 * never reached GA. Worker Deployments are themselves still public preview.
 *
 * Runs in the student's sandbox against their own Cloud namespace. KEDA is the one
 * part that genuinely needs Kubernetes, so it is an instructor demo.
 */
export const session3: SessionDef = {
  number: 3,
  title: 'Worker Config, Versioning & Bug-fix Rollouts',
  outcome: 'A safe rollout and rollback performed by hand, so the runbook is written from experience.',
  exitCheck:
    'Per-workload task-queue naming, autoscaling policy, versioning strategy, and bug-fix rollout runbook documented.',
  labTitle: 'Roll a new Worker version out, and drain the old one',
  labMinutes: 15,
  needsWorker: true,

  note:
    'Sandbox-scale: two worker processes in your sandbox against your own Cloud namespace. That is ' +
    'enough to create a real Worker Deployment with two versions and shift traffic between them — ' +
    'KEDA is the only part that needs a cluster, and you will watch that rather than run it.',

  // Every `temporal` command carries its own --address/--namespace/--api-key.
  // The lab runs three terminals, and exports do not cross terminals — an
  // ambient credential here would fail in exactly the terminal a student
  // opened last. The dotnet workers need none of it: they read labs/worker/.env.
  labCommands: ({ namespaceId }) => {
    const conn = `\\\n  --address ${namespaceId}.tmprl.cloud:7233 \\\n  --namespace ${namespaceId} \\\n  --api-key $TEMPORAL_API_KEY`;
    return [
      {
        label: `Terminal 1 — run the v${LAB_BUILD_ID_V1} worker`,
        command: `cd labs/worker\ndotnet run -- worker --version ${LAB_BUILD_ID_V1}`,
        expect: `\`Polling '${LAB_TASK_QUEUE}'\`. Setting DeploymentOptions is what makes the server register a Worker Deployment — an unversioned worker registers nothing at all, and this checkpoint then fails in a way that looks identical to the feature being unavailable.`,
        grades: 'deployment-exists',
      },
      {
        label: 'Terminal 2 — give it some work',
        command: 'cd labs/worker\ndotnet run -- start',
        expect: 'The workflow completes on v1. Run it a few times so there is something in flight later.',
      },
      {
        label: `Terminal 3 — run the v${LAB_BUILD_ID_V2} worker alongside it`,
        command: `cd labs/worker\ndotnet run -- worker --version ${LAB_BUILD_ID_V2}`,
        expect: `Both versions are now polling and neither is current. Registering a version routes nothing to it — that separation is the whole lab.`,
        grades: 'two-versions',
      },
      {
        label: `Move new traffic to v${LAB_BUILD_ID_V2}`,
        command: `temporal worker deployment set-current-version ${conn} \\\n  --deployment-name ${LAB_DEPLOYMENT_NAME} --build-id ${LAB_BUILD_ID_V2}`,
        expect: `New executions route to v${LAB_BUILD_ID_V2}. Workflows already running with Pinned behaviour finish on v${LAB_BUILD_ID_V1} — check with \`temporal workflow list\` that the old ones are still completing. That is pinning doing its job, not a stuck rollout.`,
        grades: 'current-version-moved',
      },
      {
        label: `Stop the v${LAB_BUILD_ID_V1} worker, then watch it drain`,
        command: `temporal worker deployment describe --name ${LAB_DEPLOYMENT_NAME} ${conn}`,
        expect: `v${LAB_BUILD_ID_V1} reports no pollers and moves toward drained. Draining is not instant — it waits for pinned executions to finish, which is exactly why you cannot delete a version on a whim.`,
      },
      {
        label: 'Write down the rollback step you would run if v2 turned out to be bad',
        expect:
          'No command for this one — that is the point. You need it in the chaos lab, and the stretch ' +
          'goal below shows you why writing it from memory afterwards is a bad idea.',
      },
    ];
  },

  // Reference, not instructions: the part of this lab that is neither a command
  // nor Terraform. Students come back to this when the deployment does not appear.
  snippet: () => `// What makes the deployment exist at all — labs/worker/Program.cs

var options = new TemporalWorkerOptions("${LAB_TASK_QUEUE}")
{
    DeploymentOptions = new WorkerDeploymentOptions(
        new WorkerDeploymentVersion("${LAB_DEPLOYMENT_NAME}", "${LAB_BUILD_ID_V1}"),
        useWorkerVersioning: true)
    {
        DefaultVersioningBehavior = VersioningBehavior.Pinned,
    },
};

// Pinned    — an execution finishes on the version it started on.
// AutoUpgrade — it moves to the current version at its next task. Fine for
//              short workflows, dangerous for long ones that would replay
//              across a code change.
//
// The behaviour is set on the WORKER, not as [Workflow(VersioningBehavior = ...)]
// on the class. A workflow that declares a behaviour while its worker is
// UNVERSIONED is rejected by the server, and the workflow task then retries
// forever — the execution hangs rather than fails. Setting it here keeps the
// same workflow code usable by the unversioned workers in Sessions 1, 4, 5 and 6.`,

  use: ({ namespaceId }) => ({
    intro:
      'The lab already moved traffic to v2. These are the reads that show you what happened — the ' +
      'same calls the exit check makes, run by hand. Worker Deployments are invisible to the Cloud ' +
      'Ops API and to the Terraform provider; they exist only inside your namespace.',
    steps: [
      {
        label: 'See the deployment your versioned worker created',
        command: `temporal worker deployment list \\\n  --address ${namespaceId}.tmprl.cloud:7233 \\\n  --namespace ${namespaceId} \\\n  --api-key $TEMPORAL_API_KEY`,
        expect: `A deployment named ${LAB_DEPLOYMENT_NAME}. If it is missing, your worker is unversioned — DeploymentOptions is what registers it.`,
      },
      {
        label: 'Inspect its versions and routing',
        command: `temporal worker deployment describe --name ${LAB_DEPLOYMENT_NAME} \\\n  --address ${namespaceId}.tmprl.cloud:7233 \\\n  --namespace ${namespaceId} \\\n  --api-key $TEMPORAL_API_KEY`,
        expect: `Both ${LAB_BUILD_ID_V1} and ${LAB_BUILD_ID_V2}, with the current version and each version's drainage status.`,
      },
      {
        label: 'Watch v1 drain after you stop its worker',
        command: `temporal worker deployment describe --name ${LAB_DEPLOYMENT_NAME} \\\n  --address ${namespaceId}.tmprl.cloud:7233 \\\n  --namespace ${namespaceId} \\\n  --api-key $TEMPORAL_API_KEY`,
        expect:
          'v1 reports no pollers and moves toward drained. Draining is not instant — it waits for ' +
          'pinned executions to finish, which is exactly why you cannot delete a version on a whim.',
      },
    ],
    stretch: {
      title: 'Stretch: the rollback',
      body:
        'Set the current version back to v1 with the v1 worker stopped. New workflows have nowhere ' +
        'to run and pile up in the task queue. That is what a bad rollback looks like from the ' +
        'inside, and it is worth seeing before you write the runbook step that says "roll back".',
    },
  }),

  checkpoints: [
    {
      id: 'deployment-exists',
      title: 'Worker Deployment registered',
      detail: `A deployment named ${LAB_DEPLOYMENT_NAME} exists in your namespace. Only a versioned worker creates one.`,
    },
    {
      id: 'two-versions',
      title: 'Two versions tracked',
      detail: `Both ${LAB_BUILD_ID_V1} and ${LAB_BUILD_ID_V2} are present — you cannot practise a rollout with one.`,
    },
    {
      id: 'current-version-moved',
      title: `Traffic moved to v${LAB_BUILD_ID_V2}`,
      detail: 'The deployment’s current version is v2, so new executions route there.',
    },
  ],

  async grade(ctx) {
    const ns = await ctx.labNamespace();
    if (!ns) {
      return ctx.blockedAll(`No namespace named "${ctx.namespaceName}" — complete Session 1 first.`);
    }

    const reader = await ctx.dataPlane();
    if (!reader) {
      return [
        ctx.mk(
          'deployment-exists',
          'blocked',
          'Cannot reach your namespace. It may still be provisioning, or it was created without API key authentication.',
        ),
        ctx.mk('two-versions', 'blocked', 'Waiting on the namespace connection.'),
        ctx.mk('current-version-moved', 'blocked', 'Waiting on the namespace connection.'),
      ];
    }

    const deployment = await reader.workerDeployment(LAB_DEPLOYMENT_NAME);

    if (!deployment) {
      return [
        ctx.mk(
          'deployment-exists',
          'fail',
          `No deployment named ${LAB_DEPLOYMENT_NAME}. Run a worker with DeploymentOptions set — an unversioned worker registers nothing.`,
        ),
        ctx.mk('two-versions', 'blocked', 'Waiting on the deployment.'),
        ctx.mk('current-version-moved', 'blocked', 'Waiting on the deployment.'),
      ];
    }

    const hasV1 = deployment.versions.some((v) => v.includes(LAB_BUILD_ID_V1));
    const hasV2 = deployment.versions.some((v) => v.includes(LAB_BUILD_ID_V2));

    return [
      ctx.mk('deployment-exists', 'pass', `Found ${deployment.name}.`),
      ctx.check(
        'two-versions',
        hasV1 && hasV2,
        `Tracking ${deployment.versions.join(', ')}.`,
        `Only ${deployment.versions.join(', ') || 'no'} version(s) tracked; expected both ${LAB_BUILD_ID_V1} and ${LAB_BUILD_ID_V2}.`,
      ),
      ctx.check(
        'current-version-moved',
        (deployment.currentBuildId ?? '').includes(LAB_BUILD_ID_V2),
        `Current version is ${deployment.currentBuildId}.`,
        deployment.currentBuildId
          ? `Current version is ${deployment.currentBuildId}; expected ${LAB_BUILD_ID_V2}.`
          : 'No current version set — nothing is routed by version yet. Run `temporal worker '
            + 'deployment set-current-version` — starting a v2 worker registers the version but '
            + 'routes nothing to it.',
      ),
    ];
  },
};
