mock_provider "aws" {
  mock_resource "aws_iam_role" {
    defaults = { arn = "arn:aws:iam::111111111111:role/quartermaster-dev-backup" }
  }
  mock_resource "aws_sns_topic" {
    defaults = { arn = "arn:aws:sns:us-east-2:111111111111:quartermaster-dev-operations" }
  }
  mock_resource "aws_rds_cluster" {
    defaults = {
      arn        = "arn:aws:rds:us-east-2:111111111111:cluster:quartermaster-dev"
      kms_key_id = "arn:aws:kms:us-east-2:111111111111:key/11111111-1111-4111-8111-111111111111"
    }
  }
  mock_resource "aws_backup_vault" {
    defaults = { arn = "arn:aws:backup:us-east-2:111111111111:backup-vault:quartermaster-dev-database" }
  }
  mock_resource "aws_s3_bucket" {
    defaults = { arn = "arn:aws:s3:::quartermaster-dev-test" }
  }
}
variables {
  expected_account_id = "111111111111"
  alert_email         = "alerts@example.invalid"
}

run "scale_to_zero_and_private_data" {
  command = plan
  assert {
    condition = (
      aws_rds_cluster.database.serverlessv2_scaling_configuration[0].min_capacity == 0 &&
      aws_rds_cluster.database.serverlessv2_scaling_configuration[0].max_capacity == 4 &&
      aws_rds_cluster.database.serverlessv2_scaling_configuration[0].seconds_until_auto_pause == 300 &&
      aws_rds_cluster.database.enable_http_endpoint &&
      aws_rds_cluster_instance.writer.instance_class == "db.serverless" &&
      !aws_rds_cluster_instance.writer.publicly_accessible
    )
    error_message = "Database must preserve the zero-ACU/Data API/private-network contract."
  }
  assert {
    condition     = aws_s3_bucket_public_access_block.media.block_public_acls && aws_s3_bucket_public_access_block.media.block_public_policy && aws_s3_bucket_public_access_block.media.ignore_public_acls && aws_s3_bucket_public_access_block.media.restrict_public_buckets
    error_message = "Media may never be public."
  }
  assert {
    condition     = aws_dynamodb_table.sessions.billing_mode == "PAY_PER_REQUEST"
    error_message = "Sessions must have no provisioned throughput floor."
  }
}

run "budget_and_retention" {
  # Mock apply resolves generated cluster/key ARNs; never calls real AWS.
  command = apply
  assert {
    condition     = !strcontains(aws_iam_role_policy.backup.policy, "ssm:") && !strcontains(aws_iam_role_policy.backup.policy, "ec2:")
    error_message = "The database backup role must not inherit unrelated compute/command permissions."
  }
  assert {
    condition     = aws_budgets_budget.development.limit_amount == "100" && length(aws_budgets_budget.development.notification) == 5
    error_message = "The development budget and supported notification count must be preserved."
  }
  assert {
    condition     = one(aws_backup_plan.database.rule).lifecycle[0].delete_after == 90 && aws_rds_cluster.database.backup_retention_period == 7
    error_message = "Three-month snapshot retention must not be confused with the shorter native PITR window."
  }
  assert {
    condition     = one(aws_s3_bucket_lifecycle_configuration.media.rule).status == "Disabled" && one(aws_s3_bucket_lifecycle_configuration.media.rule).expiration[0].days == 15 && one(aws_s3_bucket_lifecycle_configuration.media.rule).filter[0].prefix == "originals/"
    error_message = "Keep the disabled 15-day originals intent; resized photos must never inherit age-based expiry."
  }
}
