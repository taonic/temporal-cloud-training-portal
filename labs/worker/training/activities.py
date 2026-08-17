"""Activities — the only code here allowed to touch the outside world.

Kept in their own module because workflows.py runs inside the SDK's sandbox and
has to import these through `workflow.unsafe.imports_passed_through()`. Putting
an activity in the same module as a workflow works right up until the sandbox
re-imports it and something with a side effect runs twice.
"""

from __future__ import annotations

import asyncio

from temporalio import activity


@activity.defn
async def describe(who: str) -> str:
    return (
        f"Hello {who}. This ran on a worker you started, "
        "against a namespace you provisioned."
    )


@activity.defn
async def hang_after_heartbeat() -> None:
    """Heartbeats a few times, then hangs forever. Drill 4.

    The heartbeat is what lets you tell "stuck" from "slow", and what lets the
    retry resume from the last reported progress instead of from zero.
    """
    for progress in range(1, 4):
        activity.heartbeat(progress)
        print(f"[activity] heartbeat {progress}/3")
        await asyncio.sleep(1)

    print("[activity] now hanging — heartbeats have stopped")
    # Sleep forever. Cancellation arrives as CancelledError when the heartbeat
    # timeout fires and the server asks for the attempt back.
    await asyncio.Event().wait()
