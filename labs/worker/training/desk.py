"""The handler side of the Rate Desk — the instructor's code, in the instructor's namespace.

Students never run this and never import it. They depend on `training.rate_desk`,
which names the operation, and on an endpoint they are allowed to call. That is
the entire coupling between the two sides.

Everything here polls a task queue in a namespace the callers have no access to,
which is what makes the demo honest: when a call lands, the work provably happens
somewhere else.
"""

from __future__ import annotations

import random
from datetime import timedelta

import nexusrpc.handler
from temporalio import activity, nexus, workflow
from temporalio.common import RetryPolicy, WorkflowIDReusePolicy

with workflow.unsafe.imports_passed_through():
    from training.rate_desk import Quote, QuoteRequest, RateDesk

DESK_TASK_QUEUE = "rate-desk"

#: Assigned in arrival order so round 1 is a race. Process-local on purpose, and
#: worth one sentence in the room: this counter is NOT durable. Restart the desk
#: and it starts at 1 again; run two desk workers and both hand out ticket 4.
#: Real sequencing belongs in a workflow, which is exactly the argument for
#: putting state in Temporal rather than beside it. It is a toy, it is labelled a
#: toy, and the instructor screen derives true arrival order from workflow start
#: times rather than trusting it.
_ticket = 0


@activity.defn
async def issue_ticket() -> int:
    global _ticket
    _ticket += 1
    return _ticket


@activity.defn
async def price(request: QuoteRequest) -> float:
    """Stands in for whatever slow, unreliable thing a real desk would call."""
    base = {"NZD": 1.0, "AUD": 0.92, "USD": 0.61, "EUR": 0.56, "GBP": 0.48}
    return round(base.get(request.currency.upper(), 1.0) * random.uniform(0.995, 1.005), 5)


@workflow.defn
class QuoteWorkflow:
    """The workflow a Nexus call starts. One of these appears per caller.

    Its id carries the caller's namespace, which is what lets the instructor
    screen build its ring by discovery — reading who called off the handler's own
    workflow list, with no roster anywhere.
    """

    @workflow.run
    async def run(self, request: QuoteRequest) -> Quote:
        ticket = await workflow.execute_activity(
            issue_ticket, start_to_close_timeout=timedelta(seconds=5)
        )
        rate = await workflow.execute_activity(
            price,
            request,
            start_to_close_timeout=timedelta(seconds=5),
            retry_policy=RetryPolicy(maximum_attempts=3),
        )
        return Quote(
            ticket=ticket,
            rate=rate,
            quoted=round(request.amount * rate, 2),
            currency=request.currency.upper(),
            desk_namespace=workflow.info().namespace,
            notes=[
                f"priced in {workflow.info().namespace}",
                f"requested by {request.caller}",
            ],
        )


@nexusrpc.handler.service_handler(service=RateDesk)
class RateDeskHandler:
    @nexus.workflow_run_operation
    async def quote(
        self, ctx: nexus.WorkflowRunOperationContext, request: QuoteRequest
    ) -> nexus.WorkflowHandle[Quote]:
        # The id is business-meaningful and names the caller, so the desk's
        # workflow list reads as a guest book. ALLOW_DUPLICATE lets the same
        # namespace call again in a later round without colliding with its own
        # completed run.
        return await ctx.start_workflow(
            QuoteWorkflow.run,
            request,
            id=f"quote-{request.caller}",
            id_reuse_policy=WorkflowIDReusePolicy.ALLOW_DUPLICATE,
        )
