# CloudWatch cannot publish to SNS encrypted with alias/aws/sns. Use a narrowly
# scoped customer key so the operational alarms are both encrypted and usable.
resource "aws_kms_key" "operations" {
  description             = "Quartermaster development operational alert encryption"
  deletion_window_in_days = 30
  enable_key_rotation     = true
  policy = jsonencode({ Version = "2012-10-17", Statement = [
    { Sid = "AccountAdministration", Effect = "Allow", Principal = { AWS = "arn:aws:iam::${var.expected_account_id}:root" }, Action = "kms:*", Resource = "*" },
    { Sid = "ProjectAlarms", Effect = "Allow", Principal = { Service = "cloudwatch.amazonaws.com" }, Action = ["kms:GenerateDataKey*", "kms:Decrypt"], Resource = "*", Condition = { StringEquals = { "aws:SourceAccount" = var.expected_account_id }, ArnLike = { "aws:SourceArn" = "arn:aws:cloudwatch:us-east-2:${var.expected_account_id}:alarm:${local.name}-*" } } }
  ] })
  tags = local.tags
  lifecycle { prevent_destroy = true }
}
resource "aws_kms_alias" "operations" {
  name          = "alias/${local.name}-operations"
  target_key_id = aws_kms_key.operations.key_id
}
resource "aws_sns_topic_policy" "operations" {
  arn = aws_sns_topic.operations.arn
  policy = jsonencode({ Version = "2012-10-17", Statement = [
    { Sid = "AccountAdministration", Effect = "Allow", Principal = { AWS = "arn:aws:iam::${var.expected_account_id}:root" }, Action = ["SNS:GetTopicAttributes", "SNS:SetTopicAttributes", "SNS:AddPermission", "SNS:RemovePermission", "SNS:DeleteTopic", "SNS:Subscribe", "SNS:ListSubscriptionsByTopic", "SNS:Publish"], Resource = aws_sns_topic.operations.arn },
    { Sid = "ProjectAlarms", Effect = "Allow", Principal = { Service = "cloudwatch.amazonaws.com" }, Action = "SNS:Publish", Resource = aws_sns_topic.operations.arn, Condition = { StringEquals = { "aws:SourceAccount" = var.expected_account_id }, ArnLike = { "aws:SourceArn" = "arn:aws:cloudwatch:us-east-2:${var.expected_account_id}:alarm:${local.name}-*" } } }
  ] })
}
resource "aws_cloudwatch_metric_alarm" "backup_failed" {
  alarm_name          = "${local.name}-backup-failed"
  namespace           = "AWS/Backup"
  metric_name         = "NumberOfBackupJobsFailed"
  dimensions          = { BackupVaultName = aws_backup_vault.database.name }
  statistic           = "Maximum"
  period              = 3600
  evaluation_periods  = 1
  threshold           = 0
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.operations.arn]
  tags                = local.tags
}
