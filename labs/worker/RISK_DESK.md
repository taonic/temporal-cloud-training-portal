# Lab 4 — the Risk Desk

A Nexus call across a boundary you do not control, to a service that is three AI
agents and sometimes a human. Your worker is already polling; this adds one
command. The session page has the graded steps — this is the background.

## What you are about to do

Your `PaymentWorkflow` submits a cross-border payment and asks the bank's Risk
Desk to adjudicate it. That desk lives in **someone else's namespace** — you have
no address for it, no credential for it, and no permission to read it. You name
an endpoint and an operation, and wait.

```bash
uv run lab4_review.py review --beneficiary "Grace Hopper" --amount 4200
```

```
  ticket #1  ·  APPROVE (confidence 87%, decided by adjudicator)
    · screening: No watchlist match; NZ carries routine country risk.
    · history: 10 comparable payments; this one is in pattern.
    · adjudicator: Clean screening and consistent with the caller's payment history.
  5 model call(s) in desk-ns — a namespace you cannot reach, on a bill that is not yours
  3.3s end to end, which is the number your SLO cares about
```

## What is on the other side

Three agents, built with [Pydantic AI](https://ai.pydantic.dev), orchestrated by
an ordinary Temporal Workflow:

| Agent | Job | Tool |
|---|---|---|
| `screening` | Is the beneficiary a problem? | `watchlist_lookup` |
| `history` | Is this in pattern for this caller? | `payment_history` |
| `adjudicator` | Approve, decline — or escalate to a person | none |

The first two run **concurrently**; the third consumes both. When the adjudicator
will not decide alone, the desk's workflow parks on a Signal until a human
answers. You will not be able to tell.

## The five things worth noticing

**1. Your caller workflow contains no connection details — and no AI.** Open
[`training/lab4_payment.py`](training/lab4_payment.py) and read `PaymentWorkflow`. No
host, no namespace, no API key, no HTTP client, no retry policy for the network.
And no model, no prompt, no token budget, no agent framework, no `ANTHROPIC_API_KEY`.
Try it:

```bash
env | grep -i anthropic     # nothing
```

You just consumed an agent without holding the credential that runs it, the rate
limit that throttles it, or the bill that pays for it. That is the single most
useful thing Nexus does for a platform team in 2026, and it is worth more than a
minute.

**2. You cannot grant yourself access.** The endpoint permits *no* callers by
default — not even namespaces in the same account as its target. Your namespace
is on the allowlist because the desk's owner put it there, on *their* resource.
Same account-versus-namespace distinction Lab 3 made about the metrics endpoint,
and the one that decides who can page whom at 3am.

**3. "The agent is thinking" and "a human is deciding" look identical from here,
and should.** When your instructor sends a payment big enough to escalate, run:

```bash
temporal workflow describe --workflow-id <your payment workflow>
```

```
Pending Nexus Operations: 1
  State           Started
  Attempt         1
```

Nothing failed. Nobody is holding a socket. Nobody has to resubmit. The desk is
parked on a Signal — at zero cost, across a redeploy if need be — and your
workflow completes when the person gets back from lunch. Now ask what an HTTP
client would be doing at this point, and which of your services would still be
holding the request open.

**4. The desk can be down and your call still will not fail.** When the
instructor stops the handler entirely, the same command shows the other failure
mode:

```
  State                    BackingOff
  Attempt                  4
  LastAttemptFailure       {"message":"upstream timeout"}
  NextAttemptScheduleTime  3 seconds from now
```

When the desk comes back, your workflow completes on its own — and the latency it
reports includes every second the desk was gone, which is the number your SLO
should care about.

**5. You can click across the boundary.** In the Cloud UI, open your caller
workflow and find `NexusOperationScheduled`. It links to the handler workflow in
the desk's namespace, and that workflow links back. Two namespaces,
bidirectional, in a UI where you cannot otherwise see the other side at all.

If you can reach the desk's namespace at all, look at what its history contains —
one Activity per model request and one per tool call:

```
  agent__screening__model_request          ×2
  agent__screening__toolset__…__call_tool  ×1
  agent__history__model_request            ×2
  agent__history__toolset__…__call_tool    ×1
  agent__adjudicator__model_request        ×1
```

That is an agent's entire reasoning trace, durable, replayable and auditable,
recorded without anybody writing logging code. It is also the answer to "what did
the model actually do" six months from now, in front of a regulator.

## The contract is the seam

[`training/lab4_contract.py`](training/lab4_contract.py) is the only file both sides
share: the operation name, the input and output types, and nothing else. In
production it is a published package.

Note what it does **not** import: `pydantic`. The desk speaks Pydantic models
internally and maps them onto plain dataclasses at the boundary, so your worker
depends on `temporalio` and nothing else. Note also what you cannot import —
[`training/lab4_desk.py`](training/lab4_desk.py) and `training/lab4_agents.py`, which are the
desk owner's code and none of your business.

## Why the endpoint name is an argument, not an environment read

`PaymentWorkflow` takes `endpoint` as a parameter. Reading `os.environ` inside a
workflow raises `RestrictedWorkflowAccessError`, and the sandbox is right to
refuse: a value that can change between replays is exactly what determinism
forbids. Configuration is read by the starter and passed in, so it lands in
history and every replay sees what the first attempt saw.

## Flags

| Flag | Default | Notes |
|---|---|---|
| `--amount` | `1000` | Over 250,000 escalates to a human |
| `--beneficiary` | `Ada Lovelace` | |
| `--country` | `NZ` | `RU`, `IR`, `KP`, `SY`, `BY`, `MM`, `AF` carry elevated risk |
| `--currency` | `NZD` | |
| `--purpose` | `invoice settlement` | |
| `--as <name>` | your namespace | What the desk names its workflow after |
| `--endpoint <name>` | `risk-desk` | |
| `--local` | off | Against `temporal server start-dev` |
| `--namespace <ns>` | from `.env` | Override, for rehearsing several namespaces on one machine |

## Instructor: hosting the desk

```bash
uv run --group desk lab4_review.py desk                    # both queues, one process
uv run --group desk lab4_review.py desk --inference-only   # agent I/O only, second box
uv run --group desk lab4_review.py decide <workflow-id> approve --note "…"
```

`--group desk` is what installs Pydantic AI; students never resolve it. The desk
runs **simulated** by default — a scripted model, no provider, no API key, no
network, and a workflow history identical to the real thing. Set `DESK_MODEL` to
a real model (e.g. `anthropic:claude-opus-5`) to swap it, and `DESK_THINK_SECONDS`
to change how long a simulated model request takes.
