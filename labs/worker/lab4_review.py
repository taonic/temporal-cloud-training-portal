"""Lab 4 — Nexus. Call a service you do not own, and that you could not build.

  uv run lab4_review.py worker                    poll, so PaymentWorkflow can run
  uv run lab4_review.py review --amount 4200      ask the Risk Desk to adjudicate

  --- instructor only, and needs the optional 'desk' dependency group ---
  uv run --group desk lab4_review.py desk                     host the Risk Desk
  uv run --group desk lab4_review.py desk --inference-only    agent I/O queue only
  uv run --group desk lab4_review.py decide <id> approve      clear an escalation

Add --local to any of them to run against `temporal server start-dev`, which is
also how you rehearse both sides on one machine: run the desk with
`--namespace desk-ns` and the caller with `--namespace caller-ns`.

`desk` and `decide` read `.env.desk` — the desk's own credential, for a namespace
the students cannot reach — and every value in it can be overridden per run:

  --address <host:port>    --namespace <ns.account>    --api-key <key>

Pass all three and no file is needed at all, which is the case this exists for:
borrowing a machine, or hosting the desk from a namespace you provisioned five
minutes ago and have not written down anywhere. Note that an `--api-key` on the
command line is visible in `ps` and lands in your shell history — prefer
`.env.desk` on your own machine and keep the flag for the borrowed one.
"""

from __future__ import annotations

import contextlib
import os
import signal
import sys

from temporalio.worker import Worker

from training.cli import flag_present, flag_value, positionals, run, stamp
from training.config import TASK_QUEUE, connect
from training.lab4_contract import DEFAULT_ENDPOINT, HumanDecision, ReviewRequest
from training.lab4_payment import PaymentWorkflow
from training.worker import build_worker, poll_until_stopped

# NOTE what is NOT imported at the top of this file: `training.lab4_desk` and
# `training.lab4_agents`. Those pull in Pydantic AI, which lives in the optional
# `desk` dependency group, and importing them here would make every student's
# `uv run lab4_review.py worker` resolve an agent framework it never uses. They
# are imported inside `run_desk` instead. A student's environment stays at one
# dependency, and the import line is the enforcement.


async def run_worker(argv: list[str], suffix: str) -> int:
    client = await connect(
        local=flag_present(argv, "--local"),
        namespace_override=flag_value(argv, "--namespace"),
    )
    return await poll_until_stopped(
        build_worker(client),
        f"Polling '{TASK_QUEUE}'. The same worker as every other lab — calling a\n"
        "Nexus operation needs nothing special on your side. Ctrl-C to stop.",
    )


async def run_review(argv: list[str], suffix: str) -> int:
    """Student side. One Nexus call, from your namespace to somebody else's."""
    client = await connect(
        local=flag_present(argv, "--local"),
        namespace_override=flag_value(argv, "--namespace"),
    )
    caller = flag_value(argv, "--as") or client.namespace
    raw = flag_value(argv, "--amount")
    request = ReviewRequest(
        caller=caller,
        beneficiary=flag_value(argv, "--beneficiary") or "Ada Lovelace",
        country=(flag_value(argv, "--country") or "NZ").upper(),
        currency=(flag_value(argv, "--currency") or "NZD").upper(),
        amount=float(raw) if raw else 1000.0,
        purpose=flag_value(argv, "--purpose") or "invoice settlement",
    )

    # The endpoint is read HERE, outside any workflow, and passed in as an
    # argument. Reading it inside PaymentWorkflow raises
    # RestrictedWorkflowAccessError — the sandbox refuses os.environ, because a
    # value that can change between replays is what determinism forbids.
    endpoint = flag_value(argv, "--endpoint") or os.environ.get(
        "NEXUS_ENDPOINT", DEFAULT_ENDPOINT
    )

    print(
        f"Asking the Risk Desk to review {request.amount:,.2f} {request.currency} "
        f"to {request.beneficiary} ({request.country}) as {caller}…"
    )
    print(f"  endpoint: {endpoint}")
    handle = await client.start_workflow(
        PaymentWorkflow.run,
        args=[request, endpoint],
        id=f"payment-{caller}-{stamp()}",
        task_queue=TASK_QUEUE,
    )
    print(f"  caller workflow: {handle.id}")
    print("  waiting. Three agents are running somewhere you cannot see, and a")
    print("  human may join them. If the desk is down this does NOT fail — watch:")
    print(f"    temporal workflow describe --workflow-id {handle.id}")

    decision = await handle.result()
    print()
    print(
        f"  ticket #{decision.ticket}  ·  {decision.outcome.upper()} "
        f"(confidence {decision.confidence:.0%}, decided by {decision.decided_by})"
    )
    for line in decision.rationale:
        print(f"    · {line}")
    print(
        f"  {decision.model_calls} model call(s) in {decision.desk_namespace} — "
        "a namespace you cannot reach, on a bill that is not yours"
    )
    print(
        f"  {decision.thinking_ms / 1000:.1f}s end to end, "
        "which is the number your SLO cares about"
    )
    return 0


