variable "enable_identity" {
  type        = bool
  default     = false
  description = "Provision invitation-only Cognito and an empty runtime secret. Does not create users or tenant memberships."
}
variable "enable_workspace" {
  type        = bool
  default     = false
  description = "Enable only after operator migrations, non-owner credentials and synthetic integration checks pass. Users/memberships are provisioned separately."
  validation {
    condition     = !var.enable_workspace || var.enable_identity
    error_message = "Provision identity before enabling the workspace."
  }
}

resource "aws_cognito_user_pool" "workspace" {
  count                    = var.enable_identity ? 1 : 0
  name                     = local.name
  user_pool_tier           = "LITE"
  deletion_protection      = "ACTIVE"
  username_attributes      = ["email"]
  auto_verified_attributes = ["email"]
  mfa_configuration        = "ON"
  username_configuration { case_sensitive = false }
  admin_create_user_config { allow_admin_create_user_only = true }
  software_token_mfa_configuration { enabled = true }
  password_policy {
    minimum_length                   = 14
    require_lowercase                = true
    require_uppercase                = true
    require_numbers                  = true
    require_symbols                  = true
    temporary_password_validity_days = 3
  }
  account_recovery_setting {
    recovery_mechanism {
      name     = "verified_email"
      priority = 1
    }
  }
  email_configuration { email_sending_account = "COGNITO_DEFAULT" }
  lifecycle { prevent_destroy = true }
}
resource "aws_cognito_user_pool_client" "web" {
  count                                = var.enable_identity ? 1 : 0
  name                                 = "${local.name}-web-bff"
  user_pool_id                         = aws_cognito_user_pool.workspace[0].id
  generate_secret                      = false
  allowed_oauth_flows_user_pool_client = true
  allowed_oauth_flows                  = ["code"]
  allowed_oauth_scopes                 = ["openid", "email"]
  supported_identity_providers         = ["COGNITO"]
  callback_urls                        = ["https://${local.domain}/api/auth/callback"]
  logout_urls                          = ["https://${local.domain}/"]
  prevent_user_existence_errors        = "ENABLED"
  enable_token_revocation              = true
  explicit_auth_flows                  = ["ALLOW_REFRESH_TOKEN_AUTH"]
  access_token_validity                = 1
  id_token_validity                    = 1
  refresh_token_validity               = 1
  token_validity_units {
    access_token  = "hours"
    id_token      = "hours"
    refresh_token = "days"
  }
  lifecycle { prevent_destroy = true }
}
resource "aws_cognito_user_pool_domain" "workspace" {
  count                 = var.enable_identity ? 1 : 0
  domain                = "${local.name}-${var.expected_account_id}"
  user_pool_id          = aws_cognito_user_pool.workspace[0].id
  managed_login_version = 1
}

# Secret value is populated by the operator credential tool, NEVER Terraform,
# a CI variable, browser configuration or the API's managed master secret.
resource "aws_secretsmanager_secret" "runtime" {
  count                   = var.enable_identity ? 1 : 0
  name                    = "${local.name}/database-runtime"
  recovery_window_in_days = 30
  lifecycle { prevent_destroy = true }
}
resource "aws_iam_role_policy" "workspace" {
  count = var.enable_workspace ? 1 : 0
  name  = "synthetic-workspace"
  role  = aws_iam_role.api.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:DeleteItem"]
        Resource = "arn:aws:dynamodb:${local.region}:${var.expected_account_id}:table/${local.name}-sessions"
        Condition = {
          "ForAllValues:StringLike" = { "dynamodb:LeadingKeys" = ["LOGIN#*", "SESSION#*"] }
        }
      },
      {
        Effect   = "Allow"
        Action   = ["rds-data:BeginTransaction", "rds-data:ExecuteStatement", "rds-data:CommitTransaction", "rds-data:RollbackTransaction"]
        Resource = "arn:aws:rds:${local.region}:${var.expected_account_id}:cluster:${local.name}"
      },
      {
        Effect   = "Allow"
        Action   = ["secretsmanager:GetSecretValue"]
        Resource = aws_secretsmanager_secret.runtime[0].arn
      }
    ]
  })
}
output "user_pool_id" { value = var.enable_identity ? aws_cognito_user_pool.workspace[0].id : null }
output "app_client_id" { value = var.enable_identity ? aws_cognito_user_pool_client.web[0].id : null }
output "runtime_secret_arn" { value = var.enable_identity ? aws_secretsmanager_secret.runtime[0].arn : null }
