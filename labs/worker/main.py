"""Training starter — used in Labs 1 and 3 to 6.

  uv run main.py worker                          Lab 1: plain worker
  uv run main.py start                           Lab 1: run one workflow

  uv run main.py worker --metrics-port 9464       Lab 5: SDK metrics
  uv run main.py load --count 50                  Lab 5: traffic

  uv run main.py quote                            Lab 6: call the Rate Desk
  uv run main.py desk                             Lab 6: HOST it (instructor only)

  uv run main.py worker --break-determinism       Lab 7 drill 1
  uv run main.py chaos determinism                Lab 7 drill 1: start it
  uv run main.py chaos stuck                      Lab 7 drill 4

  --- parked with Labs 3 and 4, still working if you restore them ---
  uv run main.py worker --version 1.0             Worker Versioning: v1
  uv run main.py worker --version 2.0             Worker Versioning: v2
  uv run main.py worker --version 2.0 --proxy     Encryption proxy
  uv run main.py start  --proxy                   Encryption proxy: sealed payload

Add --local to any of them to run against `temporal server start-dev` instead of
Cloud. uv creates and syncs the virtualenv on first run; there is no install step.

--version is PARKED with the Worker Versioning lab. Do not pass it in this
cohort: a versioned worker registers a version that nothing routes to and is
handed no tasks at all — workflows appear in the UI and never start, with no
error on either side. The flag and everything behind it still work; restore
Lab 3 and it becomes required from that lab onward.

Connection comes from TEMPORAL_ADDRESS, TEMPORAL_NAMESPACE and TEMPORAL_API_KEY
— the session page prints the exact values for your namespace.
"""

from __future__ import annotations

import asyncio
import getpass
import os
import signal
import sys
from datetime import datetime, timezone

from temporalio.client import Client
from temporalio.common import VersioningBehavior, WorkerDeploymentVersion
from temporalio.worker import Worker, WorkerDeploymentConfig

from training.activities import describe, hang_after_heartbeat
from training.config import DEPLOYMENT_NAME, TASK_QUEUE, MissingSetting, connect
from training.desk import DESK_TASK_QUEUE, QuoteWorkflow, RateDeskHandler, issue_ticket, price
from training.rate_desk import DEFAULT_ENDPOINT, QuoteRequest
from training.workflows import (
    BrokenGreetingWorkflow,
    GreetingWorkflow,
    PaymentWorkflow,
    StuckActivityWorkflow,
)


def flag_value(argv: list[str], name: str) -> str | None:
    if name in argv:
        i = argv.index(name)
        if i + 1 < len(argv):
            return argv[i + 1]
    return None


def stamp() -> str:
    return datetime.now(timezone.utc).strftime("%H%M%S")


