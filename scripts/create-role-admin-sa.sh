#!/usr/bin/env bash
#
# Creates the shared service account that runs Session 2's Terraform, and prints
# an API key for it to inject into Instruqt.
#
#   TEMPORAL_API_KEY=<account-owner key> ./scripts/create-role-admin-sa.sh
#
# WHY THIS EXISTS
#
# Session 2's lab creates a Custom Role, and custom role administration defaults
# to the Account Owner — a student who is only Global Admin gets PermissionDenied.
# The obvious fix, granting students an account-level custom role, triggers a
# confirmed Cloud bug: a principal holding one LOSES its data-plane access, which
# would break the worker in Sessions 1, 3, 4, 5 and 6 to buy one session.
#
# So the credential is split. The student's own key stays where it is; the
# elevated one arrives under a NAME OF ITS OWN and is used only where Session 2
# needs it:
#
#   TEMPORAL_API_KEY           the student's key   → CLI, Worker, data plane
#   TEMPORAL_CLOUD_API_KEY     the student's key   → Terraform, Labs 1 and 3-6
#   WORKSHOP_ELEVATED_API_KEY  THIS service account → Lab 2's apply only
#
# A distinct name rather than overwriting TEMPORAL_CLOUD_API_KEY, for three
# reasons. Lab 1's namespace stays attributable to the student who created it.
# Elevation becomes an explicit act a student performs rather than an ambient
# condition they never notice. And Session 2 is a lesson about credential
# separation — switching credentials to do the privileged thing demonstrates the
# thing being taught.
#
# The service account absorbs the bug and does not care: it never polls a task
# queue. The student's identity never holds a custom role, so their data plane
# stays intact all day.
#
# TWO WAYS TO SCOPE IT, AND THE DIFFERENCE IS REAL
#
# All six labs share one Terraform directory and one state file, so any
# `terraform apply` covers every resource in it. That leaves two choices:
#
#   Per-invocation   TEMPORAL_CLOUD_API_KEY=$WORKSHOP_ELEVATED_API_KEY terraform apply
#                    Simplest, no HCL. That one run executes as the service
#                    account — including refreshing Lab 1's resources.
#
#   Per-resource     A second provider block with alias = "elevated", and
#                    `provider = temporalcloud.elevated` on the two resources
#                    that need it. Only those run elevated; everything else
#                    stays the student. More faithful, and worth the five
#                    minutes it costs to explain aliases to a platform team.
#
# Both resources need it, not just the role: creating the Worker's service
# account with account_access_custom_roles IS cloud.customrole.assign.
#
# This is a training account where every student is already Global Admin for 48
# hours. Handing them a shared admin-scoped key is not a new exposure there. It
# would be one anywhere else.
set -euo pipefail

SA_NAME="${SA_NAME:-workshop-terraform}"
ROLE_NAME="${ROLE_NAME:-workshop-customrole-admin}"
ROLE_SPEC="${ROLE_SPEC:-scripts/custom-role-delegation.json}"
# Long enough to cover prep, the workshop, and a re-run — short enough that a
# leaked key dies on its own. Override for a longer engagement.
# 30d, not 720h. Same span, but the hours form came back with a server-side
# "Internal desc = internal error"; the documented d/h/m/s examples work.
KEY_DURATION="${KEY_DURATION:-30d}"

# ASCII ONLY in --description. An em dash there returns
#   rpc error: code = Internal desc = internal error
# from CreateApiKey — a server-side failure that names nothing, and costs an
# hour if you assume it is the duration or the service account.

: "${TEMPORAL_API_KEY:?set TEMPORAL_API_KEY to an ACCOUNT OWNER key — Global Admin cannot create custom roles}"
command -v jq > /dev/null || { echo "ERROR: jq is required" >&2; exit 1; }

# --auto-confirm on every call: these commands prompt, and a script whose
# stdin is not a TTY answers nothing and gets "Aborting apply."
api() { temporal cloud "$@" --api-key "$TEMPORAL_API_KEY" --auto-confirm; }

