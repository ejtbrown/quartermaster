variable "expected_account_id" {
  type        = string
  description = "Exact development account ID from protected configuration, checked against STS."
  validation {
    condition     = can(regex("^[0-9]{12}$", var.expected_account_id))
    error_message = "Supply a 12-digit expected development account ID."
  }
}

provider "aws" {
  region              = "us-east-2"
  allowed_account_ids = [var.expected_account_id]
  default_tags {
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
}

resource "aws_s3_bucket" "state" {
  bucket        = "quartermaster-dev-tfstate-${var.expected_account_id}-us-east-2"
  force_destroy = false
  lifecycle { prevent_destroy = true }
}

resource "aws_s3_bucket_versioning" "state" {
  bucket = aws_s3_bucket.state.id
  versioning_configuration { status = "Enabled" }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "state" {
  bucket = aws_s3_bucket.state.id
  rule {
    apply_server_side_encryption_by_default { sse_algorithm = "AES256" }
  }
}

resource "aws_s3_bucket_public_access_block" "state" {
  bucket                  = aws_s3_bucket.state.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_policy" "state" {
  bucket = aws_s3_bucket.state.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "DenyInsecureTransport", Effect = "Deny", Principal = "*", Action = "s3:*"
      Resource  = [aws_s3_bucket.state.arn, "${aws_s3_bucket.state.arn}/*"]
      Condition = { Bool = { "aws:SecureTransport" = "false" } }
    }]
  })
}

output "backend_bucket" { value = aws_s3_bucket.state.id }
