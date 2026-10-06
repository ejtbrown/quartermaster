# On-demand operational jobs. No provisioned concurrency, database polling,
# permanent build runner, NAT gateway or recurring keep-alive schedule.
locals {
  media_bucket = "${local.name}-media-${var.expected_account_id}-${local.region}"
  media_arn    = "arn:aws:s3:::${local.media_bucket}"
  worker_arn   = "arn:aws:lambda:${local.region}:${var.expected_account_id}:function:${local.name}-worker"
  operational_environment = var.enable_workspace ? {
    QM_MEDIA_BUCKET       = local.media_bucket
    QM_JOBS_QUEUE         = aws_sqs_queue.jobs[0].url
    QM_JOBS_DLQ_ARN       = aws_sqs_queue.jobs_dlq[0].arn
    QM_SCHEDULE_GROUP     = aws_scheduler_schedule_group.estate[0].name
    QM_SCHEDULER_ROLE_ARN = aws_iam_role.scheduler[0].arn
    QM_WORKER_ARN         = "${local.worker_arn}:live"
    QM_DELETION_TABLE     = "${local.name}-deletions"
    QM_MODEL_ID           = "us.amazon.nova-2-lite-v1:0"
  } : {}
}
resource "aws_sqs_queue" "jobs_dlq" {
  count                     = var.enable_workspace ? 1 : 0
  name                      = "${local.name}-jobs-dlq"
  message_retention_seconds = 1209600
  sqs_managed_sse_enabled   = true
}
resource "aws_sqs_queue" "jobs" {
  count                      = var.enable_workspace ? 1 : 0
  name                       = "${local.name}-jobs"
  visibility_timeout_seconds = 1080
  message_retention_seconds  = 345600
  sqs_managed_sse_enabled    = true
  redrive_policy             = jsonencode({ deadLetterTargetArn = aws_sqs_queue.jobs_dlq[0].arn, maxReceiveCount = 5 })
}
resource "aws_sqs_queue_policy" "uploads" {
  count     = var.enable_workspace ? 1 : 0
  queue_url = aws_sqs_queue.jobs[0].url
  policy    = jsonencode({ Version = "2012-10-17", Statement = [{ Effect = "Allow", Principal = { Service = "s3.amazonaws.com" }, Action = "sqs:SendMessage", Resource = aws_sqs_queue.jobs[0].arn, Condition = { StringEquals = { "aws:SourceAccount" = var.expected_account_id }, ArnEquals = { "aws:SourceArn" = local.media_arn } } }] })
}
resource "aws_s3_bucket_notification" "uploads" {
  count  = var.enable_workspace ? 1 : 0
  bucket = local.media_bucket
  queue {
    queue_arn     = aws_sqs_queue.jobs[0].arn
    events        = ["s3:ObjectCreated:*"]
    filter_prefix = "quarantine/"
  }
  depends_on = [aws_sqs_queue_policy.uploads]
}
resource "aws_scheduler_schedule_group" "estate" {
  count = var.enable_workspace ? 1 : 0
  name  = "${local.name}-estate"
}
resource "aws_iam_role" "scheduler" {
  count              = var.enable_workspace ? 1 : 0
  name               = "${local.name}-scheduler"
  assume_role_policy = jsonencode({ Version = "2012-10-17", Statement = [{ Effect = "Allow", Principal = { Service = "scheduler.amazonaws.com" }, Action = "sts:AssumeRole", Condition = { StringEquals = { "aws:SourceAccount" = var.expected_account_id }, ArnEquals = { "aws:SourceArn" = aws_scheduler_schedule_group.estate[0].arn } } }] })
}
resource "aws_iam_role_policy" "scheduler" {
  count = var.enable_workspace ? 1 : 0
  name  = "invoke-estate-worker-only"
  role  = aws_iam_role.scheduler[0].id
  policy = jsonencode({ Version = "2012-10-17", Statement = [
    { Effect = "Allow", Action = ["lambda:InvokeFunction"], Resource = "${local.worker_arn}:live" },
    { Effect = "Allow", Action = ["sqs:SendMessage"], Resource = aws_sqs_queue.jobs_dlq[0].arn }
  ] })
}
resource "aws_secretsmanager_secret" "worker" {
  count                   = var.enable_workspace ? 1 : 0
  name                    = "${local.name}/database-worker"
  recovery_window_in_days = 30
  lifecycle { prevent_destroy = true }
}
resource "aws_cloudwatch_log_group" "worker" {
  count             = var.enable_workspace ? 1 : 0
  name              = "/aws/lambda/${local.name}-worker"
  retention_in_days = 30
}
resource "aws_iam_role" "worker" {
  count              = var.enable_workspace ? 1 : 0
  name               = "${local.name}-worker"
  assume_role_policy = jsonencode({ Version = "2012-10-17", Statement = [{ Effect = "Allow", Principal = { Service = "lambda.amazonaws.com" }, Action = "sts:AssumeRole" }] })
}
resource "aws_iam_role_policy" "worker" {
  count = var.enable_workspace ? 1 : 0
  name  = "bounded-estate-processing"
  role  = aws_iam_role.worker[0].id
  policy = jsonencode({ Version = "2012-10-17", Statement = [
    { Effect = "Allow", Action = ["logs:CreateLogStream", "logs:PutLogEvents"], Resource = "${aws_cloudwatch_log_group.worker[0].arn}:*" },
    { Effect = "Allow", Action = ["rds-data:BeginTransaction", "rds-data:ExecuteStatement", "rds-data:CommitTransaction", "rds-data:RollbackTransaction"], Resource = "arn:aws:rds:${local.region}:${var.expected_account_id}:cluster:${local.name}" },
    { Effect = "Allow", Action = ["secretsmanager:GetSecretValue"], Resource = aws_secretsmanager_secret.worker[0].arn },
    { Effect = "Allow", Action = ["sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:GetQueueAttributes"], Resource = aws_sqs_queue.jobs[0].arn },
    { Effect = "Allow", Action = ["s3:ListBucketVersions"], Resource = local.media_arn, Condition = { StringLike = { "s3:prefix" = ["quarantine/*", "originals/*", "resized/*", "exports/*"] } } },
    { Effect = "Allow", Action = ["s3:GetObject", "s3:GetObjectVersion", "s3:PutObject", "s3:DeleteObject", "s3:DeleteObjectVersion"], Resource = [for prefix in ["quarantine", "originals", "resized", "exports"] : "${local.media_arn}/${prefix}/*"] },
    { Effect = "Allow", Action = ["dynamodb:PutItem"], Resource = "arn:aws:dynamodb:${local.region}:${var.expected_account_id}:table/${local.name}-deletions" },
    { Effect = "Allow", Action = ["bedrock:InvokeModel"], Resource = concat(["arn:aws:bedrock:${local.region}:${var.expected_account_id}:inference-profile/us.amazon.nova-2-lite-v1:0"], [for region in ["us-east-2", "us-east-1", "us-west-2"] : "arn:aws:bedrock:${region}::foundation-model/amazon.nova-2-lite-v1:0"]) }
  ] })
}
resource "aws_iam_role_policy" "operational_shared" {
  for_each = var.enable_workspace ? { api = aws_iam_role.api.id, worker = aws_iam_role.worker[0].id } : {}
  name     = "one-time-schedules-and-admission-caps"
  role     = each.value
  policy = jsonencode({ Version = "2012-10-17", Statement = [
    { Effect = "Allow", Action = ["scheduler:CreateSchedule"], Resource = "arn:aws:scheduler:${local.region}:${var.expected_account_id}:schedule/${aws_scheduler_schedule_group.estate[0].name}/qm-*" },
    { Effect = "Allow", Action = ["iam:PassRole"], Resource = aws_iam_role.scheduler[0].arn, Condition = { StringEquals = { "iam:PassedToService" = "scheduler.amazonaws.com" } } },
    { Effect = "Allow", Action = ["dynamodb:UpdateItem"], Resource = "arn:aws:dynamodb:${local.region}:${var.expected_account_id}:table/${local.name}-sessions", Condition = { "ForAllValues:StringLike" = { "dynamodb:LeadingKeys" = ["USAGE#*"] } } }
  ] })
}
resource "aws_iam_role_policy" "operational_api" {
  count = var.enable_workspace ? 1 : 0
  name  = "private-media-invitations-and-jobs"
  role  = aws_iam_role.api.id
  policy = jsonencode({ Version = "2012-10-17", Statement = [
    { Effect = "Allow", Action = ["sqs:SendMessage"], Resource = aws_sqs_queue.jobs[0].arn },
    { Effect = "Allow", Action = ["s3:PutObject", "s3:GetObject"], Resource = "${local.media_arn}/quarantine/*" },
    { Effect = "Allow", Action = ["s3:GetObject"], Resource = ["${local.media_arn}/resized/*", "${local.media_arn}/exports/*"] },
    { Effect = "Allow", Action = ["cognito-idp:AdminCreateUser", "cognito-idp:AdminGetUser"], Resource = aws_cognito_user_pool.workspace[0].arn },
    # Streaming speech has no resource-level ARN. Admission is enforced before
    # starting each <=20-second stream; no browser AWS credentials are issued.
    { Effect = "Allow", Action = ["transcribe:StartStreamTranscription"], Resource = "*", Condition = { StringEquals = { "aws:RequestedRegion" = local.region } } }
  ] })
}
resource "aws_lambda_function" "worker" {
  count                          = var.enable_workspace ? 1 : 0
  function_name                  = "${local.name}-worker"
  role                           = aws_iam_role.worker[0].arn
  runtime                        = "nodejs24.x"
  architectures                  = ["arm64"]
  handler                        = "index.handler"
  filename                       = "${path.module}/../../../services/core-api/dist/worker.zip"
  source_code_hash               = filebase64sha256("${path.module}/../../../services/core-api/dist/worker.zip")
  memory_size                    = 1024
  timeout                        = 180
  reserved_concurrent_executions = 2
  publish                        = true
  environment {
    variables = merge(local.operational_environment, {
      QM_WORKER_SECRET_ARN = aws_secretsmanager_secret.worker[0].arn
      QM_DATABASE_ARN      = "arn:aws:rds:${local.region}:${var.expected_account_id}:cluster:${local.name}"
      QM_SESSIONS_TABLE    = "${local.name}-sessions"
    })
  }
  depends_on = [aws_iam_role_policy.worker, aws_iam_role_policy.operational_shared]
  lifecycle {
    prevent_destroy = true
    ignore_changes  = [filename, source_code_hash]
  }
}
resource "aws_lambda_alias" "worker" {
  count            = var.enable_workspace ? 1 : 0
  name             = "live"
  function_name    = aws_lambda_function.worker[0].function_name
  function_version = aws_lambda_function.worker[0].version
  lifecycle { ignore_changes = [function_version] }
}
resource "aws_lambda_event_source_mapping" "jobs" {
  count                   = var.enable_workspace ? 1 : 0
  event_source_arn        = aws_sqs_queue.jobs[0].arn
  function_name           = aws_lambda_alias.worker[0].arn
  batch_size              = 1
  function_response_types = ["ReportBatchItemFailures"]
  scaling_config { maximum_concurrency = 2 }
}
resource "aws_cloudwatch_metric_alarm" "jobs_dlq" {
  count               = var.enable_workspace ? 1 : 0
  alarm_name          = "${local.name}-jobs-dead-letter"
  namespace           = "AWS/SQS"
  metric_name         = "ApproximateNumberOfMessagesVisible"
  dimensions          = { QueueName = aws_sqs_queue.jobs_dlq[0].name }
  statistic           = "Maximum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 0
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = ["arn:aws:sns:${local.region}:${var.expected_account_id}:${local.name}-operations"]
}
output "worker_function" { value = var.enable_workspace ? aws_lambda_function.worker[0].function_name : null }
resource "aws_cloudwatch_log_metric_filter" "failures" {
  for_each       = var.enable_workspace ? { api = aws_cloudwatch_log_group.api.name, worker = aws_cloudwatch_log_group.worker[0].name } : {}
  name           = "${local.name}-${each.key}-failures"
  log_group_name = each.value
  pattern        = each.key == "api" ? "{ $.event = \"request_failed\" }" : "{ $.event = \"job_failed\" }"
  metric_transformation {
    name      = "${each.key}-failures"
    namespace = "Quartermaster/dev"
    value     = "1"
    unit      = "Count"
  }
}
resource "aws_cloudwatch_metric_alarm" "failures" {
  for_each            = var.enable_workspace ? toset(["api", "worker"]) : toset([])
  alarm_name          = "${local.name}-${each.key}-failures"
  namespace           = "Quartermaster/dev"
  metric_name         = "${each.key}-failures"
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 0
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = ["arn:aws:sns:${local.region}:${var.expected_account_id}:${local.name}-operations"]
}
