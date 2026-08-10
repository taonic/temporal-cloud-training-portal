import { namespaceTags } from '@/cloud/ops';
import { LAB_TASK_QUEUE } from '../naming';
import type { SessionDef } from '../types';

/**
 * Session 6 — Troubleshooting Chaos Lab.
 *
 * Every checkpoint here asserts the RECOVERED state, never the broken one.
 * "Your workflow is currently stuck" is true for about thirty seconds and racy
 * to grade; "your workflow reached Completed after being stuck" is stable, and
 * recovering is the actual learning objective anyway.
 *
 * The consequence, stated plainly on the page: the grader cannot prove a
 * student broke anything before fixing it. Drill 2 in particular verifies that
 * workers are polling, which is also true of someone who never stopped them.
 * That is the honour system and the UI says so.
 *
 * Drill 3 (break the encryption proxy) needs the Session 4 AKS deployment, so
 * it is an instructor demo rather than a student drill.
 */
const DRILL_1_PREFIX = 'chaos-1';
const DRILL_4_PREFIX = 'chaos-4';

export const session6: SessionDef = {
  number: 6,
  title: 'Troubleshooting Chaos Lab',
  outcome: 'The top failure modes run by hand, so the runbooks are written from memory rather than imagination.',
  exitCheck: 'Three runbooks drafted; escalation path memorised.',
  labTitle: 'Break it on purpose, three times',
  labMinutes: 15,
  needsWorker: true,

  note:
    'These checks grade the recovery, not the breakage — a completed workflow is stable to observe, ' +
    'a stuck one is not. That means the grader cannot prove you broke anything first. Drill 2 in ' +
    'particular passes for someone who never stopped their workers. It is on you; the point is the ' +
    'runbook you write afterwards, not the green tick.',

  labSteps: [
    `Drill 1 — non-determinism. Start a workflow with id ${DRILL_1_PREFIX}-<yourname> on the v1 worker, then restart the worker with \`dotnet run -- worker --break-determinism\`. The workflow task starts failing on replay; the execution is stuck, not failed, and nothing alerts. Find it, then restart the worker unmodified and watch it complete.`,
    `Drill 2 — no workers. Start a workflow, then kill every worker. Watch schedule-to-start grow in the CLI. Nothing is lost. Bring the worker back and let it finish.`,
    `Drill 4 — stuck Activity. Run \`dotnet run -- chaos stuck\`, which starts ${DRILL_4_PREFIX}-<yourname> with an Activity that heartbeats and then hangs. Use the heartbeat to tell "stuck" from "slow", then let the heartbeat timeout fire and watch the retry resume from the last reported progress.`,
    'Watch the instructor break the encryption proxy (drill 3) and note the symptom: the Cloud UI cannot decode payloads. Decide whether that is an incident or expected behaviour.',
    'Draft the three runbooks — "Workflow stuck", "Non-determinism error", "UI cannot decode payload" — in one document, and tag it below.',
  ],

  snippetLang: 'hcl',
  snippet: () => `# ADD this key to the temporalcloud_namespace_tags "lab" block in lab1.tf.
# That resource manages the COMPLETE tag set for the namespace, so declaring a
# second one here would delete every tag the earlier sessions set.
#
#   tags = {
#     ...keys from earlier sessions...
#   # The three runbooks plus your escalation matrix.
#   "session-6" = "https://your-wiki/temporal-runbooks"
#   }

# --- Escalation, worth writing down before you need it -------------------
#
#   Workflow stuck, no error         -> check pending workflow task for a
#                                       non-determinism failure; check the task
#                                       queue has pollers. Both are yours to fix.
#   UI cannot decode payload         -> expected under the encryption proxy
#                                       pattern. NOT an incident. Do not "fix"
#                                       it by adding a codec server.
#   Namespace unreachable / 5xx      -> Temporal support, Tier 0 via the CBA
#                                       agreement. Have the namespace id and a
#                                       workflow id ready.`,

  use: ({ namespaceId }) => ({
    intro:
      'These are the commands you will reach for at 3am, so run them now while nothing is actually ' +
      'wrong. Export the connection flags once and reuse them.',
    steps: [
      {
        label: 'Set up the connection once',
        command: `export T="--address ${namespaceId}.tmprl.cloud:7233 --namespace ${namespaceId} --api-key $TEMPORAL_API_KEY"`,
        expect: 'Every command below uses $T. Saves you retyping three flags under pressure.',
      },
      {
        label: 'Drill 1 — find the stuck workflow and read why',
        command: `temporal workflow describe --workflow-id ${DRILL_1_PREFIX}-<yourname> $T`,
        expect:
          'A pending workflow task with a failure, and an attempt count climbing. The status is still ' +
          'Running — Temporal is retrying the task, not failing the workflow. This is why "stuck" ' +
          'never shows up as an error rate.',
      },
      {
        label: 'Drill 2 — is anyone actually polling?',
        command: `temporal task-queue describe --task-queue ${LAB_TASK_QUEUE} $T`,
        expect:
          'With workers down: no pollers. This is the first command to run when someone says ' +
          '"Temporal is broken" — nine times in ten the answer is that nothing is polling.',
      },
      {
        label: 'Drill 4 — separate stuck from slow',
        command: `temporal workflow describe --workflow-id ${DRILL_4_PREFIX}-<yourname> $T`,
        expect:
          'The pending activity shows attempt count and last heartbeat time. A heartbeat that stopped ' +
          'advancing means stuck; one still ticking means slow. Without heartbeats you cannot tell, ' +
          'and you are forced to guess a timeout.',
      },
      {
        label: 'Confirm everything recovered',
        command: `temporal workflow list --query 'ExecutionStatus="Completed"' $T`,
        expect: 'Your chaos workflows in Completed. That is what the checkpoints below look for.',
      },
    ],
    stretch: {
      title: 'Stretch: reset instead of restart',
      body:
        'Rather than letting drill 1 recover on its own, use `temporal workflow reset` to rewind the ' +
        'execution to a point before the bad code and replay forward. This is the tool that turns a ' +
        'bad deploy from an incident into an inconvenience, and almost nobody knows it exists until ' +
        'they need it.',
    },
  }),

  checkpoints: [
    {
      id: 'drill1-recovered',
      title: 'Drill 1 — non-determinism recovered',
      detail: `A workflow whose id starts with ${DRILL_1_PREFIX} reached Completed. Verifies the recovery, not that you broke it first.`,
    },
    {
      id: 'drill2-workers-polling',
      title: 'Drill 2 — workers back on the task queue',
      detail:
        `At least one poller on ${LAB_TASK_QUEUE}. This also passes if you never stopped them — ` +
        'the grader cannot see into the past. Honour system.',
    },
    {
      id: 'drill4-recovered',
      title: 'Drill 4 — stuck Activity recovered',
      detail: `A workflow whose id starts with ${DRILL_4_PREFIX} reached Completed after its heartbeat timeout fired.`,
    },
    {
      id: 'session-6-documented',
      title: 'Runbooks and escalation path recorded',
      detail: 'Looks for a `session-6` namespace tag pointing at the three runbooks.',
      selfAttested: true,
    },
  ],

  async grade(ctx) {
    const ns = await ctx.labNamespace();
    if (!ns) {
      return ctx.blockedAll(`No namespace named "${ctx.namespaceName}" — complete Session 1 first.`);
    }

    const tag = (namespaceTags(ns)['session-6'] ?? '').trim();
    const documented = ctx.check(
      'session-6-documented',
      tag !== '',
      `Documented at ${tag}`,
      'No session-6 tag on your namespace.',
    );

    const reader = await ctx.dataPlane();
    if (!reader) {
      return [
        ctx.mk('drill1-recovered', 'blocked', 'Cannot reach your namespace.'),
        ctx.mk('drill2-workers-polling', 'blocked', 'Cannot reach your namespace.'),
        ctx.mk('drill4-recovered', 'blocked', 'Cannot reach your namespace.'),
        documented,
      ];
    }

    const completed = async (prefix: string) => {
      try {
        return await reader.countWorkflows(
          `ExecutionStatus = "Completed" AND WorkflowId STARTS_WITH "${prefix}"`,
        );
      } catch {
        return -1;
      }
    };

    const [drill1, drill4, pollers] = await Promise.all([
      completed(DRILL_1_PREFIX),
      completed(DRILL_4_PREFIX),
      reader.pollerCount(LAB_TASK_QUEUE).catch(() => -1),
    ]);

    return [
      ctx.check(
        'drill1-recovered',
        drill1 > 0,
        `${drill1} completed workflow(s) matching ${DRILL_1_PREFIX}*.`,
        drill1 === 0
          ? `No completed workflow starting with ${DRILL_1_PREFIX}. Fix the worker and let it finish.`
          : 'Could not query your namespace.',
      ),
      ctx.check(
        'drill2-workers-polling',
        pollers > 0,
        `${pollers} poller(s) on ${LAB_TASK_QUEUE}.`,
        pollers === 0
          ? `Nothing is polling ${LAB_TASK_QUEUE} — bring your worker back up.`
          : 'Could not describe the task queue.',
      ),
      ctx.check(
        'drill4-recovered',
        drill4 > 0,
        `${drill4} completed workflow(s) matching ${DRILL_4_PREFIX}*.`,
        drill4 === 0
          ? `No completed workflow starting with ${DRILL_4_PREFIX}. Let the heartbeat timeout fire and the retry finish.`
          : 'Could not query your namespace.',
      ),
      documented,
    ];
  },
};
