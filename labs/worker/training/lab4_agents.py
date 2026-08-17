"""The Risk Desk's agents — the instructor's code, and the only place a model is named.

Three agents, built with Pydantic AI:

    screening    is the beneficiary a problem? (has a watchlist tool)
    history      is this payment in pattern for this caller? (has a history tool)
    adjudicator  given both assessments, approve, decline, or escalate to a human

The first two run concurrently; the third consumes their output. That shape is
the point of the session and it is expressed in `desk.ReviewWorkflow`, not here.

WHY THIS MODULE IS SEPARATE FROM desk.py, WHICH IS NOT A STYLE CHOICE.
`desk.py` is a workflow module: the SDK re-imports it inside the determinism
sandbox on every workflow task. This module reads `os.environ` at import time to
choose a model, which the sandbox forbids — so `desk.py` pulls it in through
`workflow.unsafe.imports_passed_through()` and it is imported exactly once, in
the real process. Same reason `activities.py` is separate from `workflows.py`.

WHAT TEMPORAL DOES TO THESE AGENTS. Each carries a `TemporalDurability`
capability, and that one line is the whole integration: every model request and
every tool call becomes a Temporal Activity, with its own retries, its own
timeout, and its own row in the workflow history. Nobody writes a `call_model`
activity. Nobody writes a retry loop. Open a completed review in the Cloud UI and
you can read what the agent did, in order, forever — which is a claim very few
agent frameworks can make.
"""

from __future__ import annotations

import asyncio
import os
import re
from datetime import timedelta

from pydantic import BaseModel, Field
from pydantic_ai import Agent
from pydantic_ai.durable_exec.temporal import TemporalDurability
from pydantic_ai.messages import ModelMessage, ModelResponse, ToolCallPart
from pydantic_ai.models.function import AgentInfo, FunctionModel
from temporalio.common import RetryPolicy
from temporalio.workflow import ActivityConfig

#: Agent activities — model requests AND tool calls — are dispatched to their own
#: task queue. This is the one piece of the desk that exists purely to make a
#: point, and it is the point a platform team came for: inference is slow, bursty
#: and rate-limited, and orchestration is neither. Sharing a queue between them
#: means a backlog of model calls starves the workflow tasks that dispatch them,
#: and the system deadlocks itself under exactly the load you built it for.
#:
#: `lab4_review.py desk` polls both queues from one process, so nothing extra is needed
#: to run it. `lab4_review.py desk --inference-only` polls just this one, which is how
#: you show the split scaling independently.
INFERENCE_TASK_QUEUE = "risk-desk-inference"

#: How long each simulated model request "thinks". The default makes a review
#: take roughly ten seconds — long enough that the ring on the instructor screen
#: is readable and a call caught mid-flight shows a pending Activity, short
#: enough that a room of twelve is not waiting on it. Raise it to make the
#: round-3 outage more dramatic.
THINK_SECONDS = float(os.environ.get("DESK_THINK_SECONDS", "2.0"))

#: `simulated` (the default) runs the desk with no model provider, no API key and
#: no network — see `_simulated_model` below. Any other value is passed to
#: Pydantic AI as a model name, e.g. `anthropic:claude-opus-5`.
DESK_MODEL = os.environ.get("DESK_MODEL", "simulated")

#: The escalation thresholds. Deliberately crude and deliberately OUTSIDE the
#: agents: a number a compliance officer has to be able to point at does not
#: belong in a prompt, and "the model decides what counts as large" is how you
#: end up unable to answer a regulator. Agents judge; policy stays in code.
ESCALATION_AMOUNT = 250_000.0
HIGH_RISK_COUNTRIES = frozenset({"IR", "KP", "SY", "RU", "BY", "MM", "AF"})


# ---------------------------------------------------------------------------
# What each agent returns. These are Pydantic models and they stay on this side
# of the boundary — `risk_desk.Decision` is what a caller sees.
# ---------------------------------------------------------------------------