async def run_worker(argv: list[str], suffix: str) -> int:
    client = await connect(
        metrics_port=flag_value(argv, "--metrics-port"),
        local="--local" in argv,
        proxy="--proxy" in argv,
        namespace_override=flag_value(argv, "--namespace"),
    )
    version = flag_value(argv, "--version")
    broken = "--break-determinism" in argv

    deployment_config = None
    if version is not None:
        # Setting deployment_config is what makes the server register a Worker
        # Deployment. An unversioned worker creates nothing, which is why Lab 3's
        # first checkpoint fails without this.
        deployment_config = WorkerDeploymentConfig(
            version=WorkerDeploymentVersion(
                deployment_name=DEPLOYMENT_NAME, build_id=version
            ),
            use_worker_versioning=True,
            # PINNED: an execution finishes on the version it started on, which is
            # what lets v1 drain safely while v2 takes new traffic.
            #
            # This lives on the WORKER rather than as `versioning_behavior=` on the
            # workflow class, and that is not a style choice. A workflow that
            # declares a versioning behaviour while its worker is UNVERSIONED is
            # rejected by the server, and the workflow task then retries forever —
            # so the execution hangs instead of failing. Setting it here keeps the
            # same workflow code usable by the unversioned workers in Labs 1 and 2,
            # which run before any Worker Deployment exists.
            default_versioning_behavior=VersioningBehavior.PINNED,
        )
        print(f"Versioned worker: {DEPLOYMENT_NAME}.{version}")
    else:
        print("Unversioned worker (no Worker Deployment will be created)")
        print(
            f"  NOTE: if Lab 3 has run, {DEPLOYMENT_NAME} has a current version and this "
            "worker will be handed NO tasks — workflows will sit in the UI and never "
            "start. Add --version 2.0."
        )

    # Exactly one of these is registered: both declare the workflow type name
    # "GreetingWorkflow", so registering both is a duplicate-type error.
    greeting = BrokenGreetingWorkflow if broken else GreetingWorkflow

    worker = Worker(
        client,
        task_queue=TASK_QUEUE,
        # PaymentWorkflow is the Nexus caller. It is registered on the ordinary
        # student worker because that is the honest shape: calling a Nexus
        # operation needs nothing special on the worker — no service handler, no
        # extra task queue, no endpoint configuration. Only the HANDLER side
        # registers nexus_service_handlers.
        workflows=[greeting, StuckActivityWorkflow, PaymentWorkflow],
        activities=[describe, hang_after_heartbeat],
        deployment_config=deployment_config,
    )

    stopping = asyncio.Event()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(sig, stopping.set)

    print(
        f"Polling '{TASK_QUEUE}'"
        + (" with DELIBERATELY BROKEN determinism" if broken else "")
        + ". Ctrl-C to stop."
    )
    async with worker:
        await stopping.wait()
    print("Worker stopped.")
    return 0


