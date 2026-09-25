locals {
  build_names = {
    checks = "${local.name}-checks"
    build  = "${local.name}-build"
    deploy = "${local.name}-deploy"
  }
  artifact_objects = "${aws_s3_bucket.delivery["artifacts"].arn}/${local.name}/*"
}
resource "aws_cloudwatch_log_group" "build" {
  for_each          = local.build_names
  name              = "/aws/codebuild/${each.value}"
  retention_in_days = 30
}
resource "aws_iam_role" "build" {
  for_each = local.build_names
  name     = each.value
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow", Principal = { Service = "codebuild.amazonaws.com" }, Action = "sts:AssumeRole"
      Condition = { StringEquals = { "aws:SourceAccount" = var.expected_account_id }, ArnEquals = { "aws:SourceArn" = "arn:aws:codebuild:${local.region}:${var.expected_account_id}:project/${each.value}" } }
    }]
  })
}
resource "aws_iam_role_policy" "build_logs" {
  for_each = local.build_names
  name     = "own-logs-only"
  role     = aws_iam_role.build[each.key].id
  policy = jsonencode({
    Version   = "2012-10-17"
    Statement = [{ Effect = "Allow", Action = ["logs:CreateLogStream", "logs:PutLogEvents"], Resource = "${aws_cloudwatch_log_group.build[each.key].arn}:*" }]
  })
}
resource "aws_iam_role_policy" "checks_connection" {
  name = "single-github-connection"
  role = aws_iam_role.build["checks"].id
  policy = jsonencode({
    Version   = "2012-10-17"
    Statement = [{ Effect = "Allow", Action = ["codeconnections:GetConnectionToken", "codeconnections:GetConnection"], Resource = var.github_connection_arn }]
  })
}
resource "aws_iam_role_policy" "build_artifacts" {
  for_each = toset(["build", "deploy"])
  name     = "pipeline-artifacts-only"
  role     = aws_iam_role.build[each.key].id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      { Effect = "Allow", Action = ["s3:GetBucketLocation", "s3:GetBucketVersioning"], Resource = aws_s3_bucket.delivery["artifacts"].arn },
      { Effect = "Allow", Action = each.key == "build" ? ["s3:GetObject", "s3:GetObjectVersion", "s3:PutObject"] : ["s3:GetObject", "s3:GetObjectVersion"], Resource = local.artifact_objects }
    ]
  })
}
resource "aws_iam_role_policy" "deploy" {
  name = "publish-quartermaster-development-only"
  role = aws_iam_role.build["deploy"].id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      { Effect = "Allow", Action = ["s3:PutObject", "s3:GetObject", "s3:GetObjectVersion"], Resource = "${aws_s3_bucket.delivery["web"].arn}/*" },
      { Effect = "Allow", Action = ["s3:ListBucket", "s3:GetBucketLocation"], Resource = aws_s3_bucket.delivery["web"].arn },
      { Effect = "Allow", Action = ["lambda:UpdateFunctionCode", "lambda:GetFunctionConfiguration", "lambda:GetFunction", "lambda:PublishVersion"], Resource = aws_lambda_function.api.arn },
      { Effect = "Allow", Action = ["lambda:GetAlias", "lambda:UpdateAlias"], Resource = "${aws_lambda_function.api.arn}:live" },
      { Effect = "Allow", Action = ["lambda:InvokeFunction"], Resource = "${aws_lambda_function.api.arn}:*" },
      { Effect = "Allow", Action = ["cloudfront:CreateInvalidation", "cloudfront:GetInvalidation", "cloudfront:GetDistribution"], Resource = aws_cloudfront_distribution.site.arn },
      { Effect = "Allow", Action = ["wafv2:GetWebACL"], Resource = aws_wafv2_web_acl.site.arn },
      # ListSubscriptions has no resource-level IAM scope. Read metadata only;
      # the release validator filters the exact distribution and web ACL.
      { Effect = "Allow", Action = ["pricingplanmanager:ListSubscriptions"], Resource = "*" }
    ]
  })
}
resource "aws_codebuild_project" "checks" {
  count                  = var.enable_pipeline ? 1 : 0
  name                   = local.build_names.checks
  description            = "Disposable GitHub checks runner. No deployment, state, database, media or signing access."
  service_role           = aws_iam_role.build["checks"].arn
  build_timeout          = 20
  queued_timeout         = 30
  concurrent_build_limit = 1
  artifacts { type = "NO_ARTIFACTS" }
  environment {
    compute_type                = "BUILD_GENERAL1_SMALL"
    image                       = "aws/codebuild/standard:7.0"
    type                        = "LINUX_CONTAINER"
    image_pull_credentials_type = "CODEBUILD"
    privileged_mode             = false
  }
  source {
    type            = "GITHUB"
    location        = "https://github.com/${local.repository}.git"
    git_clone_depth = 1
    auth {
      type     = "CODECONNECTIONS"
      resource = var.github_connection_arn
    }
  }
  logs_config {
    cloudwatch_logs {
      group_name = aws_cloudwatch_log_group.build["checks"].name
      status     = "ENABLED"
    }
  }
  depends_on = [aws_iam_role_policy.checks_connection, aws_iam_role_policy.build_logs]
}
resource "aws_codebuild_webhook" "checks" {
  count        = var.enable_pipeline ? 1 : 0
  project_name = aws_codebuild_project.checks[0].name
  build_type   = "BUILD"
  filter_group {
    filter {
      type    = "EVENT"
      pattern = "WORKFLOW_JOB_QUEUED"
    }
    filter {
      type    = "WORKFLOW_NAME"
      pattern = "Verify foundation"
    }
  }
}
resource "aws_codebuild_project" "release" {
  for_each               = var.enable_pipeline ? toset(["build", "deploy"]) : toset([])
  name                   = local.build_names[each.key]
  service_role           = aws_iam_role.build[each.key].arn
  build_timeout          = 20
  queued_timeout         = 30
  concurrent_build_limit = 1
  artifacts { type = "CODEPIPELINE" }
  environment {
    compute_type                = "BUILD_GENERAL1_SMALL"
    image                       = "aws/codebuild/standard:7.0"
    type                        = "LINUX_CONTAINER"
    image_pull_credentials_type = "CODEBUILD"
    privileged_mode             = false
    dynamic "environment_variable" {
      for_each = each.key == "deploy" ? {
        QM_EXPECTED_ACCOUNT_ID = var.expected_account_id
        QM_WEB_BUCKET          = aws_s3_bucket.delivery["web"].id
        QM_API_FUNCTION        = aws_lambda_function.api.function_name
        QM_DISTRIBUTION_ID     = aws_cloudfront_distribution.site.id
        QM_PUBLIC_URL          = "https://${local.domain}"
      } : {}
      content {
        name  = environment_variable.key
        value = environment_variable.value
        type  = "PLAINTEXT"
      }
    }
  }
  source {
    type = "CODEPIPELINE"
    buildspec = each.key == "build" ? "buildspec.yml" : yamlencode({
      version = "0.2"
      phases = {
        install = { commands = ["npm install --prefix .local/toolchain --no-save --package-lock=false node@24.20.0"] }
        build = { commands = [
          "export PATH=\"$CODEBUILD_SRC_DIR/.local/toolchain/node_modules/.bin:$PATH\"",
          "node deploy.mjs"
        ] }
      }
    })
  }
  logs_config {
    cloudwatch_logs {
      group_name = aws_cloudwatch_log_group.build[each.key].name
      status     = "ENABLED"
    }
  }
  depends_on = [aws_iam_role_policy.build_logs, aws_iam_role_policy.build_artifacts, aws_iam_role_policy.deploy]
}
resource "aws_iam_role" "pipeline" {
  name = "${local.name}-pipeline"
  assume_role_policy = jsonencode({
    Version   = "2012-10-17"
    Statement = [{ Effect = "Allow", Principal = { Service = "codepipeline.amazonaws.com" }, Action = "sts:AssumeRole" }]
  })
}
resource "aws_iam_role_policy" "pipeline" {
  name = "source-build-and-deploy-projects-only"
  role = aws_iam_role.pipeline.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      { Effect = "Allow", Action = ["codeconnections:UseConnection"], Resource = var.github_connection_arn },
      { Effect = "Allow", Action = ["s3:GetBucketVersioning", "s3:GetBucketLocation"], Resource = aws_s3_bucket.delivery["artifacts"].arn },
      { Effect = "Allow", Action = ["s3:GetObject", "s3:GetObjectVersion", "s3:PutObject"], Resource = local.artifact_objects },
      { Effect = "Allow", Action = ["codebuild:StartBuild", "codebuild:BatchGetBuilds"], Resource = [for key in ["build", "deploy"] : "arn:aws:codebuild:${local.region}:${var.expected_account_id}:project/${local.build_names[key]}"] }
    ]
  })
}
resource "aws_codepipeline" "release" {
  count          = var.enable_pipeline ? 1 : 0
  name           = local.name
  role_arn       = aws_iam_role.pipeline.arn
  pipeline_type  = "V2"
  execution_mode = "QUEUED"
  artifact_store {
    location = aws_s3_bucket.delivery["artifacts"].id
    type     = "S3"
  }
  stage {
    name = "Source"
    action {
      name             = "GitHubDev"
      category         = "Source"
      owner            = "AWS"
      provider         = "CodeStarSourceConnection"
      version          = "1"
      output_artifacts = ["Source"]
      namespace        = "SourceVariables"
      configuration = {
        ConnectionArn        = var.github_connection_arn
        FullRepositoryId     = local.repository
        BranchName           = "dev"
        DetectChanges        = "true"
        OutputArtifactFormat = "CODE_ZIP"
      }
    }
  }
  stage {
    name = "VerifyAndBuild"
    action {
      name             = "BuildTestPackage"
      category         = "Build"
      owner            = "AWS"
      provider         = "CodeBuild"
      version          = "1"
      input_artifacts  = ["Source"]
      output_artifacts = ["Release"]
      configuration = {
        ProjectName          = aws_codebuild_project.release["build"].name
        EnvironmentVariables = jsonencode([{ name = "QM_RELEASE_SHA", value = "#{SourceVariables.CommitId}", type = "PLAINTEXT" }])
      }
    }
  }
  stage {
    name = "DeployDevelopment"
    action {
      name            = "PublishAndSmokeTest"
      category        = "Build"
      owner           = "AWS"
      provider        = "CodeBuild"
      version         = "1"
      input_artifacts = ["Release"]
      configuration = {
        ProjectName          = aws_codebuild_project.release["deploy"].name
        EnvironmentVariables = jsonencode([{ name = "QM_RELEASE_SHA", value = "#{SourceVariables.CommitId}", type = "PLAINTEXT" }])
      }
    }
  }
  depends_on = [aws_iam_role_policy.pipeline]
}
