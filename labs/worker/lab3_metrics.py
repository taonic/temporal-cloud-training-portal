"""Lab 3 — Observability. A worker that exports SDK metrics, and traffic to see.

  uv run lab3_metrics.py worker           poll, exporting Prometheus on :9464
  uv run lab3_metrics.py load --count 50  enough workflows to make a curve

The worker is the same one Lab 1 runs; the only difference is `--metrics-port`,
and the only thing that flag does is turn on an exporter. That is worth one
sentence in the room: SDK metrics are not an integration, they are a runtime
option, and the reason teams do not have them is almost never effort.

Add --local to either to run against `temporal server start-dev`.
"""

from __future__ import annotations

import asyncio
import sys

from training.cli import flag_present, flag_value, run, stamp
from training.config import TASK_QUEUE, connect
from training.lab1_greeting import GreetingWorkflow
from training.worker import build_worker, poll_until_stopped

DEFAULT_METRICS_PORT = "9464"


async def run_worker(argv: list[str], suffix: str) -> int:
    port = flag_value(argv, "--metrics-port") or DEFAULT_METRICS_PORT
    client = await connect(
        metrics_port=port,
        local=flag_present(argv, "--local"),
        namespace_override=flag_value(argv, "--namespace"),
    )
    return await poll_until_stopped(
        build_worker(client),
        f"Polling '{TASK_QUEUE}' with metrics on :{port}. Ctrl-C to stop.",
    )


async def run_load(argv: list[str], suffix: str) -> int:
    """Generate enough traffic that the dashboard has a curve rather than a point."""
    client = await connect(
        local=flag_present(argv, "--local"),
        namespace_override=flag_value(argv, "--namespace"),
    )
    raw = flag_value(argv, "--count")
    count = int(raw) if raw and raw.isdigit() else 50
    print(f"Starting {count} workflows…")

    started = stamp()
    handles = [
        await client.start_workflow(
            GreetingWorkflow.run,
            f"{suffix}-{index}",
            id=f"load-{suffix}-{started}-{index}",
            task_queue=TASK_QUEUE,
        )
        for index in range(count)
    ]

    await asyncio.gather(*(handle.result() for handle in handles))
    print(f"{count} workflows completed. Check Grafana at http://localhost:3030")
    return 0


if __name__ == "__main__":
    sys.exit(
        run("lab3_metrics.py", {"worker": run_worker, "load": run_load}, default="worker")
    )
