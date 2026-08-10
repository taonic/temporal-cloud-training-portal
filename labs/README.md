# Your lab workspace

Everything you touch during the workshop lives here.

```
labs/
  *.tf              Terraform — plumbing done, resources yours to write
  worker/           C# worker and workflows (Labs 1, 3, 4, 5, 6)
  observability/    Prometheus + Grafana on Docker (Lab 5)
```

The Terraform plumbing is already set up — provider, version pin, and the
API-key variable — so `terraform init` works before you have written a line.
**The resources are yours to write**, one file per session, guided by the TODO
header in each.

`worker/` and `observability/` are the opposite: working code you run rather
than write. If you break something in there, `git checkout labs/worker` puts it
back.

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

## Per lab

| File | What you write in it |
|---|---|
| `lab1.tf` | Namespace, region, retention, and the one `provisioner` tag block |
| `lab2.tf` | Custom role, Worker service account, its API key, operators group |
| `lab3.tf` | Nothing — the rollout runs from `labs/worker` and the CLI |
| `lab4.tf` | Nothing — the work is in `labs/proxy/`, and the check reads payload metadata |
| `lab5.tf` | Dashboard and alert catalogue tag |
| `lab6.tf` | Runbook and escalation tag |

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
the 0.9 line predates `temporalcloud_custom_role`, `temporalcloud_group` and
`temporalcloud_namespace_tags`, so Labs 2 onwards would fail to plan against
it. Do not add a second `terraform` or `provider` block in your session files —
Terraform allows only one of each per directory.

## Two provider quirks that will cost you time

**`resource_ids` is required on every custom-role permission**, even when
`allow_all = true`. Pass an empty list:

```hcl
resources = {
  resource_type = "accounts"
  resource_ids  = []
  allow_all     = true
}
```

**Attaching a custom role uses `account_access_custom_roles`**, not
`custom_roles`. The shorter name looks right and does not exist.

## Getting the Worker's service account key out (Lab 2)

Terraform will not print a sensitive value unless you name it:

```bash
terraform output -raw worker_api_key
```

## Cleaning up

```bash
terraform destroy
```

Worth doing at the end of the day even though the portal's sweeper removes your
resources when your 48-hour window closes. Custom roles in particular are capped
at 25 per account, so releasing yours early is a courtesy to the next cohort.

Never commit `terraform.tfstate` — it holds resource ids and can hold secrets.
`.gitignore` already covers it.
