resource "aws_s3_bucket" "delivery" {
  for_each      = toset(["web", "artifacts"])
  bucket        = "${local.name}-${each.key}-${var.expected_account_id}-${local.region}"
  force_destroy = false
  lifecycle { prevent_destroy = true }
}
resource "aws_s3_bucket_versioning" "delivery" {
  for_each = aws_s3_bucket.delivery
  bucket   = each.value.id
  versioning_configuration { status = "Enabled" }
}
resource "aws_s3_bucket_server_side_encryption_configuration" "delivery" {
  for_each = aws_s3_bucket.delivery
  bucket   = each.value.id
  rule {
    apply_server_side_encryption_by_default { sse_algorithm = "AES256" }
  }
}
resource "aws_s3_bucket_public_access_block" "delivery" {
  for_each                = aws_s3_bucket.delivery
  bucket                  = each.value.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}
resource "aws_s3_bucket_policy" "delivery" {
  for_each = aws_s3_bucket.delivery
  bucket   = each.value.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = concat([{
      Sid       = "TLSOnly", Effect = "Deny", Principal = "*", Action = "s3:*"
      Resource  = [each.value.arn, "${each.value.arn}/*"]
      Condition = { Bool = { "aws:SecureTransport" = "false" } }
      }], each.key == "web" ? [{
      Sid       = "CloudFrontOnly", Effect = "Allow", Principal = { Service = "cloudfront.amazonaws.com" }, Action = "s3:GetObject"
      Resource  = "${each.value.arn}/*"
      Condition = { StringEquals = { "AWS:SourceArn" = aws_cloudfront_distribution.site.arn } }
    }] : [])
  })
}

# Build artifacts contain public source/binaries, never tenant data. This is not
# the asset-media bucket: originals/resized photos retain their separate rules.
resource "aws_s3_bucket_lifecycle_configuration" "build_artifacts" {
  bucket = aws_s3_bucket.delivery["artifacts"].id
  rule {
    id     = "public-build-artifacts-30-days"
    status = "Enabled"
    filter { prefix = "quartermaster-dev/" }
    expiration { days = 30 }
    noncurrent_version_expiration { noncurrent_days = 30 }
    abort_incomplete_multipart_upload { days_after_initiation = 1 }
  }
}
