resource "aws_acm_certificate" "site" {
  provider          = aws.edge
  domain_name       = local.domain
  validation_method = "DNS"
  lifecycle { prevent_destroy = true }
}
resource "aws_route53_record" "certificate" {
  for_each = { (local.domain) = one(aws_acm_certificate.site.domain_validation_options) }
  zone_id  = data.aws_route53_zone.parent.zone_id
  name     = each.value.resource_record_name
  type     = each.value.resource_record_type
  records  = [each.value.resource_record_value]
  ttl      = 300
}
resource "aws_acm_certificate_validation" "site" {
  provider                = aws.edge
  certificate_arn         = aws_acm_certificate.site.arn
  validation_record_fqdns = [for record in aws_route53_record.certificate : record.fqdn]
}
resource "aws_wafv2_web_acl" "site" {
  provider = aws.edge
  name     = local.name
  scope    = "CLOUDFRONT"
  default_action {
    allow {}
  }
  rule {
    name     = "PerIPRateLimit"
    priority = 1
    action {
      block {}
    }
    statement {
      rate_based_statement {
        limit                 = 300
        aggregate_key_type    = "IP"
        evaluation_window_sec = 300
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "quartermaster-dev-rate-limit"
      sampled_requests_enabled   = false
    }
  }
  visibility_config {
    cloudwatch_metrics_enabled = true
    metric_name                = local.name
    sampled_requests_enabled   = false
  }
  lifecycle { prevent_destroy = true }
}
data "aws_cloudfront_cache_policy" "static" { name = "Managed-CachingOptimized" }
data "aws_cloudfront_cache_policy" "api" { name = "Managed-CachingDisabled" }
data "aws_cloudfront_origin_request_policy" "api" { name = "Managed-AllViewerExceptHostHeader" }
data "aws_cloudfront_response_headers_policy" "security" { name = "Managed-SecurityHeadersPolicy" }

resource "aws_cloudfront_origin_access_control" "origins" {
  for_each                          = toset(["s3", "lambda"])
  name                              = "${local.name}-${each.key}"
  origin_access_control_origin_type = each.key
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}
resource "aws_cloudfront_function" "navigation" {
  name    = "${local.name}-navigation"
  runtime = "cloudfront-js-2.0"
  publish = true
  code    = file("${path.module}/../../../services/edge/navigation.js")
}
resource "aws_cloudfront_function" "security" {
  name    = "${local.name}-security"
  runtime = "cloudfront-js-2.0"
  publish = true
  code    = file("${path.module}/../../../services/edge/security.js")
}
resource "aws_cloudfront_distribution" "site" {
  enabled             = var.publish_site
  is_ipv6_enabled     = true
  aliases             = [local.domain]
  comment             = "Quartermaster development preview; standard CloudFront and WAF billing"
  default_root_object = "index.html"
  http_version        = "http2and3"
  price_class         = "PriceClass_100"
  web_acl_id          = aws_wafv2_web_acl.site.arn
  wait_for_deployment = true
  origin {
    origin_id                = "web"
    domain_name              = aws_s3_bucket.delivery["web"].bucket_regional_domain_name
    origin_access_control_id = aws_cloudfront_origin_access_control.origins["s3"].id
  }
  origin {
    origin_id                = "api"
    domain_name              = trimsuffix(trimprefix(aws_lambda_function_url.api.function_url, "https://"), "/")
    origin_access_control_id = aws_cloudfront_origin_access_control.origins["lambda"].id
    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "https-only"
      origin_ssl_protocols   = ["TLSv1.2"]
    }
  }
  default_cache_behavior {
    target_origin_id           = "web"
    allowed_methods            = ["GET", "HEAD"]
    cached_methods             = ["GET", "HEAD"]
    viewer_protocol_policy     = "redirect-to-https"
    cache_policy_id            = data.aws_cloudfront_cache_policy.static.id
    response_headers_policy_id = data.aws_cloudfront_response_headers_policy.security.id
    compress                   = true
    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.navigation.arn
    }
    function_association {
      event_type   = "viewer-response"
      function_arn = aws_cloudfront_function.security.arn
    }
  }
  ordered_cache_behavior {
    path_pattern               = "/api/*"
    target_origin_id           = "api"
    allowed_methods            = ["GET", "HEAD", "OPTIONS", "PUT", "PATCH", "POST", "DELETE"]
    cached_methods             = ["GET", "HEAD"]
    viewer_protocol_policy     = "https-only"
    cache_policy_id            = data.aws_cloudfront_cache_policy.api.id
    origin_request_policy_id   = data.aws_cloudfront_origin_request_policy.api.id
    response_headers_policy_id = data.aws_cloudfront_response_headers_policy.security.id
    compress                   = true
  }
  restrictions {
    geo_restriction { restriction_type = "none" }
  }
  viewer_certificate {
    acm_certificate_arn      = aws_acm_certificate_validation.site.certificate_arn
    ssl_support_method       = "sni-only"
    minimum_protocol_version = "TLSv1.2_2021"
  }
  lifecycle { prevent_destroy = true }
}

resource "aws_route53_record" "site" {
  for_each = var.publish_site ? toset(["A", "AAAA"]) : toset([])
  zone_id  = data.aws_route53_zone.parent.zone_id
  name     = local.domain
  type     = each.key
  alias {
    name                   = aws_cloudfront_distribution.site.domain_name
    zone_id                = aws_cloudfront_distribution.site.hosted_zone_id
    evaluate_target_health = false
  }
}
