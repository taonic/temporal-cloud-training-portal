"""Lab 5 — the two failure modes you have to have seen before you see them live.

Drill 1  a non-deterministic change deployed without versioning
Drill 4  an Activity that stops making progress without failing

Both produce executions that are STUCK rather than FAILED, which is the whole
reason they are drills: no error-rate metric moves, no alert fires, and the only
way to find them is to know the shape.

(Drill 2 — stop every worker and watch schedule-to-start climb — needs no code:
stop the worker and start a Lab 1 workflow.)
"""

from __future__ import annotations

from datetime import timedelta

from temporalio import workflow
from temporalio.common import RetryPolicy

with workflow.unsafe.imports_passed_through():
    from training.activities import describe, hang_after_heartbeat


@workflow.defn(name="GreetingWorkflow")
class BrokenGreetingWorkflow:
    """The SAME workflow as Lab 1's, with an extra command. Drill 1.

    Note `name="GreetingWorkflow"` here and on `lab1_greeting.GreetingWorkflow`:
    to the server these are one workflow type, and the worker registers whichever
    one `--break-determinism` selects. Start an execution against the healthy
    worker, restart the worker with the flag, and the timer below appears where
    history recorded an immediate completion — so replay diverges and the
    workflow task fails and retries forever. The execution is STUCK, not failed,
    and no error-rate metric moves. That is the whole drill.

    The C# version of this starter carried a static `Determinism.Broken` flag
    read from inside the workflow instead. That does not port: the Python sandbox
    re-imports this module, so a global set in the entrypoint is simply not
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
class StuckActivityWorkflow:
    """Drill 4. The Activity heartbeats a few times, then hangs forever."""

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
