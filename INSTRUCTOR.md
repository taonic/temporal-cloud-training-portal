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

      As Account Owner, create the delegation role once from `scripts/custom-role-delegation.json`
      and note the role id it returns:

      ```bash
      temporal cloud custom-role apply --spec @scripts/custom-role-delegation.json \
        --api-key $TEMPORAL_API_KEY
      ```

      Only `create` and `list` go in that spec, and the reason is a trap worth knowing: the
      [permissions reference](https://docs.temporal.io/cloud/manage-access/permissions-reference#custom-role-permissions)
      has **two** tables. `cloud.customrole.create` and `cloud.customrole.list` are *Account*-scoped.
      `cloud.customrole.get`, `.update` and `.delete` are scoped to the **Custom Role** resource
      type, not the account, so putting them in an account-scoped grant is rejected outright:

      ```
      InvalidArgument desc = invalid action: cloud.customrole.update for resource type: account
      ```

      Then put the returned role id in `STUDENT_CUSTOM_ROLE_IDS` and redeploy. Every invitation
      from then on carries it — `createUser` sends it as `access.account_access.custom_roles`.
      One-off assignment for someone already invited, remembering that `set-custom-roles`
      **replaces** the list rather than appending:

      ```bash
      temporal cloud user set-custom-roles --user-email STUDENT@EXAMPLE.COM \
        --custom-role <ROLE_ID> --api-key $TEMPORAL_API_KEY
      ```

      You need that command for anyone the portal *adopted* rather than created — an existing Cloud
      user is returned as-is by `inviteGlobalAdmin`, which never calls CreateUser and so never
      attaches the roles. The activity logs a warning when that happens.

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
      only thing between the internet and Global Admin on `bvmon` is a six-character link.
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
| 5 | **`PORTAL_ALLOWED_EMAIL_DOMAINS=*`** as shipped | Anyone with the link can grant themselves Global Admin | Narrow it before the workshop |
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

## Related docs

- Instruqt track `temporal-control-plane-workshop` and sandbox preset
  `temporal-cloud-platform-workshop` — what is installed, the `workshop-*` helper commands,
  and the egress the sandbox needs. Replaces the old PREREQUISITES.md: attendees install nothing
- [README.md](README.md) — architecture, sweeper semantics, security posture
- [DEPLOY.md](DEPLOY.md) — Fly.io deployment, secrets, environment variables
- [quiz.md](quiz.md) — 18 AhaSlides questions, 3 per session
- [course.md](course.md) — the workshop agenda this is built from
