# ============================================================================
# Lab 4 — Nexus: calling a service you do not own
#
# Nothing to provision here, and that is the lesson rather than a gap.
#
# The Risk Desk endpoint is your INSTRUCTOR's resource. In Temporal Cloud the
# Nexus Registry is global across the whole account — one namespace for names,
# spanning every namespace in it — and creating an endpoint needs Developer role
# plus Namespace Admin on its TARGET namespace. You are a caller today, not an
# owner, and the control that decides whether you may call lives entirely on
# somebody else's resource.
#
# Do NOT add a temporalcloud_nexus_endpoint here. Endpoint names are unique
# account-wide, so a second "risk-desk" fails to apply — and worse, a
# `terraform destroy` in this directory at the end of the day would take the
# instructor's endpoint with it and end the segment for the whole room.
#
# Nothing to write below either. This lab's artifact is a workflow history, not a
# file: the exit check reads your own namespace for NexusOperationCompleted and
# NexusOperationStarted, so two of the three checkpoints are facts rather than
# claims. The one that is not is the outage: `BackingOff` exists only while it is
# happening, and a recovered history is identical to one that never stalled. That
# checkpoint is attested and the page says so.
# ============================================================================