class Screening(BaseModel):
    """The screening agent's assessment of the beneficiary."""

    hit: bool = Field(description="True if the beneficiary matches a watchlist entry.")
    risk: float = Field(ge=0.0, le=1.0, description="0 is clean, 1 is certainly sanctioned.")
    notes: str = Field(description="One sentence, for the caller's rationale.")


class History(BaseModel):
    """The history agent's assessment of whether this is normal for this caller."""

    in_pattern: bool = Field(description="True if this payment looks like the caller's others.")
    prior_payments: int = Field(ge=0, description="How many comparable payments were found.")
    notes: str = Field(description="One sentence, for the caller's rationale.")


class Approve(BaseModel):
    """The adjudicator is confident the payment should proceed."""

    confidence: float = Field(ge=0.0, le=1.0)
    rationale: str


class Decline(BaseModel):
    """The adjudicator is confident the payment should be stopped."""

    confidence: float = Field(ge=0.0, le=1.0)
    rationale: str


class Escalate(BaseModel):
    """The adjudicator will not decide this one alone.

    Returning this does NOT make the agent wait for a human — an agent that
    blocks is an agent holding a socket. It hands the decision back to the
    workflow, which parks on a Signal at zero cost for as long as it takes. The
    waiting is Temporal's job; the judgement about whether to wait is the
    agent's. Keeping those two separate is why this is a union output type and
    not an `ask_human` tool.
    """

    question: str
    rationale: str


# ---------------------------------------------------------------------------
# The simulated model.
# ---------------------------------------------------------------------------
#
# Pydantic AI's `FunctionModel` is a model whose "inference" is a Python
# function, so the desk runs end to end with no provider, no API key and no
# network — and every Activity, every retry and every event in the workflow
# history is identical to the real thing. That is what makes it honest as a
# teaching artefact rather than a mock: the only component swapped out is the
# one nobody in the room is here to learn about.
#
# It also has to be scripted, and scripting it is where the shape of an agent
# becomes obvious: turn one asks for a tool, turn two answers. Read `_screening`
# below next to the history in the Cloud UI and the correspondence is exact.


def _text_so_far(messages: list[ModelMessage]) -> str:
    """Every string the model has been shown, flattened.

    The simulation reads its inputs back out of the prompt because that is all a
    model gets. No side channel, no `deps` smuggled past the boundary — if the
    prompt does not say it, the agent cannot know it, and neither can this.
    """
    chunks: list[str] = []
    for message in messages:
        for part in getattr(message, "parts", []):
            content = getattr(part, "content", None)
            if isinstance(content, str):
                chunks.append(content)
            elif isinstance(content, list):
                chunks.extend(item for item in content if isinstance(item, str))
    return "\n".join(chunks)


def _field(text: str, label: str, default: str = "") -> str:
    match = re.search(rf"^{re.escape(label)}:\s*(.+)$", text, re.MULTILINE)
    return match.group(1).strip() if match else default


def _number(text: str, label: str, default: float = 0.0) -> float:
    raw = _field(text, label)
    match = re.search(r"-?\d+(?:\.\d+)?", raw)
    return float(match.group(0)) if match else default


def _output_tool(info: AgentInfo, name: str) -> str:
    """Find the output tool for a given result type.

    With `output_type=[Approve, Decline, Escalate]` Pydantic AI publishes one
    output tool per member and lets the model pick — which is exactly how a real
    model chooses a branch, so the simulation picks the same way.
    """
    for tool in info.output_tools:
        if tool.name.endswith(name):
            return tool.name
    return info.output_tools[0].name


def _called(messages: list[ModelMessage], tool_name: str) -> bool:
    """Has this tool already been called in this run?"""
    return any(
        isinstance(part, ToolCallPart) and part.tool_name == tool_name
        for message in messages
        for part in getattr(message, "parts", [])
    )


async def _think() -> None:
    """Stand in for the latency of a real model request.

    A sleep inside an Activity is a sleep on a worker thread, not a workflow
    timer — which is precisely what a model request is, and precisely why it does
    not belong in workflow code.
    """
    if THINK_SECONDS > 0:
        await asyncio.sleep(THINK_SECONDS)


