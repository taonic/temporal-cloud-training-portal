# Temporal Cloud Training Portal

A portal that invites workshop attendees into a real Temporal Cloud account as Global Admins,
removes them 48 hours later, and delivers the workshop material with live, auto-graded lab checks.

The invitation lifecycle is Temporal workflows driving the [Cloud Ops API](https://docs.temporal.io/ops).

---

## Architecture

```
   student browser
         │
         │  /?k=<invite token>
         ▼
 ┌───────────────────┐        Update: requestSeat        ┌──────────────────────────┐
 │  Next.js (App     │ ────────────────────────────────► │  trainingRegistry        │
 │  Router)          │                                   │  · seat cap (per day)    │
 │  · invite form    │ ◄──────────────────────────────── │  · baseline inventory    │
 │  · Session 1      │        SeatDecision               │  · access-window ledger  │
 │  · instructor     │                                   │  · sweeper loop          │
 └───────────────────┘                                   └──────────┬───────────────┘
         │                                                          │ starts
         │ Cloud Ops API (read)                                     ▼
         │                                              ┌──────────────────────────┐
         │                                              │  invitation (1/student)  │
         │                                              │  CreateUser ROLE_ADMIN   │
         │                                              │  … sleep 48h …           │
         │                                              │  DeleteUser              │
         │                                              └──────────────────────────┘
         ▼                                                          │
 ┌─────────────────────────────────────────────────────────────────▼───────────────┐
 │  Temporal Cloud account: bvmon    ← students get Global Admin here              │
 └─────────────────────────────────────────────────────────────────────────────────┘

 Workflows above run in namespace tao.a2dd6 — a DIFFERENT account.
```

That separation is the single most important property of the design. A student holding Global
Admin on `bvmon` has no reach into `a2dd6`, so they cannot delete the workflows that will later
delete them. Had the portal run its own workflows inside `bvmon`, deleting one namespace would
silently cancel every pending cleanup.

### Workflows

| Workflow | Id | Job |
|---|---|---|
| `invitation` | `invite-<sha256(email)>` | Invite as `ROLE_ADMIN`, hold for the TTL, `DeleteUser`. Accepts `revoke` and `extendMs` signals. |
| `trainingRegistry` | `training-registry` | Singleton. Enforces the seat cap in an Update handler, owns the baseline inventory and the access-window ledger, runs the sweeper on a loop. Continues-as-new. |
| `opsCanary` | `ops-canary` | Cheap authenticated read every 5 minutes so you learn the portal's credential is broken at 09:00, not 15:30. |

Workflow ids hash the email so the Cloud UI's workflow list is not a roster of attendee addresses.

### State

There is no database. The registry workflow *is* the datastore — seat counts, access windows,
baseline and the last sweep report are workflow state, read by the web layer via Query and
mutated via Update. The seat cap is enforced inside the Update handler, so two simultaneous
requests cannot both take the last seat.

### Cloud Ops API client

There is no official TypeScript SDK. `proto/cloudservice.binpb` is a `FileDescriptorSet` built
from [`temporalio/api-cloud`](https://github.com/temporalio/api-cloud) with every dependency
inlined, and `src/cloud/client.ts` builds a dynamic gRPC client from it at runtime — no codegen
step, whole API surface available. Regenerate with `pnpm proto:vendor` after bumping
`API_CLOUD_REF` in `scripts/vendor-protos.mjs`.

**Field names in `src/cloud/` are snake_case, and that is load-bearing.** proto-loader's
`keepCase` option is ignored when loading a descriptor set — names are always the protobuf wire
names. Protobuf then discards unknown fields *silently*, so a camelCase field is not a type error
and not a runtime error; it simply never arrives. `{pageSize: 100}` serialises to zero bytes.

`pnpm check:wire` round-trips every request shape the portal sends through the real serializer and
fails if any field is lost.

### Keeping a customer's name out

This is generic tooling pointed at one customer at a time; their name belongs in `.env.local` and
`course.md`, not in defaults, fixtures or prose. `pnpm check:names` fails the build if it creeps
back in — it is easy to reintroduce with one example namespace in a comment. Exemptions live in
`ALLOW` in `scripts/check-names.ts` and are printed on every run, so nothing is silently excused.
`course.md` and `quiz.md` are gitignored and `labs/lab*.tf` are the student's own workspace, which
is why those are exempt.

Per-student values reach the session pages through `SnippetContext`, never as literals — that is
what keeps a real namespace out of `src/course` while still showing each student their own.

`pnpm check` runs typecheck, the wire guard and the name guard together. `.githooks/pre-commit`
runs the name guard on commit; enable it with `git config core.hooksPath .githooks`. Run it after touching `src/cloud/ops.ts` or re-vendoring the protos.
Types owned by this project (`InventoryItem`, everything in `src/temporal` and `src/course`) stay
camelCase — only proto shapes are snake.

---

## Security posture — read this before running it

**The invite link is not an access control.** It is copy-pasteable and stays valid until you
change `PORTAL_LINK_CODE`. The real controls are `PORTAL_ALLOWED_EMAIL_DOMAINS` and
`PORTAL_DAILY_SEAT_CAP`.

The link is one configured code — six lowercase alphanumerics, no secret behind it, nothing derived
at runtime. It got there by removing two things. It used to be an HMAC of the calendar day, which
expired every link at midnight: cloud access lasts 48 hours, so students were locked out of the
portal halfway through their own window and someone re-pasted a new link on day two. With the day
dropped, hashing a secret to produce one fixed string bought nothing over configuring that string,
so the secret went too. What is left is one value, deployed as a secret: set a new
`PORTAL_LINK_CODE` and every outstanding link dies at once.

The allowlist takes comma-separated patterns — `example.com` (exact), `*.example.com` (subdomains
only), or `*` (any domain). An empty value denies everything, so a blank config fails closed;
opening the door to everyone has to be spelled `*` deliberately. When it *is* `*`, both the invite
page and `/instructor` say so in as many words, because at that point the link and the seat cap
are all that stand between the internet and Global Admin on `bvmon`.

`PORTAL_BLOCKED_EMAIL_DOMAINS` is the denylist: same patterns, checked first, and it wins over the
allowlist. Empty blocks nothing. It exists for the wildcard case — keeping consumer mail providers
out (`gmail.com,outlook.com,yahoo.com`) is a three-item list, whereas expressing the same intent as
an allowlist means enumerating every attendee's employer. It narrows `*`; it does not replace it.

**Global Admin includes user management.** A student can delete other students, and can delete the
identity that owns the portal's Cloud Ops API key. Nothing in the product prevents this. The
`opsCanary` workflow detects it; it cannot prevent it. Confirm you hold **Account Owner** on
`bvmon`, not merely Global Admin, before running a workshop.

**The portal's credential is your personal API key.** It will expire — `pnpm ops:preflight` warns
below 7 days. Every sweeper deletion will appear in `bvmon`'s audit log under your name.

**The instructor mirror is gated separately.** `/instructor` lists every user and their role, so it
uses `PORTAL_INSTRUCTOR_TOKEN`, not the student link.

### What the sweeper deletes

Baseline-diff with a time window. A resource is deleted only when **all three** hold:

1. it is absent from the baseline snapshot taken when the registry first started; **and**
2. its creation time falls inside at least one student access window; **and**
3. every window containing it has closed.

Condition (2) is what stops a stale baseline from eating your work. A namespace you create next
month is not in the baseline either — but it is not inside any access window, so the sweeper
reports it as **drift** and leaves it alone. Drift is surfaced on `/instructor` for you to handle
by hand.

Resources with no creation timestamp are never deleted. Closed windows are retained for 7 days
and then pruned; anything still alive from a pruned window degrades to drift rather than deletion.

Covered kinds: namespaces, users, service accounts, API keys, groups, custom roles, Nexus endpoints
— i.e. everything a Global Admin can create that outlives their own deletion, including **users they
invite themselves**, who arrive with no 48-hour timer of their own. Groups are on that list because
Session 2 has students create one; leaving them out would silently accumulate debris in the account.
Custom roles stay on it even though no lab creates one any more — an account that ran the older
version of Session 2, or an instructor demo, can still leave them behind, and they burn a 25-role
cap permanently.

Set `SWEEPER_MODE=dry-run` for the first pass. It reports `would-delete` and deletes nothing.

---

## Setup

```bash
pnpm install
cp .env.example .env.local     # fill it in
pnpm ops:preflight             # verify every assumption against the real accounts
pnpm dev                       # Next.js + worker
```

All entrypoints — the Next server, `pnpm worker` and `pnpm ops:preflight` — read `.env.local` /
`.env` through the same loader with the same precedence, so the preflight script sees exactly the
configuration the running portal will. Real environment variables still win, so this is a no-op on
Fly.io and in CI.

`pnpm ops:preflight` checks the things that are painful to discover on the morning of the
workshop: that the Ops API credential works and has a sufficient role, when the key expires,
whether `LAB_REQUIRED_REGION` actually exists on the account (it prints the valid ids if not),
current namespace count against the quota, and that the Temporal connection works.

**Temporal connection gotcha.** API-key auth needs the *regional* address
(`<region>.<provider>.api.temporal.io:7233`) and the namespace must have API key auth enabled.
mTLS needs the *namespace* address (`<namespace>.<account>.tmprl.cloud:7233`). They are not
interchangeable; using the wrong one produces a connection timeout, not a helpful error.

### Production

```bash
pnpm build && pnpm start       # Next.js + Temporal worker in one process
```

`Dockerfile` and `fly.toml` are set up for a single Fly.io container. **See [DEPLOY.md](DEPLOY.md)**
for the full deployment walkthrough: the four secrets, every environment variable, verification
steps, and how to rotate credentials mid-workshop.

---

## Running a workshop

**See [INSTRUCTOR.md](INSTRUCTOR.md)** for the full guide: dated prep checklist, on-the-day runbook,
and the ranked list of limits — two of which have lead times you don't control. The summary:

1. **Well beforehand:** raise the namespace limit with a support ticket. Accounts start at 10 and
   the automatic increase only applies when existing namespaces have running workflows — yours
   won't. 20 students doing the Session 1 lab need 20.
2. **Beforehand:** `pnpm ops:preflight`, and confirm you are Account Owner on `bvmon`.
3. **Beforehand:** run the registry once with `SWEEPER_MODE=dry-run` and read a sweep report on
   `/instructor` before switching to `live`.
4. **On the day:** open `/instructor?t=<token>`, copy the student link, paste it into chat.
   Project the mirror.
5. **After:** the sweeper cleans up as each 48-hour window closes. Check `/instructor` for drift.

One link for the whole workshop. Students re-use it to return to the session content on day two,
and there is nothing to re-paste. `PORTAL_DAILY_SEAT_CAP` still resets at midnight
`Australia/Sydney` (02:00 NZ — outside workshop hours), so a two-day cohort gets its cap back for
day two without you touching anything.

---

## Sessions — interactivity

Two mechanisms, both built on Cloud Ops API reads the portal already needs.

**Auto-graded exit checks** (`/session/[n]`) poll the account every 15 seconds and turn green as
`terraform apply` completes. Sessions are lab-only — the teaching happens live; the portal carries
the hands-on half and the exit check.

| Session | Lab | Verified | Attested | Graded via |
|---|---|---|---|---|
| 1. Foundations & Control Plane | Provision a namespace with Terraform | 5 (+1 stretch) | 0 | Control plane + data plane |
| 2. AuthN/Z, RBAC & Deployment | The identity a Worker runs as: namespace-scoped service account, its key, operators group | 5 | 0 | Control plane + Audit Log |
| 5. Observability & Ops | SDK metrics *and* Temporal Cloud OpenMetrics into one Prometheus + Grafana | 4 | 1 | Control plane + **data plane** |
| 6. Nexus | Call a service in a namespace you cannot reach | 2 | 2 | **Data plane** (history) |
| 7. Chaos Lab | Three student drills, graded on recovery | 3 | 1 | **Data plane** |

Each session also has an ungraded **"Use what you built"** section: CLI commands, personalised with
the student's own namespace and identity names, each stating what they should see. These are
deliberately not graded — nothing typed into a student's terminal is visible to the Cloud Ops API,
and the alternative (the portal minting itself namespace credentials across the training account)
costs far more than it teaches.

Session 2's is the payoff: switch to the key the Worker would carry, run the job it exists to do,
then discover that the two commands you assumed it could not run both succeed — and that the one
account read it genuinely cannot perform is the Audit Log. Session 1's stretch goal is
`labs/worker` — a Python worker and one-activity workflow, run with `uv` so there is no install
step and no virtualenv to explain.

The split is not cosmetic. **Verified** means the Cloud Ops API was asked and answered.
**Attested** means it could not be, and the student's claim is what's recorded — shown with a
`self-attested` badge and counted separately in the header ("5/5 verified, 1/1 attested").

The line falls where the API's knowledge ends, and it moved twice while this was built. Session 1
cannot verify *provenance* — no API records whether a namespace came from Terraform or the console —
so its checkpoint claims only what it can see: the namespace carries the tag `provisioner=terraform`,
which is real control-plane state and grades automatically. What it does not prove is that Terraform
put it there.

Session 4 — parked for this cohort, but the reasoning stands — is the case where a better check was available. Encryption at a proxy is invisible to the
control plane, so the obvious design records tags and calls it attested. Instead the grader reads the
**payload metadata off the student's own workflow history** and asserts `encoding: binary/encrypted`
— the ciphertext is on the data plane whether or not the control plane knows about it. That took the
session from three attestations to none. Its control-plane check is worth keeping too: **no codec
server exists**, since the proxy decrypts at your edge and a codec server would quietly hand Temporal
Cloud a decode path.

Session 2 is the one that grades properly, because access control *is* control-plane state. It builds
a **namespace-scoped service account** — `namespace_scoped_access` with `write`, and no account-wide
access block at all. That is [Temporal's own recommendation](https://docs.temporal.io/cloud/manage-access/service-accounts#scoped)
for a Worker's API key, and it is the least-privilege identity shape the product offers.

It used to build an account-scoped service account plus a hand-written **Custom Role**, and that cost
more than it taught. Creating a custom role and attaching one are Account Owner permissions, so
students needed a second elevated credential threaded through an aliased provider — a
workshop-shaped workaround, not a pattern anyone would copy. Custom Roles are also Pre-release,
capped at 25 per account, and carry a confirmed bug where holding an account-level custom role costs
the principal its data-plane access. Neither the elevated key nor the cap exists any more: every
resource in Lab 2 now runs as the student.

The lesson survives the removal, because it was never really about custom roles. A namespace-scoped
service account still carries a **`Read` account role** — the docs say "must always have" — and no
argument lowers it: not `none`, and not a custom role, which could only ever add. How *wide* that
floor is, though, is something the docs leave open: the account-role table lists `GetUsers`,
`GetNamespaces` and `ListNamespaces` under Read-Only, while the same reference documents **runtime
narrowing** on other endpoints, where the role grants the call and the caller's scope decides what
comes back. So the session has students run those commands as their Worker identity and **report what
they got**, rather than the page claiming an outcome nobody measured. Either answer is a design
constraint worth knowing, and a least-privilege lab that stages a fake denial teaches a control that
isn't there.

Two denials *are* asserted, because both are unambiguous: `GetAuditLogs` is Global Admin and Account
Owner only, and any namespace the service account was not scoped to is simply not its namespace. The
second is the reason namespace permissions exist separately from account roles.

Adding a session is one file in `src/course/sessions/` plus a line in `src/course/index.ts`. Each
session owns its checkpoints and its own `grade(ctx)`; the context memoises account reads, so
twenty-odd checkpoints across six sessions still cost one `GetNamespaces`.

### The Audit Log as a third evidence source

Everything else in the Cloud Ops API describes *current state*, which is why "was this created by
Terraform or by hand" reads as unanswerable. `GetAuditLogs` is the one read that answers a question
about the past, and `principal.api_key_id` on each record is the only place the product records
**how** a change arrived: it is set for API-key callers (Terraform, the CLI, CI) and empty for
browser sessions. Session 2's `audit-log-attributable` checkpoint grades exactly that, and needs no
extra work from the student — it reads the `terraform apply` they already ran.

Two things to know before relying on it. Audit Logs need Account Owner or Global Admin, so the
portal can read them but a least-privilege identity cannot — which the lab turns into its one real
denial. And the documented event list does not match the wire: the docs say `CreateUserAPI` and
`CreateAPIKey`, the API emits `CreateUser` and `CreateApiKey`, and `UpdateNamespaceTags` and
`CreateCustomRole` are not documented at all. `src/cloud/ops.ts` therefore never matches on an
operation-name list; it grades the *shape* of a record instead.

### Data-plane grading

Sessions 3 to 7 grade facts the Cloud Ops API cannot see — the whole API has no worker,
deployment, Build ID, task-queue or payload surface. `src/cloud/dataplane.ts` opens a client against the
student's own namespace to read worker deployments, task-queue pollers and workflow status.

**The credential is an Account Owner key, and Account Owners hold Namespace *Admin* on every
namespace in the account — not revocable, not something the portal opted into.** So it could
terminate a student's workflow, not merely read it. The only thing preventing that is
`NamespaceReader`, which exposes reads and nothing else and is the only thing handed out. If a
mutating call is ever needed, add it as a separately named export so it shows up in review.

Session 7's checkpoints assert the **recovered** state, never the broken one: "currently stuck" is
true for thirty seconds and racy to grade, while "reached Completed after being stuck" is stable and
is the actual objective. The cost is that the grader cannot prove a student broke anything first —
drill 2 passes for someone who never stopped their workers — and the UI says so rather than
implying otherwise.

**Live control-plane mirror** (`/instructor`) refreshes every 5 seconds and highlights newly
created resources in green for 20 seconds. Project it: the room watching their own namespaces and
API keys appear on the big screen is the RBAC lesson that Session 2 then formalises.

---

## Known gaps

- **Provenance is only half-provable.** Session 1 verifies the tag `provisioner=terraform` exists,
  not that Terraform wrote it — a student who sets the tag by hand passes, and the checkpoint is
  named for what it checks so the page does not overclaim. The Audit Log gets closer than the tag
  does (see below) and Session 1's check could be rebuilt on it; that is not done yet.
- **Four checkpoints — in sessions 5, 6 and 7 — are self-attested**, each because the fact
  lives in the student's sandbox (a Grafana panel, a stopped worker) and nothing reachable can
  confirm it.
  They are badged and counted separately rather than mixed into the verified total.
- Nothing prevents a student deleting another student; the sweeper and the invitation workflows
  are idempotent, so the damage is recoverable by re-requesting access, but the interruption is real.
- Seat-cap accounting is per calendar day in `PORTAL_LINK_TIMEZONE`, not per cohort. The invite
  link itself does not expire — only changing `PORTAL_LINK_CODE` retires it.
- The `drift` list is reported but never acted on, by design.
