# ============================================================================
# Lab 6 — Troubleshooting Chaos Lab
#
# The drills all happen in the data plane with starter/dotnet. Nothing to
# provision except the record of what you learned.
#
# Write below:
#   · the key(s) below ADDED to the temporalcloud_namespace_tags "lab" block you
#     created in lab1.tf. That resource manages the COMPLETE tag set for the
#     namespace, so declaring a second one here would delete every tag the earlier
#     sessions wrote — and turn their green checkpoints red.
#
# Note the checkpoints grade the RECOVERED state, not the breakage — a completed
# workflow is stable to observe, a stuck one is not. So the grader cannot prove
# you broke anything first. Drill 2 passes even if you never stopped your
# workers. The runbook is the point, not the tick.
# ============================================================================


