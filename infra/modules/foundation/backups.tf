# Same-region retention only: cross-region copies and media recovery remain
# release gates. This plan alone does NOT meet regional recovery objectives.
resource "aws_backup_vault" "database" {
  name          = "${local.name}-database"
  force_destroy = false
  tags          = local.tags
  lifecycle { prevent_destroy = true }
}

resource "aws_iam_role" "backup" {
  name = "${local.name}-backup"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow", Action = "sts:AssumeRole"
      Principal = { Service = "backup.amazonaws.com" }
    }]
  })
  tags = local.tags
}

# Snapshot-only role, not the multi-service AWS-managed policy (which also
# permits EC2/SSM/EKS mutations). Restore and cross-region copy are not granted.
resource "aws_iam_role_policy" "backup" {
  name = "${local.name}-database-snapshots"
  role = aws_iam_role.backup.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "ReadRegionalDatabaseMetadata", Effect = "Allow"
        Action    = ["rds:DescribeDBClusters", "rds:DescribeDBClusterSnapshots", "rds:DescribeDBInstances", "rds:DescribeDBSnapshots", "rds:DescribeDBClusterAutomatedBackups", "tag:GetResources"]
        Resource  = "*"
        Condition = { StringEquals = { "aws:RequestedRegion" = "us-east-2" } }
      },
      {
        Sid    = "SnapshotQuartermasterOnly", Effect = "Allow"
        Action = ["rds:CreateDBClusterSnapshot", "rds:AddTagsToResource", "rds:ListTagsForResource"]
        Resource = [
          aws_rds_cluster.database.arn,
          "arn:aws:rds:us-east-2:${var.expected_account_id}:cluster-snapshot:awsbackup:*"
        ]
      },
      {
        Sid       = "ExpireQuartermasterSnapshotsOnly", Effect = "Allow"
        Action    = ["rds:DeleteDBClusterSnapshot"]
        Resource  = "arn:aws:rds:us-east-2:${var.expected_account_id}:cluster-snapshot:awsbackup:*"
        Condition = { StringEquals = { "aws:ResourceTag/Application" = "Quartermaster", "aws:ResourceTag/Environment" = "dev" } }
      },
      {
        Sid    = "DescribeDatabaseKey", Effect = "Allow"
        Action = ["kms:DescribeKey"], Resource = aws_rds_cluster.database.kms_key_id
      },
      {
        Sid       = "GrantDatabaseKeyToAWSResource", Effect = "Allow"
        Action    = ["kms:CreateGrant"], Resource = aws_rds_cluster.database.kms_key_id
        Condition = { Bool = { "kms:GrantIsForAWSResource" = "true" } }
      },
      {
        Sid    = "DescribeQuartermasterVault", Effect = "Allow"
        Action = ["backup:DescribeBackupVault"], Resource = aws_backup_vault.database.arn
      },
      {
        Sid      = "TagRegionalRecoveryPoints", Effect = "Allow"
        Action   = ["backup:TagResource"]
        Resource = "arn:aws:backup:us-east-2:${var.expected_account_id}:recovery-point:*"
      }
    ]
  })
}

resource "aws_backup_plan" "database" {
  name = "${local.name}-90-days"
  rule {
    rule_name                    = "database-every-12-hours"
    target_vault_name            = aws_backup_vault.database.name
    schedule                     = "cron(0 0/12 * * ? *)"
    schedule_expression_timezone = "Etc/UTC"
    start_window                 = 60
    completion_window            = 180
    enable_continuous_backup     = false
    lifecycle { delete_after = 90 }
    recovery_point_tags = local.tags
  }
  tags = local.tags
}

resource "aws_backup_selection" "database" {
  name         = "${local.name}-database-only"
  iam_role_arn = aws_iam_role.backup.arn
  plan_id      = aws_backup_plan.database.id
  resources    = [aws_rds_cluster.database.arn]
  depends_on   = [aws_iam_role_policy.backup]
}
