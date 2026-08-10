# Lab 5 — local Prometheus and Grafana

SDK metrics are emitted by *your worker process*, not by Temporal Cloud, so the whole stack runs on
your laptop. Nothing here talks to `bvmon` except the worker itself.

## 1. Start the stack

```bash
cd labs/observability
docker compose up -d
```

| | URL | Login |
|---|---|---|
| Grafana | <http://localhost:3030> | `admin` / `admin` (anonymous access is on, so you can skip it) |
| Prometheus | <http://localhost:9090> | — |

The **Temporal Worker health** dashboard is provisioned automatically — look under Dashboards →
Temporal. You do not need to import anything.

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
cd ../dotnet
dotnet run -- worker --metrics-port 9464
```

You should see `SDK metrics on http://localhost:9464/metrics`.

## 3. Confirm Prometheus found it

<http://localhost:9090> → **Status → Targets**. The `temporal-sdk` job should show
`host.docker.internal:9464` as **UP**.

The second target on `9465` stays **DOWN** — that is deliberate. Run a second worker on that port if
you want to see per-worker metrics side by side:

```bash
dotnet run -- worker --metrics-port 9465
```

## 4. Generate traffic

One workflow gives you a single point. A dashboard you can read needs load:

```bash
dotnet run -- load --count 50
```

## Why your queries return nothing

The most common failure in this lab, and it fails *silently*. These are the names this project's worker actually emits, confirmed by curling the endpoint —
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

## Tearing down

```bash
docker compose down          # keep nothing
docker compose down -v       # also drop volumes
```