async def run_start(argv: list[str], suffix: str) -> int:
    client = await connect(
        local="--local" in argv,
        proxy="--proxy" in argv,
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


async def run_chaos(argv: list[str], suffix: str) -> int:
    client = await connect(
        local="--local" in argv,
        proxy="--proxy" in argv,
        namespace_override=flag_value(argv, "--namespace"),
    )
    drill = argv[1] if len(argv) > 1 and not argv[1].startswith("-") else "determinism"

    if drill == "determinism":
        # Drill 1. Start on a healthy worker, then restart the worker with
        # --break-determinism. The task fails on replay and retries forever:
        # the workflow is stuck, NOT failed, and no error rate moves.
        workflow_id = f"chaos-1-{suffix}"
        await client.start_workflow(
            GreetingWorkflow.run, suffix, id=workflow_id, task_queue=TASK_QUEUE
        )
        print(f"Started {workflow_id}. Now restart your worker with --break-determinism,")
        print(f"then run: temporal workflow describe --workflow-id {workflow_id}")
        print("Restart the worker WITHOUT the flag to let it recover.")
    elif drill == "stuck":
        # Drill 4. The Activity heartbeats, then hangs. The heartbeat is what
        # lets you tell "stuck" from "slow", and what lets the retry resume from
        # the last reported progress instead of from zero.
        workflow_id = f"chaos-4-{suffix}"
        await client.start_workflow(
            StuckActivityWorkflow.run, id=workflow_id, task_queue=TASK_QUEUE
        )
        print(f"Started {workflow_id}. The Activity will heartbeat, then hang.")
        print(f"Watch: temporal workflow describe --workflow-id {workflow_id}")
        print("The heartbeat timeout fires after ~10s and the retry resumes.")
    else:
        print(f"Unknown drill '{drill}'. Use 'determinism' or 'stuck'.", file=sys.stderr)
        return 1
    return 0


async def run_load(argv: list[str], suffix: str) -> int:
    # Lab 5: generate enough traffic that the dashboard has a curve rather than
    # a single point.
    client = await connect(
        local="--local" in argv,
        proxy="--proxy" in argv,
        namespace_override=flag_value(argv, "--namespace"),
    )
    raw = flag_value(argv, "--count")
    count = int(raw) if raw and raw.isdigit() else 50
    print(f"Starting {count} workflows…")

    started = stamp()
    handles = [
        await client.start_workflow(
            GreetingWorkflow.run,
            f"{suffix}-{i}",
            id=f"load-{suffix}-{started}-{i}",
            task_queue=TASK_QUEUE,
        )
        for i in range(count)
    ]

    await asyncio.gather(*(h.result() for h in handles))
    print(f"{count} workflows completed. Check Grafana at http://localhost:3030")
    return 0


async def run_desk(argv: list[str], suffix: str) -> int:
    """Instructor only. The Rate Desk handler, in the instructor's own namespace.

    Reads .env.desk so it connects somewhere the callers have no access to. This
    is the process you stop in round 3 and restart in round 4.
    """
    client = await connect(
        local="--local" in argv,
        env_file=".env.desk",
        namespace_override=flag_value(argv, "--namespace"),
    )
    print(f"Rate Desk open in {client.namespace} on '{DESK_TASK_QUEUE}'")
    print("Callers reach this through the Nexus endpoint, never directly.")

    worker = Worker(
        client,
        task_queue=DESK_TASK_QUEUE,
        workflows=[QuoteWorkflow],
        activities=[issue_ticket, price],
        nexus_service_handlers=[RateDeskHandler()],
    )

    stopping = asyncio.Event()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(sig, stopping.set)

    async with worker:
        await stopping.wait()
    print("Rate Desk closed. In-flight operations are queued, not lost.")
    return 0


async def run_quote(argv: list[str], suffix: str) -> int:
    """Student side. One Nexus call, from your namespace to somebody else's."""
    client = await connect(
        local="--local" in argv,
        proxy="--proxy" in argv,
        namespace_override=flag_value(argv, "--namespace"),
    )
    caller = flag_value(argv, "--as") or client.namespace
    currency = (flag_value(argv, "--currency") or "NZD").upper()
    raw = flag_value(argv, "--amount")
    amount = float(raw) if raw else 1000.0

    # The endpoint is read HERE, outside any workflow, and passed in as an
    # argument. Reading it inside PaymentWorkflow raises
    # RestrictedWorkflowAccessError — the sandbox refuses os.environ, because a
    # value that can change between replays is what determinism forbids.
    endpoint = os.environ.get("NEXUS_ENDPOINT", DEFAULT_ENDPOINT)

    print(f"Asking the Rate Desk for {amount:.2f} {currency} as {caller}…")
    print(f"  endpoint: {endpoint}")
    handle = await client.start_workflow(
        PaymentWorkflow.run,
        args=[QuoteRequest(caller, currency, amount), endpoint],
        id=f"payment-{caller}-{stamp()}",
        task_queue=TASK_QUEUE,
    )
    print(f"  caller workflow: {handle.id}")
    print("  waiting. If the desk is down this does NOT fail — watch:")
    print(f"    temporal workflow describe --workflow-id {handle.id}")

    quote = await handle.result()
    print()
    print(f"  ticket #{quote.ticket}  ·  {quote.currency} {quote.quoted:.2f} @ {quote.rate}")
    print(f"  priced in {quote.desk_namespace} — a namespace you cannot reach")
    return 0


COMMANDS = {
    "worker": run_worker,
    "start": run_start,
    "chaos": run_chaos,
    "load": run_load,
    "desk": run_desk,
    "quote": run_quote,
}


async def main() -> int:
    argv = sys.argv[1:]
    command = argv[0] if argv and not argv[0].startswith("-") else "start"
    suffix = getpass.getuser().lower()

    handler = COMMANDS.get(command)
    if handler is None:
        print(
            f"Unknown command '{command}'. Use worker, start, load or chaos.",
            file=sys.stderr,
        )
        return 1

    try:
        return await handler(argv, suffix)
    except MissingSetting as missing:
        # Missing configuration is the most common way to land here, and a
        # traceback tells a student nothing useful about it.
        print(
            f"""
  {missing} is not set.

  Pick one:

  1. Against your Cloud namespace — copy .env.example to .env and paste in
     the "Connection details" block shown at the top of any session page:

       cp .env.example .env && $EDITOR .env

  2. Against a local dev server — no Cloud, no credentials:

       temporal server start-dev        # in another terminal
       uv run main.py {command} --local
""",
            file=sys.stderr,
        )
        return 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
