# Lab 5 — Prometheus and Grafana over both metric sources

One Prometheus, one Grafana, two scrape jobs — because there are two sources and neither one can
answer the other's questions.

| Job | Source | What only it knows | Cost |
|---|---|---|---|
| `temporal-sdk` | your worker process, port 9464 | pollers, task slots, sticky cache, schedule-to-start | free, scrape as fast as you like |
| `temporal-cloud` | `metrics.temporal.io` | backlog, sync match rate, service latency, Actions consumed | **180 requests per hour, shared by the whole account** |

The split is not arbitrary. A worker cannot report a backlog it never received, and Temporal Cloud
cannot report a sticky cache miss that happened inside your process. Alert on one and you are blind
to half the failure modes — which is the point of building both today.

## 1. Start the stack

```bash
cd labs/observability
docker compose up -d
```

| | URL | Login |
|---|---|---|
| Grafana | <http://localhost:3030> | `admin` / `admin` (anonymous access is on, so you can skip it) |
| Prometheus | <http://localhost:9090> | — |

Two dashboards are provisioned automatically — look under Dashboards → Temporal. You do not need to
import anything.

| Dashboard | Built from | Source |
|---|---|---|
| **Temporal Worker health** | the `temporal-sdk` job | written for this workshop |
| **Temporal Cloud overview** | the `temporal-cloud` job | [grafana/jsonnet-libs `temporal-mixin`](https://github.com/grafana/jsonnet-libs/blob/master/temporal-mixin/dashboards/temporal-overview.json), vendored |

Worker health is organised in five rows, roughly in the order you would read them during an incident:

| Row | Answers |
|---|---|
| **Triage** | Is anyone polling, is work queueing, is the worker full, is anything failing |
| **Latency** | Where the time goes — end-to-end, both schedule-to-start queues, workflow task and activity execution |
| **Replay and the sticky cache** | What eviction is costing you, in seconds of replay |
| **Saturation** | Slot utilisation per worker type, from `used` *and* `available` |
| **Network** | Long polls, request rate, failures by status code, and round-trip latency to the frontend |

The Cloud overview is the dashboard Temporal's own docs point you at, vendored here rather than
imported so it provisions with no Grafana Cloud account. Every panel and query is upstream's; the
only edits are presentational — title, `editable`, timezone, a 3-hour default window and a 30s
refresh (upstream's 1-hour window holds about twenty samples at this scrape interval) — plus the
datasource variable's saved default, which upstream points at a Grafana Cloud datasource that does
not exist here.

Its panels are empty until you finish step 5. **Temporal namespace** and **Temporal region** at the
top are template variables — they populate from whatever has actually been scraped, so an empty
dropdown means no data has arrived yet, not that you picked the wrong namespace.

### "address already in use"

Something on your machine already owns that port. Both are overridable:

```bash
GRAFANA_PORT=3031 PROMETHEUS_PORT=9091 docker compose up -d
```

Or make it stick, so you don't have to remember:

```bash
echo 'GRAFANA_PORT=3031' >> .env
docker compose up -d
```

If a container half-started before the error, clear it first:

```bash
docker compose down
docker compose up -d
```

To find the culprit: `lsof -nP -iTCP:3030 -sTCP:LISTEN` (macOS/Linux).

## 2. Start a worker that emits metrics

In another terminal, with the environment variables from your session page exported:

```bash
cd ../worker
dotnet run -- worker --version 2.0 --metrics-port 9464
```

You should see `SDK metrics on http://localhost:9464/metrics`.

`--version 2.0` matches the current version Lab 3 left on the `training-workers` Worker Deployment.
A versioned task queue routes new executions only to its current version, so an unversioned worker
is handed no tasks at all — the load you generate below would appear in the Cloud UI and never run.
The worker prints a warning if you forget.

## 3. Confirm Prometheus found it

<http://localhost:9090> → **Status → Targets**. The `temporal-sdk` job should show
`host.docker.internal:9464` as **UP**.

Two targets are **DOWN** at this point and both are deliberate.

`host.docker.internal:9465` stays down until you run a second worker on that port, which is worth
doing if you want to see per-worker metrics side by side:

```bash
dotnet run -- worker --version 2.0 --metrics-port 9465
```

`metrics.temporal.io` shows `server returned HTTP status 401 Unauthorized` — or is still blank, if
its first scrape has not landed yet. That job runs every 180 seconds, not every 5, so give it up to
three minutes before concluding anything. Read the 401 properly before you fix it in step 5: the
shipped `cloud-api-key` holds a placeholder, and this is exactly what a wrong or expired metrics key
looks like from the outside. Nothing in it says the credential is the problem rather than the
endpoint, the network, or the account.

## 4. Generate traffic

One workflow gives you a single point. A dashboard you can read needs load:

```bash
dotnet run -- load --count 50
```

## 5. Wire up Temporal Cloud metrics

Your `lab5.tf` created a service account with the **Metrics Read-Only** account role and an API key
owned by it. That key is the whole credential story for `metrics.temporal.io` — no CA to upload, no
client certificates to distribute, and nothing account-global to set. It is worth noticing what the
old mTLS metrics endpoint required by comparison, and that `temporalcloud_metrics_endpoint` is a
single account-wide setting you must *not* touch in a shared account.

Get the key out of Terraform and check it works before Prometheus ever sees it:

```bash
cd ../                                       # labs/
export METRICS_API_KEY=$(terraform output -raw metrics_api_key)

curl -s -H "Authorization: Bearer $METRICS_API_KEY" \
  https://metrics.temporal.io/v1/metrics | head -20
```

Expect output beginning `# TYPE temporal_cloud_v1_...`. There is no browser UI — opening that URL in
a tab returns `Jwt is missing`, and so does an empty `Authorization` header.

Now hand the key to Prometheus and point the job at your own namespace:

```bash
cd observability
printf '%s' "$METRICS_API_KEY" > cloud-api-key     # replaces the placeholder
```

Then edit `prometheus.yml` and replace `training-REPLACE-ME*` under `params.namespaces` with your own
namespace — your session page has the exact line. Reload:

```bash
docker compose restart prometheus
```

Within about three minutes, **Status → Targets** shows `metrics.temporal.io` **UP**, and the
**Temporal Cloud overview** dashboard fills in. Three minutes, not thirty seconds: the endpoint
serves the last *completed* one-minute aggregation window, so there is a fixed ~3 minute delay
between something happening and it being scrapeable. Plan alert windows around that.

> **`cloud-api-key` is tracked by git and now holds a real credential.** It has to exist before
> Prometheus starts — `credentials_file` is read at config load, and a missing file takes the whole
> stack down rather than one target — so it ships with a placeholder rather than being gitignored.
> Do not commit it. `git checkout labs/observability/cloud-api-key` puts the placeholder back when
> you are done.

### The rate limit is the interesting part

`metrics.temporal.io` allows **180 requests per hour per account**. Not per API key, not per service
account, not per namespace — per account. Everyone in this room is scraping `bvmon`.

| Scrape interval | Requests/hour each | Students that fit in 180/hr |
|---|---|---|
| 30s (the documented default) | 120 | 1 |
| 60s | 60 | 3 |
| **180s (shipped here)** | **20** | **9** |
| 300s | 12 | 15 |

Do not push past 300s. Metrics are aggregated into one-minute windows and each scrape returns only
the most recently completed one, so a longer interval silently drops windows — and past five minutes
Prometheus marks the series stale and the graphs break into disconnected islands. If your cohort is
larger than nine, raise `scrape_interval` on the `temporal-cloud` job before everyone starts, and
expect `429 Too Many Requests` with a `Retry-After` header if you get it wrong.

This is the shape of the constraint, not a workshop quirk: one scraper per engineer does not survive
contact with an account-wide budget. In production you run **one** collector at 30s and fan the data
out internally, the same way you would treat any shared upstream quota.

### The two query parameters that make it survivable

Both are already set on the job, and both matter more than they look:

```yaml
params:
  namespaces: ['training-yourname*']
  labels: ['temporal_worker_deployment_name', 'temporal_worker_build_id']
```

`namespaces` filters server-side. Drop it and you scrape every namespace in the account — every other
student's included — against a 50k-datapoint response cap, and `X-Completeness: limited` in the
response header is the only warning you get that data was silently truncated.

`labels` opts *in* to high-cardinality labels that are off by default. These two put a Build ID on
`temporal_cloud_v1_approximate_backlog_count`, which answers a question Session 3 left open and the
SDK metrics cannot touch: *is the version I just made current actually draining the queue?*

## Why your queries return nothing

The most common failure in this lab, and it fails *silently*. Worse, the two metric sources fail
this way for **completely different reasons**, so the fix you learn on one does not transfer.

### Cloud metrics: never wrap them in `rate()`

Every `temporal_cloud_v1_*` metric is exposed as an OpenMetrics **gauge**, including the ones whose
names end in `_count`. They are not counters. `temporal_cloud_v1_workflow_success_count` is already
*workflows succeeded per second*, pre-computed by Temporal over the one-minute window.

```promql
# WRONG — rate of a rate. Returns near-zero, or nothing at all.
rate(temporal_cloud_v1_workflow_success_count[5m])

# RIGHT — it is already a per-second rate; just aggregate it.
sum(temporal_cloud_v1_workflow_success_count) by (temporal_workflow_type)
```

The `_count` suffix is what catches people, because it means "counter" everywhere else in the
Prometheus ecosystem. The `_p50`/`_p95`/`_p99` families have the mirror-image trap: they are
pre-calculated per one-minute window and **cannot** be re-aggregated, so `histogram_quantile` has
nothing to work with and averaging them across windows produces a number that is not a percentile of
anything. Read them directly.

One more, specific to a lab-sized namespace: percentiles need roughly 20 samples in a window to mean
anything. Fifty workflows spread over fifteen minutes will not get you there, and p50, p95 and p99
will converge on whichever request happened to be slowest. That is a property of your traffic, not a
bug — and it is why a percentile alert on a low-traffic namespace should be gated on a minimum
`temporal_cloud_v1_service_request_count`.

### SDK metrics: the names are not what the internet says

These are the names this project's worker actually emits, confirmed by curling the endpoint —
not copied from a docs page:

| Metric type | Suffix | Example |
|---|---|---|
| Counter | **none** | `temporal_workflow_completed` |
| Histogram | `_seconds_bucket` / `_sum` / `_count` | `temporal_workflow_task_schedule_to_start_latency_seconds_bucket` |
| Gauge | **none** | `temporal_num_pollers` |

Two traps live here.

**Durations.** The .NET exporter defaults to *integer milliseconds with no `_seconds` in the name*.
`labs/worker` sets two options to fix that:

```csharp
Prometheus = new($"0.0.0.0:{metricsPort}")
{
    HasUnitSuffix         = true,   // default: false
    UseSecondsForDuration = true,   // default: false (milliseconds!)
}
```

**Counters.** Much of the internet writes `temporal_workflow_completed_total`, because that is the
OpenMetrics convention. In Temporalio 1.17 the counters carry **no `_total` suffix at all** — and
setting `HasCounterTotalSuffix = true` changes nothing; the emitted names were byte-identical with
the flag on and off. So query `temporal_workflow_completed`.

Either mistake gives you an empty graph and no error, which is why step one of this lab is to look
at the raw endpoint rather than trust any of the above:

```bash
curl -s localhost:9464/metrics | grep -E '^temporal_' | cut -d'{' -f1 | sort -u
```

### Porting a dashboard written for another SDK

Almost every Temporal dashboard you will find online was written against the Java or TypeScript SDK,
and **not one of its queries runs unmodified here**. The underlying metrics are the same — .NET,
TypeScript, Python and Ruby all sit on the same Rust core — but the Prometheus exporter names them
differently per SDK and per configuration. This table is the mapping, measured by running this
worker and diffing the endpoint against
[a TypeScript worker-tuning dashboard](https://github.com/taonic/temporal-training-operations-typescript/blob/main/worker-tuning/dashboard/sdk_metrics.json):

| In a TS/Java dashboard | Here (.NET, `labs/worker` options) |
|---|---|
| `..._latency_bucket`, then `/ 1000` | `..._latency_seconds_bucket`, **no division** |
| `temporal_request_total` | `temporal_request` |
| `temporal_long_request_total` | `temporal_long_request` |
| `temporal_request_failure_total` | `temporal_request_failure` |
| `temporal_long_request_failure_total` | `temporal_long_request_failure` |
| `temporal_sticky_cache_hit_total` | `temporal_sticky_cache_hit` |
| `temporal_sticky_cache_miss_total` | `temporal_sticky_cache_miss` |
| `temporal_sticky_cache_total_forced_eviction_total` | `temporal_sticky_cache_total_forced_eviction` |
| `temporal_sticky_cache_size`, `temporal_worker_task_slots_available` | unchanged — gauges never took a suffix |
| `temporal_poller_start_total` | **not emitted.** Use `temporal_num_pollers` (gauge) |
| `process_cpu_usage`, `jvm_memory_used_bytes`, `jvm_memory_max_bytes` | **not emitted.** See below |

The `/ 1000` is the one that will not announce itself. Those dashboards divide because their exporter
reports integer milliseconds; ours reports seconds, so keeping the division renders every latency a
thousand times too small — a plausible-looking graph that is simply wrong, which is worse than a
blank one.

**There are no host metrics.** The .NET SDK's Prometheus exporter publishes Temporal Core's metrics
and nothing else — no CPU, no heap, no GC, no `process_*` at all. Any dashboard with a "Compute" row
built on `process_cpu_usage` loses it here. In production you would run a separate exporter, or the
OpenTelemetry .NET runtime instrumentation, alongside on its own port and correlate in Grafana.

Three metrics worth knowing that the TS dashboard does not use, and which are on Worker health here:

| Metric | Why it earns a panel |
|---|---|
| `temporal_worker_task_slots_used` | The `available` gauge alone cannot give you a utilisation *ratio*; with both you get one number for "is this worker full" |
| `temporal_workflow_task_replay_latency_seconds` | Puts the cost of a cache eviction in seconds, rather than leaving it as an abstract hit rate |
| `temporal_num_pollers{poller_type=...}` | Splits `workflow_task`, `sticky_workflow_task` and `activity_task`. Sticky pollers vanishing while the others hold is a cache problem, not a capacity one |

And two more the endpoint emits that no panel uses, in case you want them:
`temporal_activity_task_received` (carries an `eager` label, for eager activity dispatch) and
`temporal_workflow_task_queue_poll_succeed`.

The same move works on the Cloud side, and there it is cheap in a way the scrape is not —
`/v1/descriptors` returns every metric with its help text and its available labels, and it is not
the endpoint the 180/hr budget is protecting:

```bash
curl -sS -H "Authorization: Bearer $METRICS_API_KEY" \
  https://metrics.temporal.io/v1/descriptors | jq -r '.descriptors[].name'
```

## Tearing down

```bash
docker compose down          # keep nothing
docker compose down -v       # also drop volumes
git checkout cloud-api-key   # put the placeholder back, drop the real key
```
