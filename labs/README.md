# Your lab workspace

Everything you touch during the workshop lives here.

```
labs/
  *.tf              Terraform — plumbing done, resources yours to write
  worker/           Python worker and workflows, run with uv (Labs 1, 5, 6, 7)
  observability/    Prometheus + Grafana on Docker (Lab 5)
  proxy/            Encryption proxy — parked with Lab 4, not running this cohort
```

This cohort runs Labs **1, 2, 5, 6 and 7**. Worker Versioning (3) and the
Encryption Proxy (4) are parked: their session pages, lab headers and sandbox
assets all still exist, they are simply not in the running course. Numbers are
unchanged so nothing you write today has to move if they come back.

The Terraform plumbing is already set up — provider and version pin — so
`terraform init` works before you have written a line.
**The resources are yours to write**, one file per session, guided by the TODO
header in each.

`worker/` and `observability/` are the opposite: working code you run rather
than write. If you break something in there, `git checkout labs/worker` puts it
back.

The worker needs no install step and no virtualenv you manage. `uv run main.py
<command>` creates the environment from `uv.lock` on first use — pinned versions,
same for everyone in the room — and reuses it after that. The lockfile is
committed on purpose; it is what makes that first run offline-safe once the
sandbox image has warmed the cache.

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
| `lab5.tf` | Metrics Read-Only service account, its API key, and the dashboard/alert catalogue tag |
| `lab6.tf` | Nothing — you are a caller on your instructor's Nexus endpoint. Boundary decision tag |
| `lab7.tf` | Runbook and escalation tag |

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

## Getting a service account key out (Labs 2 and 5)

Terraform will not print a sensitive value unless you name it:

```bash
terraform output -raw worker_api_key     # Lab 2 — the Worker's identity
terraform output -raw metrics_api_key    # Lab 5 — the metrics scraper's identity
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
