using Temporalio.Activities;
using Temporalio.Client;
using Temporalio.Common;
using Temporalio.Runtime;
using Temporalio.Worker;
using Temporalio.Workflows;

// Training starter — used in Labs 1 and 3 to 6.
//dotnet run -- worker --metrics-port 9464.
//   dotnet run -- worker                          Lab 1: plain worker
//   dotnet run -- start                            Lab 1: run one workflow
//
//   dotnet run -- worker --version 1.0             Lab 3: versioned worker
//   dotnet run -- worker --version 2.0             Lab 3: the new version
//
//   dotnet run -- worker --break-determinism       Lab 6 drill 1
//   dotnet run -- chaos determinism                Lab 6 drill 1: start it
//   dotnet run -- chaos stuck                      Lab 6 drill 4
//
//   dotnet run -- worker --proxy                   Lab 4: via temporal-proxy
//   dotnet run -- start  --proxy                   Lab 4: encrypted payload
//
//   dotnet run -- worker --metrics-port 9464       Lab 5: expose SDK metrics
//   dotnet run -- load --count 50                  Lab 5: generate traffic
//
// Connection comes from TEMPORAL_ADDRESS, TEMPORAL_NAMESPACE and
// TEMPORAL_API_KEY — the session page prints the exact values for your namespace.

const string TaskQueue = "training-starter";
const string DeploymentName = "training-workers";

/// <summary>
/// Reads a .env file so you configure the connection once instead of exporting
/// three variables into every terminal — and this lab wants three terminals.
/// Real environment variables win, so CI and one-off overrides still work.
/// </summary>
static void LoadDotEnv()
{
    var dir = new DirectoryInfo(Directory.GetCurrentDirectory());
    for (var depth = 0; depth < 4 && dir is not null; depth++, dir = dir.Parent)
    {
        var file = Path.Combine(dir.FullName, ".env");
        if (!File.Exists(file))
        {
            continue;
        }

        foreach (var raw in File.ReadAllLines(file))
        {
            var line = raw.Trim();
            if (line.Length == 0 || line.StartsWith('#'))
            {
                continue;
            }

            var eq = line.IndexOf('=');
            if (eq <= 0)
            {
                continue;
            }

            var key = line[..eq].Trim();
            var value = line[(eq + 1)..].Trim().Trim('"', '\'');
            if (Environment.GetEnvironmentVariable(key) is null)
            {
                Environment.SetEnvironmentVariable(key, value);
            }
        }

        Console.WriteLine($"Loaded {file}");
        return;
    }
}

static string Require(string name) =>
    Environment.GetEnvironmentVariable(name)
    ?? throw new InvalidOperationException(name);

static async Task<ITemporalClient> ConnectAsync(
    string? metricsPort = null, bool local = false, bool proxy = false)
{
    LoadDotEnv();

    // --local points at `temporal server start-dev`, so every mode below can be
    // rehearsed without touching Temporal Cloud or burning a namespace.
    //
    // --proxy (Lab 4) points at temporal-proxy on localhost. Note what is
    // absent: no TLS, no API key, and the SHORT namespace name. The proxy adds
    // all three on the way to Cloud, which is the entire point of the pattern —
    // this process carries no connection details and no credentials.
    var address = local || proxy ? "127.0.0.1:7233" : Require("TEMPORAL_ADDRESS");
    var ns = local
        ? "default"
        : proxy
            ? Require("TEMPORAL_NAMESPACE").Split('.')[0] // strip ".account"
            : Require("TEMPORAL_NAMESPACE");
    var apiKey = local || proxy ? null : Require("TEMPORAL_API_KEY");
    Console.WriteLine($"Connecting to {address} ({ns})");

    TemporalRuntime? runtime = null;
    if (metricsPort is not null)
    {
        // Lab 5. Metric NAMES depend on these options, and getting them
        // wrong produces empty graphs with no error. Verified by curling the
        // endpoint rather than read off a docs page:
        //
        //   Histograms  UseSecondsForDuration + HasUnitSuffix give you
        //               temporal_..._latency_seconds_{bucket,sum,count}.
        //               Without them: integer milliseconds, no _seconds.
        //   Counters    NO _total suffix, in Temporalio 1.17, whatever you set
        //               HasCounterTotalSuffix to — it made no difference with
        //               the flag on or off. Query temporal_workflow_completed.
        //   Gauges      never take a suffix: temporal_num_pollers.
        runtime = new TemporalRuntime(new()
        {
            Telemetry = new()
            {
                Metrics = new()
                {
                    Prometheus = new($"0.0.0.0:{metricsPort}")
                    {
                        HasUnitSuffix = true,
                        UseSecondsForDuration = true,
                    },
                },
            },
        });
        Console.WriteLine($"SDK metrics on http://localhost:{metricsPort}/metrics");
    }

    return await TemporalClient.ConnectAsync(
        new(address)
        {
            Namespace = ns,
            ApiKey = apiKey,
            Tls = local || proxy ? null : new(),
            Runtime = runtime,
        });
}

