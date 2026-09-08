variable "expected_account_id" { type = string }
variable "alert_email" {
  type      = string
  sensitive = true
}

locals {
  name = "quartermaster-dev"
  tags = {
    Application = "Quartermaster"
    Environment = "dev"
    Owner       = "ErickBrown"
    CostCenter  = "Quartermaster"
    DataClass   = "restricted"
    ManagedBy   = "Terraform"
    CostScope   = "Quartermaster-dev"
  }
}

resource "aws_vpc" "database" {
  cidr_block           = "10.42.0.0/16"
  enable_dns_support   = true
  enable_dns_hostnames = true
  tags                 = local.tags
}

# Isolated subnets: no gateway, public IP allocation, endpoint fleet, or NAT.
resource "aws_subnet" "database" {
  count                   = 2
  vpc_id                  = aws_vpc.database.id
  cidr_block              = cidrsubnet(aws_vpc.database.cidr_block, 8, count.index)
  availability_zone       = ["us-east-2a", "us-east-2b"][count.index]
  map_public_ip_on_launch = false
  tags                    = local.tags
}

resource "aws_security_group" "database" {
  name        = "${local.name}-database"
  description = "No client ingress; the application uses the RDS Data API."
  vpc_id      = aws_vpc.database.id
  ingress     = []
  egress      = []
  tags        = local.tags
}

resource "aws_db_subnet_group" "database" {
  name       = local.name
  subnet_ids = aws_subnet.database[*].id
  tags       = local.tags
}

resource "aws_rds_cluster_parameter_group" "database" {
  name   = local.name
  family = "aurora-postgresql16"
  parameter {
    name         = "rds.force_ssl"
    value        = "1"
    apply_method = "pending-reboot"
  }
  # On the pinned engine, rds.logical_replication defaults to 0. AWS keeps
  # reporting that value as engine-default even after an explicit write of 0,
  # causing perpetual Terraform drift. Do not add a redundant override or
  # ignore all parameter changes: deployment:check verifies the effective 0,
  # db:smoke checks non-logical WAL, and plan policy rejects nonzero overrides.
  tags = local.tags
}

resource "aws_rds_cluster" "database" {
  cluster_identifier              = local.name
  engine                          = "aurora-postgresql"
  engine_mode                     = "provisioned" # AWS API name; the instance below is Serverless v2.
  engine_version                  = "16.14"
  engine_lifecycle_support        = "open-source-rds-extended-support-disabled"
  database_name                   = "quartermaster"
  master_username                 = "qm_migrator"
  manage_master_user_password     = true
  storage_encrypted               = true
  enable_http_endpoint            = true
  db_subnet_group_name            = aws_db_subnet_group.database.name
  db_cluster_parameter_group_name = aws_rds_cluster_parameter_group.database.name
  vpc_security_group_ids          = [aws_security_group.database.id]
  backup_retention_period         = 7
  copy_tags_to_snapshot           = true
  deletion_protection             = true
  skip_final_snapshot             = false
  final_snapshot_identifier       = "${local.name}-final"
  serverlessv2_scaling_configuration {
    min_capacity             = 0
    max_capacity             = 4
    seconds_until_auto_pause = 300
  }
  tags = local.tags
  lifecycle { prevent_destroy = true }
}

resource "aws_rds_cluster_instance" "writer" {
  identifier                   = "${local.name}-writer"
  cluster_identifier           = aws_rds_cluster.database.id
  instance_class               = "db.serverless"
  engine                       = aws_rds_cluster.database.engine
  engine_version               = aws_rds_cluster.database.engine_version
  publicly_accessible          = false
  auto_minor_version_upgrade   = false
  monitoring_interval          = 0
  performance_insights_enabled = false
  tags                         = local.tags
  lifecycle { prevent_destroy = true }
}

resource "aws_s3_bucket" "media" {
  bucket        = "${local.name}-media-${var.expected_account_id}-us-east-2"
  force_destroy = false
  tags          = local.tags
  lifecycle { prevent_destroy = true }
}

resource "aws_s3_bucket_public_access_block" "media" {
  bucket                  = aws_s3_bucket.media.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_versioning" "media" {
  bucket = aws_s3_bucket.media.id
  versioning_configuration { status = "Enabled" }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "media" {
  bucket = aws_s3_bucket.media.id
  rule {
    apply_server_side_encryption_by_default { sse_algorithm = "AES256" }
  }
}

resource "aws_s3_bucket_policy" "media" {
  bucket = aws_s3_bucket.media.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "DenyInsecureTransport", Effect = "Deny", Principal = "*", Action = "s3:*"
      Resource  = [aws_s3_bucket.media.arn, "${aws_s3_bucket.media.arn}/*"]
      Condition = { Bool = { "aws:SecureTransport" = "false" } }
    }]
  })
}

# Intentional safety gate: metadata/access-deadline policy is testable now;
# physical expiry must wait for version-aware purge workers and backup deletion
# semantics. Resized photos live under resized/, without age-based expiration;
# manual photo, asset, or tenant deletion must purge every version of those too.
resource "aws_s3_bucket_lifecycle_configuration" "media" {
  bucket = aws_s3_bucket.media.id
  rule {
    id     = "originals-15-days-pending-policy-confirmation"
    status = "Disabled"
    filter { prefix = "originals/" }
    expiration { days = 15 }
    noncurrent_version_expiration { noncurrent_days = 15 }
  }
  depends_on = [aws_s3_bucket_versioning.media]
}

resource "aws_dynamodb_table" "sessions" {
  name                        = "${local.name}-sessions"
  billing_mode                = "PAY_PER_REQUEST"
  hash_key                    = "pk"
  range_key                   = "sk"
  deletion_protection_enabled = true
  attribute {
    name = "pk"
    type = "S"
  }
  attribute {
    name = "sk"
    type = "S"
  }
  ttl {
    attribute_name = "expires_at"
    enabled        = true
  }
  server_side_encryption { enabled = true }
  tags = local.tags
}

resource "aws_sns_topic" "operations" {
  name              = "${local.name}-operations"
  kms_master_key_id = "alias/aws/sns"
  tags              = local.tags
}

resource "aws_sns_topic_subscription" "operations" {
  topic_arn = aws_sns_topic.operations.arn
  protocol  = "email"
  endpoint  = var.alert_email
}

resource "aws_budgets_budget" "development" {
  name         = "${local.name}-monthly"
  budget_type  = "COST"
  limit_amount = "100"
  limit_unit   = "USD"
  time_unit    = "MONTHLY"
  cost_filter {
    name   = "TagKeyValue"
    values = ["CostScope$Quartermaster-dev"]
  }
  dynamic "notification" {
    # Budgets supports five notifications: actual 50/80/100, forecast 80/100.
    for_each = { for pair in setproduct([50, 80, 100], ["ACTUAL", "FORECASTED"]) : "${pair[0]}-${pair[1]}" => pair if !(pair[0] == 50 && pair[1] == "FORECASTED") }
    content {
      comparison_operator        = "GREATER_THAN"
      threshold                  = notification.value[0]
      threshold_type             = "PERCENTAGE"
      notification_type          = notification.value[1]
      subscriber_email_addresses = [var.alert_email]
    }
  }
  tags = local.tags
}

output "database_arn" { value = aws_rds_cluster.database.arn }
output "media_bucket" { value = aws_s3_bucket.media.id }
