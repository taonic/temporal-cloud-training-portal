"""The handler side of the Risk Desk — the instructor's code, in the instructor's namespace.

Students never run this and never import it. They depend on `training.lab4_contract`,
which names the operation, and on an endpoint they are allowed to call. That is
the entire coupling between the two sides.

Everything here polls task queues in a namespace the callers have no access to,
which is what makes the demo honest: when a call lands, the work provably happens
somewhere else — and now the work is three agents, a watchlist, and sometimes a
person.

THE ONE THING TO READ IN THIS FILE is `ReviewWorkflow.run`. It is fifteen lines
of ordinary async Python. Two agents run concurrently, a third consumes them, and
if it declines to decide, the workflow parks on a Signal until a human arrives.
There is no retry loop, no JSON parsing, no state machine, no queue, no timeout
plumbing, and no framework runtime — because the model requests are Activities
and the wait is a workflow. That is the pitch.
"""

from __future__ import annotations

import asyncio
from datetime import timedelta

import nexusrpc.handler
from temporalio import activity, nexus, workflow
from temporalio.common import RetryPolicy, WorkflowIDReusePolicy

with workflow.unsafe.imports_passed_through():
    # `agents` reads os.environ at import to choose a model, which the workflow
    # sandbox forbids — so it is imported once, out here, in the real process.
    # `risk_desk` comes through the same door because it is shared with the
    # caller and there is no reason to re-import it per workflow task.
    #
    # `annotated_types` is here for a duller reason: Pydantic's field
    # constraints pull it in lazily, and the sandbox warns loudly the first time
    # a module is imported after workflow load. Naming it here imports it up
    # front and keeps the desk's console clean for the escalations, which are
    # the only thing on it anybody should be reading.
    import annotated_types  # noqa: F401
    from pydantic_ai.durable_exec.temporal import PydanticAIWorkflow

    from training.lab4_agents import (
        ALL_AGENTS,
        Approve,
        Decline,
        Escalate,
        adjudicator_agent,
        history_agent,
        screening_agent,
    )
    from training.lab4_contract import Decision, HumanDecision, ReviewRequest, RiskDesk

#: Orchestration. Agent Activities go to `agents.INFERENCE_TASK_QUEUE` instead —
#: see the comment there for why that split is the whole reason a platform team
#: is in the room.
DESK_TASK_QUEUE = "risk-desk"

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
async def announce_escalation(workflow_id: str, question: str) -> None:
    """Put an escalation on the instructor's terminal, with the command to clear it.

    An Activity rather than a `print` in the workflow, because printing from
    workflow code runs again on every replay and you would rather find that out
    here than in production.
    """
    print()
    print("  ┌─ ESCALATED ─────────────────────────────────────────────────────")
    print(f"  │ {question}")
    print("  │")
    print(f"  │   uv run --group desk lab4_review.py decide {workflow_id} approve")
    print(f"  │   uv run --group desk lab4_review.py decide {workflow_id} decline")
    print("  └─────────────────────────────────────────────────────────────────")
    print("  The caller is not failing and not polling. It is parked.")


def _screening_prompt(request: ReviewRequest) -> str:
    return (
        f"Beneficiary: {request.beneficiary}\n"
        f"Country: {request.country}\n"
        f"Amount: {request.amount:.2f} {request.currency}\n"
        f"Purpose: {request.purpose}\n"
        f"Caller: {request.caller}"
    )


def _history_prompt(request: ReviewRequest) -> str:
    return (
        f"Caller: {request.caller}\n"
        f"Amount: {request.amount:.2f} {request.currency}\n"
        f"Beneficiary: {request.beneficiary}\n"
        f"Purpose: {request.purpose}"
    )


def _adjudication_prompt(request: ReviewRequest, screening, history) -> str:
    return (
        f"Amount: {request.amount:.2f} {request.currency}\n"
        f"Country: {request.country}\n"
        f"Screening risk: {screening.risk:.2f}\n"
        f"Watchlist hit: {screening.hit}\n"
        f"Screening notes: {screening.notes}\n"
        f"In pattern: {history.in_pattern}\n"
        f"Comparable payments: {history.prior_payments}\n"
        f"History notes: {history.notes}"
    )


