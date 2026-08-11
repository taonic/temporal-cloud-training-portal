import { ENCRYPTED_ENCODING } from '@/cloud/dataplane';
import { LAB_BUILD_ID_V2 } from '../naming';
import type { SessionDef } from '../types';

/**
 * Session 4 — Data Security & Encryption, built on temporalio/temporal-proxy.
 *
 * This session used to record its claims as namespace tags, which was the
 * weakest thing in the portal: a tag reading "ciphertext-egress-verified" is a
 * student's word, not evidence. The proxy makes the real check possible.
 *
 * Payloads sealed by the proxy carry `encoding: binary/encrypted` in their
 * metadata. The grader reads that straight off the student's own namespace
 * through the data plane — the same API an auditor would use — so "Temporal
 * Cloud only ever sees ciphertext" is verified rather than attested. The grader
 * cannot decrypt any of it, which is precisely the property being demonstrated.
 *
 * Laptop-scale: one Go binary and one config file. No AKS, no Azure
 * subscription, no certificates.
 */
export const session4: SessionDef = {
  number: 4,
  title: 'Data Security & Encryption',
  outcome: 'Payloads that Temporal Cloud stores but cannot read, proven rather than claimed.',
  exitCheck: 'Ciphertext-only egress verified; key rotation runbook drafted.',
  labTitle: 'Put temporal-proxy in front of Cloud and encrypt the payloads',
  labMinutes: 15,

  prerequisites: [
    {
      name: 'temporal-proxy',
      why:
        'The encrypting gateway this whole session is about. The image is already pulled in your ' +
        'sandbox; `proxy-up` runs it in the foreground on 127.0.0.1:7233 with the command from ' +
        '`labs/proxy/README.md`. That command must invoke the `serve` subcommand — `--config` is ' +
        'defined on `proxy serve`, not on the bare entrypoint.',
      install: 'proxy-up',
      docs: 'https://github.com/temporalio/temporal-proxy',
    },
  ],

  note:
    'temporal-proxy is Pre-release — its own front page says "not ready for production use". It is ' +
    'the right thing to learn the pattern on, and it is not a recommendation to ship it as-is. The ' +
    'key this lab uses is a throwaway held in a config file; the production substitution is one URI, ' +
    'and that substitution is the real deliverable of this session.',

  labSteps: [
    'In a fresh terminal, run `proxy-up`. It listens on 127.0.0.1:7233, against `labs/proxy/config.yaml`, and that file ships with `encryption: enabled: true` — every payload it forwards is sealed from the first workflow onward. Read what it prints: the proxy wants the SHORT namespace name plus the account, which is exactly what `labs/worker/.env` does not hold — `proxy-up` derives both, and `labs/proxy/README.md` has the full `docker run` if you would rather type it.',
    `Point the worker at it: \`dotnet run -- worker --version ${LAB_BUILD_ID_V2} --proxy\` in one terminal, \`dotnet run -- start --proxy\` in another. Note what the worker no longer has — no endpoint, no TLS, no API key. **Keep the \`--version ${LAB_BUILD_ID_V2}\`**: Session 3 left v${LAB_BUILD_ID_V2} as your Worker Deployment's current version, and a versioned task queue routes new executions only to that version. An unversioned worker polls happily and is handed nothing — workflows appear in the UI and never start, with no error anywhere.`,
    'Now the comparison. Start one more workflow **without** the proxy — `dotnet run -- start`, no flag — which connects straight to Cloud from your own process, carrying the endpoint, the namespace and your API key the way Sessions 1 and 3 did.',
    'Open both workflows in the Cloud UI. The direct one shows its input as readable JSON; the proxied one is opaque bytes with `encoding: binary/encrypted` and two `encryption-*` metadata keys. Same worker, same workflow code, same namespace — the only difference is which side of the proxy the client sat on.',
    'Note what did NOT change to get that: no application code, no data converter, no key material anywhere near the worker. Encryption is on by default in `labs/proxy/config.yaml` — three lines of proxy config that the application cannot see and cannot switch off.',
    'Draft the key rotation runbook: who owns the Key Vault key, how `duration` and `renewBefore` roll DEKs, and what happens to workflows whose history was sealed under an older key.',
  ],

  snippetLang: 'yaml',
  snippet: () => `# labs/proxy/config.yaml — the part that matters. Already in the file,
# already on: you did not have to enable it, and neither would an application
# team whose platform group runs the proxy.
#
# Everything above this in the file is routing: derive the Cloud endpoint from
# the namespace, append the account, attach the API key, terminate TLS. That is
# what lets the worker connect in plaintext carrying no credentials at all.

encryption:
  enabled: true
  cacheSize: 200
  default:
    # A local in-process key held in this file. The proxy's own docs call the
    # "testing://" scheme "for tests and local runs only" — anyone who can read
    # this repo can decrypt every payload it protects. It is here so the
    # mechanism is visible without anyone needing an Azure subscription.
    uri: testing://KioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKio=

    # How long a data encryption key lives before a new one is minted, and how
    # early to roll it. Older DEKs stay openable, which is why history sealed
    # last week still reads today.
    duration: 1h
    renewBefore: 15m

# ---------------------------------------------------------------------------
# What you would run in production is this same block with one line changed:
#
#     uri: azurekeyvault://<vault>.vault.azure.net/keys/<key>
#
# The proxy then wraps every DEK through Key Vault and the key never leaves it.
# awskms:// and gcpkms:// work identically, and for an on-prem HSM there is an
# extension-server path where you implement the key handling and payloads never
# reach it.
#
# Architecture unchanged. That is the point worth taking away.
# ---------------------------------------------------------------------------`,

  use: ({ namespaceId }) => ({
    intro:
      'The claim is that Temporal Cloud holds your payloads and cannot read them. Do not take that ' +
      'on trust — go and look at the bytes.',
    steps: [
      {
        label: 'Confirm the control plane has no decode path',
        command: `temporal cloud namespace get -n ${namespaceId}`,
        expect:
          'No codec server endpoint. A codec server exists so the Cloud UI can ask something to ' +
          'decrypt payloads for display — convenient, and exactly the property you just gave up on ' +
          'purpose.',
      },
      {
        label: 'Look at the workflow you started WITHOUT the proxy',
        command: `temporal workflow show --workflow-id <the direct one> \\\n  --address ${namespaceId}.tmprl.cloud:7233 \\\n  --namespace ${namespaceId} \\\n  --api-key $TEMPORAL_API_KEY`,
        expect:
          'Your input as readable JSON, tagged `encoding: json/plain`. This is what Temporal Cloud ' +
          'stores by default, and what it stored for every workflow in Sessions 1 and 3.',
      },
      {
        label: 'Now the one that went through the encrypting proxy',
        command: `temporal workflow show --workflow-id <the proxied one> \\\n  --address ${namespaceId}.tmprl.cloud:7233 \\\n  --namespace ${namespaceId} \\\n  --api-key $TEMPORAL_API_KEY`,
        expect:
          `Opaque bytes, \`encoding: ${ENCRYPTED_ENCODING}\` — the field the exit check reads — plus ` +
          '`encryption-dek` and `encryption-key-id` metadata: the wrapped data key travels with the ' +
          'payload, which is what lets a DEK rotate without orphaning old history. Note you are ' +
          'authenticated as an account admin and still cannot read it: the boundary is the key, not ' +
          'the permission.',
      },
      {
        label: 'Watch the worker read it back perfectly well',
        command: 'dotnet run -- start --proxy',
        expect:
          'The workflow returns its greeting in cleartext. The proxy opened the payload on the way ' +
          'back, and your application never knew encryption was happening — which is why this is a ' +
          'deployment concern rather than a code change.',
      },
    ],
    stretch: {
      title: 'Stretch: break it deliberately',
      body:
        'Stop the proxy and point a worker straight at Cloud, then try to read the encrypted ' +
        'workflow. You get ciphertext the SDK cannot decode. That is the failure mode behind the ' +
        '"UI cannot decode payload" runbook in Session 6 — and the reason the answer there is "this ' +
        'is expected", not "add a codec server".',
    },
  }),

  checkpoints: [
    {
      id: 'payload-encrypted',
      title: 'Workflow payload is encrypted',
      detail:
        'The grader reads the input payload metadata off a completed workflow in your namespace — ' +
        `the same raw history an auditor would fetch — and looks for \`encoding: ${ENCRYPTED_ENCODING}\`. ` +
        'Not a tag you set and not a claim you made. It holds the ciphertext without being able to ' +
        'open it, which is the property under test.',
    },
  ],

  async grade(ctx) {
    const ns = await ctx.labNamespace();
    if (!ns) {
      return ctx.blockedAll(`No namespace named "${ctx.namespaceName}" — complete Session 1 first.`);
    }

    const reader = await ctx.dataPlane();
    if (!reader) {
      return [ctx.mk('payload-encrypted', 'blocked', 'Cannot reach your namespace.')];
    }

    let samples;
    try {
      samples = await reader.payloadEncodings();
    } catch (err) {
      return [
        ctx.mk(
          'payload-encrypted',
          'blocked',
          `Could not read payloads: ${err instanceof Error ? err.message : String(err)}`,
        ),
      ];
    }

    const encrypted = samples.filter((s) => s.encodings.includes(ENCRYPTED_ENCODING));
    const sealed = encrypted[0];

    return [
      ctx.check(
        'payload-encrypted',
        encrypted.length > 0,
        `${sealed?.workflowId} — payload metadata [${sealed?.metadataKeys.join(', ')}] carries ` +
          `encoding ${sealed?.encodings.join(', ')}. ${encrypted.length} of ${samples.length} sampled workflow(s) sealed.`,
        samples.length === 0
          ? 'No completed workflows to inspect — run one through the proxy first.'
          : `Sampled ${samples.length} workflow(s), none tagged ${ENCRYPTED_ENCODING} (saw ${[
              ...new Set(samples.flatMap((s) => s.encodings)),
            ].join(', ')}). Only workflows started with \`--proxy\` are sealed — a direct one is stored ` +
            `in the clear, which is the comparison the lab asks for. Run \`dotnet run -- start --proxy\` ` +
            `and let it complete. If it is still unsealed, check that labs/proxy/config.yaml kept ` +
            `encryption.enabled: true.`,
      ),
    ];
  },
};
