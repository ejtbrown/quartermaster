variable "expected_account_id" {
  type = string
  validation {
    condition     = can(regex("^[0-9]{12}$", var.expected_account_id))
    error_message = "Supply the exact development account ID privately."
  }
}

variable "github_connection_arn" {
  type = string
  validation {
    condition     = startswith(var.github_connection_arn, "arn:aws:codeconnections:us-east-2:${var.expected_account_id}:connection/")
    error_message = "Use the development account's Ohio GitHub connection."
  }
}

variable "dns_zone_id" { type = string }
variable "enable_pipeline" {
  type        = bool
  default     = false
  description = "Enable after the owner completes the GitHub connection handshake."
}
variable "publish_site" {
  type        = bool
  default     = false
  description = "Enable only after the associated CloudFront FREE subscription is verified ACTIVE."
}

locals {
  name       = "quartermaster-dev"
  region     = "us-east-2"
  domain     = "qm.ejtbrown.com"
  repository = "ejtbrown/quartermaster"
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

provider "aws" {
  region              = local.region
  allowed_account_ids = [var.expected_account_id]
  default_tags { tags = local.tags }
}
provider "aws" {
  alias               = "edge"
  region              = "us-east-1"
  allowed_account_ids = [var.expected_account_id]
  default_tags { tags = local.tags }
}

data "aws_route53_zone" "parent" {
  zone_id      = var.dns_zone_id
  private_zone = false
  lifecycle {
    postcondition {
      condition     = trimsuffix(self.name, ".") == "ejtbrown.com" && !self.private_zone
      error_message = "Only the existing public ejtbrown.com zone is in scope."
    }
  }
}

output "website_url" { value = "https://${local.domain}" }
output "distribution_id" { value = aws_cloudfront_distribution.site.id }
output "distribution_domain" { value = aws_cloudfront_distribution.site.domain_name }
output "free_plan_stack" { value = aws_cloudformation_stack.edge_free.name }
output "web_bucket" { value = aws_s3_bucket.delivery["web"].id }
output "api_function" { value = aws_lambda_function.api.function_name }
output "api_origin_url" { value = aws_lambda_function_url.api.function_url }
output "pipeline_name" { value = var.enable_pipeline ? aws_codepipeline.release[0].name : null }
output "scope" { value = "Synthetic web preview and health-only API; real asset intake and AI remain disabled." }
