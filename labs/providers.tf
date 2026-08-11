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
  # This is YOU. Every resource in every lab file runs as you and is
  # attributable to you — there is one provider here and no second identity.
  #
  # There used to be an aliased "elevated" provider holding a shared service
  # account's key, because Lab 2 created a custom role and custom role
  # administration is an Account Owner permission. Lab 2 now builds a
  # namespace-scoped service account instead, which a Global Admin can create
  # directly, so the second credential is gone. If your sandbox still exports
  # TF_VAR_elevated_api_key, nothing reads it.
}
