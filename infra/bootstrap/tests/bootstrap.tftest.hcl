mock_provider "aws" {}
variables { expected_account_id = "111111111111" }

run "state_is_protected" {
  command = plan
  assert {
    condition     = aws_s3_bucket.state.force_destroy == false && aws_s3_bucket_versioning.state.versioning_configuration[0].status == "Enabled"
    error_message = "State must be versioned and must not permit force-destroy."
  }
  assert {
    condition     = aws_s3_bucket_public_access_block.state.block_public_acls && aws_s3_bucket_public_access_block.state.block_public_policy && aws_s3_bucket_public_access_block.state.ignore_public_acls && aws_s3_bucket_public_access_block.state.restrict_public_buckets
    error_message = "State must deny all public access mechanisms."
  }
}

run "account_id_is_required" {
  command = plan
  variables { expected_account_id = "invalid" }
  expect_failures = [var.expected_account_id]
}

run "github_connection_is_project_scoped" {
  command = plan
  assert {
    condition     = aws_codeconnections_connection.github.name == "quartermaster-dev-github" && aws_codeconnections_connection.github.provider_type == "GitHub"
    error_message = "Bootstrap only the named development GitHub connection."
  }
}
