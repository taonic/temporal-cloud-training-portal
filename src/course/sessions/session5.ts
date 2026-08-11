import { namespaceTags } from '@/cloud/ops';
import { LAB_BUILD_ID_V2, LAB_TASK_QUEUE } from '../naming';
import type { SessionDef } from '../types';

/**
 * Session 5 — Observability & Operational Readiness, via SDK metrics and a
 * local Grafana.
 *
 * SDK metrics are emitted by the worker process, not by Temporal Cloud, so this
 * runs entirely inside the student's sandbox: `labs/observability` is a docker-compose with
 * Prometheus and a provisioned Grafana dashboard, scraping the worker's own
 * Prometheus endpoint.
 *
 * That choice has a cost worth being honest about. Everything interesting here
 * happens inside the student's sandbox, where the portal cannot see it. The two
 * objective checkpoints below are the strongest available — a worker polled the
 * task queue, and workflows completed — and neither proves a dashboard exists.
 * The dashboard and alert catalogue are attested.
 */
const METRICS_PORT = 9464;

export const session5: SessionDef = {
  number: 5,
  title: 'Observability & Operational Readiness',
  outcome: 'A worker health dashboard built from SDK metrics, and two alerts you would actually keep.',
  exitCheck: 'Dashboard live; alert catalogue reviewed with on-call.',
  labTitle: 'SDK metrics into a local Prometheus and Grafana',
  labMinutes: 15,

  prerequisites: [
    {
      name: 'Prometheus and Grafana',
      why: 'Both run as containers in your sandbox — nothing is deployed anywhere. `obs-up` starts the pair, `obs-down` stops them, and the images are already pulled. Watch them in the Grafana and Prometheus tabs above the terminal.',
      install: 'obs-up',
      docs: 'https://docs.docker.com/get-started/get-docker/',
    },
  ],

  note:
    'SDK metrics come from your worker process, not from Temporal Cloud — they are the signals the ' +
    'service cannot see for you: replay failures, slot exhaustion, pollers that quietly went away. ' +
    'Everything here runs inside your sandbox, which also means the exit check below can only verify ' +
    'that a worker ran and workflows completed. The dashboard is your word.',

  labSteps: [
    'Start the stack: `obs-up`. Open the **Grafana** tab (admin/admin) — the Temporal Worker health dashboard is already provisioned. Prometheus has its own tab. Both take a few seconds to come up; reload the tab rather than assuming it failed. See `labs/observability/README.md`.',
    `Run the worker with metrics exposed: \`dotnet run -- worker --version ${LAB_BUILD_ID_V2} --metrics-port ${METRICS_PORT}\`. The \`--version\` is not optional: Session 3 left v${LAB_BUILD_ID_V2} as the deployment's current version, and a versioned task queue hands work only to that version. Drop the flag and your workflows will show up in the UI and sit there forever — pollers present, no error, nothing running.`,
    'Check Prometheus can see it: the **Prometheus** tab → Status → Targets. The temporal-sdk job should be UP. The second target on 9465 stays DOWN until you run a second worker, which is expected.',
    'Generate traffic: `dotnet run -- load --count 50`. A single workflow gives you a dot; fifty gives you a curve.',
    'Open the Grafana dashboard and answer four questions: what is p99 workflow-task schedule-to-start, what is the sticky cache hit rate, how many task slots stay free, and is anything failing.',
    'Now break something. Kill the worker while load is running and watch schedule-to-start climb and pollers drop to zero. Restart it and watch recovery.',
    'Decide one paging alert and one ticket alert, and write both into a document with the dashboard link. Record it by adding a `"session-5" = "<your doc link>"` key to the `temporalcloud_namespace_tags "lab"` block already in `lab1.tf` — add to that block rather than writing a second one, because it manages the namespace\'s COMPLETE tag set and a second declaration would delete every tag the earlier sessions set.',
  ],

  snippetLang: 'hcl',
  snippet: () => `# --- Not Terraform: the worker options that emit the metrics -------------
#
#   var runtime = new TemporalRuntime(new()
#   {
#       Telemetry = new()
#       {
#           Metrics = new()
#           {
#               Prometheus = new("0.0.0.0:${METRICS_PORT}")
#               {
#                   HasUnitSuffix         = true,   // default: false
#                   UseSecondsForDuration = true,   // default: false (ms!)
#               },
#           },
#       },
#   });
#
# Those two defaults are why copied PromQL returns nothing: without them you get
# integer milliseconds and no _seconds in the histogram names. labs/worker
# turns them on.
#
# Counters are the opposite trap. Most examples online write
# temporal_workflow_completed_total, but Temporalio 1.17 emits NO _total suffix
# — and HasCounterTotalSuffix makes no difference; the names come out identical
# with it on or off. Query temporal_workflow_completed.`,

  use: () => ({
    intro:
      'Before writing a single query, look at the raw endpoint. Metric names change with the suffix ' +
      'flags above, and the failure mode is an empty graph with no error — Prometheus cannot tell you ' +
      'that a metric name never existed.',
    steps: [
      {
        label: 'Read the actual names your worker emits',
        command: `curl -s localhost:${METRICS_PORT}/metrics | grep -E '^temporal_' | cut -d'{' -f1 | sort -u`,
        expect:
          'Histogram families ending _seconds_bucket/_sum/_count, and counters and gauges with no ' +
          'suffix at all — temporal_workflow_completed, not temporal_workflow_completed_total. Ask ' +
          'for the _total form and you get an empty result with no error and no hint why.',
      },
      {
        label: 'Is anyone polling? (gauge — no suffix)',
        command: 'sum(temporal_num_pollers) by (poller_type)',
        expect:
          'One series per poller type while the worker runs, dropping to nothing when you kill it. ' +
          'This is the first query to run when someone says Temporal is broken.',
      },
      {
        label: 'Is work waiting? (histogram — _seconds_bucket)',
        command:
          'histogram_quantile(0.99,\n  sum(rate(temporal_workflow_task_schedule_to_start_latency_seconds_bucket[5m])) by (le, task_queue)\n)',
        expect:
          'Near zero with a healthy worker. Kill the worker mid-load and watch it climb — the tasks are ' +
          'not lost, they are queued, and this is the number that tells you so.',
      },
      {
        label: 'Is replay being avoided? (counters — no suffix)',
        command:
          '(sum(rate(temporal_sticky_cache_hit[5m])) or vector(0))\n/\nclamp_min(\n  (sum(rate(temporal_sticky_cache_hit[5m])) or vector(0))\n  + (sum(rate(temporal_sticky_cache_miss[5m])) or vector(0)),\n  0.001\n)',
        expect:
          'High. A low hit rate means workflows are evicted and replayed from history — same result, ' +
          'more latency and CPU. It is a sizing signal, not a correctness one.',
      },
      {
        label: 'The metric that catches a stuck workflow',
        command: 'sum(rate(temporal_workflow_task_execution_failed[5m])) or vector(0)',
        expect:
          'Zero normally. The `or vector(0)` matters: a counter that has never fired emits no series ' +
          'at all, so without it this returns blank rather than zero. Run Session 6 drill 1 and it ' +
          'climbs while the workflow is neither completed nor failed — which is exactly why an alert ' +
          'on workflow failure rate would never fire.',
      },
    ],
    stretch: {
      title: 'Stretch: the alert worth keeping',
      body:
        'Most teams page on error rate and learn to ignore it. Try instead: page when p99 ' +
        'schedule-to-start exceeds your SLO for 10 minutes, because that means work is silently piling ' +
        'up and no other signal will tell you. Ticket everything else. Write both into Grafana as real ' +
        'alert rules rather than leaving them in a document.',
    },
  }),

  checkpoints: [
    {
      id: 'worker-polled',
      title: 'A worker polled your task queue',
      detail:
        `At least one poller on ${LAB_TASK_QUEUE}. You cannot emit SDK metrics without a running ` +
        'worker, so this is the closest the portal can get to verifying the lab from outside your sandbox.',
    },
    {
      id: 'load-generated',
      title: 'Enough traffic to make a curve',
      detail:
        'At least 10 completed workflow executions. One workflow gives you a dot on a graph; a ' +
        'dashboard you can read needs load.',
    },
    {
      id: 'session-5-documented',
      title: 'Dashboard and alert catalogue recorded',
      detail:
        'Looks for a `session-5` namespace tag. Your Grafana runs in your sandbox and the portal cannot ' +
        'reach it — this records that you built it, and verifies nothing about what is on it.',
      selfAttested: true,
    },
  ],

  async grade(ctx) {
    const ns = await ctx.labNamespace();
    if (!ns) {
      return ctx.blockedAll(`No namespace named "${ctx.namespaceName}" — complete Session 1 first.`);
    }

    const tag = (namespaceTags(ns)['session-5'] ?? '').trim();
    const documented = ctx.check(
      'session-5-documented',
      tag !== '',
      `Documented at ${tag}`,
      'No session-5 tag on your namespace.',
    );

    const reader = await ctx.dataPlane();
    if (!reader) {
      return [
        ctx.mk('worker-polled', 'blocked', 'Cannot reach your namespace.'),
        ctx.mk('load-generated', 'blocked', 'Cannot reach your namespace.'),
        documented,
      ];
    }

    const [pollers, completed] = await Promise.all([
      reader.pollerCount(LAB_TASK_QUEUE).catch(() => -1),
      reader.countWorkflows('ExecutionStatus = "Completed"').catch(() => -1),
    ]);

    return [
      ctx.check(
        'worker-polled',
        pollers > 0,
        `${pollers} poller(s) on ${LAB_TASK_QUEUE}.`,
        pollers === 0
          ? `Nothing polling ${LAB_TASK_QUEUE} — start the worker with --metrics-port ${METRICS_PORT}.`
          : 'Could not describe the task queue.',
      ),
      ctx.check(
        'load-generated',
        completed >= 10,
        `${completed} completed execution(s).`,
        completed >= 0
          ? `Only ${completed} completed execution(s). Run: dotnet run -- load --count 50`
          : 'Could not query your namespace.',
      ),
      documented,
    ];
  },
};
