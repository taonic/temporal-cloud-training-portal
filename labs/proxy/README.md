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

docker run --rm -p 7233:7233 \
  -v "$PWD/labs/proxy/config.yaml:/config.yaml:ro" \
  -e TEMPORAL_NAMESPACE -e TEMPORAL_ACCOUNT -e TEMPORAL_API_KEY \
  temporalio/temporal-proxy:latest --config /config.yaml
```

It listens on `127.0.0.1:7233`.

## Point the Worker at it

```bash
cd labs/worker
dotnet run -- worker --proxy      # terminal 2
dotnet run -- start  --proxy      # terminal 3
```

`--proxy` connects in plaintext to `127.0.0.1:7233` with the short namespace and **no credentials at
all** — that is the whole point. The Worker carries no endpoint, no TLS material, and no API key.

## The lab

1. Run it **with encryption off** (the block at the bottom of `config.yaml` commented out). Start a
   workflow, then open it in the Cloud UI. The input is readable JSON.
2. Uncomment the `encryption:` block, restart the proxy, and run another workflow.
3. Open that one in the Cloud UI. The payload is now opaque bytes — Temporal Cloud is holding data
   it cannot read.

The exit check verifies step 3 by reading the payload metadata from your namespace and looking for
`encoding: binary/encrypted`. It is not taking your word for it.

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
