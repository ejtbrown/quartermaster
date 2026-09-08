import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

type Values = Record<string, unknown>;
type Change = {
  address: string;
  type: string;
  mode?: string;
  change: { actions: string[]; after?: Values | null };
};
type Plan = {
  resource_changes?: Change[];
  errored?: boolean;
  complete?: boolean;
};
const allowedTypes = new Set([
  'aws_vpc',
  'aws_subnet',
  'aws_security_group',
  'aws_db_subnet_group',
  'aws_rds_cluster_parameter_group',
  'aws_rds_cluster',
  'aws_rds_cluster_instance',
  'aws_s3_bucket',
  'aws_s3_bucket_versioning',
  'aws_s3_bucket_server_side_encryption_configuration',
  'aws_s3_bucket_public_access_block',
  'aws_s3_bucket_policy',
  'aws_s3_bucket_lifecycle_configuration',
  'aws_dynamodb_table',
  'aws_sns_topic',
  'aws_sns_topic_subscription',
  'aws_budgets_budget',
  'aws_backup_vault',
  'aws_backup_plan',
  'aws_backup_selection',
  'aws_iam_role',
  'aws_iam_role_policy',
  'aws_codeconnections_connection',
  'aws_cloudwatch_log_group',
  'aws_lambda_function',
  'aws_lambda_alias',
  'aws_lambda_function_url',
  'aws_lambda_permission',
  'aws_acm_certificate',
  'aws_acm_certificate_validation',
  'aws_route53_record',
  'aws_wafv2_web_acl',
  'aws_cloudfront_origin_access_control',
  'aws_cloudfront_function',
  'aws_cloudfront_distribution',
  'aws_cloudformation_stack',
  'aws_codebuild_project',
  'aws_codebuild_webhook',
  'aws_codepipeline',
]);
const taggable = new Set([
  'aws_vpc',
  'aws_subnet',
  'aws_security_group',
  'aws_db_subnet_group',
  'aws_rds_cluster_parameter_group',
  'aws_rds_cluster',
  'aws_rds_cluster_instance',
  'aws_s3_bucket',
  'aws_dynamodb_table',
  'aws_sns_topic',
  'aws_budgets_budget',
  'aws_backup_vault',
  'aws_backup_plan',
  'aws_iam_role',
  'aws_codeconnections_connection',
  'aws_cloudwatch_log_group',
  'aws_lambda_function',
  'aws_acm_certificate',
  'aws_wafv2_web_acl',
  'aws_cloudfront_distribution',
  'aws_cloudformation_stack',
  'aws_codebuild_project',
  'aws_codepipeline',
]);
const expectedTags = {
  Application: 'Quartermaster',
  Environment: 'dev',
  Owner: 'ErickBrown',
  CostCenter: 'Quartermaster',
  DataClass: 'restricted',
  ManagedBy: 'Terraform',
  CostScope: 'Quartermaster-dev',
};
function blocks(value: unknown): Values[] {
  return Array.isArray(value) ? (value as Values[]) : [];
}