async def run_desk(argv: list[str], suffix: str) -> int:
    """Instructor only. The Risk Desk handler, in the instructor's own namespace.

    Reads .env.desk so it connects somewhere the callers have no access to. This
    is the process you stop in round 3 and restart in round 4.
    """
    try:
        from pydantic_ai.durable_exec.temporal import PydanticAIPlugin
    except ModuleNotFoundError:
        print(
            "The desk needs Pydantic AI, which is in the optional 'desk' group:\n"
            "\n    uv run --group desk lab4_review.py desk\n",
            file=sys.stderr,
        )
        return 1

    from training.lab4_agents import INFERENCE_TASK_QUEUE, describe_model
    from training.lab4_desk import (
        DESK_TASK_QUEUE,
        ReviewWorkflow,
        RiskDeskHandler,
        announce_escalation,
        issue_ticket,
    )

    # The plugin does two things and both matter. It swaps in a payload converter
    # that can serialise the agents' Pydantic models across the Activity
    # boundary, and it walks each registered workflow's `__pydantic_ai_agents__`
    # to register the model-request and tool-call Activities. Neither is
    # something you would want to hand-maintain, and the second is why there is
    # no list of agent activities anywhere in this file.
    client = await connect(
        local=flag_present(argv, "--local"),
        env_file=".env.desk",
        namespace_override=flag_value(argv, "--namespace"),
        address_override=flag_value(argv, "--address"),
        api_key_override=flag_value(argv, "--api-key"),
        plugins=[PydanticAIPlugin()],
    )

    inference_only = flag_present(argv, "--inference-only")
    print(f"Risk Desk open in {client.namespace}")
    print(f"  model:       {describe_model()}")
    print(
        f"  orchestration on '{DESK_TASK_QUEUE}'"
        + (" — NOT polled (--inference-only)" if inference_only else "")
    )
    print(f"  agent I/O    on '{INFERENCE_TASK_QUEUE}'")
    print("Callers reach this through the Nexus endpoint, never directly.")

    workers = []
    if not inference_only:
        workers.append(
            Worker(
                client,
                task_queue=DESK_TASK_QUEUE,
                workflows=[ReviewWorkflow],
                activities=[issue_ticket, announce_escalation],
                nexus_service_handlers=[RiskDeskHandler()],
            )
        )

    # The inference worker registers no workflows of its own — it exists to run
    # model requests and tool calls, and it is the one you would scale on a GPU
    # box, or throttle, or point at a different provider. Registering
    # ReviewWorkflow here anyway is what makes the plugin contribute the agent
    # Activities; the worker never gets a workflow task for it because nothing
    # schedules ReviewWorkflow on this queue.
    workers.append(Worker(client, task_queue=INFERENCE_TASK_QUEUE, workflows=[ReviewWorkflow]))

    import asyncio

    stopping = asyncio.Event()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(sig, stopping.set)

    async with contextlib.AsyncExitStack() as stack:
        for worker in workers:
            await stack.enter_async_context(worker)
        await stopping.wait()
    print("Risk Desk closed. In-flight operations are queued, not lost.")
    return 0


async def run_decide(argv: list[str], suffix: str) -> int:
    """Instructor only. Answer an escalation by Signal.

    The workflow this reaches has been parked on `wait_condition` — possibly for
    minutes, possibly across a redeploy of the desk. It is holding no thread and
    no connection, and the caller waiting on it has no idea a human was involved.
    """
    args = positionals(argv)
    if len(args) < 2:
        print(
            "Usage: uv run --group desk lab4_review.py decide <workflow-id> "
            "approve|decline [--note '…']",
            file=sys.stderr,
        )
        return 1
    workflow_id, outcome = args[0], args[1].lower()
    if not outcome.startswith(("a", "d")):
        print(f"Outcome must be approve or decline, not '{outcome}'.", file=sys.stderr)
        return 1

    client = await connect(
        local=flag_present(argv, "--local"),
        env_file=".env.desk",
        namespace_override=flag_value(argv, "--namespace"),
        address_override=flag_value(argv, "--address"),
        api_key_override=flag_value(argv, "--api-key"),
    )
    await client.get_workflow_handle(workflow_id).signal(
        "decide",
        HumanDecision(
            outcome="approve" if outcome.startswith("a") else "decline",
            note=flag_value(argv, "--note") or "",
            by=suffix,
        ),
    )
    print(f"Signalled {workflow_id}: {outcome}. The caller's workflow completes on its own.")
    return 0


if __name__ == "__main__":
    sys.exit(
        run(
            "lab4_review.py",
            {
                "worker": run_worker,
                "review": run_review,
                "desk": run_desk,
                "decide": run_decide,
            },
            default="review",
        )
    )
