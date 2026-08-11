# Instructor guide

Everything you need to run the workshop, in the order you need it. Read the
[Limits and known sharp edges](#limits-and-known-sharp-edges) section before you commit to a date —
two items in it have **lead times you do not control**.

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

These are the two that can kill a workshop date, because someone else has to act.

- [ ] **Raise the namespace limit.** Accounts start at **10**. Every student creates one in
      Session 1. The documented auto-raise only triggers for namespaces with *running workflows*,
      which lab namespaces won't have. Open a support ticket for `cohort size + existing + headroom`.
      `pnpm ops:preflight` prints your current count.
- [ ] **Confirm Custom Roles are enabled on `bvmon`.** They are **Pre-release**. Session 2 is built
      around them and its custom-role checkpoints simply cannot pass without them. Preflight fails
      loudly if they're missing — run it now, not in week three.
- [ ] **Delegate custom-role administration to Global Admin.** Enabled is not sufficient.
      [Custom role administration defaults to the Account Owner](https://docs.temporal.io/cloud/manage-access/custom-roles#delegating-custom-roles),
      and students are invited as Global Admin, so Session 2's first `terraform apply` dies with
      `rpc error: code = PermissionDenied desc = request unauthorized` on
      `temporalcloud_custom_role`. Preflight does **not** catch this: it authenticates as Account
      Owner, which can always do it.

      **Run this once, as Account Owner:**

      ```bash
      TEMPORAL_API_KEY=<account-owner key> ./scripts/create-role-admin-sa.sh
      ```

      It applies the delegation role from `scripts/custom-role-delegation.json`, creates the
      `workshop-terraform` service account with that role attached, and prints an API key. The key
      is shown once. Re-running the script is safe; it reuses what already exists.

      The role spec needs **two** permission blocks, because the
      [permissions reference](https://docs.temporal.io/cloud/manage-access/permissions-reference#custom-role-permissions)
      has two tables. `cloud.customrole.assign`, `.create` and `.list` are scoped to `accounts`;
      `.get`, `.update` and `.delete` are scoped to the `custom-roles` resource type. Mixing them
      into one account-scoped block is rejected outright:

      ```
      InvalidArgument desc = invalid action: cloud.customrole.update for resource type: accounts
      ```

      `assign` is the one people leave out. Lab 2 attaches the role to the Worker's service
      account, which *is* an assign — without it the apply dies one resource later than expected.

      **The key goes to the service account, never to the students.** Confirmed Temporal Cloud bug:
      a principal holding an **account-level custom role loses its data-plane access**. The control
      plane still works — `temporal cloud whoami` authenticates, and `namespace user list` still
      reports `PERMISSION_ADMIN` with `InheritedAccess true` — but `temporal workflow list` against
      their own namespace returns `Request unauthorized`. Sessions 1, 3, 4, 5 and 6 all run workers,
      so a student carrying that role would lose five sessions to buy one. Leave
      `STUDENT_CUSTOM_ROLE_IDS` unset.

      The service account absorbs the bug instead, and does not care: it never polls a task queue.
      Then inject its key into Instruqt — see
      [Injecting the elevated key into Instruqt](#injecting-the-elevated-key-into-instruqt).

      Other approaches, if you would rather not run a second identity, are in
      [Custom roles: the options](#custom-roles-the-options) below.

      The docs call out the privilege-escalation risk in delegating this, and they are right: a
      principal that can create and assign roles can grant itself anything. In a throwaway training
      account where every student is already Global Admin for 48 hours, that is not a new exposure.
      Do not copy the pattern into a real account.

      Not delegating is not really an option. Pre-creating one shared role as Account Owner still
      leaves students unable to attach it to their service account without `cloud.customrole.assign`,
      so it narrows the delegation rather than avoiding it.

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
| 2 | **25 custom roles** per account, no documented auto-raise | Session 2 caps your cohort around 20 | Preflight reports headroom; beyond ~20, pre-create one shared role |
| 3 | **Custom Roles are Pre-release** | Session 2's headline checkpoints ungradeable if not enabled | Verify with preflight *now* |
| 4 | **Link rotates at midnight `Australia/Sydney`** | Students lose portal access on day 2 while still holding Cloud access for 48h | Re-paste the new link on day two. Accepted trade-off |
| 5 | **`PORTAL_ALLOWED_EMAIL_DOMAINS=*`** as shipped | Anyone with the link can grant themselves Global Admin | Narrow it before the workshop; failing that, set `PORTAL_BLOCKED_EMAIL_DOMAINS` to the consumer mail providers |
| 6 | **6-character link**, ~2.2×10⁹ keyspace | Brute-forceable at ~12,000 req/s; a small machine falls over first | Fine in practice; don't pair it with `*` above |
| 7 | **The grader holds Account Owner** | It has Namespace *Admin* on every student namespace — read *and* write. Only the code restrains it | Deliberate choice. Grading paths use a read-only wrapper |
| 8 | **Session 5 is nearly unverifiable** | SDK metrics and Grafana live in the student's sandbox; the portal can only confirm a worker polled and workflows ran | Walk the room and look at screens |
| 9 | **temporal-proxy is Pre-release** | "Not ready for production use" per its own front page — fine for teaching, not a shipping recommendation | Say so; the session page does |
| 10 | **No provenance in the API** | "Created via Terraform" is unverifiable, ever | Session 1 grades the **tag** `provisioner=terraform`, and the checkpoint is named for that rather than for provenance |
| 11 | **One machine, must stay up** | Stopping it stops every pending 48h revocation and the sweeper | `auto_stop_machines = false`. Don't "optimise" it |
| 12 | **Worker Deployments are public preview** | Session 3 ungradeable if unavailable; NOT_FOUND is indistinguishable from an unversioned worker | Test against a real namespace before the workshop |
| 13 | **Drill 2 cannot be truly verified** | It passes for a student who never stopped their workers | Honour system, stated on the page |

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
| 2. AuthN/Z, RBAC & Deployment | 8 / 0 | Custom Roles enabled |
| 3. Worker Config & Versioning | 3 / 0 | Worker Deployments available (public preview) |
| 4. Data Security & Encryption | 4 / 0 | Nothing — sandbox-scale, one Go binary via `proxy-up` |
| 5. Observability & Ops | 2 / 1 | Nothing — images pre-pulled in the sandbox, started with `obs-up` |
| 6. Chaos Lab | 3 / 1 | You run drill 3 as a demo |

**Session 1** — the lab is ~5 minutes of Terraform and the rest is the "Use what you built" section.
Let fast finishers run `labs/worker`; tell them to try `start` *without* a worker first, so they
see a workflow sit in schedule-to-start deliberately.

**Session 2** — the sharp edge is that Custom Roles are **additive** and cannot narrow a predefined
role. Students who reach for `developer` fail the check on purpose. Expect to explain this; it is
also quiz question 2.1, which usually splits the room.

Read the "Use what you built" section before you teach it, because it deliberately ends in a
surprise. The identity is the one a **Worker** runs as, and students run `temporal cloud user list`
and `temporal cloud namespace list` with it and watch **both succeed**. That is correct and
intended: every principal must carry a predefined role, and Read-Only already grants `GetUsers`,
`GetNamespaces` and `ListNamespaces` account-wide, so no custom role can take them away. Someone
will call it a bug. It is the most useful thing in the session — for a bank in particular, "our
service accounts are read-only" does not mean what people assume. The account-level role table is
linked from the page; put it on screen.

The genuine denial is `temporal cloud account audit-log list`: `GetAuditLogs` is Global Admin and
Account Owner only. Pair it with the audit-log read they did earlier as themselves — the identities
doing the work cannot read the forensic record of it, which is the whole reason the record is worth
keeping.

This is also the session with the largest checkpoint count (8) and no worker, so it runs on the
control plane alone. Project `/instructor` while they work — watching their own service accounts and
API keys appear is the lesson.

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

Two things to pre-empt. The proxy is **Pre-release** and says so on its own front page — teach it,
don't recommend shipping it. And the second real check is that **no codec server exists**: a codec
server would hand Temporal Cloud the decode path the whole pattern exists to withhold, so a student
who adds one to make the UI readable fails, correctly.

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

## Injecting the elevated key into Instruqt

Lab 2's Terraform runs two resources as a shared service account, and that account's key has to
reach the sandbox. There are two ways in; use the second only while the first is unavailable.

### Preferred: an Instruqt secret

Needs team-admin rights on Instruqt. `--description` is **required** — without it the CLI stops
with `[ERROR] no description specified`.

```bash
instruqt secrets create WORKSHOP_ELEVATED_API_KEY <token> \
  --description "Lab 2 elevated Terraform key (workshop-terraform service account)" \
  --team temporal
```

Then reference it from the preset, under the VM:

```yaml
  secrets:
  - name: WORKSHOP_ELEVATED_API_KEY
```

A `secrets:` entry only *resolves* a name that already exists in team settings — it does not create
one. Skip the create and the sandbox builds happily with the variable empty, and the failure
surfaces at Lab 2's `terraform apply` as a 401, an hour after anyone could have caught it.

To keep the token out of argv, where `ps` can read it and your shell history keeps it:

```bash
printf '%s' '<token>' > /tmp/k && chmod 600 /tmp/k
instruqt secrets create WORKSHOP_ELEVATED_API_KEY --data-file /tmp/k \
  --description "Lab 2 elevated Terraform key" --team temporal
rm -f /tmp/k
```

### Fallback: the preset environment block

**This is what the preset ships today**, because creating a team secret needs admin rights we do
not have. The value goes in `environment:` in
`preset/temporal-cloud-platform-workshop/config.yml`:

```yaml
  environment:
    WORKSHOP_ELEVATED_API_KEY: "<token>"
```

It works identically — the setup script reads the same variable either way. What it costs:

- Instruqt prints environment values in the sandbox debug log and shows them to anyone with access
  to the track. A secret is masked; this is not.
- The preset directory is not in git today. The moment it is, the key is in history permanently,
  and rotating it does not remove it from there.
- The service account holds account-role **admin** on the training account, so a leaked key is
  admin until it expires or is deleted.

Students reading it inside the sandbox is *not* part of the cost — Lab 2 hands it to them anyway,
and they already hold Global Admin for 48 hours. The exposure that matters is everyone outside the
room.

So **shorten the lifetime to match the engagement** rather than accepting the 30-day default, and
delete the key afterwards:

```bash
KEY_DURATION=3d TEMPORAL_API_KEY=<account-owner key> ./scripts/create-role-admin-sa.sh
# after the workshop
temporal cloud apikey list --api-key $TEMPORAL_API_KEY | grep SERVICE_ACCOUNT
temporal cloud apikey delete --key-id <id> --api-key $TEMPORAL_API_KEY --auto-confirm
```

Move to the secret form as soon as someone with team-admin rights can create it; the only change is
deleting the `environment:` line and adding the `secrets:` block.

### How it reaches Terraform

Either way, the setup script re-exports it in `~/.bashrc`:

```bash
export TF_VAR_elevated_api_key=${WORKSHOP_ELEVATED_API_KEY:-}
```

`TF_VAR_` is how Terraform takes a variable from the environment, and the name is deliberately not
`TEMPORAL_CLOUD_API_KEY` — that stays the student's own key, so Lab 1's namespace is created by
them and the Worker authenticates as them.

**Verify before the day**, in a launched sandbox:

```bash
[ -n "$TF_VAR_elevated_api_key" ] && echo present || echo MISSING
temporal cloud custom-role list --api-key "$TF_VAR_elevated_api_key"   # expect: the role list
temporal workflow list --namespace <ns> --api-key "$TF_VAR_elevated_api_key"
```

The last one **should** fail with `Request unauthorized`. That is the custom-role bug landing on an
identity that never needed the data plane, which is the whole reason Lab 2 runs through it.

### Rotation

The key expires `KEY_DURATION` after creation. Re-run the script, then update wherever it lives —
the `environment:` line, or:

```bash
instruqt secrets update WORKSHOP_ELEVATED_API_KEY <token> \
  --description "Lab 2 elevated Terraform key" --team temporal
instruqt secrets list --team temporal
```

Sandboxes already running keep the old value; new ones pick up the new one.

To find out what you have without the token:

```bash
temporal cloud apikey list --api-key $TEMPORAL_API_KEY | grep SERVICE_ACCOUNT
```

---

## Custom roles: the options

Session 2's lab is built on Custom Roles, and Custom Roles carry a confirmed bug: **a principal
holding an account-level custom role loses its data-plane access**. Control plane keeps working, so
nothing looks wrong until a worker fails to poll. Pick one of these before the day; they are ordered
by how little they disturb the lab.

| # | Option | Students still create a role? | Risk |
|---|---|---|---|
| 1 | Grant for Session 2, revoke after | Yes | Two commands per student, mid-workshop |
| 2 | Instructor pre-creates the roles | No — they read and attach one | Low |
| 3 | Shared elevated key, Lab 2 only | Yes, via a second credential | Low — **chosen** |
| 4 | Demote to an instructor demo | No | None |

**1. Time-box the grant.** Covered in Prep work above. Works because Session 2 is the only session
that never touches the data plane. Verify with `workshop-check` before Session 3.

**2. Pre-create the roles.** As Account Owner, create one `<prefix><slug>-worker-role` per attendee
ahead of time. Session 2 then drops the `temporalcloud_custom_role` resource and references the
existing role by id. Students still build the service account, attach the role, grant namespace
`write` and issue the key — four of the six checkpoints are untouched. `custom-role-exists` and
`custom-role-scoped` grade the role either way, since they read the account rather than the state
file.

**3. Shared elevated key, Lab 2 only.** *(chosen)* One service account holds the delegation role
and its own API key, created by `scripts/create-role-admin-sa.sh`. Instruqt injects it as
`WORKSHOP_ELEVATED_API_KEY` — a name of its own, so it never shadows the student's key.
`TEMPORAL_API_KEY` and `TEMPORAL_CLOUD_API_KEY` both stay the student's, which keeps Lab 1's
namespace attributable to them and the Worker authenticating as them. Lab 2 elevates explicitly,
either for one invocation:

```bash
TEMPORAL_CLOUD_API_KEY=$WORKSHOP_ELEVATED_API_KEY terraform apply
```

or per-resource with an aliased second provider block on `temporalcloud_custom_role` **and**
`temporalcloud_service_account` — both need it, because attaching the role to the service account
is itself `cloud.customrole.assign`. All six labs share one Terraform directory and state, so the
per-invocation form runs *everything* in that apply as the service account; the alias form is the
only one that truly scopes elevation to two resources.

The service account loses its own data-plane access to the bug and does not care, because it never
polls. Making a student switch credentials to perform the privileged step also happens to
demonstrate the exact separation Session 2 is teaching.

**4. Demote to a demo.** Remove the `custom-role-exists` and `custom-role-scoped` checkpoints and
run the custom role on the projector. The session still teaches least privilege through the
predefined-role floor, the namespace-scoped grant and the service-account-owned key. Reach for this
if the bug is still open on the morning and you want zero moving parts.

### Untested, and it matters

Every option above assumes the bug hits **users**. The lab also attaches the custom role to a
**service account** (`account_access_custom_roles` in the lab 2 snippet) which separately holds
`write` on the student's namespace — and that service account's key is what the Worker uses from
Session 2 onward. If the bug applies to service accounts too, the Worker loses its namespace grant
and Sessions 3 to 6 fail to poll for everyone, whichever option you picked.

Test it once, before the day:

```bash
# As Account Owner, against a throwaway namespace
temporal cloud service-account create --name bugtest --account-role read \
  --namespace-permission <ns>=write --api-key $TEMPORAL_API_KEY
temporal cloud service-account set-custom-roles --service-account-id <id> \
  --custom-role <ROLE_ID> --api-key $TEMPORAL_API_KEY
# Issue a key for it, then:
temporal workflow list --namespace <ns> --address <ns>.tmprl.cloud:7233 --api-key <SA_KEY>
```

If that returns `Request unauthorized`, drop `account_access_custom_roles` from the lab 2 snippet —
the service account keeps its predefined `read` floor plus the namespace grant, which is all the
Worker needs — and teach the attachment as a diagram rather than as applied Terraform.

---

## Related docs

- Instruqt track `temporal-control-plane-workshop` and sandbox preset
  `temporal-cloud-platform-workshop` — what is installed, the `workshop-*` helper commands,
  and the egress the sandbox needs. Replaces the old PREREQUISITES.md: attendees install nothing
- [README.md](README.md) — architecture, sweeper semantics, security posture
- [DEPLOY.md](DEPLOY.md) — Fly.io deployment, secrets, environment variables
- [quiz.md](quiz.md) — 18 AhaSlides questions, 3 per session
- [course.md](course.md) — the workshop agenda this is built from