export function inspectPlan(input: unknown): string[] {
  if (!input || typeof input !== 'object') return ['Invalid Terraform plan'];
  const plan = input as Plan;
  if (
    plan.errored ||
    plan.complete === false ||
    !Array.isArray(plan.resource_changes)
  )
    return [
      'A complete, non-errored Terraform plan with resource_changes is required',
    ];
  const errors: string[] = [];
  for (const resource of plan.resource_changes) {
    if (
      !resource ||
      typeof resource.address !== 'string' ||
      typeof resource.type !== 'string' ||
      !Array.isArray(resource.change?.actions)
    ) {
      errors.push('Malformed resource change');
      continue;
    }
    if (resource.mode === 'data') continue;
    const fail = (message: string) =>
      errors.push(`${resource.address}: ${message}`);
    if (resource.change.actions.includes('delete'))
      fail('Deletion or replacement requires a separately reviewed operation');
    if (!allowedTypes.has(resource.type)) {
      fail(
        'Resource type is not approved for this foundation (warm capacity or scope expansion)',
      );
      continue;
    }
    const value = resource.change.after;
    if (!value) continue;
    if (taggable.has(resource.type)) {
      const tags = value.tags_all ?? value.tags;
      for (const [key, expected] of Object.entries(expectedTags))
        if ((tags as Values | undefined)?.[key] !== expected)
          fail(`Missing or unexpected ${key} tag`);
    }
    switch (resource.type) {
      case 'aws_rds_cluster': {
        const scaling = blocks(value.serverlessv2_scaling_configuration)[0];
        if (
          scaling?.min_capacity !== 0 ||
          scaling?.seconds_until_auto_pause !== 300 ||
          typeof scaling.max_capacity !== 'number' ||
          scaling.max_capacity > 4
        )
          fail(
            'Database must pause at zero with five-minute timeout and dev maximum <=4',
          );
        if (
          value.enable_http_endpoint !== true ||
          value.storage_encrypted !== true ||
          value.deletion_protection !== true ||
          value.manage_master_user_password !== true
        )
          fail(
            'Data API, encryption, deletion protection and managed credentials are required',
          );
        if (
          value.engine !== 'aurora-postgresql' ||
          value.engine_version !== '16.14' ||
          value.engine_lifecycle_support !==
            'open-source-rds-extended-support-disabled'
        )
          fail('Engine/version and extended-support policy require review');
        break;
      }
      case 'aws_rds_cluster_instance':
        if (
          value.instance_class !== 'db.serverless' ||
          value.publicly_accessible !== false
        )
          fail('Only private Serverless v2 instances are approved');
        break;
      case 'aws_rds_cluster_parameter_group':
        if (
          blocks(value.parameter).some(
            (p) => p.name === 'rds.logical_replication' && p.value !== '0',
          )
        )
          fail('Logical replication prevents full database pause');
        break;
      case 'aws_subnet':
        if (value.map_public_ip_on_launch !== false)
          fail('Subnet must not allocate public IPv4');
        break;
      case 'aws_security_group':
        if (!Array.isArray(value.ingress) || value.ingress.length !== 0)
          fail('Data API database group must have no client ingress');
        break;
      case 'aws_dynamodb_table':
        if (
          value.billing_mode !== 'PAY_PER_REQUEST' ||
          value.deletion_protection_enabled !== true
        )
          fail('Sessions require on-demand billing and deletion protection');
        break;
      case 'aws_s3_bucket':
      case 'aws_backup_vault':
        if (value.force_destroy !== false)
          fail('Force destroy must be disabled');
        break;
      case 'aws_s3_bucket_public_access_block':
        if (
          [
            'block_public_acls',
            'block_public_policy',
            'ignore_public_acls',
            'restrict_public_buckets',
          ].some((key) => value[key] !== true)
        )
          fail('All public access blocks are required');
        break;
      case 'aws_s3_bucket_versioning':
        if (blocks(value.versioning_configuration)[0]?.status !== 'Enabled')
          fail('Versioning is required');
        break;
      case 'aws_s3_bucket_lifecycle_configuration':
        if (
          blocks(value.rule).some(
            (rule) =>
              rule.status !== 'Disabled' &&
              !(
                resource.address ===
                  'aws_s3_bucket_lifecycle_configuration.build_artifacts' &&
                rule.id === 'public-build-artifacts-30-days' &&
                blocks(rule.filter)[0]?.prefix === 'quartermaster-dev/' &&
                blocks(rule.expiration)[0]?.days === 30 &&
                blocks(rule.noncurrent_version_expiration)[0]
                  ?.noncurrent_days === 30
              ),
          )
        )
          fail('Destructive content lifecycle awaits policy confirmation');
        break;
      case 'aws_lambda_function':
        if (
          typeof value.reserved_concurrent_executions !== 'number' ||
          value.reserved_concurrent_executions < 1 ||
          value.reserved_concurrent_executions > 5 ||
          Number(value.timeout) > 10 ||
          blocks(value.vpc_config).length
        )
          fail(
            'Delivery Lambdas require bounded concurrency/timeouts and no VPC',
          );
        break;
      case 'aws_lambda_function_url':
        if (value.authorization_type !== 'AWS_IAM')
          fail('Function URL must require CloudFront IAM origin access');
        break;
      case 'aws_cloudfront_origin_access_control':
        if (
          value.signing_behavior !== 'always' ||
          value.signing_protocol !== 'sigv4'
        )
          fail('Origins must always use SigV4');
        break;
      case 'aws_cloudfront_distribution':
        if (
          blocks(value.ordered_cache_behavior).length > 4 ||
          blocks(value.logging_config).length
        )
          fail('Preserve FREE-plan behavior and logging limits');
        if (
          blocks(value.viewer_certificate)[0]?.minimum_protocol_version !==
          'TLSv1.2_2021'
        )
          fail('Modern viewer TLS is required');
        break;
      case 'aws_cloudformation_stack': {
        try {
          const template = JSON.parse(String(value.template_body));
          const resources = Object.values(template.Resources) as Values[];
          if (
            resources.length !== 1 ||
            resources[0]?.Type !== 'AWS::PricingPlanManager::Subscription' ||
            (resources[0]?.Properties as Values)?.PlanTier !== 'FREE' ||
            resources[0]?.DeletionPolicy !== 'Retain'
          )
            fail('Only the retained FREE edge subscription bridge is approved');
        } catch {
          fail('CloudFormation template must be known and reviewable');
        }
        break;
      }
      case 'aws_cloudwatch_log_group':
        if (value.retention_in_days !== 30)
          fail('Delivery system logs require 30-day retention');
        break;
      case 'aws_codebuild_project': {
        const environment = blocks(value.environment)[0];
        if (
          environment?.compute_type !== 'BUILD_GENERAL1_SMALL' ||
          environment?.type !== 'LINUX_CONTAINER' ||
          environment?.privileged_mode !== false ||
          value.concurrent_build_limit !== 1 ||
          Number(value.build_timeout) > 20 ||
          blocks(value.fleet).length ||
          blocks(value.vpc_config).length
        )
          fail(
            'Builds must use bounded, unprivileged on-demand Linux containers',
          );
        break;
      }
      case 'aws_codepipeline':
        if (value.pipeline_type !== 'V2' || value.execution_mode !== 'QUEUED')
          fail('Use V2 pay-per-action serialized releases');
        break;
      case 'aws_budgets_budget':
        if (
          Number(value.limit_amount) !== 100 ||
          value.limit_unit !== 'USD' ||
          value.time_unit !== 'MONTHLY'
        )
          fail('Preserve the $100 monthly development budget');
        break;
      case 'aws_backup_plan':
        if (
          !blocks(value.rule).length ||
          blocks(value.rule).some(
            (rule) =>
              blocks(rule.lifecycle)[0]?.delete_after !== 90 ||
              rule.enable_continuous_backup !== false,
          )
        )
          fail('Use 90-day snapshots, not a 90-day native PITR setting');
        break;
      case 'aws_backup_selection':
        if (
          blocks(value.selection_tag).length > 0 ||
          (Array.isArray(value.resources) &&
            value.resources.some(
              (arn) => typeof arn === 'string' && arn.includes('*'),
            ))
        )
          fail(
            'Back up the exact application cluster, not broad account selections',
          );
        break;
    }
  }
  return errors;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    const input = JSON.parse(
      readFileSync(process.argv[2] ?? 0, 'utf8'),
    ) as unknown;
    const errors = inspectPlan(input);
    if (errors.length) {
      process.stderr.write(errors.join('\n') + '\n');
      process.exitCode = 1;
    } else
      process.stdout.write(
        'Foundation plan guardrails passed. This is not deployment approval or a complete security review.\n',
      );
  } catch {
    process.stderr.write(
      'Could not read a valid Terraform plan JSON document.\n',
    );
    process.exitCode = 1;
  }
}
