mock_provider "aws" {
  mock_data "aws_route53_zone" {
    defaults = { name = "ejtbrown.com.", private_zone = false }
  }
}
mock_provider "aws" { alias = "edge" }
variables {
  expected_account_id   = "111111111111"
  github_connection_arn = "arn:aws:codeconnections:us-east-2:111111111111:connection/test"
  dns_zone_id           = "ZTEST"
}
run "private_bootstrap" {
  command = plan
  assert {
    condition     = !aws_cloudfront_distribution.site.enabled && length(aws_route53_record.site) == 0
    error_message = "Do not publish before standard edge and private-origin checks pass."
  }
  assert {
    condition     = aws_lambda_function_url.api.authorization_type == "AWS_IAM" && aws_lambda_function.api.reserved_concurrent_executions == 5
    error_message = "API must be origin-protected with bounded concurrency."
  }
  assert {
    condition     = length(aws_codepipeline.release) == 0
    error_message = "Pipeline requires the owner's completed connection."
  }
  assert {
    condition     = length(aws_wafv2_web_acl.site.rule) == 1 && one(aws_wafv2_web_acl.site.rule).statement[0].rate_based_statement[0].limit == 300
    error_message = "Preserve the approved one-rule WAF baseline and rate limit."
  }
}
run "pipeline_roles_and_branch" {
  command = plan
  variables { enable_pipeline = true }
  assert {
    condition     = aws_codepipeline.release[0].pipeline_type == "V2" && aws_codepipeline.release[0].execution_mode == "QUEUED"
    error_message = "Use pay-per-action V2 with serialized releases."
  }
  assert {
    condition     = one(aws_codepipeline.release[0].stage[0].action).configuration["BranchName"] == "dev"
    error_message = "This is development only, never main/production."
  }
  assert {
    condition     = !aws_codebuild_project.checks[0].environment[0].privileged_mode && aws_codebuild_project.checks[0].concurrent_build_limit == 1
    error_message = "Checks must remain unprivileged and bounded."
  }
}
run "identity_is_explicit_and_invitation_only" {
  command = plan
  variables { enable_identity = true }
  assert {
    condition     = aws_cognito_user_pool.workspace[0].admin_create_user_config[0].allow_admin_create_user_only && aws_cognito_user_pool.workspace[0].mfa_configuration == "ON" && aws_cognito_user_pool.workspace[0].user_pool_tier == "LITE"
    error_message = "Keep self-signup off and authenticator MFA required without warm infrastructure."
  }
  assert {
    condition     = aws_cognito_user_pool_client.web[0].allowed_oauth_flows == toset(["code"]) && !aws_cognito_user_pool_client.web[0].generate_secret
    error_message = "The BFF uses a public PKCE client, never implicit tokens or a browser client secret."
  }
  assert {
    condition     = length(aws_iam_role_policy.workspace) == 0 && aws_lambda_function.api.environment[0].variables["QM_WORKSPACE_ENABLED"] == "false"
    error_message = "Identity provisioning alone cannot enable asset intake or runtime database permissions."
  }
}
run "workspace_keeps_compute_bounded" {
  command = plan
  variables {
    enable_identity  = true
    enable_workspace = true
  }
  assert {
    condition     = aws_lambda_function.api.timeout == 30 && aws_lambda_function.api.reserved_concurrent_executions == 5 && aws_lambda_function.api.memory_size == 256
    error_message = "Cold resume must stay bounded without provisioned concurrency or VPC infrastructure."
  }
}
