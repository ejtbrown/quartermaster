# One-time bootstrap only. The owner completes the provider authorization in
# the AWS console; no personal GitHub token is copied into Terraform or AWS.
resource "aws_codeconnections_connection" "github" {
  name          = "quartermaster-dev-github"
  provider_type = "GitHub"
  lifecycle { prevent_destroy = true }
}

output "github_connection_arn" { value = aws_codeconnections_connection.github.arn }
