# ============================================================================
# Lab 1 — Foundations & Control Plane
#
# Goal: provision your own namespace with Terraform rather than by clicking.
#
# Write below:
#   · one temporalcloud_namespace, using the exact name shown on your session
#     page (names are unique per account and reserved after deletion, so a typo
#     costs you the name for the rest of the workshop)
#   · api_key_auth = true — every later session connects with an API key, and a
#     namespace created without it cannot be switched over afterwards
#   · retention_days = 7, and the region the exit check names
#   · THE temporalcloud_namespace_tags block for the whole workshop, tagging
#     provisioner = "terraform". Every later session adds a key to this one block;
#     the resource manages the complete tag set, so a second one would wipe it.
#
# The grader checks: the namespace exists, its region, retention = 7, and the
# provisioner tag. It cannot tell Terraform from a UI click — nothing in the API
# records that — so the tag is a label you apply, not proof. Only set it if it
# is true. Every later session records its artifacts as tags the same way.
#
# The full configuration is on your session page, personalised with your name.
# ============================================================================
