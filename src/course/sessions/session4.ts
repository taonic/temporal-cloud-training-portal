import { LAB_TASK_QUEUE } from '../naming';
import type { SessionDef } from '../types';

/**
 * Session 4 — Nexus: calling a service you do not own.
 *
 * The first session where the boundary is somebody else's. Every earlier lab
 * happened inside the student's own namespace, with their own credential, on
 * resources they could create and destroy. Here they call a service in a
 * namespace they cannot reach, over an endpoint they cannot configure, and the
 * only thing they control is whether they ask.
 *
 * WHY THE DESK IS AN AGENT NOW. It used to be an FX rate desk: a lookup and a
 * multiply. Everything about the Nexus lesson worked, and two arguments had to
 * be taken on trust — that a synchronous operation's ten-second handler deadline
 * is a real constraint, and that a shared service can be worth its coupling. A
 * three-agent adjudication loop settles both from the room's own screens. It
 * takes tens of seconds, so workflow-backed is the only shape that fits. It
 * holds a model credential, a rate limit and a token bill, which is a thing a
 * platform team in 2026 is actually deciding how to share. And it can stop and
 * ask a human, which is the strongest argument for durable execution anyone has
 * and is invisible from the caller's side — as it should be.
 *
 * WHAT MAKES THIS GRADABLE, which was not obvious. The handler runs in the
 * instructor's namespace and the portal is deliberately not told which one — it
 * is typed into the instructor dashboard on the day, so it cannot be a config
 * value the grader depends on. But `NexusOperationCompleted` lands in the
 * CALLER's history, and the caller's namespace is the student's own. That event
 * can only have been written by the caller's Nexus Machinery after a handler in
 * another namespace answered, so it is proof of a cross-namespace call that the
 * student cannot manufacture from their own side. Two of the three checkpoints
 * below are real.
 *
 * The one that is not is the outage. Round 4 stops the desk and every caller
 * parks — the best moment in the workshop and completely invisible after the
 * fact, because the recovered history looks identical to one that never stalled.
 * A long caller-observed latency hints at it and nothing proves it, so it is
 * attested and labelled as such.
 */
const NEXUS_ENDPOINT = 'risk-desk';
const CALLER_WORKFLOW = 'PaymentWorkflow';

