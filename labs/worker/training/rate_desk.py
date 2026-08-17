"""The Rate Desk service contract — the only thing the two sides share.

This module is deliberately tiny and deliberately dependency-free. It names the
operations and their input and output types, and nothing else: no handler code,
no workflow code, no connection details. A caller needs exactly this to make a
call, which is the whole point of a Nexus Service.

In production the two sides are separate deployments owned by separate teams, and
this file is a published artifact — a package, or a generated stub — that the
caller depends on without depending on the handler's implementation. It lives in
the same repository here only because the workshop runs both sides on one laptop.
What matters is that nothing in `training.desk` is importable from a caller: the
contract is the seam.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import nexusrpc

#: The endpoint name is account-global in Temporal Cloud — one Nexus Registry per
#: account, spanning every namespace. Your instructor owns this one, and no
#: caller is permitted by default: being in the allowlist is a grant somebody
#: else made on their resource, not something you can configure on yours.
DEFAULT_ENDPOINT = "rate-desk"


@dataclass
class QuoteRequest:
    """What a caller sends.

    `caller` is the caller's own namespace, sent as payload. Note what it is NOT:
    it is not how the desk decides whether to serve you. That decision is the
    endpoint's access policy, enforced before this struct is ever deserialised.
    This field exists so the desk can name its workflows after whoever called,
    which is what makes the instructor's screen readable — a convenience, and
    trivially spoofable. Never authorise on it.
    """

    caller: str
    currency: str = "NZD"
    amount: float = 1000.0


@dataclass
class Quote:
    """What the desk sends back."""

    ticket: int
    rate: float
    quoted: float
    currency: str
    #: The namespace that actually did the work — proof, in the caller's own
    #: result, that this ran somewhere they have no access to.
    desk_namespace: str
    notes: list[str] = field(default_factory=list)


@nexusrpc.service
class RateDesk:
    """One operation, asynchronous, backed by a workflow in the desk's namespace.

    Asynchronous is the right shape here and the reason is worth saying out loud:
    a synchronous Nexus operation must answer inside a 10-second handler
    deadline, and anything whose latency you do not control will eventually
    breach it. A workflow-backed operation has no such ceiling — the desk can be
    down for ten minutes and the call simply has not finished yet.
    """

    quote: nexusrpc.Operation[QuoteRequest, Quote]
