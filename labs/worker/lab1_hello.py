"""Lab 1 — Foundations. Prove the namespace, the credential and the worker.

  uv run lab1_hello.py worker      poll the task queue
  uv run lab1_hello.py start       run one workflow and print its result

Add --local to either to run against `temporal server start-dev` instead of
Cloud. uv creates and syncs the virtualenv on first run; there is no install
step.

Connection comes from TEMPORAL_ADDRESS, TEMPORAL_NAMESPACE and TEMPORAL_API_KEY
— the session page prints the exact values for your namespace.
"""

from __future__ import annotations

import sys

from training.cli import flag_present, flag_value, run, stamp
from training.config import TASK_QUEUE, connect
from training.lab1_greeting import GreetingWorkflow
from training.worker import build_worker, poll_until_stopped


async def run_worker(argv: list[str], suffix: str) -> int:
    client = await connect(
        local=flag_present(argv, "--local"),
        namespace_override=flag_value(argv, "--namespace"),
    )
    return await poll_until_stopped(
        build_worker(client),
        f"Polling '{TASK_QUEUE}'. Ctrl-C to stop.",
    )


async def run_start(argv: list[str], suffix: str) -> int:
    client = await connect(
        local=flag_present(argv, "--local"),
        namespace_override=flag_value(argv, "--namespace"),
    )
    workflow_id = f"training-{suffix}-{stamp()}"

    print(f"Starting {workflow_id}…")
    handle = await client.start_workflow(
        GreetingWorkflow.run, suffix, id=workflow_id, task_queue=TASK_QUEUE
    )

    print("Waiting for the result — if this hangs, no worker is polling.")
    print(await handle.result())
    return 0


if __name__ == "__main__":
    sys.exit(
        run("lab1_hello.py", {"worker": run_worker, "start": run_start}, default="start")
    )
