provider "temporalcloud" {
  # No api_key argument on purpose. The provider reads TEMPORAL_CLOUD_API_KEY
  # from the environment, which keeps the key out of this repo entirely — no
  # variable to thread through, no terraform.tfvars to forget to gitignore.
  #
  # Set it once in your shell startup file, alongside the one the CLIs use:
  #
  #   export TEMPORAL_API_KEY=<your key>              # temporal / temporal cloud
  #   export TEMPORAL_CLOUD_API_KEY=$TEMPORAL_API_KEY # this provider
  #
  # This is YOU. Everything you build runs as you and is attributable to you,
  # except the two resources in Lab 2 that name the alias below.
}

# ---------------------------------------------------------------------------
# The elevated identity — Lab 2 only.
#
# Custom role administration defaults to the Account Owner, so a Global Admin
# cannot create one. The workshop cannot simply grant students that permission:
# a principal holding an account-level custom role loses its DATA-PLANE access,
# which would break the Worker in every other session.
#
# So a shared service account holds the delegation, and exactly two resources
# run as it. It never polls a task queue, so losing the data plane costs it
# nothing. Your own identity never holds a custom role and stays intact.
#
# This block DOES take api_key, unlike the one above, because a second provider
# cannot read the same environment variable as the first. The value arrives as
# TF_VAR_elevated_api_key, already exported in your sandbox — still no file.
# ---------------------------------------------------------------------------
variable "elevated_api_key" {
  type        = string
  sensitive   = true
  default     = ""
  description = "Service-account key for Lab 2's custom role. From TF_VAR_elevated_api_key."
}

provider "temporalcloud" {
  alias   = "elevated"
  api_key = var.elevated_api_key
}