@workflow.defn
class ReviewWorkflow(PydanticAIWorkflow):
    """The workflow a Nexus call starts. One of these appears per caller.

    Its id carries the caller's namespace, which is what lets the instructor
    screen build its ring by discovery — reading who called off the handler's own
    workflow list, with no roster anywhere.

    `__pydantic_ai_agents__` is the entire registration story: `PydanticAIPlugin`
    walks it when the Worker starts and registers the model-request and tool
    Activities for each agent. Forget an agent here and its first model request
    fails with "activity not registered" — which is a better failure than the
    alternative, since it happens on the first review rather than the first
    unusual one.
    """

    __pydantic_ai_agents__ = ALL_AGENTS

    def __init__(self) -> None:
        self._escalation: Escalate | None = None
        self._human: HumanDecision | None = None

    @workflow.signal
    def decide(self, decision: HumanDecision) -> None:
        """The human's answer. Arrives whenever it arrives; nothing is waiting on a socket."""
        self._human = decision

    @workflow.query
    def pending(self) -> str | None:
        """What this review is waiting for, if anything.

        A Query so the instructor screen can show the escalation queue without
        touching the desk's database — because there isn't one.
        """
        return self._escalation.question if self._escalation and not self._human else None

    @workflow.run
    async def run(self, request: ReviewRequest) -> Decision:
        started = workflow.now()
        ticket = await workflow.execute_activity(
            issue_ticket,
            start_to_close_timeout=timedelta(seconds=5),
            retry_policy=RetryPolicy(maximum_attempts=3),
        )

        # Two specialists, concurrently. Each `.run()` schedules its own model
        # requests and tool calls as Activities on the inference queue; this
        # gather is a workflow waiting on two independent branches, which is a
        # thing Temporal has always been good at and agent frameworks reinvent.
        screening_run, history_run = await asyncio.gather(
            screening_agent.run(_screening_prompt(request)),
            history_agent.run(_history_prompt(request)),
        )
        screening, history = screening_run.output, history_run.output

        adjudication_run = await adjudicator_agent.run(
            _adjudication_prompt(request, screening, history)
        )
        verdict = adjudication_run.output

        rationale = [
            f"screening: {screening.notes}",
            f"history: {history.notes}",
            f"adjudicator: {verdict.rationale}",
        ]
        decided_by = "adjudicator"

        if isinstance(verdict, Escalate):
            # The agent handed the decision back rather than blocking on a human,
            # and now the WORKFLOW waits. This costs nothing while it waits: no
            # thread, no connection, no memory on any worker, no polling. The
            # desk can be redeployed underneath it. The caller cannot tell this
            # apart from the agent still thinking, and should not be able to.
            self._escalation = verdict
            await workflow.execute_activity(
                announce_escalation,
                args=[workflow.info().workflow_id, verdict.question],
                start_to_close_timeout=timedelta(seconds=10),
            )
            await workflow.wait_condition(lambda: self._human is not None)

            human = self._human
            assert human is not None
            decided_by = "human"
            rationale.append(
                f"human ({human.by}): {human.note or 'decided on escalation'}"
            )
            outcome = "approve" if human.outcome.lower().startswith("a") else "decline"
            confidence = 1.0
        else:
            outcome = "approve" if isinstance(verdict, Approve) else "decline"
            confidence = verdict.confidence

        elapsed = workflow.now() - started
        return Decision(
            ticket=ticket,
            outcome=outcome,
            confidence=confidence,
            rationale=rationale,
            decided_by=decided_by,
            desk_namespace=workflow.info().namespace,
            # One `requests` per model round-trip, and each round-trip was an
            # Activity on the desk's queue and the desk's bill. A tool-using
            # agent costs two: one to ask for the tool, one to answer with it.
            model_calls=(
                screening_run.usage.requests
                + history_run.usage.requests
                + adjudication_run.usage.requests
            ),
            thinking_ms=int(elapsed.total_seconds() * 1000),
        )


@nexusrpc.handler.service_handler(service=RiskDesk)
class RiskDeskHandler:
    @nexus.workflow_run_operation
    async def review(
        self, ctx: nexus.WorkflowRunOperationContext, request: ReviewRequest
    ) -> nexus.WorkflowHandle[Decision]:
        # The id is business-meaningful and names the caller, so the desk's
        # workflow list reads as a guest book. ALLOW_DUPLICATE lets the same
        # namespace call again in a later round without colliding with its own
        # completed run.
        return await ctx.start_workflow(
            ReviewWorkflow.run,
            request,
            id=f"review-{request.caller}",
            id_reuse_policy=WorkflowIDReusePolicy.ALLOW_DUPLICATE,
        )