export const session4: SessionDef = {
  number: 4,
  title: 'Nexus — Calling a Service You Do Not Own',
  outcome:
    'One cross-namespace call into a service that is three AI agents and sometimes a human, ' +
    'survived an outage, and read back out of your own history as three events you could not have ' +
    'written yourself.',
  exitCheck: 'A Nexus operation completed, asynchronously, across a namespace boundary.',
  labTitle: 'Call the Risk Desk',
  labMinutes: 20,

  note:
    'Everything so far has been inside **your** namespace. This is not. The Risk Desk runs in your ' +
    "instructor's namespace — you have no address for it, no credential for it, and no permission to " +
    'read it. It is three agents that decide whether a payment should go through, and behind them a ' +
    'model API key you will never hold. You will name an endpoint and an operation and wait. Then ' +
    'your instructor will make one of your payments large enough that a human has to decide it, and ' +
    'later turn the desk off entirely — and the interesting thing both times is what does *not* happen.',

  prerequisites: [
    {
      name: 'The Risk Desk endpoint',
      why:
        'Your instructor creates it and adds your namespace to its access policy. A Nexus Endpoint ' +
        'permits **no** callers by default — not even namespaces in the same account as its target — ' +
        'so until they do, your call is refused at the boundary. Nothing for you to install, and ' +
        'no model API key for you to obtain: that is the point of the session.',
      docs: 'https://docs.temporal.io/nexus',
    },
  ],

  references: [
    {
      source: 'Nexus',
      links: [
        {
          label: 'Temporal Nexus',
          url: 'https://docs.temporal.io/nexus',
          note:
            'Start here. The mental model worth taking away: an Endpoint is a reverse proxy that maps ' +
            'an operation onto a namespace and task queue, so the caller never learns where the work ' +
            'ran — or, today, what ran it.',
        },
        {
          label: 'Nexus Registry and Endpoints',
          url: 'https://docs.temporal.io/nexus/registry',
          note:
            'In Temporal Cloud the Registry is **global across the account**, spanning every ' +
            'namespace, and endpoint names are unique within it. That is the same account-versus-' +
            'namespace distinction Session 3 made about the metrics endpoint.',
        },
        {
          label: 'Runtime access controls',
          url: 'https://docs.temporal.io/nexus/security#runtime-access-controls',
          note:
            'The allowlist of caller namespaces, and the sentence that matters: no callers are ' +
            'allowed by default. Managing an endpoint needs Developer role plus Namespace Admin on ' +
            'the target — which is why you are a caller today and not an owner.',
        },
        {
          label: 'Execution debugging across namespaces',
          url: 'https://docs.temporal.io/nexus/execution-debugging',
          note:
            'Bidirectional links, pending operations and pending callbacks. This is the page that ' +
            'explains the click-through you will do in step 6.',
        },
        {
          label: 'Python SDK — Nexus feature guide',
          url: 'https://docs.temporal.io/develop/python/nexus/feature-guide',
          note:
            'Both sides in the SDK you are using. Note the guidance on sync versus async: a ' +
            'synchronous operation must answer inside a 10-second handler deadline, which an agent ' +
            'loop cannot do and a human certainly cannot. Workflow-backed is not a preference here.',
        },
      ],
    },
    {
      source: 'Durable agents',
      links: [
        {
          label: 'Durable, flexible multi-agent systems',
          url: 'https://temporal.io/blog/durable-flexible-multi-agent-systems',
          note:
            'The pattern the Risk Desk is built on: agent loop in the Workflow, model calls and tool ' +
            'calls as Activities, human-in-the-loop as a Signal the Workflow parks on. Also the ' +
            'task-queue argument — agent inference and operational work do not belong on one queue.',
        },
        {
          label: 'Pydantic AI — Temporal integration',
          url: 'https://pydantic.dev/docs/ai/integrations/durable_execution/temporal/',
          note:
            'How the desk is written. One `TemporalDurability()` capability on each agent turns every ' +
            'model request and tool call into an Activity — which is why the desk contains no retry ' +
            'loop, no JSON parsing and no timeout plumbing, and why its history is readable six ' +
            'months later.',
        },
      ],
    },
    {
      source: 'Cost',
      links: [
        {
          label: 'Actions — Nexus',
          url: 'https://docs.temporal.io/cloud/actions#nexus',
          note:
            'Scheduling an operation is one Action on the **caller** namespace; everything the handler ' +
            'does bills to the handler. With an agent behind it that now moves the token bill as well ' +
            'as the work across a team boundary, which is worth knowing before you design one.',
        },
      ],
    },
  ],

  labCommands: ({ namespaceId }) => [
    {
      label: 'Make sure your worker is running',
      command: 'cd labs/worker\nuv run lab4_review.py worker',
      expect:
        `\`Polling '${LAB_TASK_QUEUE}'\`. The same worker as every other session — calling a Nexus ` +
        'operation needs nothing special on your side: no service handler, no extra task queue, no ' +
        'endpoint configuration, and no agent framework. `PaymentWorkflow` is already registered on it.',
    },
    {
      label: 'Ask a service in a namespace you cannot reach to make a decision',
      command: 'uv run lab4_review.py review --beneficiary "Grace Hopper" --amount 4200',
      expect:
        'An approve or a decline, a confidence, and one line of rationale per agent — screening, ' +
        'history, adjudicator. Then the namespace that decided it and the number of model calls it ' +
        'took. Read those last two lines twice: the reasoning happened somewhere you have no ' +
        'credential for, and the tokens landed on somebody else\'s bill.',
      grades: 'nexus-call-completed',
    },
    {
      label: 'Read what your own history recorded',
      command: `temporal workflow show --workflow-id <your payment workflow> \\\n  --address ${namespaceId}.tmprl.cloud:7233 \\\n  --namespace ${namespaceId} \\\n  --api-key $TEMPORAL_API_KEY`,
      expect:
        '`NexusOperationScheduled`, `NexusOperationStarted`, `NexusOperationCompleted`. The Started ' +
        'event is what tells you the operation was **asynchronous** — a synchronous one goes straight ' +
        'from Scheduled to Completed and must answer inside ten seconds, which is less time than the ' +
        'agents took. Those three events are also what the exit check reads. The same three events ' +
        "are in the Cloud UI's Event History for that workflow, and `NexusOperationScheduled` there " +
        'carries the endpoint name — which is the only thing in the whole record that names the ' +
        'other side.',
      grades: 'nexus-async-operation',
      link: {
        label: `Open your ${CALLER_WORKFLOW}s in the Cloud UI — ${namespaceId}`,
        url: `https://cloud.temporal.io/namespaces/${namespaceId}/workflows?query=${encodeURIComponent(
          `WorkflowType="${CALLER_WORKFLOW}"`,
        )}`,
      },
    },
    {
      label: 'Now your instructor sends one big enough that a human has to decide it',
      command: 'uv run lab4_review.py review --country RU --amount 900000',
      expect:
        'It takes much longer, and then comes back `decided by human` with an extra line of rationale. ' +
        'While you were waiting, run `temporal workflow describe` on it: `State: Started`, attempt 1, ' +
        'nothing pending. **That is the same output you would see while the agents were still ' +
        'thinking.** You could not tell a model from a person from out here, and a caller that could ' +
        'would be a caller coupled to the desk\'s internals.',
    },
    {
      label: 'Now your instructor turns the desk off. Call again and do not panic',
      command: 'uv run lab4_review.py review --amount 7500',
      expect:
        'It hangs, and that is correct. `temporal workflow describe` now shows something different ' +
        'from the human case: `State: BackingOff`, an attempt counter climbing, a next-attempt time, ' +
        'and `LastAttemptFailure: upstream timeout`. Nothing failed. Nobody is holding a socket. ' +
        'Nobody has to resubmit. When the desk comes back your workflow completes on its own — and ' +
        'its latency includes every second the desk was gone, which is the number your SLO should ' +
        'care about.',
      grades: 'nexus-survived-outage',
    },
    {
      label: 'Click across the boundary',
      expect:
        'In the Cloud UI, open your caller workflow and find `NexusOperationScheduled`. It links to ' +
        'the handler workflow in the desk namespace, and that workflow links back to yours. Two ' +
        'namespaces, bidirectional, in a UI that otherwise shows you nothing of the other side. If ' +
        'your instructor puts the desk side on the projector, note what its history contains: one ' +
        'Activity per model request and one per tool call, retried and replayable. That is an ' +
        'agent\'s entire reasoning trace, recorded without anybody writing logging code.',
      link: {
        label: `Open your workflows in the Cloud UI — ${namespaceId}`,
        url: `https://cloud.temporal.io/namespaces/${namespaceId}/workflows`,
      },
    },
  ],

  use: ({ namespaceId }) => ({
    intro:
      'The reads that show you what crossed the boundary, and the two that show you a call in ' +
      'trouble — which are not the same trouble. Export the connection flags once; you will want ' +
      'them again in Session 5.',
    steps: [
      {
        label: 'Set up the connection once',
        command: `export T="--address ${namespaceId}.tmprl.cloud:7233 --namespace ${namespaceId} --api-key $TEMPORAL_API_KEY"`,
        expect: 'Every command below uses $T.',
      },
      {
        label: 'Find your callers',
        command: `temporal workflow list --query 'WorkflowType="${CALLER_WORKFLOW}"' $T`,
        expect:
          'One row per decision you asked for. These run in your namespace; the workflows that ' +
          'decided them do not appear here at all, because they are not yours.',
      },
      {
        label: 'A call in trouble — the money command',
        command: `temporal workflow describe --workflow-id <a running payment workflow> $T`,
        expect:
          'Two different pictures, and telling them apart is the skill. **`State: Started`** means ' +
          'the desk accepted the work and is doing it — thinking, calling tools, or waiting on a ' +
          'person; you cannot tell which and do not need to. **`State: BackingOff`** with an attempt ' +
          'count and a `LastAttemptFailure` means the desk is not there at all. The first is not a ' +
          'problem. The second is somebody else\'s problem, and it is still not yours.',
      },
      {
        label: 'The three events that prove it crossed',
        command: `temporal workflow show --workflow-id <a completed payment workflow> $T | grep -i nexus`,
        expect:
          '`NexusOperationScheduled`, `NexusOperationStarted`, `NexusOperationCompleted`. Scheduled ' +
          'carries the endpoint name. Started only appears for asynchronous operations — its absence ' +
          'is how you tell a sync operation apart from an async one at a glance.',
      },
      {
        label: 'What the desk cost you, and what it cost them',
        command: `temporal workflow show --workflow-id <a completed payment workflow> $T | grep -c NexusOperationScheduled`,
        expect:
          'One. That is your entire bill for the call: a single Action on **your** namespace. ' +
          'Everything the desk did — three agent workflows worth of model requests, tool calls, ' +
          'retries, and the tokens behind all of it — billed to the desk\'s namespace and the desk\'s ' +
          'model provider. A shared agent moves cost across a team boundary along with the work, and ' +
          'the direction it moves is the conversation to have before you build one, not after.',
      },
      {
        label: 'Try the thing you are not allowed to do',
        command: `temporal cloud nexus endpoint allowed-namespace list --name ${NEXUS_ENDPOINT} --api-key $TEMPORAL_API_KEY`,
        expect:
          'You hold Global Admin today, so this probably succeeds and you can read the whole ' +
          'allowlist. Now notice what that means: reading the Registry is an account-level ' +
          'permission, and *managing* an endpoint additionally needs Namespace Admin on its target. ' +
          'In your own organisation the person who may call an agent and the person who may change ' +
          'who calls it should not be the same person, and today they are.',
      },
    ],
    stretch: {
      title: 'Stretch: what would you have to build to survive this without Nexus?',
      body:
        'Write down the pieces. A retry loop with backoff and jitter. Somewhere durable to keep the ' +
        'request so a restart does not lose it. Idempotency, so a retry after a partial success does ' +
        'not double-charge — or, now, does not spend the tokens twice. A dead letter queue. A way to ' +
        'know a queued request eventually landed. Somewhere to park a request that is waiting on a ' +
        'human, that survives a deploy. An access model that is not a shared bearer token in an ' +
        'environment variable, for a credential that is metered. Then note that the version you ran ' +
        'today was two lines, and that every one of those pieces is a place your team has had an ' +
        'incident.',
    },
  }),

  checkpoints: [
    {
      id: 'nexus-call-completed',
      title: 'A Nexus operation completed in your namespace',
      detail:
        `A ${CALLER_WORKFLOW} in your namespace whose history carries \`NexusOperationCompleted\`. ` +
        'That event is written by your own namespace, but only after a handler in a namespace you ' +
        'cannot reach answered — so it is proof of a cross-namespace call rather than a claim about one.',
    },
    {
      id: 'nexus-async-operation',
      title: 'The operation was asynchronous, and workflow-backed',
      detail:
        '`NexusOperationStarted` is present as well as Completed. A synchronous operation goes ' +
        'straight from Scheduled to Completed and must answer inside a 10-second handler deadline — ' +
        'which is less time than three agents take and far less than a human. The Started event is ' +
        'your evidence the desk started a workflow instead, which is what lets it think, escalate, ' +
        'and survive being switched off.',
    },
    {
      id: 'nexus-survived-outage',
      title: 'You watched a call back off and recover',
      detail:
        'Attested. A recovered history is byte-identical to one that never stalled — `BackingOff` ' +
        'exists only while it is happening, so nothing after the fact can prove you saw it. The ' +
        'grader reports your slowest caller-observed latency as a hint and verifies nothing.',
      selfAttested: true,
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
        ctx.mk('nexus-call-completed', 'blocked', 'Cannot reach your namespace.'),
        ctx.mk('nexus-async-operation', 'blocked', 'Cannot reach your namespace.'),
        ctx.mk('nexus-survived-outage', 'blocked', 'Cannot reach your namespace.'),
      ];
    }

    const outcomes = await reader
      .nexusOutcomes(`WorkflowType = "${CALLER_WORKFLOW}"`, 10)
      .catch(() => undefined);

    if (!outcomes) {
      return [
        ctx.mk('nexus-call-completed', 'fail', 'Could not read your workflow histories.'),
        ctx.mk('nexus-async-operation', 'blocked', 'Waiting on a readable history.'),
        ctx.mk('nexus-survived-outage', 'blocked', 'Waiting on a readable history.'),
      ];
    }

    const completed = outcomes.filter((o) => o.completed > 0);
    const async = completed.filter((o) => o.started > 0);
    const endpoints = [...new Set(outcomes.flatMap((o) => o.endpoints))];
    const scheduled = outcomes.reduce((n, o) => n + o.scheduled, 0);

    /* -- The outage hint. Latency is the only trace an outage leaves, and it is
          circumstantial — and an agentic desk makes it more circumstantial, not
          less: a slow call might be a stopped desk, three agents thinking, or a
          human at lunch. So this is reported, never asserted. ---------------- */
    const slowest = await (async () => {
      const rows = await reader
        .listWorkflows(`WorkflowType = "${CALLER_WORKFLOW}"`, 10)
        .catch(() => []);
      const durations = rows
        .filter((r) => r.startedAtMs && r.closedAtMs)
        .map((r) => (r.closedAtMs as number) - (r.startedAtMs as number));
      return durations.length ? Math.max(...durations) : undefined;
    })();

    return [
      ctx.check(
        'nexus-call-completed',
        completed.length > 0,
        `${completed.length} completed Nexus call(s)` +
          (endpoints.length ? ` via endpoint ${endpoints.join(', ')}.` : '.'),
        scheduled > 0
          ? `${scheduled} operation(s) scheduled but none completed yet. If one is stuck on ` +
            'BackingOff the desk is down — that is the outage round, and it will complete on its ' +
            'own. If it is Started and staying that way, the agents are working or a human has it. ' +
            'If it failed outright, your namespace may not be on the endpoint allowlist.'
          : `No ${CALLER_WORKFLOW} has scheduled a Nexus operation. Run: uv run lab4_review.py review`,
      ),
      ctx.check(
        'nexus-async-operation',
        async.length > 0,
        `${async.length} operation(s) recorded NexusOperationStarted — workflow-backed, asynchronous.`,
        completed.length > 0
          ? 'Completed without a Started event, so the operation answered synchronously. The Risk ' +
            'Desk is workflow-backed and should report Started — check you called `review` rather ' +
            'than a sync operation.'
          : 'Waiting on a completed call.',
      ),
      ctx.mk(
        'nexus-survived-outage',
        completed.length > 0 ? 'pass' : 'fail',
        slowest !== undefined
          ? `Slowest caller-observed call: ${(slowest / 1000).toFixed(1)}s. A long one means the ` +
            'desk was down, the agents were thinking, or a human was deciding — this cannot tell ' +
            'you which, and neither could your SLO.'
          : 'No completed call to measure yet.',
      ),
    ];
  },
};