echo "==> Custom role '$ROLE_NAME'"
# apply = create or update, so re-running this script is safe. --idempotent
# because a second run has nothing to change, and the CLI calls that an error.
api custom-role apply --spec "@$ROLE_SPEC" --idempotent > /dev/null
# -o json rather than parsing the table: column layout is not an interface, and
# a role whose name shares a prefix with another would silently pick the wrong id.
ROLE_ID="$(api custom-role list -o json \
    | jq -r --arg n "$ROLE_NAME" 'first(.. | objects | select(.spec.name? == $n) | .id) // empty')"
[ -n "$ROLE_ID" ] || { echo "ERROR: could not find role '$ROLE_NAME' after apply" >&2; exit 1; }
echo "    id $ROLE_ID"

echo "==> Service account '$SA_NAME'"
# --account-role admin, not read: this identity runs the WHOLE of lab 2, which
# creates service accounts, issues API keys and grants namespace access. A read
# floor plus the custom role would only let it manage custom roles.
#
# --idempotent so a second run reports rather than fails.
# Not silenced with 2>&1: --idempotent already covers the re-run case, so
# anything that still fails here is a real error worth reading. A pre-existing
# account with a DIFFERENT spec is one of them, and the id lookup below is what
# decides whether to carry on.
api service-account create \
    --name "$SA_NAME" \
    --account-role admin \
    --custom-role "$ROLE_ID" \
    --description "Runs Session 2 Terraform. Holds the custom-role delegation." \
    --idempotent > /dev/null || echo "    create reported an error — checking for an existing account"

SA_ID="$(api service-account list -o json \
    | jq -r --arg n "$SA_NAME" 'first(.. | objects | select(.spec.name? == $n) | .id) // empty')"
[ -n "$SA_ID" ] || { echo "ERROR: could not find service account '$SA_NAME'" >&2; exit 1; }
echo "    id $SA_ID"

# Re-assert on the reuse path: set-custom-roles REPLACES the list, so this is
# also the repair if someone cleared it by hand.
# --idempotent: on the create path the role is already attached, and without it
# the CLI treats "nothing to change" as an error and kills the script.
api service-account set-custom-roles \
    --service-account-id "$SA_ID" --custom-role "$ROLE_ID" --idempotent > /dev/null
echo "    custom role attached"

echo "==> API key (shown once)"
api apikey create-for-service-account \
    --service-account-id "$SA_ID" \
    --display-name "$SA_NAME" \
    --description "Instruqt WORKSHOP_ELEVATED_API_KEY, Lab 2 only" \
    --expiry-duration "$KEY_DURATION"

cat <<'NEXT'

==> Next

Copy the token above — Temporal shows it once.

  instruqt secrets create WORKSHOP_ELEVATED_API_KEY <token> --team temporal

Reference it from the sandbox preset as a secret, never in `environment:` —
that block is committed to git and printed in Instruqt's debug log.

Export it under its own name. It must NOT overwrite TEMPORAL_API_KEY or
TEMPORAL_CLOUD_API_KEY: both of those stay the student's own key, so Lab 1 is
created by the student and the Worker authenticates as the student.

Lab 2 then elevates for one command:

  TEMPORAL_CLOUD_API_KEY=$WORKSHOP_ELEVATED_API_KEY terraform apply

or, per-resource, with a second provider block:

  provider "temporalcloud" {
    alias   = "elevated"
    api_key = var.elevated_api_key   # from WORKSHOP_ELEVATED_API_KEY
  }

  resource "temporalcloud_custom_role" "worker" {
    provider = temporalcloud.elevated
    ...
  }

  resource "temporalcloud_service_account" "worker" {
    provider = temporalcloud.elevated   # attaching the role is an assign
    ...
  }

Verify before the day, as the service account:

  temporal cloud custom-role list --api-key <token>          # expect: works
  temporal workflow list --namespace <ns> --api-key <token>  # expect: unauthorized

The second failing is the bug doing exactly what it is supposed to do here, to
an identity that never needed the data plane.
NEXT
