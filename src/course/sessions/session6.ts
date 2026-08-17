import { namespaceTags } from '@/cloud/ops';
import { LAB_TASK_QUEUE } from '../naming';
import type { SessionDef } from '../types';

/**
 * Session 6 — Nexus: calling a service you do not own.
 *
 * The first session where the boundary is somebody else's. Every earlier lab
 * happened inside the student's own namespace, with their own credential, on
 * resources they could create and destroy. Here they call a service in a
 * namespace they cannot reach, over an endpoint they cannot configure, and the
 * only thing they control is whether they ask.
 *
 * WHAT MAKES THIS GRADABLE, which was not obvious. The handler runs in the
 * instructor's namespace and the portal is deliberately not told which one — it
 * is typed into the instructor dashboard on the day, so it cannot be a config
 * value the grader depends on. But `NexusOperationCompleted` lands in the
 * CALLER's history, and the caller's namespace is the student's own. That event
 * can only have been written by the caller's Nexus Machinery after a handler in
 * another namespace answered, so it is proof of a cross-namespace call that the
 * student cannot manufacture from their own side. Three of the four checkpoints
 * below are real.
 *
 * The one that is not is the outage. Round 3 stops the desk and every caller
 * parks on `BackingOff` — the best moment in the workshop and completely
 * invisible after the fact, because the recovered history looks identical to one
 * that never stalled. A long caller-observed latency hints at it and nothing
 * proves it, so it is attested and labelled as such.
 */
const NEXUS_ENDPOINT = 'rate-desk';
const CALLER_WORKFLOW = 'PaymentWorkflow';

