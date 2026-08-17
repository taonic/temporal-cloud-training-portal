"""Connection setup shared by every command.

Three ways to connect, and the flags pick between them:

    (default)   your Temporal Cloud namespace, from .env
    --local     `temporal server start-dev` on 127.0.0.1, no credentials
    --proxy     temporal-proxy on 127.0.0.1 (Lab 4), no credentials either
"""

from __future__ import annotations

import os
from pathlib import Path

from temporalio.client import Client
from temporalio.runtime import PrometheusConfig, Runtime, TelemetryConfig

TASK_QUEUE = "training-starter"
DEPLOYMENT_NAME = "training-workers"


class MissingSetting(Exception):
    """Raised instead of KeyError so main.py can print something a human can act on."""


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
    """Lab 5. Metric NAMES depend on these two options, and getting them wrong
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
    proxy: bool = False,
    env_file: str = ".env",
    namespace_override: str | None = None,
) -> Client:
    # The Rate Desk handler connects to the INSTRUCTOR's namespace, not the
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

    # --local points at `temporal server start-dev`, so every mode below can be
    # rehearsed without touching Temporal Cloud or burning a namespace.
    #
    # --proxy (Lab 4) points at temporal-proxy on localhost. Note what is
    # absent: no TLS, no API key, and the SHORT namespace name. The proxy adds
    # all three on the way to Cloud, which is the entire point of the pattern —
    # this process carries no connection details and no credentials.
    if local or proxy:
        address = "127.0.0.1:7233"
        namespace = "default" if local else _require("TEMPORAL_NAMESPACE").split(".")[0]
        api_key = None
    else:
        address = _require("TEMPORAL_ADDRESS")
        namespace = _require("TEMPORAL_NAMESPACE")
        api_key = _require("TEMPORAL_API_KEY")

    # --namespace wins over all of the above. It exists for the Nexus rehearsal,
    # which is the one case that runs several namespaces on one machine: a dev
    # server needs a caller namespace and a handler namespace side by side, and
    # `--local` alone can only ever mean `default`. In Cloud nobody passes it —
    # .env carries the namespace and this stays None.
    if namespace_override:
        namespace = namespace_override

    print(f"Connecting to {address} ({namespace})")

    return await Client.connect(
        address,
        namespace=namespace,
        api_key=api_key,
        tls=not (local or proxy),
        runtime=build_runtime(metrics_port),
    )
