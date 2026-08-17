import { namespaceTags } from '@/cloud/ops';
import { accountRoleOf } from '@/cloud/types';
import { LAB_BUILD_ID_V2, LAB_DEPLOYMENT_NAME, LAB_TASK_QUEUE } from '../naming';
import type { SessionDef } from '../types';

/**
 * Session 5 — Observability & Operational Readiness, over BOTH metric sources.
 *
 * There are two, they overlap in nothing, and the session is built around that:
 *
 *  · SDK metrics come from the worker process — pollers, task slots, sticky
 *    cache, schedule-to-start. Free, local, and invisible to Temporal Cloud.
 *  · Cloud metrics come from `metrics.temporal.io` — backlog, sync match rate,
 *    service latency, Actions consumed. Authenticated, rate-limited, and
 *    invisible to the worker.
 *
 * An earlier version of this session taught only the first, on the grounds that
 * the second needed an account-global metrics CA nobody could safely set in a
 * shared training account. The OpenMetrics endpoint removed that obstacle: it
 * authenticates with an ordinary API key owned by a `metricsread` service
 * account, which every student can create for themselves without touching a
 * single account-wide setting.
 *
 * That change also fixes the weakest grading in the workshop. The dashboard
 * still lives in the student's sandbox where the portal cannot see it, but the
 * IDENTITY the scraper runs as is control-plane state, so two of the five
 * checkpoints below are now facts about the account rather than claims.
 *
 * The one thing that does not go away is the rate limit, and it is a genuinely
 * account-global control: 180 requests per hour for the WHOLE account, shared
 * by every student in the room. That is why the shipped scrape interval is 180s
 * rather than the documented 30s, and why the arithmetic is on the page instead
 * of hidden in a config file.
 */
const METRICS_PORT = 9464;
/** Seconds. 20 req/hr each; the account budget is 180/hr for everyone. See labs/observability/prometheus.yml. */
const CLOUD_SCRAPE_SECONDS = 180;
const METRICS_ENDPOINT = 'https://metrics.temporal.io/v1/metrics';
const REQUIRED_METRICS_ROLE = 'ROLE_METRICS_READ';

