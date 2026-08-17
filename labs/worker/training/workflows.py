"""Workflows — deterministic code, replayed from history on every task.

Everything in this module runs inside the SDK's workflow sandbox, which
re-imports it in a restricted environment. That is why activities are pulled in
through `imports_passed_through()`: without it the sandbox would re-execute
activities.py, and anything with a side effect at import time would run twice.
"""

from __future__ import annotations

from datetime import timedelta

from temporalio import workflow
from temporalio.common import RetryPolicy

with workflow.unsafe.imports_passed_through():
    from training.activities import describe, hang_after_heartbeat
    from training.rate_desk import DEFAULT_ENDPOINT, Quote, QuoteRequest, RateDesk


@workflow.defn(name="GreetingWorkflow")
class GreetingWorkflow:
    @workflow.run
    async def run(self, who: str) -> str:
        return await workflow.execute_activity(
            describe,
            who,
            start_to_close_timeout=timedelta(seconds=10),
        )


@workflow.defn(name="GreetingWorkflow")
class BrokenGreetingWorkflow:
    """The SAME workflow type, with an extra command. Lab 6 drill 1.

    Note `name="GreetingWorkflow"` on both classes: to the server these are one
    workflow type, and the worker registers whichever one `--break-determinism`
    selects. Start an execution against the healthy worker, restart the worker
    with the flag, and the timer below appears where history recorded an
    immediate completion — so replay diverges and the workflow task fails and
    retries forever. The execution is STUCK, not failed, and no error-rate
    metric moves. That is the whole drill.

    The C# version of this starter carried a static `Determinism.Broken` flag
    read from inside the workflow instead. That does not port: the Python
    sandbox re-imports this module, so a global set in __main__ is simply not
    visible here. Two classes sharing one registered name is the honest way to
    express "same workflow type, different code" — which is also a better model
    of what actually happens when you deploy a bad build.
    """

    @workflow.run
    async def run(self, who: str) -> str:
        greeting = await workflow.execute_activity(
            describe,
            who,
            start_to_close_timeout=timedelta(seconds=10),
        )
        await workflow.sleep(timedelta(seconds=1))
        return greeting


@workflow.defn
class PaymentWorkflow:
    """The caller side of the Rate Desk. Runs in YOUR namespace; the quote does not.

    Look at what this workflow does not contain. No address, no namespace, no
    credential, no retry policy for the network, no timeout for a service that
    might be down. It names an endpoint and an operation and waits. Everything
    else — routing, authorisation, durability across a handler outage — is the
    platform's problem, which is the entire pitch for Nexus over an HTTP call to
    another team's API.

    The endpoint arrives as an ARGUMENT, not from the environment, and the
    sandbox is what taught us that: reading `os.environ` in here raises
    `RestrictedWorkflowAccessError`, because a value that can change between
    replays is exactly what determinism forbids. Configuration is read by the
    starter, outside the sandbox, and passed in — so it is recorded in history
    and the replay sees the same endpoint the first attempt did.
    """

    @workflow.run
    async def run(self, request: QuoteRequest, endpoint: str = DEFAULT_ENDPOINT) -> Quote:
        desk = workflow.create_nexus_client(service=RateDesk, endpoint=endpoint)
        # No schedule_to_close_timeout on purpose. Round 3 of the classroom
        # exercise stops the handler worker, and a deadline here would convert
        # "the desk is busy" into "your payment failed" — which is exactly the
        # wrong call to make on a caller's behalf. Add one when you genuinely
        # know how long the answer is worth waiting for.
        return await desk.execute_operation(RateDesk.quote, request)


@workflow.defn
class StuckActivityWorkflow:
    @workflow.run
    async def run(self) -> None:
        await workflow.execute_activity(
            hang_after_heartbeat,
            start_to_close_timeout=timedelta(minutes=5),
            # Without this, a hung Activity is indistinguishable from a slow one
            # until start_to_close_timeout expires five minutes later.
            heartbeat_timeout=timedelta(seconds=10),
            retry_policy=RetryPolicy(maximum_attempts=2),
        )
