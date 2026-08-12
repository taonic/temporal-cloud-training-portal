# Deploying to Fly.io

One app, one machine, one process: Next.js and the Temporal Worker share a process, so there is
nothing to keep in sync between web and worker deploys.

> **The machine must stay running.** The worker in this process holds every pending 48-hour
> revocation timer and the sweeper loop. `fly.toml` sets `auto_stop_machines = false` and
> `min_machines_running = 1` for that reason — don't "optimise" them.

---

## 1. Gather these values first

| Value | Where to find it |
|---|---|
| Cloud Ops API key | Temporal Cloud UI for **bvmon** → Settings → API Keys. Needs `ROLE_ADMIN` or `ROLE_OWNER`. |
| Temporal API key | Temporal Cloud UI for **a2dd6** → Settings → API Keys. |
| `TEMPORAL_ADDRESS` | **a2dd6** → Namespaces → `tao.a2dd6` → the **API Key endpoint** shown in the Connect box. Looks like `ap-southeast-2.aws.api.temporal.io:7233`. |
| `LAB_REQUIRED_REGION` | `pnpm ops:preflight` prints the ids valid for the account. |

Two values you generate:

```bash
openssl rand -hex 4       # PORTAL_LINK_CODE — the code students type
openssl rand -hex 24      # PORTAL_INSTRUCTOR_TOKEN
```

Both are secrets. Keep the invite code random-looking even though it gets projected onto a wall —
it is the only thing standing between a stranger and the invite form.

Validate everything locally before you deploy anything — it is far cheaper to find a bad region id
or an expiring key here than on a Fly machine:

```bash
cp .env.example .env.local   # fill in
pnpm ops:preflight
```

---

## 2. Secrets — `fly secrets set`

Four values, never in `fly.toml`, never in git:

| Secret | Purpose | If it's wrong |
|---|---|---|
| `PORTAL_LINK_CODE` | **The invite code students type** — the whole of the link, with no secret behind it and nothing derived at runtime. 4-32 lowercase alphanumerics. | Every link 404s. Setting a new value retires every outstanding link at once, which is the emergency stop. |
| `PORTAL_INSTRUCTOR_TOKEN` | Guards `/instructor` and `/api/mirror`. | Either you can't reach the mirror, or — if you leak it — every attendee email and account role is exposed. |
| `CLOUD_OPS_API_KEY` | Admin key on **bvmon**. Invites, revokes, sweeps, grades. | Nothing works and `opsCanary` goes red. |
| `TEMPORAL_API_KEY` | Connects to **a2dd6**, where the workflows run. | No workflows start; the portal cannot grant or revoke anything. |

```bash
fly secrets set \
  PORTAL_LINK_CODE='...' \
  PORTAL_INSTRUCTOR_TOKEN='...' \
  CLOUD_OPS_API_KEY='...' \
  TEMPORAL_API_KEY='...'
```

### Using mTLS to a2dd6 instead of an API key

Fly injects secrets as environment variables, not files, so the `*_PATH` variables are unusable
there. Pass base64 PEM instead, and switch `TEMPORAL_ADDRESS` to the **namespace** endpoint
(`tao.a2dd6.tmprl.cloud:7233`) — the regional address only works with API keys.

```bash
fly secrets set \
  TEMPORAL_TLS_CLIENT_CERT_DATA="$(base64 -i client.pem)" \
  TEMPORAL_TLS_CLIENT_KEY_DATA="$(base64 -i client.key)"
```

Don't set both an API key and cert data. API key wins, and you'll debug the wrong one.

---

## 3. Environment variables — `fly.toml [env]`

Non-secret, version-controlled, already populated in `fly.toml`. Change them there and redeploy.

| Variable | Default in `fly.toml` | Notes |
|---|---|---|
| `PORTAL_BASE_URL` | `https://temporal-cloud-training-portal.fly.dev` | Fallback only. `/instructor` derives the invite link from the request's `x-forwarded-host` / `x-forwarded-proto`, so it is correct on Fly without this being set. Used by `pnpm ops:preflight`, which has no request to read. |
| `PORTAL_LINK_TIMEZONE` | `Australia/Sydney` | Midnight here resets the daily seat cap — 02:00 NZ, outside workshop hours. The invite link does not rotate. |
| `PORTAL_ALLOWED_EMAIL_DOMAINS` | `example.com` | **The actual access control.** Patterns: `example.com` (exact), `*.example.com` (subdomains only), `*` (any domain). Empty **denies everything** — it fails closed. Setting `*` means the invite link and the seat cap are your only controls; the portal warns about this on both the invite page and `/instructor`. |
| `PORTAL_BLOCKED_EMAIL_DOMAINS` | *(empty)* | Domains that may never be invited, whatever the allowlist says — same patterns, checked first, wins outright. Empty blocks nothing. Use it to keep consumer mail out while the allowlist stays `*`, e.g. `gmail.com,outlook.com,yahoo.com`. `*` here rejects everybody; `pnpm ops:preflight` fails on that, and on any domain that appears on both lists. |
| `PORTAL_DAILY_SEAT_CAP` | `25` | Invitations per day, counted in `PORTAL_LINK_TIMEZONE`. |
| `ACCESS_TTL_HOURS` | `48` | How long a student holds Global Admin. |
| `TRAINING_ACCOUNT_ID` | `bvmon` | Display only; the key decides which account is really touched. |
| `CLOUD_OPS_ADDRESS` | `saas-api.tmprl.cloud:443` | |
| `CLOUD_OPS_API_VERSION` | `v0.19.1` | Must match the `api-cloud` revision `proto/cloudservice.binpb` was built from. |
| `TEMPORAL_NAMESPACE` | `tao.a2dd6` | |
| `TEMPORAL_ADDRESS` | `ap-southeast-2.aws.api.temporal.io:7233` | Regional for API keys, namespace endpoint for mTLS. Not interchangeable. |
| `TEMPORAL_TASK_QUEUE` | `training-portal` | |
| `SWEEPER_MODE` | `dry-run` | Ships as `dry-run` deliberately. See step 6. |
| `SWEEPER_INTERVAL_MINUTES` | `15` | |
| `LAB_NAMESPACE_PREFIX` | `training-` | Namespace names are `<prefix><email-local-part>`, capped at 39 chars. |
| `LAB_REQUIRED_REGION` | `azure-australiaeast` | Session 1's exit check. Confirm with `pnpm ops:preflight`. |

