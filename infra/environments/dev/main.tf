variable "expected_account_id" {
  type        = string
  description = "Development account ID; supplied privately, never inferred for production."
  validation {
    condition     = can(regex("^[0-9]{12}$", var.expected_account_id))
    error_message = "Supply the exact expected development account ID."
  }
}

variable "alert_email" {
  type        = string
  sensitive   = true
  description = "Confirmed budget and operational alert recipient. A domain alone is not sufficient."
  validation {
    condition     = can(regex("^[^@[:space:]]+@[^@[:space:]]+\\.[^@[:space:]]+$", var.alert_email))
    error_message = "Supply a valid alert recipient before planning a deployment."
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

module "foundation" {
  source              = "../../modules/foundation"
  expected_account_id = var.expected_account_id
  alert_email         = var.alert_email
}

output "database_arn" { value = module.foundation.database_arn }
output "media_bucket" { value = module.foundation.media_bucket }
output "development_domain" { value = "qm.ejtbrown.com" }
output "deployment_scope" { value = "Data/governance foundation only. Edge, identity, API integration, DNS/email, cross-region recovery and CI/CD remain pending." }