static string? FlagValue(string[] args, string name)
{
    var i = Array.IndexOf(args, name);
    return i >= 0 && i + 1 < args.Length ? args[i + 1] : null;
}

var command = args.FirstOrDefault() ?? "start";
var suffix = Environment.UserName.ToLowerInvariant();
var local = args.Contains("--local");
var viaProxy = args.Contains("--proxy");

try
{
switch (command)
{
    case "worker":
    {
        var client = await ConnectAsync(FlagValue(args, "--metrics-port"), local, viaProxy);
        var version = FlagValue(args, "--version");

        // Lab 6 drill 1: the same workflow type, deliberately altered so
        // replay of an existing history no longer matches. Shipping this
        // without versioning is the single most common self-inflicted outage.
        Determinism.Broken = args.Contains("--break-determinism");

        var options = new TemporalWorkerOptions(TaskQueue);

        if (version is not null)
        {
            // Setting DeploymentOptions is what makes the server register a
            // Worker Deployment. An unversioned worker creates nothing, which
            // is why Lab 3's first checkpoint fails without this.
            options.DeploymentOptions = new WorkerDeploymentOptions(
                new WorkerDeploymentVersion(DeploymentName, version),
                useWorkerVersioning: true)
            {
                // Pinned: an execution finishes on the version it started on,
                // which is what lets v1 drain safely while v2 takes new traffic.
                //
                // This lives here rather than as [Workflow(VersioningBehavior =
                // ...)] on the workflow class, and that is not a style choice.
                // A workflow that declares a versioning behaviour while its
                // worker is UNVERSIONED is rejected by the server with
                // "versioning behavior cannot be specified without deployment
                // options being set with versioned mode" — and the workflow task
                // then retries forever, so the execution hangs instead of
                // failing. Setting it on the worker keeps the same workflow code
                // usable by the unversioned workers in Labs 1, 4, 5 and 6.
                DefaultVersioningBehavior = VersioningBehavior.Pinned,
            };
            Console.WriteLine($"Versioned worker: {DeploymentName}.{version}");
        }
        else
        {
            Console.WriteLine("Unversioned worker (no Worker Deployment will be created)");
        }

        options.AddActivity(Activities.Describe)
            .AddActivity(Activities.HangAfterHeartbeatAsync)
            .AddWorkflow<GreetingWorkflow>()
            .AddWorkflow<StuckActivityWorkflow>();

        using var tokenSource = new CancellationTokenSource();
        Console.CancelKeyPress += (_, e) =>
        {
            tokenSource.Cancel();
            e.Cancel = true;
        };

        using var worker = new TemporalWorker(client, options);
        Console.WriteLine(
            $"Polling '{TaskQueue}'"
                + (Determinism.Broken ? " with DELIBERATELY BROKEN determinism" : "")
                + ". Ctrl-C to stop.");
        try
        {
            await worker.ExecuteAsync(tokenSource.Token);
        }
        catch (OperationCanceledException)
        {
            Console.WriteLine("Worker stopped.");
        }
        break;
    }

    case "start":
    {
        var client = await ConnectAsync(local: local, proxy: viaProxy);
        var workflowId = $"training-{suffix}-{DateTime.UtcNow:HHmmss}";

        Console.WriteLine($"Starting {workflowId}…");
        var handle = await client.StartWorkflowAsync(
            (GreetingWorkflow wf) => wf.RunAsync(suffix),
            new(id: workflowId, taskQueue: TaskQueue));

        Console.WriteLine("Waiting for the result — if this hangs, no worker is polling.");
        Console.WriteLine(await handle.GetResultAsync());
        break;
    }

    case "chaos":
    {
        var client = await ConnectAsync(local: local, proxy: viaProxy);
        var drill = args.ElementAtOrDefault(1) ?? "determinism";

        if (drill == "determinism")
        {
            // Drill 1. Start on a healthy worker, then restart the worker with
            // --break-determinism. The task fails on replay and retries forever:
            // the workflow is stuck, NOT failed, and no error rate moves.
            var id = $"chaos-1-{suffix}";
            var handle = await client.StartWorkflowAsync(
                (GreetingWorkflow wf) => wf.RunAsync(suffix),
                new(id: id, taskQueue: TaskQueue));
            Console.WriteLine($"Started {id}. Now restart your worker with --break-determinism,");
            Console.WriteLine("then run: temporal workflow describe --workflow-id " + id);
            Console.WriteLine("Restart the worker WITHOUT the flag to let it recover.");
            _ = handle;
        }
        else if (drill == "stuck")
        {
            // Drill 4. The Activity heartbeats, then hangs. The heartbeat is
            // what lets you tell "stuck" from "slow", and what lets the retry
            // resume from the last reported progress instead of from zero.
            var id = $"chaos-4-{suffix}";
            await client.StartWorkflowAsync(
                (StuckActivityWorkflow wf) => wf.RunAsync(),
                new(id: id, taskQueue: TaskQueue));
            Console.WriteLine($"Started {id}. The Activity will heartbeat, then hang.");
            Console.WriteLine("Watch: temporal workflow describe --workflow-id " + id);
            Console.WriteLine("The heartbeat timeout fires after ~10s and the retry resumes.");
        }
        else
        {
            Console.Error.WriteLine($"Unknown drill '{drill}'. Use 'determinism' or 'stuck'.");
            return 1;
        }
        break;
    }

    case "load":
    {
        // Lab 5: generate enough traffic that the dashboard has a curve
        // rather than a single point.
        var client = await ConnectAsync(local: local, proxy: viaProxy);
        var count = int.TryParse(FlagValue(args, "--count"), out var n) ? n : 50;
        Console.WriteLine($"Starting {count} workflows…");

        var handles = new List<WorkflowHandle<GreetingWorkflow, string>>();
        for (var i = 0; i < count; i++)
        {
            handles.Add(await client.StartWorkflowAsync(
                (GreetingWorkflow wf) => wf.RunAsync($"{suffix}-{i}"),
                new(id: $"load-{suffix}-{DateTime.UtcNow:HHmmss}-{i}", taskQueue: TaskQueue)));
        }

        await Task.WhenAll(handles.Select(h => h.GetResultAsync()));
        Console.WriteLine($"{count} workflows completed. Check Grafana at http://localhost:3030");
        break;
    }

    default:
        Console.Error.WriteLine($"Unknown command '{command}'. Use worker, start, load or chaos.");
        return 1;
}
}
catch (InvalidOperationException ex)
{
    // Missing configuration is the most common way to land here, and a stack
    // trace tells a student nothing useful about it.
    Console.Error.WriteLine();
    Console.Error.WriteLine($"  {ex.Message} is not set.");
    Console.Error.WriteLine();
    Console.Error.WriteLine("  Pick one:");
    Console.Error.WriteLine();
    Console.Error.WriteLine("  1. Against your Cloud namespace — copy .env.example to .env and paste in");
    Console.Error.WriteLine("     the \"Connection details\" block shown at the top of any session page:");
    Console.Error.WriteLine();
    Console.Error.WriteLine("       cp .env.example .env && $EDITOR .env");
    Console.Error.WriteLine();
    Console.Error.WriteLine("  2. Against a local dev server — no Cloud, no credentials:");
    Console.Error.WriteLine();
    Console.Error.WriteLine("       temporal server start-dev        # in another terminal");
    Console.Error.WriteLine($"       dotnet run -- {command} --local");
    Console.Error.WriteLine();
    return 1;
}

