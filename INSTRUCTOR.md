# Instructor guide

Everything you need to run the workshop, in the order you need it. Read the
[Limits and known sharp edges](#limits-and-known-sharp-edges) section before you commit to a date —
the first item in it has a **lead time you do not control**.

---

## The 30-second mental model

Students open a rotating link, type their email, and Temporal Cloud emails them an invitation to
**`bvmon` as Global Admin**. A Temporal workflow — running in a *different* account (`tao.a2dd6`),
where students have no reach — holds a 48-hour timer and then deletes them. A sweeper deletes what
they created.

The portal grades each session's exit criteria by reading the Cloud Ops API live. It distinguishes
**verified** (the API was asked and answered) from **attested** (it could not be, and the student's
claim is what's recorded). Never present an attested check as proof.

---

## Prep work

### T-minus 2 weeks — the things with lead times

One item here can still kill a workshop date, because someone else has to act. The second used to,
and no longer does — it is kept so you know not to go looking for it.

- [ ] **Raise the namespace limit.** Accounts start at **10**. Every student creates one in
      Session 1. The documented auto-raise only triggers for namespaces with *running workflows*,
      which lab namespaces won't have. Open a support ticket for `cohort size + existing + headroom`.
      `pnpm ops:preflight` prints your current count.
- [ ] **Session 2 needs nothing from you any more.** It used to need two things with lead times:
      Custom Roles enabled on the account (they are Pre-release), and custom-role administration
      delegated to Global Admin via a shared elevated service account. Lab 2 now builds a
      **namespace-scoped service account** — `namespace_scoped_access` with `write`, no account-wide
      access block — which a Global Admin can create directly. No custom role, no second credential,
      no `TF_VAR_elevated_api_key`, and nothing to ask Temporal support for.

      `scripts/create-role-admin-sa.sh` and `scripts/custom-role-delegation.json` are retired. They
      still work if you want a delegation role for something else; no session runs them. If your
      Instruqt preset still injects `WORKSHOP_ELEVATED_API_KEY`, nothing reads it — see
      [Retired: custom roles and the elevated key](#retired-custom-roles-and-the-elevated-key) for
      what that machinery was for and why it went.

      The bug that drove all of it is worth remembering, because it is still open: a principal
      holding an **account-level custom role loses its data-plane access**. The control plane keeps
      working — `temporal cloud whoami` authenticates, `namespace user list` still reports
      `PERMISSION_ADMIN` — but `temporal workflow list` against their own namespace returns
      `Request unauthorized`. Leave `STUDENT_CUSTOM_ROLE_IDS` unset; a student carrying such a role
      would lose Sessions 1, 3, 4, 5 and 6 to buy nothing.

### T-minus 1 week

- [ ] **Confirm you are Account Owner on `bvmon`**, not merely Global Admin. A student with Global
      Admin can delete a Global Admin. Preflight reports which you are.
- [ ] **Check API key expiry.** Preflight warns below 7 days. The Cloud Ops key is a personal key —
      it dies with your account and expires on its own schedule.
- [ ] **Session 5 needs Docker only.** It uses SDK metrics into a Prometheus + Grafana pair
      (`labs/observability`), so there is no account-global metrics CA to set and no client
      certificates to distribute. Both run as containers in the sandbox — `obs-up` starts them and
      the images are pre-pulled at preset build time, so a locked-down attendee network is no
      longer the thing that breaks it.
- [ ] **Attendees install nothing.** The workshop runs in the Instruqt track
      `temporal-control-plane-workshop`, on the `temporal-cloud-platform-workshop` sandbox preset.
      The Temporal CLI and its `cloud` extension, Terraform, .NET 8, Docker and Compose are all
      baked into the image at pinned versions, with `terraform init` and `dotnet build` already
      run and the proxy, Prometheus and Grafana images pre-pulled. Attendees need a browser and
      the track link. What they still have to do themselves is `workshop-creds` and
      `workshop-check` at the top of Session 1 — see below.
- [ ] **Verify the track boots.** Launch it yourself once, end to end, and run `workshop-check` in
      the Terminal tab. It probes the tools, outbound gRPC on 7233 and the Cloud Ops API. This is
      the check that used to be an email asking twenty people to run `nc -vz`; it is now one
      sandbox launch, so there is no excuse for finding out on the day.
- [ ] **Session 4 needs no infrastructure.** It runs `temporalio/temporal-proxy` as a container
      with a throwaway in-process key, so there is no AKS cluster, no Azure Key Vault and no
      certificates. `proxy-up` runs it, deriving the short namespace name and account that
      `labs/worker/.env` does not carry.

### T-minus 1 day

- [ ] `pnpm ops:preflight` — must come back clean.
- [ ] Deploy with `SWEEPER_MODE=dry-run`. Let one pass run (≤15 min), open `/instructor`, and read
      the sweep report. Every row should be something you recognise.
- [ ] Flip `SWEEPER_MODE=live` and redeploy. **Do not skip the dry run** — this is auto-delete
      against an account you've said is not disposable.
- [ ] Narrow `PORTAL_ALLOWED_EMAIL_DOMAINS` from `*` to the attendees' real domain. With `*`, the
      only thing between the internet and Global Admin on `bvmon` is a six-character link. If you
      must leave it at `*` — mixed-employer cohort, unknown attendee list — at least set
      `PORTAL_BLOCKED_EMAIL_DOMAINS=gmail.com,outlook.com,yahoo.com,hotmail.com,icloud.com` so a
      leaked link cannot be redeemed with a throwaway consumer address.
- [ ] Walk Session 1 end-to-end yourself with a real address. It costs 10 minutes and it is the only
      way to find out the region id is wrong.

### Morning of

- [ ] Open `/instructor?t=<PORTAL_INSTRUCTOR_TOKEN>`. Check the canary is green and the baseline
      captured recently.
- [ ] Copy today's link **from `/instructor`**, not from preflight — the instructor page derives it
      from the URL you're actually on, so it has the right host and port.
- [ ] Paste it into the room's chat. Project the mirror.

---

## During the day

**Project `/instructor`.** New resources flash green for 20 seconds as students create them. It is
the fastest way to see who is stuck — a student with no namespace after ten minutes is visible
without asking.

**Watch the canary badge.** If it goes red, your Cloud Ops credential has broken: expired, revoked,
or the identity was deleted. Invitations and sweeps are both down until you fix it. Rotate with
`fly secrets set CLOUD_OPS_API_KEY=...`; it recovers within five minutes.

**Someone's invitation never arrives.** Check `/instructor` — if their user exists in the account,
the invite was created and it's an email problem, not a portal problem. Resending isn't wired up;
delete the user in the Cloud UI and have them resubmit.

**Seat cap hit.** 25/day by default. Raise `PORTAL_DAILY_SEAT_CAP` and redeploy.

**Someone needs longer than 48 hours.** There's an `extendMs` signal on their invitation workflow:

```bash
temporal workflow signal --workflow-id invite-$(printf '%s' "$EMAIL" | shasum -a 256 | cut -c1-32) \
  --name extendMs --input 86400000 \
  --address $TEMPORAL_ADDRESS --namespace tao.a2dd6 --api-key $TEMPORAL_API_KEY
```

---

## Limits and known sharp edges

Ordered by how likely they are to bite you.

| # | Limit | Consequence | Mitigation |
|---|---|---|---|
| 1 | **10 namespaces** default per account | Session 1 fails for everyone past the tenth student | Support ticket, 2 weeks ahead |
| 2 | **A namespace-scoped service account's namespace is immutable** | A student who scopes Lab 2's service account to the wrong namespace must destroy and recreate it, key included | The portal fills the id in for them; the checkpoint names the namespace it expected |
| 3 | **Link rotates at midnight `Australia/Sydney`** | Students lose portal access on day 2 while still holding Cloud access for 48h | Re-paste the new link on day two. Accepted trade-off |
| 4 | **`PORTAL_ALLOWED_EMAIL_DOMAINS=*`** as shipped | Anyone with the link can grant themselves Global Admin | Narrow it before the workshop; failing that, set `PORTAL_BLOCKED_EMAIL_DOMAINS` to the consumer mail providers |
| 5 | **6-character link**, ~2.2×10⁹ keyspace | Brute-forceable at ~12,000 req/s; a small machine falls over first | Fine in practice; don't pair it with `*` above |
| 6 | **The grader holds Account Owner** | It has Namespace *Admin* on every student namespace — read *and* write. Only the code restrains it | Deliberate choice. Grading paths use a read-only wrapper |
| 7 | **Session 5 is nearly unverifiable** | SDK metrics and Grafana live in the student's sandbox; the portal can only confirm a worker polled and workflows ran | Walk the room and look at screens |
| 8 | **temporal-proxy is Pre-release** | "Not ready for production use" per its own front page — fine for teaching, not a shipping recommendation | Say so; the session page does |
| 9 | **No provenance in the API** | "Created via Terraform" is unverifiable, ever | Session 1 grades the **tag** `provisioner=terraform`, and the checkpoint is named for that rather than for provenance |
| 10 | **One machine, must stay up** | Stopping it stops every pending 48h revocation and the sweeper | `auto_stop_machines = false`. Don't "optimise" it |
| 11 | **Worker Deployments are public preview** | Session 3 ungradeable if unavailable; NOT_FOUND is indistinguishable from an unversioned worker | Test against a real namespace before the workshop |
| 12 | **Drill 2 cannot be truly verified** | It passes for a student who never stopped their workers | Honour system, stated on the page |

### What the sweeper will *not* clean up

By design, it deletes only resources that are (a) absent from the baseline, (b) created inside a
student access window, and (c) whose windows have all closed. Anything else is reported as **drift**
on `/instructor` and left alone — including anything created after all windows closed, and anything
with no creation timestamp. **Check the drift list after the workshop** and clear it by hand.

### Teardown

Do not tear the app down while access windows are open — you'd strand students as Global Admins on
`bvmon` with nothing left to revoke them. Wait until `/instructor` shows zero open windows and a
clean sweep, or revoke by hand in the Cloud UI first.

---

## Session-by-session notes

| Session | Verified / attested | Needs from you |
|---|---|---|
| 1. Foundations & Control Plane | 5 / 0 | Namespace quota raised |
| 2. AuthN/Z, RBAC & Deployment | 5 / 0 | Nothing — every resource runs as the student |
| 3. Worker Config & Versioning | 3 / 0 | Worker Deployments available (public preview) |
| 4. Data Security & Encryption | 4 / 0 | Nothing — sandbox-scale, one Go binary via `proxy-up` |
| 5. Observability & Ops | 2 / 1 | Nothing — images pre-pulled in the sandbox, started with `obs-up` |
| 6. Chaos Lab | 3 / 1 | You run drill 3 as a demo |

**Session 1** — the lab is ~5 minutes of Terraform and the rest is the "Use what you built" section.
Let fast finishers run `labs/worker`; tell them to try `start` *without* a worker first, so they
see a workflow sit in schedule-to-start deliberately.

**Session 2** — the lab builds a **namespace-scoped** service account: `namespace_scoped_access`
with `write`, and no account-wide access block at all. That is Temporal's documented recommendation
for a Worker's API key. It replaced a version built on a hand-written Custom Role, which needed a
second elevated credential and hit a Pre-release feature with an open data-plane bug. Nothing to
prepare, and every resource in the lab runs as the student.

Two things students get wrong, both by reflex. They add `account_access = "read"` alongside
`namespace_scoped_access`, and the provider refuses the combination at `terraform validate` — worth
letting them hit, because it is the fastest way to learn that this shape has no account role to
tune. And they create `temporalcloud_group` without `temporalcloud_group_access`, which entitles
nobody; the checkpoint says so in as many words.

Custom roles are still worth ten minutes on the whiteboard, and quiz question 2.1 still covers them:
they are **additive**, so a custom role on top of `developer` narrows nothing. The lab's own comments
make the point — there is nothing for a custom role to add to an identity that already has exactly
one namespace permission. Do not offer to demo creating one on `bvmon`; it is an Account Owner
permission and the roles are capped at 25 per account permanently.

Read the "Use what you built" section before you teach it, because it deliberately ends in a
surprise. The identity is the one a **Worker** runs as, and students run `temporal cloud user list`
and `temporal cloud namespace list` with it and watch **both succeed** — having written no account
access whatsoever. That is correct and intended: a namespace-scoped service account always carries
an implicit `Read` account role, and Read-Only already grants `GetUsers`, `GetNamespaces` and
`ListNamespaces` account-wide. Nothing lowers it. Someone will call it a bug. It is the most useful
thing in the session — for a bank in particular, "our service accounts are read-only" does not mean
what people assume. The permissions reference is linked from the page; put it on screen.

Two genuine denials follow, and they are the pair worth landing. `temporal cloud account audit-log
list` fails because `GetAuditLogs` is Global Admin and Account Owner only — pair it with the
audit-log read they did earlier as themselves, so they see that the identities doing the work cannot
read the forensic record of it. Then `temporal workflow list` against a *colleague's* namespace
fails: it can enumerate every namespace in the account and act in exactly one. That gap is why
namespace permissions exist separately from account roles.

This session has no worker, so it runs on the control plane alone. Project `/instructor` while they
work — watching their own service accounts, keys and groups appear is the lesson.

**Session 3** — sandbox-scale: two `labs/worker` worker processes against their own namespace is
enough to create a real Worker Deployment with two versions and shift traffic. Teaches
**Worker Deployments** (`DeploymentOptions` + `WorkerDeploymentVersion`), not Build ID compatibility
sets — the latter are deprecated in every SDK and never reached GA. KEDA is your demo.

The failure to watch for: an unversioned worker registers **no** deployment at all, so
`deployment-exists` fails and the message looks identical to the feature being unavailable. If
several students hit it at once, check they passed `--version`.

**Session 4** — `temporalio/temporal-proxy` as a local binary or container, with a `testing://` key
so nothing touches a real KMS. All four checkpoints are verified, and the interesting one reads the
**payload metadata off their own workflow history**: `encoding: binary/encrypted` is on the data
plane whether or not the control plane can see it. Worth saying out loud that this is why the
session has no attestations while an infrastructure-shaped version of it would have been all
attestation.

**Encryption ships ON.** `labs/proxy/config.yaml` has `encryption.enabled: true`, so the first
workflow through the proxy is already sealed — the lab no longer has students uncomment a block and
restart. The reveal is a comparison instead: one workflow with `--proxy`, one without, opened side by
side in the Cloud UI. Two commands, no restart, and it lands the point better, because "the platform
team turned this on and the application cannot see it" is the actual pattern. Mixing is safe —
plaintext passes back through the proxy untouched, so the direct workflow still completes on the
proxy-connected worker.

Two things to pre-empt. The proxy is **Pre-release** and says so on its own front page — teach it,
don't recommend shipping it. And the second real check is that **no codec server exists**: a codec
server would hand Temporal Cloud the decode path the whole pattern exists to withhold, so a student
who adds one to make the UI readable fails, correctly.

**Check `proxy-up` in the sandbox before the day.** The helper lives in the Instruqt preset, not in
this repo, so nothing here can fix it. If it prints

```
Incorrect Usage: flag provided but not defined: -config
```

it is invoking the image without the `serve` subcommand. The container entrypoint is the bare
`proxy` binary and `--config` is defined on `proxy serve`, so the command has to end
`temporalio/temporal-proxy:latest serve --config /config.yaml`. `labs/proxy/README.md` carries the
correct form. The error message is misleading — it reads like a renamed flag rather than a missing
subcommand — so nobody will guess it.

The next failure after that one is subtler and was in this repo, not the preset: with `proxy-up`
running under `docker run -p 7233:7233`, the gateway has to bind **`0.0.0.0:7233`** inside the
container. `labs/proxy/config.yaml` said `127.0.0.1:7233`, copied from upstream's example, which is
correct only when the binary runs natively. Docker forwards the published port to the container's
eth0, nothing listens there, and the worker dies with `get_system_info call error after connection:
... connection closed` — which reads like a bad API key. Fixed in `config.yaml`; the preset mounts
that file from the workshop repo, so a preset rebuild picks it up with no change to `proxy-up`.
Consider narrowing the publish to `-p 127.0.0.1:7233:7233` there while you are in it.

**Session 5** — SDK metrics into a local Prometheus and Grafana, all in the sandbox. The dashboard is
provisioned already, so the lab is about reading it rather than building panels.

The trap to pre-empt: .NET's Prometheus exporter defaults produce metric names that match nothing in
the docs — counters without `_total`, durations in milliseconds without `_seconds`. `labs/worker`
sets the three flags that fix it, and the first "use" step has students `curl` the raw endpoint
before writing any query. If someone's graph is empty, that is why. Gauges never take `_total`
regardless — `temporal_num_pollers_total` returns nothing, silently.

**Session 6** — drills 1, 2 and 4 are student-run in the sandbox; drill 3 (break the encryption proxy
from Session 4) is your demo, and it is the only one producing the "UI cannot decode payload"
symptom that one of the three runbooks covers. Checkpoints grade the **recovery**, so the grader
cannot prove they broke anything first — drill 2 passes for someone who never stopped their workers.
Say that out loud; the page says it too.

---

## Retired: custom roles and the elevated key

Kept as a decision record. Nothing here is live, and no session needs any of it.

Session 2's lab used to build a hand-written **Custom Role** and attach it to the Worker's service
account. Both of those are Account Owner permissions, so a Global Admin student could not run their
own `terraform apply`. Worse, the workaround everyone reaches for first — grant students the
delegation role — is unusable here: a principal holding an **account-level custom role loses its
data-plane access** (confirmed bug, control plane unaffected), and Sessions 1, 3, 4, 5 and 6 all run
workers. Four options were on the table:

| # | Option | Students still create a role? | Risk |
|---|---|---|---|
| 1 | Grant the delegation for Session 2, revoke after | Yes | Two commands per student, mid-workshop |
| 2 | Instructor pre-creates the roles | No — they read and attach one | Low |
| 3 | Shared elevated key, Lab 2 only, via an aliased provider | Yes, via a second credential | Low — chosen at the time |
| 4 | Demote the role to an instructor demo | No | None |

Option 3 shipped: `scripts/create-role-admin-sa.sh` created a `workshop-terraform` service account
holding the delegation role from `scripts/custom-role-delegation.json`, Instruqt injected its key as
`WORKSHOP_ELEVATED_API_KEY`, `labs/providers.tf` exposed it as an aliased `temporalcloud.elevated`
provider, and exactly two resources in `lab2.tf` named that alias. The service account absorbed the
data-plane bug and did not care, because it never polled a task queue.

What replaced it is **option 5, which nobody had listed**: don't create a custom role at all. A
[namespace-scoped service account](https://docs.temporal.io/cloud/manage-access/service-accounts#scoped)
— `namespace_scoped_access` with `write`, no account-wide access block — is both the lower-privilege
identity *and* creatable by a Global Admin directly, because Namespace Admins may manage them and
Global Admin implicitly holds Namespace Admin everywhere. The custom role was granting one action
(`cloud.namespace.get`) that a Worker never calls, so removing it cost the lab nothing and removed a
second credential, an aliased provider, a Pre-release dependency, a 25-per-account cap and an open
bug.

Two lessons kept from the old design, because they were never really about custom roles: the account
role floor is `Read` and nothing lowers it, and custom roles are additive so they can only ever grant
more. Both are taught in the new lab, and quiz question 2.1 still covers the second.

If you ever need the elevated identity back for something else, the script and the role spec still
work. The role spec needs **two** permission blocks, because the
[permissions reference](https://docs.temporal.io/cloud/manage-access/permissions-reference#custom-role-permissions)
has two tables: `cloud.customrole.assign`, `.create` and `.list` are scoped to `accounts`, while
`.get`, `.update` and `.delete` are scoped to the `custom-roles` resource type. Mixing them into one
account-scoped block is rejected outright with
`InvalidArgument desc = invalid action: cloud.customrole.update for resource type: accounts`.

---

## Related docs

- Instruqt track `temporal-control-plane-workshop` and sandbox preset
  `temporal-cloud-platform-workshop` — what is installed, the `workshop-*` helper commands,
  and the egress the sandbox needs. Replaces the old PREREQUISITES.md: attendees install nothing
- [README.md](README.md) — architecture, sweeper semantics, security posture
- [DEPLOY.md](DEPLOY.md) — Fly.io deployment, secrets, environment variables
- [quiz.md](quiz.md) — 18 AhaSlides questions, 3 per session
- [course.md](course.md) — the workshop agenda this is built from
