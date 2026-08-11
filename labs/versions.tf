# Pinned deliberately. The Temporal Cloud provider is on 1.x; anything in the
# 0.9 line predates temporalcloud_group, temporalcloud_group_access,
# namespace_scoped_access and temporalcloud_namespace_tags, so Labs 2 to 6
# would fail to plan.
terraform {
  required_version = ">= 1.5"

  required_providers {
    temporalcloud = {
      source  = "temporalio/temporalcloud"
      version = "~> 1.6"
    }
  }
}
