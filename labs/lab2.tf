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
#   · one temporalcloud_custom_role granting ONE action — cloud.namespace.get,
#     scoped to YOUR namespace by id. No allow_all, and no account-scoped
#     grant. (The provider requires resource_ids on every permission even when
#     allow_all = true, which is why you may have seen an empty list in
#     examples — you do not need one here.)
#   · one temporalcloud_service_account with account_access = "read" and the
#     custom role attached via account_access_custom_roles (NOT "custom_roles" —
#     that argument does not exist), plus namespace_accesses with permission
#     "write" on your namespace. "write" is what lets a Worker poll task queues
#     and complete Workflow and Activity Tasks.
#   · one temporalcloud_apikey owned by that service account (owner_type =
#     "service-account"), not by you. This is the key you would put in the
#     Worker's environment as TEMPORAL_API_KEY.
#   · one temporalcloud_group and temporalcloud_group_access for your operators
#
# Two traps, and the second one is the point of the session:
#
#   1. Custom Roles are ADDITIVE. They cannot narrow or remove anything a
#      predefined role grants. So "developer + a narrow custom role" grants
#      everything developer does, and the grader fails it. Start at `read`.
#
#   2. `read` is the floor because every principal must carry a predefined
#      role — but the floor is not as low as it sounds. Read-Only already
#      includes GetUsers, GetNamespaces and ListNamespaces across the whole
#      account. You will watch that happen in "Use what you built". Design
#      around where the floor really is, not where you assume it is.
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
# Goes in labs/lab2.tf.
#
# The terraform block, provider and API-key variable already live in labs/ —
# versions.tf and providers.tf. Declaring them again here is a
# duplicate-declaration error, so this file holds resources only.
#
# It references temporalcloud_namespace.lab from lab1.tf. Terraform reads every
# .tf file in the directory as one module, so that works — as long as lab1.tf is
# still there. Do not move Session 1's resources into this file.

# The control-plane access a Worker needs, which is very nearly none.
# A Worker polls a task queue and completes tasks; it never calls the Cloud Ops
# API to do its job. So this grants ONE action, on ONE namespace, by id.
# No allow_all, and no account-scoped grant — a Worker does not enumerate the
# account it runs in.
resource "temporalcloud_custom_role" "worker" {
  name        = "asb-training-taoguo1-training3-worker-role"
  description = "Read one namespace. Nothing else."

  permissions = [
    {
      actions = ["cloud.namespace.get"]
      resources = {
        resource_type = "namespaces"
        resource_ids  = ["asb-training-taoguo1-training3.bvmon"]
        allow_all     = false
      }
    },
  ]
}

resource "temporalcloud_service_account" "worker" {
  name = "asb-training-taoguo1-training3-worker"

  # The FLOOR, not "developer". Every principal must carry a predefined role,
  # and custom roles cannot take permissions away — so whatever you pick here is
  # the minimum this identity will ever have. Read what "read" really covers in
  # the section below before you assume it is tight.
  account_access              = "read"
  account_access_custom_roles = [temporalcloud_custom_role.worker.id]

  # The grant that actually matters. "write" is the namespace permission that
  # lets a Worker poll task queues and complete Workflow and Activity Tasks —
  # and it is scoped per namespace, entirely separately from the account role.
  namespace_accesses = [
    {
      namespace_id = temporalcloud_namespace.lab.id
      permission   = "write"
    }
  ]
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

# The "Use what you built" section needs this key. Terraform will not print a
# sensitive value unless you ask for it by name:
#   terraform output -raw worker_api_key
output "worker_api_key" {
  value     = temporalcloud_apikey.worker.token
  sensitive = true
}
