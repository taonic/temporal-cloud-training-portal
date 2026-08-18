# ============================================================================
# Lab 3 — Observability & Operational Readiness
#
# Two metric sources, and only one of them has anything to provision.
#
#   SDK metrics come from your worker process. Nothing to create — you pass
#   --metrics-port and the worker opens a socket.
#
#   Temporal Cloud metrics come from the service, over an authenticated HTTPS
#   endpoint. That needs an identity, and building it is the Terraform half of
#   this lab.
#
# Write below:
#   · one temporalcloud_service_account with account_access = "metricsread".
#     This is the ONLY account role in the product whose whole purpose is to be
#     read by a machine, and it is worth reading the permissions table to see
#     how little it carries. Use the exact name shown on your session page.
#   · one temporalcloud_apikey owned by it — owner_type = "service-account".
#     The scraper runs unattended for months; a key owned by a person dies with
#     the person.
#   · an output for the key, marked sensitive, so you can get it into
#     labs/observability/cloud-api-key without it landing in a config file.
#
# Nothing else. There is no tag to write in this lab: the dashboard and the alert
# catalogue live in your sandbox, and the checkpoints grade the scraper's IDENTITY
# — which is control-plane state — rather than a claim that you built one.
#
# Note what "metricsread" is NOT. It is an ACCOUNT role: it reads metrics for
# every namespace in bvmon, not just yours. There is no namespace-scoped form of
# it, which is why the filtering that keeps you out of your colleagues' data is
# a query parameter on the scrape URL rather than a permission — a control you
# can forget, rather than one the platform enforces. Session 2 built the
# opposite shape on purpose; hold the two next to each other.
#
# Do NOT add temporalcloud_metrics_endpoint. That is the OLD, mTLS-based metrics
# endpoint, and it sets a single account-global CA for everyone in the account —
# applying it replaces your instructor's and every other student's. The
# OpenMetrics endpoint you are wiring up today needs no such thing, which is
# most of why it exists. Both controls are per-account rather than per-namespace,
# and knowing which is which is most of operating a shared platform.
#
# One more account-global thing you cannot see in Terraform at all: the endpoint
# allows 180 requests per hour PER ACCOUNT, shared by everyone in this room.
# labs/observability/prometheus.yml does the arithmetic.
# ============================================================================
