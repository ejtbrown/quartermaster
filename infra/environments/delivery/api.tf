resource "aws_cloudwatch_log_group" "api" {
  name              = "/aws/lambda/${local.name}-api"
  retention_in_days = 30
}
resource "aws_iam_role" "api" {
  name = "${local.name}-api"
  assume_role_policy = jsonencode({
    Version   = "2012-10-17"
    Statement = [{ Effect = "Allow", Principal = { Service = "lambda.amazonaws.com" }, Action = "sts:AssumeRole" }]
  })
}
resource "aws_iam_role_policy" "api" {
  name = "write-own-logs"
  role = aws_iam_role.api.id
  policy = jsonencode({
    Version   = "2012-10-17"
    Statement = [{ Effect = "Allow", Action = ["logs:CreateLogStream", "logs:PutLogEvents"], Resource = "${aws_cloudwatch_log_group.api.arn}:*" }]
  })
}
resource "aws_lambda_function" "api" {
  function_name                  = "${local.name}-api"
  role                           = aws_iam_role.api.arn
  runtime                        = "nodejs24.x"
  architectures                  = ["arm64"]
  handler                        = "index.handler"
  filename                       = "${path.module}/../../../services/core-api/dist/api.zip"
  source_code_hash               = filebase64sha256("${path.module}/../../../services/core-api/dist/api.zip")
  memory_size                    = 128
  timeout                        = 5
  reserved_concurrent_executions = 5
  publish                        = true
  depends_on                     = [aws_iam_role_policy.api]
  lifecycle {
    prevent_destroy = true
    # Terraform bootstraps configuration; CodePipeline exclusively owns releases.
    ignore_changes = [filename, source_code_hash]
  }
}
resource "aws_lambda_alias" "live" {
  name             = "live"
  function_name    = aws_lambda_function.api.function_name
  function_version = aws_lambda_function.api.version
  lifecycle { ignore_changes = [function_version] }
}
resource "aws_lambda_function_url" "api" {
  function_name      = aws_lambda_function.api.function_name
  qualifier          = aws_lambda_alias.live.name
  authorization_type = "AWS_IAM"
}
resource "aws_lambda_permission" "cloudfront_url" {
  statement_id           = "CloudFrontOnlyURL"
  action                 = "lambda:InvokeFunctionUrl"
  function_name          = aws_lambda_function.api.function_name
  qualifier              = aws_lambda_alias.live.name
  principal              = "cloudfront.amazonaws.com"
  source_arn             = aws_cloudfront_distribution.site.arn
  function_url_auth_type = "AWS_IAM"
}
resource "aws_lambda_permission" "cloudfront_invoke" {
  statement_id             = "CloudFrontOnlyInvoke"
  action                   = "lambda:InvokeFunction"
  function_name            = aws_lambda_function.api.function_name
  qualifier                = aws_lambda_alias.live.name
  principal                = "cloudfront.amazonaws.com"
  source_arn               = aws_cloudfront_distribution.site.arn
  invoked_via_function_url = true
}
