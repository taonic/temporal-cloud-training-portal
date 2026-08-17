# Lab 6 — the Rate Desk

A Nexus call across a boundary you do not control. Your worker is already polling;
this adds one command. The session page has the graded steps — this is the
background.

## What you are about to do

Your `PaymentWorkflow` asks another team's service for an FX quote. That service
lives in **someone else's namespace** — you have no address for it, no credential
for it, and no permission to read it. You name an endpoint and an operation, and
wait.

```bash
uv run main.py quote --currency AUD --amount 5000
```

```
  ticket #7  ·  AUD 4610.10 @ 0.92202
  priced in rate-desk.bvmon — a namespace you cannot reach
```

## The four things worth noticing

**1. Your caller workflow contains no connection details.** Open
[`training/workflows.py`](training/workflows.py) and read `PaymentWorkflow`. No
host, no namespace, no API key, no HTTP client, no retry policy for the network.
Compare that with what calling another team's REST API would have required.

**2. You cannot grant yourself access.** The endpoint permits *no* callers by
default — not even namespaces in the same account as its target. Your namespace
is on the allowlist because the desk's owner put it there, on *their* resource.
That is the same account-versus-namespace distinction Lab 5 made about the
metrics endpoint, and it is the one that decides who can page whom at 3am.

**3. The desk can be down and your call still will not fail.** When the instructor
stops the handler, run this:

```bash
temporal workflow describe --workflow-id <your payment workflow>
```

```
Pending Nexus Operations: 1
  State                    BackingOff
  Attempt                  4
  NextAttemptScheduleTime  3 seconds from now
```

Nothing failed. Nobody is holding a socket. Nobody has to resubmit. When the desk
comes back, your workflow completes on its own — and the latency it reports
includes every second the desk was gone, which is the number your SLO should care
about.

**4. You can click across the boundary.** In the Cloud UI, open your caller
workflow and find `NexusOperationScheduled`. It links to the handler workflow in
the desk's namespace, and that workflow links back. Two namespaces, bidirectional,
in a UI where you cannot otherwise see the other side at all.

## The contract is the seam

[`training/rate_desk.py`](training/rate_desk.py) is the only file both sides
share: operation names, input and output types, nothing else. In production it is
a published package. Note what you do *not* import — `training/desk.py`, the
handler, which is the desk owner's code and none of your business.

## Why the endpoint name is an argument, not an environment read

`PaymentWorkflow` takes `endpoint` as a parameter. Reading `os.environ` inside a
workflow raises `RestrictedWorkflowAccessError`, and the sandbox is right to
refuse: a value that can change between replays is exactly what determinism
forbids. Configuration is read by the starter and passed in, so it lands in
history and every replay sees what the first attempt saw.

## Flags

| Flag | Default | Notes |
|---|---|---|
| `--currency` | `NZD` | `NZD`, `AUD`, `USD`, `EUR`, `GBP` |
| `--amount` | `1000` | |
| `--as <name>` | your namespace | What the desk names its workflow after |
| `--local` | off | Against `temporal server start-dev` |
| `--namespace <ns>` | from `.env` | Override, for rehearsing several namespaces on one machine |