---

## 4. Deploy

```bash
fly launch --no-deploy --copy-config --name temporal-cloud-training-portal
```

Then set the secrets from step 2, fix `PORTAL_BASE_URL` in `fly.toml` to the hostname Fly assigned,
and:

```bash
fly deploy
```

Set secrets **before** the first deploy. The app boots without them (config is read lazily and
`/api/health` is deliberately fault-tolerant), but nothing it does will work.

Builds run on Fly's remote builder, which matters: `@temporalio/core-bridge` ships a native binary
and a macOS build would not run on the machine. `.dockerignore` keeps host `node_modules` out of
the image for the same reason.

---

## 5. Verify

```bash
fly logs                                   # expect: [web] listening, [worker] polling tao.a2dd6
curl https://<app>.fly.dev/api/health      # {"ok":true,"registryRunning":true,"canaryHealthy":true}
```

`registryRunning: false` means the worker has not claimed the singletons — check `fly logs` for a
Temporal connection error, which is nearly always the regional-vs-namespace address mistake.

Then open `/instructor?t=<PORTAL_INSTRUCTOR_TOKEN>`. You should see the student link, the
canary green with the identity your Cloud Ops key belongs to, and the baseline resource count.

---

## 6. Before the first real workshop

1. Leave `SWEEPER_MODE=dry-run` for one full pass (≤15 minutes). Read the sweep report at the
   bottom of `/instructor`. Every row should say `would-delete` only for things you recognise as
   workshop debris.
2. Flip it: set `SWEEPER_MODE = "live"` in `fly.toml`, `fly deploy`.
3. Confirm you hold **Account Owner** on `bvmon`, not merely Global Admin — a student with Global
   Admin can otherwise delete you.
4. Confirm the namespace-limit support ticket has landed. Accounts start at 10 and the automatic
   increase only triggers for namespaces with running workflows; the lab's won't have any.

---

## Operating

**Retire the invite link immediately.**

```bash
fly secrets set PORTAL_LINK_CODE="$(openssl rand -hex 4)"
```

Every outstanding link dies at once — `fly secrets set` restarts the machine on its own, so there is
no separate deploy. Existing access is unaffected; the running `invitation` workflows still revoke on
schedule. Read the new link off `/instructor` afterwards.

**Rotate the Cloud Ops key** (it expires, and a student with Global Admin can delete the identity
owning it): `fly secrets set CLOUD_OPS_API_KEY='...'`. The canary goes green again within five
minutes.

**Scaling.** Safe: extra machines just add workers polling the same task queue, and the registry,
canary and each invitation are singleton workflows keyed by id, so nothing runs twice. Only scale
up for web traffic; the workflows don't need it.

**Redeploys are safe mid-workshop.** Timers live in Temporal, not in the process. A student's
48-hour revocation survives any number of deploys, restarts and machine replacements.

**Teardown.** Don't `fly apps destroy` while access windows are open — you would strand students
as Global Admins on `bvmon` with nothing left to revoke them. Wait for `/instructor` to show zero
open windows and an empty sweep, or revoke by hand in the Cloud UI first.

---

## Troubleshooting

| Symptom | Cause |
|---|---|
| `Failed to connect before the deadline` in logs | `TEMPORAL_ADDRESS` is the namespace endpoint while using an API key, or the regional endpoint while using mTLS. |
| `Request unauthorized` from Temporal | Namespace doesn't have API key auth enabled, or the key belongs to the wrong account. |
| Canary red, `grpc code 16` | `CLOUD_OPS_API_KEY` expired, revoked, or its owning identity was deleted. |
| Canary red, `grpc code 7` | Key is valid but its role is below `ROLE_ADMIN` on `bvmon`. |
| Invite form: "that link is not valid" right after deploy | `PORTAL_LINK_CODE` changed — every outstanding link died with it, which is what it is for. Re-copy the link from `/instructor`. |
| Checkpoints stuck on "No namespace named…" | Student used a different namespace name, or the region is wrong so `terraform apply` failed. |
| Health check flapping, machine restarting | Not caused by dependency outages — `/api/health` never fails on those. Look for an actual crash in `fly logs`. |
