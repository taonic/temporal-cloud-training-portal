# ============================================================================
# Lab 2 — AuthN/Z, RBAC & Deployment Patterns
#
# Goal: build the identity your WORKERS run as, instead of the Global Admin you
# are holding right now.
#
# A Worker's job is entirely on the data plane — it polls a task queue and
# completes tasks. It never calls the Cloud Ops API to do that. So the grant
# that matters is the namespace permission, and its account-level access should
# be as close to nothing as the product allows.
#
# Write below:
#   · one temporalcloud_service_account that is NAMESPACE-SCOPED:
#
#       namespace_scoped_access = {
#         namespace_id = temporalcloud_namespace.lab.id
#         permission   = "write"
#       }
#
#     "write" is what lets a Worker poll task queues and complete Workflow and
#     Activity Tasks. This is Temporal's documented recommendation for a
#     Worker's API key.
#   · one temporalcloud_apikey owned by that service account (owner_type =
#     "service-account"), not by you. This is the key you would put in the
#     Worker's environment as TEMPORAL_API_KEY.
#   · one temporalcloud_group and one temporalcloud_group_access for your
#     on-call operators. The group is the identity; the access block is the
#     entitlement. Leave membership empty — that half comes from your IdP.
#
# What you are NOT building, and why it matters:
#
#   · No account_access, account_access_custom_roles or namespace_accesses.
#     The provider rejects all three alongside namespace_scoped_access — add
#     account_access = "read" and `terraform validate` refuses before it makes
#     a single API call. A namespace-scoped service account is the one identity
#     shape with no account-wide access block of its own.
#
#   · No custom role. Creating one is an Account Owner permission that your
#     Global Admin does not have, they are Pre-release and capped at 25 per
#     account, and they are ADDITIVE — a custom role can only ever grant more,
#     never less. There is nothing here for one to add.
#
# Two constraints on this shape, worth knowing before you design on it:
#
#   1. The namespace is IMMUTABLE. Changing it replaces the service account
#      (and therefore its API key). The permission inside it can be changed.
#
#   2. The account role is implicitly `read`, and you cannot set it to none.
#      Read-Only already includes GetUsers, GetNamespaces and ListNamespaces
#      across the WHOLE account. You will watch that happen in "Use what you
#      built" — the floor is not as low as it sounds, and no configuration in
#      this file lowers it.
#
# Everything here runs as you. Global Admin can create service accounts, groups
# and API keys, so there is no second credential anywhere in this lab.
#
# You will need the service account's key in the "Use what you built" section:
#
#   output "worker_api_key" {
#     value     = temporalcloud_apikey.<your_name>.token
#     sensitive = true
#   }
#
# then: terraform output -raw worker_api_key
# ============================================================================

# The identity your Worker runs as. One namespace, one permission, no
# account-wide access block at all.
resource "temporalcloud_service_account" "worker" {
  name        = "asb-training-taoguo1-training3-worker"
  description = "Worker identity for asb-training-taoguo1-training3.bvmon. Namespace-scoped."

  namespace_scoped_access = {
    namespace_id = temporalcloud_namespace.lab.id
    permission   = "write"
  }
}

# Owned by the service account, so it outlives any individual. This is the key
# you would put in the Worker's environment as TEMPORAL_API_KEY.
resource "temporalcloud_apikey" "worker" {
  display_name = "asb-training-taoguo1-training3-worker"
  owner_type   = "service-account"
  owner_id     = temporalcloud_service_account.worker.id
  expiry_time  = "2026-12-31T00:00:00Z"
  disabled     = false
}

# Identity and entitlement, kept apart on purpose: the group below entitles
# nobody until the access block grants it something.
resource "temporalcloud_group" "operators" {
  name = "asb-training-taoguo1-training3-operators"
}

resource "temporalcloud_group_access" "operators" {
  id             = temporalcloud_group.operators.id
  account_access = "read"

  namespace_accesses = [
    {
      namespace_id = temporalcloud_namespace.lab.id
      permission   = "write"
    }
  ]

  # No membership here. Who is in this group arrives from your IdP over SCIM,
  # which is why removing someone in Azure AD removes their Temporal access
  # without anyone touching Terraform.
}

# The "Use what you built" section needs this key. Terraform will not print a
# sensitive value unless you ask for it by name:
#   terraform output -raw worker_api_key
output "worker_api_key" {
  value     = temporalcloud_apikey.worker.token
  sensitive = true
}
