# Preset: Temporal Cloud Platform Workshop

Sandbox for the six-session platform workshop this repo serves. Built from the
same shape as `temporal-local-with-python-uv`: one VM, `config.yml` +
`scripts/setup-<vm-name>`.

The preset and the track live here, alongside the labs and the portal they drive:

```
instruqt/
  sandbox/   this preset — slug temporal-cloud-platform-workshop
  track/     the track   — slug temporal-control-plane-workshop
labs/        what the sandbox extracts and students work in
src/         the portal
```

Instruqt identifies both by the `slug` (and the track's `id`) inside their YAML,
not by directory name, so these folders can be called anything. Push each from
inside its own directory — `instruqt sandbox push` here, `instruqt track push` in
`../track`. The coupling that does matter is `sandbox_preset:` in `track.yml`
naming this preset's `slug:`.

The setup script fetches `labs/` from this same repo over the GitHub tarball API
rather than reading the working copy next to it, and that is deliberate: the
sandbox must build from a pushed ref, so what a student gets is what is committed
rather than whatever is on the machine that ran the push.

Everything `PREREQUISITES.md` asks attendees to install is installed here, and
`terraform init`, the worker build (`uv sync` and/or `dotnet restore` + `build`)
and the Docker image pulls are all done at build time, so Session 1 starts at
`terraform plan`.

## What's in the box

| | |
|---|---|
| Temporal CLI 1.8.2 | every session |
| `temporal cloud` extension 0.0.3 (separate binary) | Sessions 1, 2 |
| Terraform 1.15.8 | Sessions 1, 2 |
| Python 3.12 + uv 0.12.5 | Sessions 1, 3–6 (`labs/worker`) |
| .NET SDK 8 | Sessions 1, 3–6 (`labs/worker`) |
| Docker + Compose v5.4.0 | Sessions 4, 5 |
| `temporalio/temporal-proxy:v0.4.1` | Session 4 |
| `prom/prometheus:v3.1.0` + `grafana/grafana:11.5.1` | Session 5 |
| code-server 4.131.0 on `:8443` | all sessions |
| `labs/` extracted to `/workspace/workshop/labs` | all sessions |

Every download that publishes a checksum manifest is verified against it before
install. Helpers on `PATH`: `workshop-creds`, `workshop-check`, `workshop-help`,
`worker-run`, `proxy-up`, `obs-up`/`obs-down` (aliases),
`dev-server-up`/`dev-server-down`, and `restore-labs` (instructor-only — see
Recovery).

## Two worker stacks, one set of commands

`labs/worker` is being moved from C# to Python in the lab repo, so **both
toolchains are installed** and the preset works against either ref. A sandbox that
knew only one of them would turn a lab-repo commit into a broken track.

Which one is used is decided at build time from the tarball that was actually
extracted — `pyproject.toml` wins, then `*.csproj` — and recorded in
`/etc/workshop-stack`. `WORKER_STACK=python|dotnet` in `config.yml` pins it
instead, and the build fails loudly if the named stack is not in the repo.

`worker-run` is the dispatcher, and it exists because the two workers take an
identical command surface — `worker`, `start`, `load`, `chaos`, same flags:

```bash
worker-run worker --version 2.0    # -> uv run main.py worker --version 2.0
                                   # or dotnet run -- worker --version 2.0
WORKER_STACK=dotnet rw             # override for one command
```

It prints the real command before running it, so a student comparing the terminal
against their session page sees the same words the page does.

`rw`, `rs`, `rl` and `rm5` are **shell functions** rather than aliases, which is
not cosmetic: an alias appends what you typed after the closing paren, so
`rw --version 2.0` used to expand to `(cd … && dotnet run -- worker) --version 2.0`
and drop the flag. From Lab 3 on, a worker without `--version` is handed no tasks
at all and fails silently — the most expensive twenty minutes available in this
workshop.

uv's paths are pinned rather than left under `$HOME`, and set identically in
`/etc/environment`, `~/.bashrc` and the `code-server` unit — a path that resolves
differently in a systemd-launched terminal than in the build script is a path
where the student's first `uv run` re-downloads CPython, which is the exact wait
the pre-warm exists to remove.

| | | |
|---|---|---|
| `UV_PYTHON_INSTALL_DIR` | `/opt/uv/python` | managed CPython 3.12, installed `--no-bin` so no `python3.12` lands on `PATH` without the SDK in it |
| `UV_CACHE_DIR` | `/workspace/.uv-cache` | **same filesystem as the venv**, so uv hardlinks wheels instead of copying them. On a different mount every install silently degrades to a full copy |
| `UV_PYTHON_PREFERENCE` | `only-managed` | keeps it off the base image's own `python3` |

The whole Python path — checksum verification against uv's per-asset `.sha256`,
the managed interpreter install, `uv sync --locked` against the committed
lockfile, and an offline `import temporalio` — was verified end to end in an
`ubuntu:24.04` container before this landed.

Both stacks are pre-warmed when both are present, so `WORKER_STACK` stays usable
on the day rather than costing a NuGet restore or a `uv sync` at 09:05. The
closing health checks verify **both** toolchains and the built artifact of
whichever stack shipped — the unused one is checked precisely because it is
unused, so a stack switch in the lab repo needs no preset change.

## Recovery

The workshop is six sessions in one day, in one sandbox, with nothing persisted
outside it. A sandbox that dies at Session 4 leaves the student's Cloud resources
intact and every line of Terraform they wrote gone — and re-pasting it from four
session pages in front of a waiting room is not a recovery.

So `/opt/solutions/after-{1..6}/` holds `labs/*.tf` as it should look at the end of
each session, and `restore-labs` puts it back:

```bash
restore-labs 4                    # namespace from workshop-creds
restore-labs 4 training-someone   # or name it explicitly
```

Only `lab1.tf` and `lab2.tf` are ever student-authored — Sessions 3 and 4 add no
Cloud resources, and Sessions 5 and 6 only add a key to `lab1.tf`'s tag block. The
per-student names are sentinels in the snapshots (`__NAMESPACE_NAME__` and four
others); `restore-labs` derives all of them from the namespace short name exactly
as the portal's `naming.ts` does, so it only ever has to be told that one value.

Three things it deliberately does **not** do, and prints instead:

- **State.** There is no `terraform.tfstate` to restore. The resources exist in
  Cloud and Terraform does not know it, so they must be imported before the next
  apply. The API key is the exception — its secret cannot be imported, so let
  Terraform create a new one and delete the old key in the UI.
- **`labs/proxy/config.yaml`.** Session 4's edit is an uncomment, not Terraform.
- **Session 5/6 tag values.** Those are the student's own dashboard and runbook
  links. The snapshots carry `RESTORED — replace with…` placeholders, which are
  non-empty (so the checkpoint passes) and obviously not real (so they get fixed).

`/opt/solutions` is `0700` and outside `$WORKSHOP_DIR`, and `workshop-help` does
not mention it. Session 2's snapshot includes the operators group, which the portal
deliberately leaves for students to derive — this is a restore tool, not a hint
sheet. Keep it to yourself.

## Ports

The VM sets `allow_external_ingress: [http, https, high-ports]` — Instruqt VMs
have no per-port list, so the track's `assignment.md` turns these into service
tabs.

| Port | Service |
|---|---|
| 8443 | code-server (https, `--auth none`) |
| 3030 | Grafana (Session 5) |
| 9090 | Prometheus (Session 5) |
| 9464 | worker SDK metrics — optional; Prometheus scrapes it internally |
| 8233 | local dev-server UI — fallback only, unit ships disabled |

The local dev server is installed but **disabled on purpose**: it binds 7233,
which Session 4's `temporal-proxy` needs.

## Knobs

Non-secret knobs live in the VM's `environment:` block; all have script-side
defaults.

| Variable | Default | Notes |
|---|---|---|
| `LAB_REPO_URL` | `https://github.com/taonic/temporal-cloud-training-portal.git` | repo holding `labs/` |
| `LAB_REPO_REF` | `main` | |
| `WORKSHOP_DIR` | `/workspace/workshop` | clone target; code-server opens it |
| `TEMPORAL_ACCOUNT` | `bvmon` | bare account id, used by `proxy-up` |
| `WORKER_STACK` | *empty* | `python` \| `dotnet`. Empty detects from `labs/worker`; see above |
| `TEMPORAL_CLI_VERSION` | `1.8.2` | |
| `TERRAFORM_VERSION` | `1.15.8` | |
| `UV_VERSION` | `0.12.5` | from `astral-sh/uv`; each asset ships its own `.sha256` |
| `PYTHON_VERSION` | `3.12` | must match `labs/worker/.python-version` |
| `DOTNET_CHANNEL` | `8.0` | |
| `COMPOSE_VERSION` | `v5.4.0` | only used if the base image lacks Compose v2 |
| `CODE_SERVER_VERSION` | `4.131.0` | |
| `CLOUD_CLI_VERSION` | `0.0.3` | pre-release from `temporalio/cloud-cli` |
| `PROMETHEUS_IMAGE` / `GRAFANA_IMAGE` / `PROXY_IMAGE` | pinned | must match `labs/observability/docker-compose.yml` |
| `WORKSHOP_STRICT_EGRESS` | `1` | `0` downgrades the closing egress probes to warnings. It does **not** open anything — Instruqt sandboxes have unrestricted outbound egress; this only decides whether a failed probe is fatal |

### Only `labs/`, and why

The sandbox fetches the repo tarball from
`api.github.com/repos/<owner>/<repo>/tarball/<ref>` and extracts **only `labs/`**.
It is not a clone, and there is no git remote in `/workspace/workshop`.

The rest of that repo is the portal. `src/course/grading.ts` holds every
checkpoint's pass condition; `src/course/sessions/*.ts` holds the operators-group
answer that Session 2 deliberately withholds from the snippet; `INSTRUCTOR.md` is
the run-book, including where the workshop's soft spots are. And since the preset
moved in, `instruqt/` holds this file, the setup script and the `/opt/solutions`
sentinels — the recovery snapshots that are deliberately `0700` and outside
`$WORKSHOP_DIR`. None of it belongs in the working directory of people holding
Global Admin on the training account.

The repo is public, so this is friction rather than a control — a folder people
are already sitting in gets grepped, a repo they would have to go find does not.
A tarball also removes the content outright, where `git sparse-checkout` only
hides it behind one command. If you want it to be a real boundary, the portal repo
has to go private.

The setup script asserts the filter held: if `src/`, `INSTRUCTOR.md`, `README.md`,
`package.json` or `instruqt/` ever appear in `$WORKSHOP_DIR`, the build fails
rather than shipping them. The failure mode it guards against is silent — a tar
that quietly extracted everything looks fine until a student opens `grading.ts`.

Note the tar member filter is a single pattern, `*/labs`. GNU tar recurses into a
matched directory; adding `*/labs/*` makes tar report an unmatched pattern and
exit 2, which under `set -e` kills the build.

### Private lab repo

The lab repo is public, so `config.yml` declares no secret and the fetch runs
unauthenticated. If it ever goes private, `LAB_REPO_TOKEN` belongs in a
`secrets:` block — never in `environment:`, which is committed to git and
printed in Instruqt's debug log. A `secrets:` entry only resolves a name that
already exists in team settings, so create it first:

```bash
instruqt secrets create LAB_REPO_TOKEN <PAT> --team temporal
```

The setup script already handles the token when it is present: it strips CRLF and
keeps xtrace off around every line that touches it. The API tarball endpoint takes
the token as an `Authorization: Bearer` header rather than in the URL, so there is
no tokenized URL to leak into the log in the first place.

## Before the first build

1. `labs/proxy/README.md` still tells students to pull
   `temporalio/temporal-proxy:latest`. The setup tags the pinned image as
   `latest` locally so that command hits the cache, but the README is worth
   changing to the pinned tag.
2. Validate with `instruqt sandbox push` against a draft — `instruqt track
   validate` only covers tracks (`track.yml` + challenges), not presets.
3. Then launch it for real and run **Session 1** and **Session 5** end to end as a
   student. Session 1 proves Terraform can create an `azure-australiaeast`
   namespace from inside the sandbox and that the portal grades it green; Session
   5 is the heaviest thing the VM does (worker + Prometheus + Grafana at once).
   The build-time health checks cannot tell you either of those.

## Egress probes

The address every lab dials is `<namespace>.<account>.tmprl.cloud:7233`, which
does not exist until Session 1 creates it — so nothing at build time can probe the
real endpoint. Both `workshop-check` and the closing health checks use
`australiaeast.azure.api.temporal.io:7233` instead: same port, same cloud, same
region as `lab1.tf` pins, and it resolves before anyone has provisioned anything.
It proves 7233 is open outbound, which is the failure that would kill Sessions 3–6.