return 0;

internal static class Determinism
{
    /// <summary>Set by --break-determinism to alter the command sequence on replay.</summary>
    internal static bool Broken;
}

public static class Activities
{
    [Activity]
    public static string Describe(string who) =>
        $"Hello {who}. This ran on a worker you started, against a namespace you provisioned.";

    /// <summary>Heartbeats a few times, then hangs forever. Drill 4.</summary>
    [Activity]
    public static async Task HangAfterHeartbeatAsync()
    {
        for (var progress = 1; progress <= 3; progress++)
        {
            ActivityExecutionContext.Current.Heartbeat(progress);
            Console.WriteLine($"[activity] heartbeat {progress}/3");
            await Task.Delay(TimeSpan.FromSeconds(1));
        }

        Console.WriteLine("[activity] now hanging — heartbeats have stopped");
        await Task.Delay(Timeout.Infinite, ActivityExecutionContext.Current.CancellationToken);
    }
}

[Workflow]
public class GreetingWorkflow
{
    [WorkflowRun]
    public async Task<string> RunAsync(string who)
    {
        var greeting = await Workflow.ExecuteActivityAsync(
            () => Activities.Describe(who),
            new() { StartToCloseTimeout = TimeSpan.FromSeconds(10) });

        // With --break-determinism the worker issues an extra command that is
        // absent from the recorded history, so replay diverges.
        if (Determinism.Broken)
        {
            await Workflow.DelayAsync(TimeSpan.FromSeconds(1));
        }

        return greeting;
    }
}

[Workflow]
public class StuckActivityWorkflow
{
    [WorkflowRun]
    public Task RunAsync() =>
        Workflow.ExecuteActivityAsync(
            () => Activities.HangAfterHeartbeatAsync(),
            new()
            {
                StartToCloseTimeout = TimeSpan.FromMinutes(5),
                // Without this, a hung Activity is indistinguishable from a slow
                // one until StartToCloseTimeout expires five minutes later.
                HeartbeatTimeout = TimeSpan.FromSeconds(10),
                RetryPolicy = new() { MaximumAttempts = 2 },
            });
}
