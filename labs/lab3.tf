# ============================================================================
# Lab 3 — Worker Config, Versioning & Bug-fix Rollouts
#
# Nothing to write here. This lab adds no Temporal Cloud resources.
#
# Worker Deployments, versions and task queues have NO control-plane
# representation at all. They exist only inside your namespace, created by a
# worker that sets DeploymentOptions, which is why every checkpoint in this lab
# reads the data plane rather than the Cloud Ops API — and why there is no
# Terraform to write for any of it.
#
# The whole lab runs from labs/worker and the temporal CLI. The exact commands
# are on your session page; the one that gets graded is:
#
#   temporal worker deployment set-current-version \
#     --deployment-name training-workers --build-id 2.0
#
# Starting a v2 worker REGISTERS the version. It does not route anything to it.
# Moving traffic is a separate, deliberate act — that distinction is the lab.
# ============================================================================