export const session6: SessionDef = {
  number: 6,
  title: 'Nexus — Calling a Service You Do Not Own',
  outcome:
    'One cross-namespace call made, survived an outage, and a decision about which of your own ' +
    'service boundaries deserves this treatment.',
  exitCheck: 'A Nexus operation completed across a namespace boundary; boundary decision documented.',
  labTitle: 'Call the Rate Desk',
  labMinutes: 20,

  note:
    'Everything so far has been inside **your** namespace. This is not. The Rate Desk runs in your ' +
    "instructor's namespace — you have no address for it, no credential for it, and no permission to " +
    'read it. You will name an endpoint and an operation and wait. Then your instructor will turn the ' +
    'desk off while you are calling it, and the interesting thing is what does *not* happen.',

  prerequisites: [
    {
      name: 'The Rate Desk endpoint',
      why:
        'Your instructor creates it and adds your namespace to its access policy. A Nexus Endpoint ' +
        'permits **no** callers by default — not even namespaces in the same account as its target — ' +
        'so until they do, your call is refused at the boundary. Nothing for you to install.',
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
            'ran.',
        },
        {
          label: 'Nexus Registry and Endpoints',
          url: 'https://docs.temporal.io/nexus/registry',
          note:
            'In Temporal Cloud the Registry is **global across the account**, spanning every ' +
            'namespace, and endpoint names are unique within it. That is the same account-versus-' +
            'namespace distinction Session 5 made about the metrics endpoint.',
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
            'explains the click-through you will do in step 5.',
        },
        {
          label: 'Python SDK — Nexus feature guide',
          url: 'https://docs.temporal.io/develop/python/nexus/feature-guide',
          note:
            'Both sides in the SDK you are using. Note the guidance on sync versus async: a ' +
            'synchronous operation must answer inside a 10-second handler deadline, which is why the ' +
            'Rate Desk is workflow-backed.',
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
            'does bills to the handler. So a shared service moves cost across a team boundary as well ' +
            'as work, and that is worth knowing before you design one.',
        },
      ],
    },
  ],

  labCommands: ({ namespaceName, namespaceId }) => [
    {
      label: 'Make sure your worker is running',
      command: 'cd labs/worker\nuv run main.py worker',
      expect:
        `\`Polling '${LAB_TASK_QUEUE}'\`. The same worker as every other session — calling a Nexus ` +
        'operation needs nothing special on your side: no service handler, no extra task queue, no ' +
        'endpoint configuration. `PaymentWorkflow` is already registered on it.',
    },
    {
      label: 'Call a service in a namespace you cannot reach',
      command: 'uv run main.py quote --currency AUD --amount 5000',
      expect:
        'A ticket number, a rate, and the name of the namespace that priced it. Read that last line ' +
        'twice: the work happened somewhere you have no credential for, and the result came back into ' +
        'your own workflow history.',
      grades: 'nexus-call-completed',
    },
    {
      label: 'Read what your own history recorded',
      command: `temporal workflow show --workflow-id <your payment workflow> \\\n  --address ${namespaceId}.tmprl.cloud:7233 \\\n  --namespace ${namespaceId} \\\n  --api-key $TEMPORAL_API_KEY`,
      expect:
        '`NexusOperationScheduled`, `NexusOperationStarted`, `NexusOperationCompleted`. The Started ' +
        'event is what tells you the operation was **asynchronous** — a synchronous one goes straight ' +
        'from Scheduled to Completed. Those three events are also what the exit check reads; they can ' +
        'only be written after a handler in another namespace answered.',
      grades: 'nexus-async-operation',
    },
    {
      label: 'Now your instructor turns the desk off. Call again and do not panic',
      command: 'uv run main.py quote --currency USD',
      expect:
        'It hangs, and that is correct. In another terminal run `temporal workflow describe` on it: ' +
        '`Pending Nexus Operations` shows `State: BackingOff` with an attempt counter climbing and a ' +
        'next-attempt time. Nothing failed. Nobody is holding a socket. Nobody has to resubmit. When ' +
        'the desk comes back your workflow completes on its own — and its latency includes every ' +
        'second the desk was gone, which is the number your SLO should care about.',
      grades: 'nexus-survived-outage',
    },
    {
      label: 'Click across the boundary',
      expect:
        'In the Cloud UI, open your caller workflow and find `NexusOperationScheduled`. It links to ' +
        'the handler workflow in the desk namespace, and that workflow links back to yours. Two ' +
        'namespaces, bidirectional, in a UI that otherwise shows you nothing of the other side. Note ' +
        'what you can and cannot see once you get there.',
      link: {
        label: `Open your workflows in the Cloud UI — ${namespaceId}`,
        url: `https://cloud.temporal.io/namespaces/${namespaceId}/workflows`,
      },
    },
    {
      label: 'Decide which of your own boundaries deserves this',
      command: `# add to the temporalcloud_namespace_tags "lab" block in lab1.tf:\n#   "session-6" = "<your boundary decision>"`,
      expect:
        'Pick one real integration your team owns and answer three questions in a document: would you ' +
        'model it as a Nexus operation or leave it as an API call, who would own the endpoint, and ' +
        'which team would the Actions bill land on. Then record the link as a tag. Add to the ' +
        'existing block rather than writing a second one — it manages the namespace\'s COMPLETE tag ' +
        'set, and a second declaration would delete every tag the earlier sessions set.',
      grades: 'session-6-documented',
    },
  ],

  snippetLang: 'hcl',
  snippet: ({ namespaceName }) => `# Nothing to provision in labs/lab6.tf — read this instead.
#
# You are a CALLER today, not an owner. The endpoint is account-global, your
# instructor created it, and adding you to its access policy was a change on
# THEIR resource. Which is the whole lesson: the thing that decides whether you
# may call is not configurable from your side at all.
#
# --- What your caller workflow contains (labs/worker/training/workflows.py) ---
#
#   @workflow.defn
#   class PaymentWorkflow:
#       @workflow.run
#       async def run(self, request: QuoteRequest, endpoint: str) -> Quote:
#           desk = workflow.create_nexus_client(service=RateDesk, endpoint=endpoint)
#           return await desk.execute_operation(RateDesk.quote, request)
#
# Two lines. Count what is absent: no host, no namespace, no API key, no HTTP
# client, no TLS config, no retry policy for the network, no circuit breaker, no
# timeout for a service that might be down. Compare that with what calling
# another team's REST API would have required, and with how much of it you would
# have got wrong.
#
# --- Why endpoint is an ARGUMENT and not read from the environment -----------
#
# Reading os.environ inside a workflow raises RestrictedWorkflowAccessError. The
# sandbox is right to refuse: a value that can change between replays is exactly
# what determinism forbids. Configuration is read by the starter, outside the
# workflow, and passed in — so it lands in history and every replay sees what the
# first attempt saw.
#
# --- What your instructor ran, for reference ---------------------------------
#
#   temporal cloud nexus endpoint create \\
#     --name ${NEXUS_ENDPOINT} \\
#     --target-namespace <the desk namespace> \\
#     --target-task-queue ${NEXUS_ENDPOINT} \\
#     --allow-namespace ${namespaceName}.<account>
#
# Note --allow-namespace. Without your namespace in that list the call is refused
# before your payload is ever deserialised. NOT because of anything in the
# request — the caller field in QuoteRequest is a label for the desk's workflow
# ids, trivially spoofable, and authorising on it would be a bug.
#
# --- The tag, which IS yours to write ---------------------------------------
#
#   tags = {
#     provisioner = "terraform"
#     ...
#     "session-6" = "<link to your boundary decision>"
#   }`,

  use: ({ namespaceId }) => ({
    intro:
      'The reads that show you what crossed the boundary, and the one that shows you a call in ' +
      'trouble. Export the connection flags once — you will want them again in Session 7.',
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
          'One row per quote you asked for. These run in your namespace; the workflows that priced ' +
          'them do not appear here at all, because they are not yours.',
      },
      {
        label: 'A call in trouble — the money command',
        command: `temporal workflow describe --workflow-id <a running payment workflow> $T`,
        expect:
          'While the desk is down: `Pending Nexus Operations` with `State: BackingOff`, an attempt ' +
          'count, a `NextAttemptScheduleTime` and the `LastAttemptFailure`. Run it repeatedly and ' +
          'watch the attempt climb. Now ask yourself what an HTTP client would be doing at this ' +
          'point, and which of your services would still be holding the request open.',
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
        label: 'What the desk cost you, in the unit you are billed in',
        command: `temporal workflow show --workflow-id <a completed payment workflow> $T | grep -c NexusOperationScheduled`,
        expect:
          'Each `NexusOperationScheduled` is one Action on **your** namespace. Everything the handler ' +
          'did — its workflow, its activities, its retries — bills to the desk\'s namespace instead. ' +
          'A shared service therefore moves cost across a team boundary along with the work, which is ' +
          'a conversation to have before you build one, not after.',
      },
      {
        label: 'Try the thing you are not allowed to do',
        command: 'temporal cloud nexus endpoint allowed-namespace list --name rate-desk --api-key $TEMPORAL_API_KEY',
        expect:
          'You hold Global Admin today, so this probably succeeds and you can read the whole ' +
          'allowlist. Now notice what that means: reading the Registry is an account-level ' +
          'permission, and *managing* an endpoint additionally needs Namespace Admin on its target. ' +
          'In your own organisation the person who may call and the person who may change who calls ' +
          'should not be the same person, and today they are.',
      },
    ],
    stretch: {
      title: 'Stretch: what would you have to build to survive this without Nexus?',
      body:
        'Write down the pieces. A retry loop with backoff and jitter. Somewhere durable to keep the ' +
        'request so a restart does not lose it. Idempotency, so a retry after a partial success does ' +
        'not double-charge. A dead letter queue. A way to know a queued request eventually landed. An ' +
        'access model that is not a shared bearer token in an environment variable. Then note that ' +
        'the version you ran today was two lines, and that every one of those pieces is a place your ' +
        'team has had an incident.',
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
        'straight from Scheduled to Completed and must answer inside a 10-second handler deadline; ' +
        'the Started event is your evidence the desk started a workflow instead, which is what lets ' +
        'it survive being switched off.',
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
    {
      id: 'session-6-documented',
      title: 'Boundary decision recorded',
      detail:
        'Looks for a `session-6` namespace tag pointing at your decision: one real integration, ' +
        'whether you would model it as Nexus, who owns the endpoint, and whose bill the Actions land on.',
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
        ctx.mk('nexus-call-completed', 'blocked', 'Cannot reach your namespace.'),
        ctx.mk('nexus-async-operation', 'blocked', 'Cannot reach your namespace.'),
        ctx.mk('nexus-survived-outage', 'blocked', 'Cannot reach your namespace.'),
        documented,
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
        documented,
      ];
    }

    const completed = outcomes.filter((o) => o.completed > 0);
    const async = completed.filter((o) => o.started > 0);
    const endpoints = [...new Set(outcomes.flatMap((o) => o.endpoints))];
    const scheduled = outcomes.reduce((n, o) => n + o.scheduled, 0);

    /* -- The outage hint. Latency is the only trace an outage leaves, and it is
          circumstantial: a slow desk looks the same as a stopped one. So this is
          reported, never asserted. -------------------------------------------- */
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
            'BackingOff the desk is down — that is round 3, and it will complete on its own. If it ' +
            'failed outright, your namespace may not be on the endpoint allowlist.'
          : `No ${CALLER_WORKFLOW} has scheduled a Nexus operation. Run: uv run main.py quote`,
      ),
      ctx.check(
        'nexus-async-operation',
        async.length > 0,
        `${async.length} operation(s) recorded NexusOperationStarted — workflow-backed, asynchronous.`,
        completed.length > 0
          ? 'Completed without a Started event, so the operation answered synchronously. The Rate ' +
            'Desk is workflow-backed and should report Started — check you called `quote` rather ' +
            'than a sync operation.'
          : 'Waiting on a completed call.',
      ),
      ctx.mk(
        'nexus-survived-outage',
        tag !== '' || completed.length > 0 ? 'pass' : 'fail',
        slowest !== undefined
          ? `Slowest caller-observed call: ${(slowest / 1000).toFixed(1)}s. A long one suggests you ` +
            'were calling while the desk was down; it does not prove it.'
          : 'No completed call to measure yet.',
      ),
      documented,
    ];
  },
};
