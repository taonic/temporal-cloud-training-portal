"""Lab 1 — the smallest workflow that proves the whole chain works.

One workflow, one activity, no arguments worth the name. If this completes, then
your namespace exists, your API key is valid, your worker is polling the right
task queue, and Temporal Cloud can reach nothing of yours it should not — which
is four separate things confirmed by one command.

Everything in this module runs inside the SDK's workflow sandbox, which
re-imports it in a restricted environment. That is why the activity is pulled in
through `imports_passed_through()`: without it the sandbox would re-execute
`activities.py`, and anything with a side effect at import time would run twice.
That rule is why activities live in their own module and not next to the
workflows that call them.
"""

from __future__ import annotations

from datetime import timedelta

from temporalio import workflow

with workflow.unsafe.imports_passed_through():
    from training.activities import describe


@workflow.defn(name="GreetingWorkflow")
class GreetingWorkflow:
    @workflow.run
    async def run(self, who: str) -> str:
        return await workflow.execute_activity(
            describe,
            who,
            start_to_close_timeout=timedelta(seconds=10),
        )
