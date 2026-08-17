"""The Risk Desk service contract — the only thing the two sides share.

This module is deliberately tiny and deliberately dependency-free. It names the
operation and its input and output types, and nothing else: no handler code, no
workflow code, no agents, no model, no connection details. A caller needs exactly
this to make a call, which is the whole point of a Nexus Service.

Note what is NOT here, and note it hard: `pydantic` is not imported. The desk is
built on Pydantic AI and its agents speak in Pydantic models, but none of that
crosses the boundary — the desk maps its agent's output onto the plain dataclass
below before returning it. That is not tidiness, it is the contract doing its
job: a caller depends on the shape of the answer, never on how the answer was
reached. Students install `temporalio` and nothing else, and their worker has no
idea it is talking to a language model at all.

In production the two sides are separate deployments owned by separate teams, and
this file is a published artifact — a package, or a generated stub. It lives in
the same repository here only because the workshop runs both sides on one laptop.
What matters is that nothing in `training.desk` or `training.agents` is
importable from a caller: the contract is the seam.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import nexusrpc

#: The endpoint name is account-global in Temporal Cloud — one Nexus Registry per
#: account, spanning every namespace. Your instructor owns this one, and no
#: caller is permitted by default: being on the allowlist is a grant somebody
#: else made on their resource, not something you can configure on yours.
#:
#: Endpoint names are unique account-wide, so this string has to match what the
#: instructor provisioned exactly. `--endpoint` overrides it for a rehearsal.
DEFAULT_ENDPOINT = "risk-desk"


@dataclass
class ReviewRequest:
    """What a caller sends: a payment that needs a decision before it moves.

    `caller` is the caller's own namespace, sent as payload. Note what it is NOT:
    it is not how the desk decides whether to serve you. That decision is the
    endpoint's access policy, enforced before this struct is ever deserialised.
    This field exists so the desk can name its workflows after whoever called,
    which is what makes the instructor's screen readable — a convenience, and
    trivially spoofable. Never authorise on it.
    """

    caller: str
    beneficiary: str = "Ada Lovelace"
    country: str = "NZ"
    currency: str = "NZD"
    amount: float = 1000.0
    purpose: str = "invoice settlement"


@dataclass
class Decision:
    """What the desk sends back.

    `rationale` is the interesting field. You get the agents' reasoning — one
    line per agent — and you never get the prompt, the model name, the tool
    output, or the credential that paid for any of it. That asymmetry is the
    entire argument for putting an agent behind a Nexus operation rather than
    handing every team an API key.
    """

    ticket: int
    #: "approve" or "decline". Note there is no "escalated" outcome: escalation
    #: is an implementation detail of the desk, invisible from out here, and a
    #: caller that could tell the difference would be a caller coupled to it.
    outcome: str
    confidence: float
    rationale: list[str] = field(default_factory=list)
    #: "adjudicator" or "human" — who actually made the call. Reported for
    #: honesty, not for routing.
    decided_by: str = "adjudicator"
    #: The namespace that actually did the work — proof, in the caller's own
    #: result, that this ran somewhere they have no access to.
    desk_namespace: str = ""
    #: How many model requests the decision cost. Each one is an Activity in the
    #: DESK's namespace, on the desk's bill. Worth reading next to the single
    #: Action the caller paid for.
    model_calls: int = 0
    #: Wall-clock the desk spent on it, including any time parked on a human.
    thinking_ms: int = 0


@dataclass
class HumanDecision:
    """Sent to a parked review by Signal when the adjudicator escalates.

    Not part of the Nexus contract — a caller can neither send this nor observe
    it. It is here rather than in the handler module so the instructor's CLI can
    build one without importing (or installing) any of the agent machinery.
    """

    outcome: str
    note: str = ""
    by: str = "instructor"


@nexusrpc.service
class RiskDesk:
    """One operation, asynchronous, backed by a workflow in the desk's namespace.

    Asynchronous is the right shape here and an agent makes the reason concrete:
    a synchronous Nexus operation must answer inside a 10-second handler
    deadline, and a three-agent loop does not. Nor does a human. A workflow-backed
    operation has no such ceiling — the desk can be thinking, or waiting on a
    person who has gone to lunch, and the call simply has not finished yet.
    """

    review: nexusrpc.Operation[ReviewRequest, Decision]
