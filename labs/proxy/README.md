# Lab 4 — Temporal Proxy

[`temporalio/temporal-proxy`](https://github.com/temporalio/temporal-proxy) is a gRPC proxy that
sits between your Workers and Temporal Cloud. It terminates TLS, attaches the API key, rewrites the
namespace, and — the part this session is about — **seals payloads with envelope encryption on the
way out and opens them on the way back**.

Your Worker exchanges cleartext with a local endpoint. Temporal Cloud only ever stores ciphertext.

> **Pre-release.** The project says so on its own front page: *"under active development… not ready
> for production use."* Fine for learning the pattern. Not a recommendation to ship it.

## Install

```bash
docker pull temporalio/temporal-proxy:latest
```

## Run

The proxy needs the **short** namespace name — it appends the account itself. That is different from
`labs/worker/.env`, which holds the fully-qualified name, so export these in the proxy's own
terminal rather than putting them in a file. Run this from the repo root:

```bash
export TEMPORAL_NAMESPACE=training-<you>         # short name, no .account
export TEMPORAL_ACCOUNT=bvmon
export TEMPORAL_API_KEY=<your Temporal Cloud API key>

docker run --rm -p 127.0.0.1:7233:7233 \
  -v "$PWD/labs/proxy/config.yaml:/config.yaml:ro" \
  -e TEMPORAL_NAMESPACE -e TEMPORAL_ACCOUNT -e TEMPORAL_API_KEY \
  temporalio/temporal-proxy:latest serve --config /config.yaml
```

Reachable at `127.0.0.1:7233` on this machine. Note where each half of that lives: the container
publishes the port to your loopback (`-p 127.0.0.1:7233:7233`), while `config.yaml` binds
`0.0.0.0:7233` **inside** the container. Bind the container's loopback instead and Docker's published
port forwards to an address nothing is listening on — the worker's TCP connect succeeds against the
port forwarder and then dies with

```
get_system_info call error after connection: ... connection closed
```

which reads like a credential or upstream fault and is neither.

**`serve` is not optional.** The image's entrypoint is the bare `proxy` binary, and `--config` is
defined on its `serve` subcommand, not on the root command. Leave `serve` out and you get:

```
Incorrect Usage: flag provided but not defined: -config
```

which reads like the flag was renamed rather than like a missing subcommand. `-c` is an accepted
alias, and `PROXY_CONFIG` an accepted environment variable, but both still need `serve`.

## Point the Worker at it

```bash
cd labs/worker
dotnet run -- worker --version 2.0 --proxy   # terminal 2
dotnet run -- start  --proxy                 # terminal 3
```

`--proxy` connects in plaintext to `127.0.0.1:7233` with the short namespace and **no credentials at
all** — that is the whole point. The Worker carries no endpoint, no TLS material, and no API key.

`--version 2.0` is separate and also required: Lab 3 leaves `2.0` as the Worker Deployment's current
version, and a versioned task queue routes new executions only to that version. Without it the
worker polls and is handed nothing, and the workflow sits in the UI having never started.

## The lab

**Encryption is on by default** — the `encryption:` block at the bottom of `config.yaml` ships
enabled, so every payload the proxy forwards is sealed from the first workflow onward. You do not
switch it on; you find out what it did.

1. Start a workflow **through the proxy**: `dotnet run -- start --proxy`. Open it in the Cloud UI —
   the input is opaque bytes.
2. Start one **without** the proxy: `dotnet run -- start`, which connects straight to Cloud carrying
   the endpoint, namespace and your API key. Open that one — the input is readable JSON.
3. Compare them. Same worker, same workflow code, same namespace; the only difference is which side
   of the proxy the client sat on.

The exit check verifies step 1 by reading the payload metadata from your namespace and looking for
`encoding: binary/encrypted`. It is not taking your word for it — and it only ever sees the sealed
form, because it has no key.

Mixing the two is safe: a plaintext payload passes back through the proxy untouched, so the direct
workflow still completes on a proxy-connected worker. If you would rather see the toggle, comment
`enabled: true` out and restart — but the two-command comparison above needs no restart at all.

## About that key

```yaml
uri: testing://KioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKio=
```

`testing://` is a local in-process key. The proxy's own documentation calls it *"for tests and local
runs only"*, and the key material sits in this file in plaintext — anyone who can read the repo can
decrypt every payload. It is here so the mechanism is visible without anyone needing an Azure
subscription.

Production is the same three lines with a different URI:

```yaml
uri: azurekeyvault://<vault>.vault.azure.net/keys/<key>
```

The proxy then wraps every data encryption key through Key Vault, DEKs rotate on the `duration` you
set, and the key never leaves the vault. `awskms://` and `gcpkms://` work the same way, and for an
on-prem HSM there is an extension-server path where you implement the key handling and payloads
never reach it.

**That substitution is the actual deliverable of this session** — the difference between the toy and
the real thing is a URI and a vault, not an architecture change.