async def _screening(messages: list[ModelMessage], info: AgentInfo) -> ModelResponse:
    await _think()
    text = _text_so_far(messages)

    if not _called(messages, "watchlist_lookup"):
        return ModelResponse(
            parts=[
                ToolCallPart(
                    "watchlist_lookup",
                    {
                        "name": _field(text, "Beneficiary", "unknown"),
                        "country": _field(text, "Country", "NZ"),
                    },
                )
            ]
        )

    country = _field(text, "Country", "NZ").upper()
    hit = "MATCH" in text.upper()
    risk = 0.85 if hit else (0.45 if country in HIGH_RISK_COUNTRIES else 0.08)
    return ModelResponse(
        parts=[
            ToolCallPart(
                _output_tool(info, "Screening"),
                {
                    "hit": hit,
                    "risk": risk,
                    "notes": (
                        f"Watchlist returned a match for the beneficiary in {country}."
                        if hit
                        else f"No watchlist match; {country} carries "
                        f"{'elevated' if country in HIGH_RISK_COUNTRIES else 'routine'} country risk."
                    ),
                },
            )
        ]
    )


async def _history(messages: list[ModelMessage], info: AgentInfo) -> ModelResponse:
    await _think()
    text = _text_so_far(messages)

    if not _called(messages, "payment_history"):
        return ModelResponse(
            parts=[ToolCallPart("payment_history", {"caller": _field(text, "Caller", "unknown")})]
        )

    amount = _number(text, "Amount")
    typical = _number(text, "Typical amount", 1000.0)
    prior = int(_number(text, "Comparable payments", 0))
    in_pattern = amount <= typical * 5 and prior > 0
    return ModelResponse(
        parts=[
            ToolCallPart(
                _output_tool(info, "History"),
                {
                    "in_pattern": in_pattern,
                    "prior_payments": prior,
                    "notes": (
                        f"{prior} comparable payments; this one is in pattern."
                        if in_pattern
                        else f"{prior} comparable payments, none near this size — out of pattern."
                    ),
                },
            )
        ]
    )


async def _adjudicator(messages: list[ModelMessage], info: AgentInfo) -> ModelResponse:
    await _think()
    text = _text_so_far(messages)

    risk = _number(text, "Screening risk")
    amount = _number(text, "Amount")
    in_pattern = _field(text, "In pattern", "true").lower().startswith("t")

    if risk >= 0.7 or amount >= ESCALATION_AMOUNT:
        return ModelResponse(
            parts=[
                ToolCallPart(
                    _output_tool(info, "Escalate"),
                    {
                        "question": (
                            f"Release {amount:,.2f}? Screening risk {risk:.2f}, "
                            f"{'in' if in_pattern else 'out of'} pattern."
                        ),
                        "rationale": (
                            "Above the amount threshold or above the screening risk bar; "
                            "this is not mine to decide."
                        ),
                    },
                )
            ]
        )

    if risk >= 0.4 and not in_pattern:
        return ModelResponse(
            parts=[
                ToolCallPart(
                    _output_tool(info, "Decline"),
                    {
                        "confidence": 0.78,
                        "rationale": "Elevated country risk on a payment out of pattern for this caller.",
                    },
                )
            ]
        )

    return ModelResponse(
        parts=[
            ToolCallPart(
                _output_tool(info, "Approve"),
                {
                    "confidence": round(0.95 - risk, 2),
                    "rationale": "Clean screening and consistent with the caller's payment history.",
                },
            )
        ]
    )


def _model(simulate):
    """The real model, or the scripted one. Chosen once, at import, off `DESK_MODEL`."""
    if DESK_MODEL == "simulated":
        return FunctionModel(simulate, model_name="simulated")
    return DESK_MODEL


# ---------------------------------------------------------------------------
# Activity configuration.
# ---------------------------------------------------------------------------

