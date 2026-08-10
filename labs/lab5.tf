# ============================================================================
# Lab 5 — Observability & Operational Readiness
#
# SDK metrics come from your worker process, not from Temporal Cloud, so this
# session runs entirely on your laptop (starter/observability). There is no
# Cloud resource to create.
#
# Write below:
#   · the key(s) below ADDED to the temporalcloud_namespace_tags "lab" block you
#     created in lab1.tf. That resource manages the COMPLETE tag set for the
#     namespace, so declaring a second one here would delete every tag the earlier
#     sessions wrote — and turn their green checkpoints red.
#
# Do NOT add temporalcloud_metrics_endpoint. It sets a single account-global CA
# for everyone in the account — applying it replaces your instructor's and every
# other student's. This is a good example of a control that is per-account
# rather than per-namespace, and knowing which is which is most of operating a
# shared platform.
# ============================================================================


