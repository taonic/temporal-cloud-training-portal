# Your lab workspace

Everything you touch during the workshop lives here.

```
labs/
  *.tf              Terraform — plumbing done, resources yours to write
  worker/           Python worker and workflows, run with uv (Labs 1, 3, 4 and 5)
  observability/    Prometheus + Grafana on Docker (Lab 3)
```

The course is five labs and they run in order. Worker Versioning and the
Encryption Proxy used to sit in the middle; both are gone from this repo, and
`git log` is where they live now.

The Terraform plumbing is already set up — provider and version pin — so
`terraform init` works before you have written a line.
**The resources are yours to write**, one file per session, guided by the TODO
header in each.

`worker/` and `observability/` are the opposite: working code you run rather
than write. If you break something in there, `git checkout labs/worker` puts it
back.

There is one entrypoint per lab, and you only ever run the one you are on:

| Script | Lab | Commands |
|---|---|---|
| `lab1_hello.py` | 1 | `worker`, `start` |
| `lab3_metrics.py` | 3 | `worker` (exports Prometheus), `load` |
| `lab4_review.py` | 4 | `worker`, `review` — plus `desk` and `decide`, which are your instructor's |
| `lab5_chaos.py` | 5 | `worker --break-determinism`, `determinism`, `stuck` |

They share `training/`, and share one task queue on purpose: a worker you left
running in another terminal has to be able to serve the lab you are on now, or
you spend twenty minutes debugging a workflow that never starts because of a
process you forgot about. `training/worker.py` says the same thing at more
length.

The worker needs no install step and no virtualenv you manage. `uv run
lab1_hello.py worker` creates the environment from `uv.lock` on first use —
pinned versions, same for everyone in the room — and reuses it after that. The
lockfile is committed on purpose; it is what makes that first run offline-safe
once the sandbox image has warmed the cache.

Lab 4's desk is the exception: it needs an agent framework, so it lives in an
optional dependency group and only your instructor resolves it
(`uv run --group desk lab4_review.py desk`). Your side stays at one dependency.

## Once, at the start

```bash
cd labs
export TEMPORAL_API_KEY=<the key you create in Lab 1>   # the CLIs read this
export TEMPORAL_CLOUD_API_KEY=$TEMPORAL_API_KEY        # the Terraform provider reads this
terraform init
```

`terraform init` downloads the provider and is the only setup step. Put both
exports in your shell startup file (`~/.zshrc` or `~/.bashrc`) rather than
typing them per terminal — this lab runs several at once, and an export does not
cross terminals. There is deliberately no `terraform.tfvars`: the provider reads
`TEMPORAL_CLOUD_API_KEY` directly, so the key never needs to exist in a file in
this repo.

Those two exports are the whole credential story. There is one provider, it is
you, and every resource in every lab file is attributable to you.

(Lab 2 used to need a second, elevated credential — creating a Custom Role is an
Account Owner permission. It now builds a namespace-scoped service account,
which a Global Admin can create directly, so `TF_VAR_elevated_api_key` is gone
and nothing reads it if your sandbox still exports it.)

## Per lab

| File | What you write in it |
|---|---|
| `lab1.tf` | Namespace, region, retention, and the one `provisioner` tag block |
| `lab2.tf` | Namespace-scoped Worker service account, its API key, operators group and access |
| `lab3.tf` | Metrics Read-Only service account, its API key, and the dashboard/alert catalogue tag |
| `lab4.tf` | Nothing — you are a caller on your instructor's Nexus endpoint, and the artifact is a workflow history |
| `lab5.tf` | Runbook and escalation tag |

Each file opens with what to build and what the grader checks. The full,
personalised configuration is on the matching session page in the portal — these
files tell you *what* and *why*; the portal gives you the *exact* names.

```bash
terraform plan     # read it. always read it.
terraform apply
```

Then hit **Re-check** on the session page. Objective checkpoints go green within
a few seconds of apply completing.

They accumulate: `lab2.tf` onwards reference
`temporalcloud_namespace.lab` from Lab 1, so keep everything in this one
directory and never delete a session file to "clean up".

## What is already done for you, and why

`versions.tf` pins the provider to `~> 1.6`. This matters more than it looks:
the 0.9 line predates `temporalcloud_group`, `temporalcloud_group_access`,
`namespace_scoped_access` and `temporalcloud_namespace_tags`, so Labs 2 onwards
would fail to plan against it. Do not add a second `terraform` or `provider`
block in your session files — Terraform allows only one of each per directory.

## Two provider quirks that will cost you time

**`namespace_scoped_access` is mutually exclusive** with `account_access`,
`account_access_custom_roles` and `namespace_accesses` on
`temporalcloud_service_account`. Writing both is an *Invalid Attribute
Combination* at `terraform validate` time, before any API call — which is the
good case. The namespace in it is also immutable: changing it replaces the
service account and its API key.

**A group grants nothing on its own.** `temporalcloud_group` creates the
identity; `temporalcloud_group_access` is a separate resource keyed by the
group's `id`, and it is the one that carries `namespace_accesses`. Create only
the first and you have entitled nobody.

## Getting a service account key out (Labs 2 and 3)

Terraform will not print a sensitive value unless you name it:

```bash
terraform output -raw worker_api_key     # Lab 2 — the Worker's identity
terraform output -raw metrics_api_key    # Lab 3 — the metrics scraper's identity
```

Two service accounts, two keys, two entirely different shapes — and holding them next to each other
is worth a minute. The Worker's is namespace-scoped with `write` on one namespace and no
account-wide access at all. The scraper's is the reverse: an account-level `metricsread` role with
no namespace scoping available to it. Neither can do the other's job, and neither could have been
built in the other's shape.

## Cleaning up

```bash
terraform destroy
```

Worth doing at the end of the day even though the portal's sweeper removes your
resources when your 48-hour window closes. Namespaces in particular are capped
per account, so releasing yours early is a courtesy to the next cohort.

Never commit `terraform.tfstate` — it holds resource ids and can hold secrets.
`.gitignore` already covers it.