#: Applied to every agent Activity. Two decisions worth defending out loud:
#:
#: `task_queue` sends model and tool calls to the inference queue, so a backlog
#: of slow inference cannot starve the workflow tasks that schedule it.
#:
#: `maximum_attempts=3` is Temporal retrying the model, which is why the desk
#: contains no retry loop and why you should turn OFF your provider client's own
#: retries when you wire a real model in. Two retry mechanisms stacked on each
#: other multiply, they do not add, and only one of them is visible in history.
AGENT_ACTIVITY = ActivityConfig(
    task_queue=INFERENCE_TASK_QUEUE,
    start_to_close_timeout=timedelta(seconds=90),
    retry_policy=RetryPolicy(maximum_attempts=3),
)


def _durability() -> TemporalDurability:
    return TemporalDurability(activity_config=AGENT_ACTIVITY)


# ---------------------------------------------------------------------------
# The agents.
# ---------------------------------------------------------------------------
#
# `name` is normally optional in Pydantic AI and is REQUIRED here: Temporal
# derives Activity names from it, so changing one renames an Activity and breaks
# every in-flight review that has already scheduled it. Treat these three strings
# the way you treat a workflow type name.

screening_agent = Agent(
    _model(_screening),
    name="screening",
    output_type=Screening,
    instructions=(
        "You screen payment beneficiaries for a bank's risk desk. "
        "Call watchlist_lookup exactly once, then return your assessment. "
        "Be specific in your notes and do not speculate beyond the tool result."
    ),
    capabilities=[_durability()],
)


@screening_agent.tool_plain
async def watchlist_lookup(name: str, country: str) -> str:
    """Check a beneficiary against the sanctions and PEP watchlists.

    A tool call is a Temporal Activity — retried on failure, recorded in history,
    and visible to anyone reading the desk's workflows. Note the consequence for
    the caller: they get the agent's *conclusion* and no route at all to the
    watchlist it read. The data stays inside the boundary; only the judgement
    crosses it.
    """
    await asyncio.sleep(0.2)
    flagged = country.upper() in HIGH_RISK_COUNTRIES and name.strip().lower().startswith("v")
    return (
        f"MATCH: '{name}' appears on the consolidated list ({country})."
        if flagged
        else f"No entries for '{name}' ({country}). 3 near-name records reviewed and discarded."
    )


history_agent = Agent(
    _model(_history),
    name="history",
    output_type=History,
    instructions=(
        "You assess whether a payment is in pattern for the caller who submitted it. "
        "Call payment_history exactly once, then return your assessment. "
        "A large payment is not automatically suspicious; an unprecedented one is."
    ),
    capabilities=[_durability()],
)


@history_agent.tool_plain
async def payment_history(caller: str) -> str:
    """Fetch this caller's recent payment profile."""
    await asyncio.sleep(0.2)
    # Stable per caller so a rehearsal and the live run tell the same story.
    seed = sum(ord(character) for character in caller) or 1
    prior = 4 + seed % 9
    typical = 800.0 + (seed % 17) * 250.0
    return (
        f"Comparable payments: {prior}\n"
        f"Typical amount: {typical:.2f}\n"
        f"Oldest on file: 2 years ago. No chargebacks, no recalls."
    )


adjudicator_agent = Agent(
    _model(_adjudicator),
    name="adjudicator",
    output_type=[Approve, Decline, Escalate],
    instructions=(
        "You are the adjudicator on a bank's payment risk desk. Two specialists have "
        "reported. Approve or decline when the evidence is clear. Escalate to a human "
        "when it is not, or when the amount is large enough that a person should own "
        "the call — a human deciding is not a failure, it is the system working."
    ),
    capabilities=[_durability()],
)


ALL_AGENTS = [screening_agent, history_agent, adjudicator_agent]


def describe_model() -> str:
    if DESK_MODEL == "simulated":
        return f"simulated ({THINK_SECONDS:.1f}s per model request, no provider, no API key)"
    return DESK_MODEL
