"""Lab 5 — Troubleshooting. Break it on purpose, in a room where that is safe.

  uv run lab5_chaos.py worker                      the healthy worker
  uv run lab5_chaos.py worker --break-determinism   the same worker, bad build
  uv run lab5_chaos.py determinism                  drill 1: start it, then swap workers
  uv run lab5_chaos.py stuck                        drill 4: an Activity that hangs

Drill 2 needs no command: stop every worker, start a Lab 1 workflow, and watch
schedule-to-start climb on the Lab 3 dashboard.

Add --local to any of them to run against `temporal server start-dev`.
"""

from __future__ import annotations

import sys

from training.cli import flag_present, flag_value, positionals, run
from training.config import TASK_QUEUE, connect
from training.lab1_greeting import GreetingWorkflow
from training.lab5_drills import StuckActivityWorkflow
from training.worker import build_worker, poll_until_stopped


async def run_worker(argv: list[str], suffix: str) -> int:
    broken = flag_present(argv, "--break-determinism")
    client = await connect(
        local=flag_present(argv, "--local"),
        namespace_override=flag_value(argv, "--namespace"),
    )
    return await poll_until_stopped(
        build_worker(client, broken=broken),
        f"Polling '{TASK_QUEUE}'"
        + (" with DELIBERATELY BROKEN determinism" if broken else "")
        + ". Ctrl-C to stop.",
    )


async def run_determinism(argv: list[str], suffix: str) -> int:
    """Drill 1. Start on a healthy worker, then restart the worker with
    --break-determinism. The task fails on replay and retries forever: the
    workflow is stuck, NOT failed, and no error rate moves."""
    client = await connect(
        local=flag_present(argv, "--local"),
        namespace_override=flag_value(argv, "--namespace"),
    )
    workflow_id = f"chaos-1-{suffix}"
    await client.start_workflow(
        GreetingWorkflow.run, suffix, id=workflow_id, task_queue=TASK_QUEUE
    )
    print(f"Started {workflow_id}. Now restart your worker with --break-determinism,")
    print(f"then run: temporal workflow describe --workflow-id {workflow_id}")
    print("Restart the worker WITHOUT the flag to let it recover.")
    return 0


async def run_stuck(argv: list[str], suffix: str) -> int:
    """Drill 4. The Activity heartbeats, then hangs. The heartbeat is what lets
    you tell "stuck" from "slow", and what lets the retry resume from the last
    reported progress instead of from zero."""
    client = await connect(
        local=flag_present(argv, "--local"),
        namespace_override=flag_value(argv, "--namespace"),
    )
    workflow_id = f"chaos-4-{suffix}"
    await client.start_workflow(
        StuckActivityWorkflow.run, id=workflow_id, task_queue=TASK_QUEUE
    )
    print(f"Started {workflow_id}. The Activity will heartbeat, then hang.")
    print(f"Watch: temporal workflow describe --workflow-id {workflow_id}")
    print("The heartbeat timeout fires after ~10s and the retry resumes.")
    return 0


if __name__ == "__main__":
    # `chaos determinism` and `chaos stuck` were one command with a positional
    # in the old single-entrypoint starter. They are two commands now, which is
    # what the session page says and one less thing to mistype at 15:45.
    argv = sys.argv[1:]
    if argv and argv[0] == "chaos":
        drill = positionals(argv)
        sys.argv = [sys.argv[0], drill[0] if drill else "determinism", *argv[1:]]

    sys.exit(
        run(
            "lab5_chaos.py",
            {
                "worker": run_worker,
                "determinism": run_determinism,
                "stuck": run_stuck,
            },
            default="determinism",
        )
    )