export const session5: SessionDef = {
  number: 5,
  title: 'Observability & Operational Readiness',
  outcome:
    'One Grafana over both metric sources — your workers and Temporal Cloud — and two alerts you ' +
    'would actually keep.',
  exitCheck: 'Dashboard live; alert catalogue reviewed with on-call.',
  labTitle: 'SDK metrics and Temporal Cloud metrics into one Prometheus and Grafana',
  labMinutes: 15,

  prerequisites: [
    {
      name: 'Prometheus and Grafana',
      why:
        'Both run as containers in your sandbox — nothing is deployed anywhere. `obs-up` starts the ' +
        'pair, `obs-down` stops them, and the images are already pulled. Watch them in the Grafana ' +
        'and Prometheus tabs above the terminal. The only thing leaving your sandbox is the scrape ' +
        'of `metrics.temporal.io` on 443.',
      install: 'obs-up',
      docs: 'https://docs.docker.com/get-started/get-docker/',
    },
  ],

  references: [
    {
      source: 'Temporal Cloud metrics',
      links: [
        {
          label: 'Set up Cloud metrics with OpenMetrics',
          url: 'https://docs.temporal.io/cloud/metrics/openmetrics',
          note:
            'The quickstart this lab follows. Note the prerequisite: Metrics Read-Only is an ' +
            'ACCOUNT-level role, so only an Account Owner or Global Admin can grant it. A Namespace ' +
            'Admin cannot set this up — which is a design fact about the product, not a gap.',
        },
        {
          label: 'OpenMetrics API reference',
          url: 'https://docs.temporal.io/cloud/metrics/openmetrics/api-reference',
          note:
            'Read two sections before you write a scrape config: **API limits** (180 requests per ' +
            'hour per account, 50k datapoints per response) and **Scrape window** (only the last ' +
            'completed one-minute window is served, stamped ~3 minutes in the past).',
        },
        {
          label: 'Metrics reference — the full catalogue',
          url: 'https://docs.temporal.io/cloud/metrics/openmetrics/metrics-reference',
          note:
            'Every metric with its labels. The line to internalise is under Metric Types: these are ' +
            'all gauges, and the ones ending `_count` already hold a per-second rate. Wrapping them ' +
            'in `rate()` is the single most common way to get an empty graph here.',
        },
        {
          label: 'Grafana temporal-mixin — temporal-overview.json',
          url: 'https://github.com/grafana/jsonnet-libs/blob/master/temporal-mixin/dashboards/temporal-overview.json',
          note:
            'The dashboard Temporal\'s docs point you at, vendored into `labs/observability` so it ' +
            'provisions with no Grafana Cloud account. Worth reading the PromQL in the Usage & ' +
            'Quotas and Billable Actions rows — that is the cost model in queries.',
        },
        {
          label: 'temporalcloud_service_account',
          url: 'https://registry.terraform.io/providers/temporalio/temporalcloud/latest/docs/resources/service_account',
          note:
            'Its example usage now includes the metrics-scraper shape verbatim. Note what is missing ' +
            'from it: `namespace_scoped_access`. There is no namespace-scoped form of `metricsread`.',
        },
      ],
    },
    {
      source: 'SDK metrics',
      links: [
        {
          label: 'SDK metrics reference',
          url: 'https://docs.temporal.io/references/sdk-metrics',
          note:
            'The other half. Names here are the SDK\'s, not Cloud\'s, and the .NET exporter renames ' +
            'them again on the way out — see the snippet below.',
        },
      ],
    },
  ],

  note:
    'There are **two** metric sources and neither can answer the other\'s questions. Your worker ' +
    'reports what happens inside your process — pollers, slots, sticky cache. Temporal Cloud reports ' +
    'what happens on its side of the connection — backlog, sync match rate, Actions consumed. Today ' +
    'you wire both into one Prometheus. The Cloud half is rate-limited to **180 requests per hour ' +
    'for the entire account**, which everyone in this room shares, so read the scrape interval ' +
    'before you change it.',

  labCommands: ({ namespaceName, namespaceId, metricsAccountName }) => [
    {
      label: 'Start the stack',
      command: 'obs-up',
      expect:
        'Grafana (admin/admin) and Prometheus each get a tab above the terminal. Two dashboards are ' +
        'provisioned under Dashboards → Temporal: **Temporal Worker health**, written for this ' +
        'workshop, and **Temporal Cloud overview**, vendored from Grafana\'s temporal-mixin. Both ' +
        'are empty right now. Give them a few seconds and reload the tab rather than assuming it ' +
        'failed. See `labs/observability/README.md`.',
    },
    {
      label: 'Run the worker with SDK metrics exposed',
      command: `cd labs/worker\ndotnet run -- worker --version ${LAB_BUILD_ID_V2} --metrics-port ${METRICS_PORT}`,
      expect:
        `\`SDK metrics on http://localhost:${METRICS_PORT}/metrics\`. The \`--version\` is not ` +
        `optional: Session 3 left v${LAB_BUILD_ID_V2} as the ${LAB_DEPLOYMENT_NAME} deployment's ` +
        'current version, and a versioned task queue hands work only to that version. Drop the flag ' +
        'and your workflows will show up in the UI and sit there forever — pollers present, no ' +
        'error, nothing running.',
      grades: 'worker-polled',
    },
    {
      label: 'Generate traffic — one workflow is a dot, fifty is a curve',
      command: 'dotnet run -- load --count 50',
      expect:
        'Fifty completed executions. Keep this handy; you will run it again once the Cloud scrape is ' +
        'live, because Cloud metrics lag ~3 minutes behind and there is nothing to see until traffic ' +
        'has been flowing for a few of them.',
      grades: 'load-generated',
    },
    {
      label: 'Look at the two DOWN targets before you fix either',
      command: 'open the Prometheus tab → Status → Target health',
      expect:
        `\`temporal-sdk\` on ${METRICS_PORT} is UP. Two targets are not, and both are deliberate. ` +
        'Port 9465 is waiting for a second worker. `metrics.temporal.io` reports `401 Unauthorized` ' +
        `— or nothing yet, because that job scrapes every ${CLOUD_SCRAPE_SECONDS}s rather than every ` +
        '5, so give it up to three minutes. The shipped credentials file holds a placeholder. Read ' +
        'that 401 properly now: it is exactly what an expired metrics key looks like at 3am, and ' +
        'nothing in it says the credential is the problem rather than the endpoint, the network, or ' +
        'the account.',
    },
    {
      label: 'Build the identity the scraper will run as',
      command: 'terraform plan && terraform apply',
      expect:
        `A service account named ${metricsAccountName} carrying the Metrics Read-Only account role, ` +
        'and an API key owned by it. Read the plan first — this is the second service account you ' +
        'have built today and it is the mirror image of Session 2\'s.',
      snippet: true,
      grades: 'metrics-service-account',
    },
    {
      label: 'Prove the key works before Prometheus ever sees it',
      command:
        'export METRICS_API_KEY=$(terraform output -raw metrics_api_key)\n\n' +
        `curl -sS -H "Authorization: Bearer $METRICS_API_KEY" \\\n  ${METRICS_ENDPOINT} | head -20`,
      expect:
        'Output beginning `# TYPE temporal_cloud_v1_...`. Do this by hand before wiring anything: a ' +
        'scraper that cannot authenticate looks identical to a scraper pointed at the wrong host. ' +
        'There is no browser UI — opening that URL in a tab returns `Jwt is missing`.',
      grades: 'metrics-api-key',
    },
    {
      label: 'Hand the key to Prometheus and filter to your own namespace',
      command:
        'cd ../observability\nprintf \'%s\' "$METRICS_API_KEY" > cloud-api-key\n\n' +
        `# then in prometheus.yml, under the temporal-cloud job:\n#   params:\n#     namespaces: ['${namespaceName}*']\n\n` +
        'docker compose restart prometheus',
      expect:
        'Within ~3 minutes `metrics.temporal.io` goes UP and the **Temporal Cloud overview** ' +
        'dashboard fills in. Both edits matter. Without the key you stay at 401; without ' +
        '`namespaces` you scrape every namespace in the account — every colleague\'s included — ' +
        'against a 50k-datapoint cap that truncates silently. Leave `scrape_interval` at ' +
        `${CLOUD_SCRAPE_SECONDS}s: the documented default of 30s is 120 requests an hour, and the ` +
        'account gets 180 for everyone in this room. Set it lower and you take the whole cohort ' +
        'down with `429 Too Many Requests`, including yourself.',
      link: {
        label: `Compare against the Cloud UI's own metrics view for ${namespaceId}`,
        url: `https://cloud.temporal.io/namespaces/${namespaceId}`,
      },
    },
    {
      label: 'Read both dashboards side by side and answer six questions',
      expect:
        'From **Worker health**: what is p99 workflow-task schedule-to-start, what is the sticky ' +
        'cache hit rate, how many task slots stay free. From **Cloud overview**: what is your sync ' +
        'match rate, how many Actions has this lab burned, and is anything in the task queue ' +
        'backlog. Notice that no single dashboard could have answered all six.',
    },
    {
      label: 'Now break something and watch both sides disagree',
      command: 'kill the worker while load is running, then restart it',
      expect:
        'On the SDK side, schedule-to-start climbs and pollers drop to zero — then the series stops ' +
        'entirely, because the process reporting it is gone. On the Cloud side, backlog climbs and ' +
        'sync match rate collapses, and it keeps reporting throughout. That asymmetry is the whole ' +
        'argument for scraping both: the source that goes quiet during an incident is the one you ' +
        'most wanted to read.',
    },
    {
      label: 'Decide one paging alert and one ticket alert, and record where they live',
      command: `# add to the temporalcloud_namespace_tags "lab" block in lab1.tf:\n#   "session-5" = "<your doc link>"`,
      expect:
        'Write both into a document with the dashboard link, then record it as a tag. Add to the ' +
        'existing block rather than writing a second one — it manages the namespace\'s COMPLETE tag ' +
        'set, and a second declaration would delete every tag the earlier sessions set.',
      grades: 'session-5-documented',
    },
  ],

  snippetLang: 'hcl',
  snippet: ({ metricsAccountName, namespaceName }) => `# Goes in labs/lab5.tf.
#
# The terraform block, provider and version pin already live in labs/ —
# versions.tf and providers.tf. Resources only in here.
#
# This is the second service account you have built. Put it next to Session 2's
# and notice they share nothing:
#
#                        Worker (Lab 2)          Metrics scraper (Lab 5)
#   shape                namespace-scoped        account-level role
#   reach                one namespace           every namespace in the account
#   can be narrowed?     yes, at creation        no — there is no scoped form
#   what limits it       a permission            a query parameter you remember
#
# Least privilege is not always available. When it is not, the honest move is to
# know exactly which control is carrying the weight — here it is
# params.namespaces in prometheus.yml, which is configuration, not a grant.

resource "temporalcloud_service_account" "metrics" {
  name        = "${metricsAccountName}"
  description = "OpenMetrics scraper for ${namespaceName}. Read-only, account-wide."

  # The narrowest role that can read the metrics endpoint, and the only one
  # whose entire purpose is to be held by a machine. It grants metrics reads and
  # nothing else — no workflows, no namespaces, no users.
  #
  # There is deliberately no namespace_scoped_access block here. Unlike Lab 2's
  # Worker identity, this one CANNOT be scoped to a namespace: metricsread is an
  # account role and the provider offers no scoped form of it. Try adding one
  # and terraform validate rejects the combination before it calls the API.
  account_access = "metricsread"
}

# Owned by the service account, not by you. A scraper runs unattended for
# months; a key owned by a person stops working the day that person leaves —
# and in this account, the day their 48-hour window closes.
resource "temporalcloud_apikey" "metrics" {
  display_name = "${metricsAccountName}"
  owner_type   = "service-account"
  owner_id     = temporalcloud_service_account.metrics.id
  expiry_time  = "2026-12-31T00:00:00Z"
  disabled     = false
}

# Terraform will not print a sensitive value unless you name it:
#   terraform output -raw metrics_api_key
output "metrics_api_key" {
  value     = temporalcloud_apikey.metrics.token
  sensitive = true
}

# NOT here, and not anywhere: temporalcloud_metrics_endpoint. That is the older
# mTLS metrics endpoint, and it sets ONE account-global client CA — applying it
# replaces your instructor's and every other student's. The OpenMetrics endpoint
# above needs no CA at all, which is most of why it exists.
#
# Finally, the tag. ADD this key to the temporalcloud_namespace_tags "lab" block
# in lab1.tf. Do not declare a second block: that resource manages the COMPLETE
# tag set, so a second one deletes every tag Sessions 1-4 wrote.
#
#   tags = {
#     provisioner = "terraform"
#     ...
#     "session-5" = "<link to your dashboard and alert catalogue>"
#   }`,

  use: ({ namespaceName }) => ({
    intro:
      'Two sources, two sets of gotchas, and they are not the same gotchas. Both fail the same way ' +
      'when you get them wrong — an empty graph, no error, no hint — so both start by looking at ' +
      'the raw endpoint rather than trusting a name off a docs page.',
    steps: [
      {
        label: 'SDK: read the actual names your worker emits',
        command: `curl -s localhost:${METRICS_PORT}/metrics | grep -E '^temporal_' | cut -d'{' -f1 | sort -u`,
        expect:
          'Histogram families ending _seconds_bucket/_sum/_count, and counters and gauges with no ' +
          'suffix at all — temporal_workflow_completed, not temporal_workflow_completed_total. Ask ' +
          'for the _total form and you get an empty result with no error and no hint why.',
      },
      {
        label: 'Cloud: read the catalogue, which costs you nothing',
        command:
          'curl -sS -H "Authorization: Bearer $METRICS_API_KEY" \\\n' +
          '  https://metrics.temporal.io/v1/descriptors | jq -r \'.descriptors[] | "\\(.name)  \\(.dimensions | join(","))"\'',
        expect:
          'Every metric with its available labels. Two reasons to prefer this over the docs page: it ' +
          'is what your account actually serves, and `/v1/descriptors` is not the endpoint the ' +
          '180/hr budget is protecting — `/v1/metrics` is. Explore here, scrape there.',
      },
      {
        label: 'Cloud: the query that catches the wrong mental model',
        command:
          `# WRONG — a rate of a rate. Near-zero, or nothing.\nrate(temporal_cloud_v1_workflow_success_count{temporal_namespace=~"${namespaceName}.*"}[5m])\n\n` +
          `# RIGHT — it is ALREADY per-second.\nsum(temporal_cloud_v1_workflow_success_count{temporal_namespace=~"${namespaceName}.*"})`,
        expect:
          'Run both. Every temporal_cloud_v1_* metric is a gauge, including the ones ending _count, ' +
          'and Temporal has already computed the per-second rate over its one-minute window. The ' +
          '_count suffix means "counter" everywhere else in Prometheus, which is precisely why this ' +
          'costs people an afternoon.',
      },
      {
        label: 'Cloud: sync match rate — the SLI your worker cannot see',
        command:
          `sum(temporal_cloud_v1_poll_success_sync_count{temporal_namespace=~"${namespaceName}.*"})\n/\n` +
          `clamp_min(sum(temporal_cloud_v1_poll_success_count{temporal_namespace=~"${namespaceName}.*"}), 0.001)`,
        expect:
          'Near 1.0 with a healthy worker. A sync match is a task handed straight to a waiting ' +
          'poller without ever hitting the backlog — so this falling is the earliest signal that you ' +
          'are short of worker capacity, well before latency moves. Nothing in your process knows ' +
          'this number; it is a fact about the server side of the connection.',
      },
      {
        label: 'Cloud: what this lab is costing, in the unit you are billed in',
        command: `sum(temporal_cloud_v1_total_action_count{temporal_namespace=~"${namespaceName}.*"})`,
        expect:
          'Actions per second, which is the pricing unit. Multiply by 60 for the per-minute figure, ' +
          'and compare it against `temporal_cloud_v1_action_limit` for the same namespace. The ' +
          'Billable Actions row of the Cloud overview dashboard does this properly — including a ' +
          'retry ratio and a heartbeat ratio, both of which are places a bug turns directly into ' +
          'money.',
      },
      {
        label: 'SDK: is anyone polling? (gauge — no suffix)',
        command: 'sum(temporal_num_pollers) by (poller_type)',
        expect:
          'One series per poller type while the worker runs, dropping to nothing when you kill it. ' +
          'This is the first query to run when someone says Temporal is broken — and note that when ' +
          'it matters most, it disappears, because the process reporting it is the one that died.',
      },
      {
        label: 'SDK: is work waiting? (histogram — _seconds_bucket)',
        command:
          'histogram_quantile(0.99,\n  sum(rate(temporal_workflow_task_schedule_to_start_latency_seconds_bucket[5m])) by (le, task_queue)\n)',
        expect:
          'Near zero with a healthy worker. Kill the worker mid-load and watch it climb — the tasks ' +
          'are not lost, they are queued, and this is the number that tells you so. This IS a real ' +
          'histogram, so `rate()` and `histogram_quantile` are correct here and wrong on the Cloud ' +
          'percentiles, which arrive pre-computed and cannot be re-aggregated.',
      },
      {
        label: 'SDK: is replay being avoided? (counters — no suffix)',
        command:
          '(sum(rate(temporal_sticky_cache_hit[5m])) or vector(0))\n/\nclamp_min(\n  (sum(rate(temporal_sticky_cache_hit[5m])) or vector(0))\n  + (sum(rate(temporal_sticky_cache_miss[5m])) or vector(0)),\n  0.001\n)',
        expect:
          'High. A low hit rate means workflows are evicted and replayed from history — same result, ' +
          'more latency and CPU. It is a sizing signal, not a correctness one.',
      },
      {
        label: 'SDK: the metric that catches a stuck workflow',
        command: 'sum(rate(temporal_workflow_task_execution_failed[5m])) or vector(0)',
        expect:
          'Zero normally. The `or vector(0)` matters: a counter that has never fired emits no series ' +
          'at all, so without it this returns blank rather than zero. Run Session 6 drill 1 and it ' +
          'climbs while the workflow is neither completed nor failed — which is exactly why an alert ' +
          'on workflow failure rate would never fire.',
      },
      {
        label: 'Both: which backlog is which version draining?',
        command:
          `sum(temporal_cloud_v1_approximate_backlog_count{temporal_namespace=~"${namespaceName}.*"})\n  by (temporal_task_queue, temporal_worker_build_id)`,
        expect:
          `Backlog split by Build ID — ${LAB_BUILD_ID_V2} draining, older versions flat. This only ` +
          'works because the scrape opts in to `temporal_worker_build_id`, a high-cardinality label ' +
          'the endpoint omits by default; the `labels` query parameter in prometheus.yml turns it ' +
          'on. It answers the question Session 3 left open, and neither the SDK metrics nor the ' +
          'default Cloud scrape can touch it.',
      },
    ],
    stretch: {
      title: 'Stretch: the alert worth keeping, and the one that will page you at 4am for nothing',
      body:
        'Most teams page on error rate and learn to ignore it. Try instead: page when p99 ' +
        'schedule-to-start exceeds your SLO for 10 minutes, because that means work is silently ' +
        'piling up and no other signal will tell you. Ticket everything else. Then look hard at the ' +
        'Cloud percentile metrics before you alert on any of them — they are computed over ' +
        'one-minute windows, they cannot be re-aggregated into a longer one, and on a namespace as ' +
        'quiet as yours a single slow request drags p50, p95 and p99 to the same number. Gate any ' +
        'percentile alert on a minimum `temporal_cloud_v1_service_request_count` or it will fire on ' +
        'statistical noise. Write both rules into Grafana as real alert rules rather than leaving ' +
        'them in a document.',
    },
  }),

  checkpoints: [
    {
      id: 'metrics-service-account',
      title: 'Metrics scraper identity exists, with the Metrics Read-Only role',
      detail:
        'A service account with your assigned metrics name, carrying `account_access = "metricsread"`. ' +
        'This is the credential the OpenMetrics endpoint authenticates, and the narrowest role that ' +
        'can read it. It is account-level by necessity — there is no namespace-scoped form.',
    },
    {
      id: 'metrics-api-key',
      title: 'API key owned by the scraper, not by you',
      detail:
        'At least one API key whose owner is the metrics service account. A key owned by a person ' +
        'dies with the person — and in this account, when their 48-hour window closes.',
    },
    {
      id: 'worker-polled',
      title: 'A worker polled your task queue',
      detail:
        `At least one poller on ${LAB_TASK_QUEUE}. You cannot emit SDK metrics without a running ` +
        'worker, so this is the closest the portal can get to verifying that half of the lab from ' +
        'outside your sandbox.',
    },
    {
      id: 'load-generated',
      title: 'Enough traffic to make a curve',
      detail:
        'At least 10 completed workflow executions. One workflow gives you a dot on a graph; a ' +
        'dashboard you can read needs load — and the Cloud metrics need a few one-minute windows ' +
        'with something in them before any panel has a shape.',
    },
    {
      id: 'session-5-documented',
      title: 'Dashboard and alert catalogue recorded',
      detail:
        'Looks for a `session-5` namespace tag. Your Grafana runs in your sandbox and the portal ' +
        'cannot reach it — this records that you built it, and verifies nothing about what is on it. ' +
        'What the portal CAN now verify is the identity your scraper runs as, above.',
      selfAttested: true,
    },
  ],

  async grade(ctx) {
    const ns = await ctx.labNamespace();
    if (!ns) {
      return ctx.blockedAll(`No namespace named "${ctx.namespaceName}" — complete Session 1 first.`);
    }

    /* -- The scraper's identity: ordinary control-plane state ------------ */
    const [serviceAccounts, apiKeys] = await Promise.all([ctx.serviceAccounts(), ctx.apiKeys()]);
    const sa = serviceAccounts.find((s) => s.spec?.name === ctx.metricsAccountName);
    const role = sa ? accountRoleOf(sa) : undefined;

    const identity = !sa
      ? [
          ctx.mk(
            'metrics-service-account',
            'fail',
            `No service account named "${ctx.metricsAccountName}".`,
          ),
          ctx.mk('metrics-api-key', 'blocked', 'Waiting on the service account.'),
        ]
      : [
          ctx.check(
            'metrics-service-account',
            role === REQUIRED_METRICS_ROLE,
            `${sa.spec?.name} carries ${role} (${sa.state}).`,
            role
              ? `${sa.spec?.name} exists but carries ${role}, not ${REQUIRED_METRICS_ROLE}. The ` +
                'endpoint authenticates any role that can read metrics, so a broader one works — ' +
                'which is exactly why it is worth choosing the narrowest deliberately.'
              : `${sa.spec?.name} exists but has no account role. Set account_access = "metricsread".`,
          ),
          ctx.check(
            'metrics-api-key',
            apiKeys.some((k) => k.spec?.owner_id === sa.id),
            `${apiKeys.filter((k) => k.spec?.owner_id === sa.id).length} API key(s) owned by ${sa.spec?.name}.`,
            'No API key owned by the metrics service account — owner_type "service-account" is what ' +
              'makes the scraper outlive you.',
          ),
        ];

    /* -- The tag: a claim, and labelled as one --------------------------- */
    const tag = (namespaceTags(ns)['session-5'] ?? '').trim();
    const documented = ctx.check(
      'session-5-documented',
      tag !== '',
      `Documented at ${tag}`,
      'No session-5 tag on your namespace.',
    );

    /* -- The data plane: proof a worker ran ------------------------------ */
    const reader = await ctx.dataPlane();
    if (!reader) {
      return [
        ...identity,
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
      ...identity,
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
