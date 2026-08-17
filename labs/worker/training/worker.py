"""The worker every lab runs, and the one place its registration list lives.

WHY THERE IS ONE OF THESE AND NOT FOUR. Each lab has its own entrypoint —
`lab1_hello.py`, `lab3_metrics.py`, `lab4_review.py`, `lab5_chaos.py` — and it
would be tidier for each to register only its own workflows. It would also break
the room. Every lab polls the same task queue, so a Lab 1 worker somebody left
running in another terminal will happily accept a Lab 4 workflow task, fail to
find `PaymentWorkflow` in its registry, and fail that task on a loop. The student
sees a workflow that never starts, in a terminal they are not looking at, caused
by a process they forgot about.

One registration list, shared by every entrypoint, makes that impossible. What
differs per lab is what the entrypoint *starts* and which flags it exposes —
which is the part a student is actually reading.

If you want per-lab workers with per-lab registries, the honest way is a task
queue per lab, and that is a real design worth discussing in Session 2. It is not
what this starter does, and the comment above is why.
"""

from __future__ import annotations

import asyncio
import signal

from temporalio.client import Client
from temporalio.worker import Worker

from training.activities import describe, hang_after_heartbeat
from training.config import TASK_QUEUE
from training.lab1_greeting import GreetingWorkflow
from training.lab4_payment import PaymentWorkflow
from training.lab5_drills import BrokenGreetingWorkflow, StuckActivityWorkflow


def build_worker(client: Client, *, broken: bool = False) -> Worker:
    """Every workflow the running course uses, on one task queue.

    `broken` swaps Lab 1's `GreetingWorkflow` for Lab 5's deliberately
    non-deterministic twin. Exactly one of them is ever registered: both declare
    the workflow type name "GreetingWorkflow", so registering both is a
    duplicate-type error.

    These workers are UNVERSIONED — no `deployment_config`, no Build ID, no
    Worker Deployment registered with the server. That is a deliberate omission
    rather than an oversight, and it is the right default for a starter: a
    versioned worker registers a version, and if nothing has routed traffic to
    that version the server hands it no tasks at all. Workflows then appear in
    the UI and never start, with no error on either side — which is a miserable
    thing to debug on your first afternoon with Temporal.
    """
    return Worker(
        client,
        task_queue=TASK_QUEUE,
        workflows=[
            BrokenGreetingWorkflow if broken else GreetingWorkflow,
            # PaymentWorkflow is Lab 4's Nexus caller. It is registered on the
            # ordinary worker because that is the honest shape: calling a Nexus
            # operation needs nothing special on the worker — no service handler,
            # no extra task queue, no endpoint configuration. Only the HANDLER
            # side registers nexus_service_handlers.
            PaymentWorkflow,
            StuckActivityWorkflow,
        ],
        activities=[describe, hang_after_heartbeat],
    )


async def poll_until_stopped(worker: Worker, banner: str) -> int:
    """Run a worker until Ctrl-C, printing one line a student can act on."""
    stopping = asyncio.Event()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(sig, stopping.set)

    print(banner)
    async with worker:
        await stopping.wait()
    print("Worker stopped.")
    return 0
