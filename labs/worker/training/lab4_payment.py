"""Lab 4 — the CALLER side of the Risk Desk. This is the only Lab 4 file that is yours.

`lab4_contract.py` is the contract both sides share. `lab4_agents.py` and
`lab4_desk.py` are the desk owner's code — read them if you are curious, but you
could not run them and in production you would not have them.
"""

from __future__ import annotations

from temporalio import workflow

with workflow.unsafe.imports_passed_through():
    from training.lab4_contract import DEFAULT_ENDPOINT, Decision, ReviewRequest, RiskDesk


@workflow.defn
class PaymentWorkflow:
    """Runs in YOUR namespace; the decision does not.

    Look at what this workflow does not contain. No address, no namespace, no
    credential, no retry policy for the network, no timeout for a service that
    might be down. And — the part that matters this year — no model, no API key,
    no prompt, no token budget, no agent framework. It names an endpoint and an
    operation and waits.

    Everything else, up to and including which language model runs and who pays
    for it, is on the other side of the boundary. That is the thing to take away
    from this session: the interesting shared service of 2026 is one holding a
    model credential, a rate limit and a token bill, and this workflow consumes
    one while holding none of the three.

    The endpoint arrives as an ARGUMENT, not from the environment, and the
    sandbox is what taught us that: reading `os.environ` in here raises
    `RestrictedWorkflowAccessError`, because a value that can change between
    replays is exactly what determinism forbids. Configuration is read by the
    starter, outside the sandbox, and passed in — so it is recorded in history
    and the replay sees the same endpoint the first attempt did.
    """

    @workflow.run
    async def run(self, request: ReviewRequest, endpoint: str = DEFAULT_ENDPOINT) -> Decision:
        desk = workflow.create_nexus_client(service=RiskDesk, endpoint=endpoint)
        # No schedule_to_close_timeout on purpose. Round 3 of the classroom
        # exercise stops the handler worker, and a deadline here would convert
        # "the desk is busy" into "your payment failed" — which is exactly the
        # wrong call to make on a caller's behalf. It would also convert "a human
        # is looking at it" into "your payment failed", which is worse. Add one
        # when you genuinely know how long the answer is worth waiting for, and
        # remember that a desk with a person in it answers in minutes.
        return await desk.execute_operation(RiskDesk.review, request)
