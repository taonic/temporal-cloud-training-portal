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
