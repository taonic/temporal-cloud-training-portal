provider "temporalcloud" {
  # No api_key argument on purpose. The provider reads TEMPORAL_CLOUD_API_KEY
  # from the environment, which keeps the key out of this repo entirely — no
  # variable to thread through, no terraform.tfvars to forget to gitignore.
  #
  # Set it once in your shell startup file, alongside the one the CLIs use:
  #
  #   export TEMPORAL_API_KEY=<your key>              # temporal / temporal cloud
  #   export TEMPORAL_CLOUD_API_KEY=$TEMPORAL_API_KEY # this provider
}
