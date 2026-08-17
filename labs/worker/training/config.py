"""Connection setup shared by every command.

Two ways to connect, and one flag picks between them:

    (default)   your Temporal Cloud namespace, from .env
    --local     `temporal server start-dev` on 127.0.0.1, no credentials

Any of the three settings can also be overridden per invocation, which is how
the Risk Desk gets pointed at a namespace nobody has written into a file:

    --address <host:port>   --namespace <ns.account>   --api-key <key>

An override beats the file, and the file beats an exported variable. Whatever
you override is not then required from the environment, so all three together
run with no .env present at all.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Sequence

from temporalio.client import Client, Plugin
from temporalio.runtime import PrometheusConfig, Runtime, TelemetryConfig

TASK_QUEUE = "training-starter"


class MissingSetting(Exception):
    """Raised instead of KeyError so an entrypoint can print something a human can act on."""


def load_dotenv(filename: str = ".env") -> None:
    """Read a .env file so you configure the connection once instead of exporting
    three variables into every terminal — and this lab wants three terminals.

    The FILE WINS over an already-exported variable, which is the opposite of the
    usual convention and is deliberate. `workshop-creds` exports the student's
    personal admin key as TEMPORAL_API_KEY into every shell. Session 2 then writes
    the Worker's OWN service-account key into this file. If the ambient variable
    won, the Worker would quietly keep running as the admin — the lab would pass,
    the least-privilege lesson would not happen, and the deny-case demos in "Use
    what you built" would succeed when they are supposed to fail. A credential
    this file names is a credential the process should use.

    To override for a one-off run, edit the file or point at another directory —
    exporting the variable no longer does it.
    """
    here = Path.cwd().resolve()
    for directory in [here, *here.parents][:4]:
        env_file = directory / filename
        if not env_file.is_file():
            continue

        replaced = []
        for raw in env_file.read_text().splitlines():
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue

            key, _, value = line.partition("=")
            key = key.strip()
            value = value.strip().strip("\"'")
            if not key:
                continue

            ambient = os.environ.get(key)
            if ambient is not None and ambient != value:
                replaced.append(key)
            os.environ[key] = value

        print(f"Loaded {env_file}")
        if replaced:
            # Say it out loud. Silently shadowing an exported credential is how
            # you spend an afternoon wondering which key a process is using.
            print(f"  overrode exported {', '.join(replaced)} — this file wins")
        return


def _require(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        raise MissingSetting(name)
    return value


def build_runtime(metrics_port: str | None) -> Runtime | None:
    """Lab 3. Metric NAMES depend on these two options, and getting them wrong
    produces empty graphs with no error — Prometheus cannot tell you that a
    metric name never existed.

    Verified by curling the endpoint of a running worker rather than read off a
    docs page:

      Histograms  durations_as_seconds + unit_suffix give you
                  temporal_..._latency_seconds_{bucket,sum,count}.
                  Without them: integer MILLISECONDS and no _seconds. Dashboards
                  written against the defaults divide by 1000 for that reason;
                  ours must not.
      Counters    counters_total_suffix defaults to False, so temporal_workflow_completed
                  with NO _total. Much of the internet writes _total because that
                  is the OpenMetrics convention. Leave it off — the provisioned
                  Grafana dashboard queries the unsuffixed names.
      Gauges      never take a suffix either way: temporal_num_pollers.
    """
    if metrics_port is None:
        return None

    runtime = Runtime(
        telemetry=TelemetryConfig(
            metrics=PrometheusConfig(
                bind_address=f"0.0.0.0:{metrics_port}",
                unit_suffix=True,  # default: False
                durations_as_seconds=True,  # default: False (milliseconds!)
            )
        )
    )
    print(f"SDK metrics on http://localhost:{metrics_port}/metrics")
    return runtime


async def connect(
    *,
    metrics_port: str | None = None,
    local: bool = False,
    env_file: str = ".env",
    namespace_override: str | None = None,
    address_override: str | None = None,
    api_key_override: str | None = None,
    plugins: Sequence[Plugin] = (),
) -> Client:
    # The Risk Desk handler connects to the INSTRUCTOR's namespace, not the
    # student's, so `desk` reads .env.desk instead. Two credentials for two sides
    # of a boundary is the honest shape — the same reason Session 2 keeps the
    # Worker's key out of the admin's shell.
    #
    # Load order matters: .env goes down first as a base so a single-namespace
    # rehearsal works with one file, and .env.desk lands on top so it wins. The
    # later call overwrites, so the more specific file must come second.
    if env_file != ".env":
        load_dotenv()
    load_dotenv(env_file)

    # --local points at `temporal server start-dev`, so every command in every
    # lab can be rehearsed without touching Temporal Cloud or burning a
    # namespace. It is also how the Nexus lab runs both sides on one machine.
    # An explicit flag beats a file, which beats an exported variable. Note the
    # order this is written in: a setting that was OVERRIDDEN is never required
    # from the environment, so `--address … --namespace … --api-key …` works
    # with no .env file present at all. That is the whole point of the overrides
    # — the desk has to be runnable against an arbitrary namespace by someone
    # who has not edited a file on this machine.
    if local:
        address = "127.0.0.1:7233"
        namespace = "default"
        api_key = None
    else:
        address = address_override or _require("TEMPORAL_ADDRESS")
        namespace = namespace_override or _require("TEMPORAL_NAMESPACE")
        api_key = api_key_override or _require("TEMPORAL_API_KEY")

    if address_override:
        address = address_override
    if api_key_override:
        api_key = api_key_override

    # --namespace wins over all of the above, --local included. It exists for
    # the Nexus rehearsal, which is the one case that runs several namespaces on
    # one machine: a dev server needs a caller namespace and a handler namespace
    # side by side, and `--local` alone can only ever mean `default`.
    if namespace_override:
        namespace = namespace_override

    # TLS follows the ADDRESS rather than the flag, because those can now
    # disagree. `--local` means loopback and no TLS; an explicit `--address`
    # means whatever that address is, so pointing the desk at Cloud without
    # editing a file works, and so does pointing it at a dev server on another
    # port. Deciding this from `--local` alone would have silently offered a
    # plaintext handshake to Temporal Cloud, which fails in a way that reads as
    # a credential problem.
    if address_override:
        tls = not address.startswith(("127.0.0.1", "localhost", "[::1]"))
    else:
        tls = not local

    # Name the flags that beat the file. `load_dotenv` has already announced
    # "this file wins" about the environment, and without this line the next
    # thing on screen is a connection to somewhere the file does not mention —
    # which reads as a bug rather than as the override doing its job.
    overridden = [
        name
        for name, value in (
            ("--address", address_override),
            ("--namespace", namespace_override),
            ("--api-key", api_key_override),
        )
        if value
    ]
    if overridden:
        print(f"  {', '.join(overridden)} on the command line — these win over any file")

    print(f"Connecting to {address} ({namespace}){'' if tls else ' — no TLS'}")

    # `plugins` is empty for every command except the Risk Desk, which passes
    # Pydantic AI's. A plugin can replace the data converter and the workflow
    # runner, so it belongs on the CLIENT rather than being bolted onto each
    # Worker — that is what keeps the desk's Workers down to a task queue and a
    # list of workflows.
    return await Client.connect(
        address,
        namespace=namespace,
        api_key=api_key,
        tls=tls,
        runtime=build_runtime(metrics_port),
        plugins=list(plugins),
    )
