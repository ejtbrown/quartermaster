import { expect, it } from 'vitest';
import { inspectPlan } from './check-plan';

const tags = {
  Application: 'Quartermaster',
  Environment: 'dev',
  Owner: 'ErickBrown',
  CostCenter: 'Quartermaster',
  DataClass: 'restricted',
  ManagedBy: 'Terraform',
  CostScope: 'Quartermaster-dev',
};
function plan(
  type: string,
  after: Record<string, unknown>,
  actions = ['create'],
) {
  return {
    resource_changes: [
      {
        address: `${type}.test`,
        type,
        change: { actions, after: { tags_all: tags, ...after } },
      },
    ],
  };
}
const database = {
  engine: 'aurora-postgresql',
  engine_version: '16.14',
  engine_lifecycle_support: 'open-source-rds-extended-support-disabled',
  enable_http_endpoint: true,
  storage_encrypted: true,
  deletion_protection: true,
  manage_master_user_password: true,
  serverlessv2_scaling_configuration: [
    { min_capacity: 0, max_capacity: 4, seconds_until_auto_pause: 300 },
  ],
};

const backupRules = [
  {
    rule_name: 'database-every-12-hours',
    schedule: 'cron(0 0/12 * * ? *)',
    lifecycle: [{ delete_after: 7 }],
  },
  {
    rule_name: 'database-weekly-90-days',
    schedule: 'cron(0 0 ? * SUN *)',
    lifecycle: [{ delete_after: 90 }],
  },
].map((rule) => ({
  ...rule,
  target_vault_name: 'quartermaster-dev-database',
  schedule_expression_timezone: 'Etc/UTC',
  start_window: 60,
  completion_window: 180,
  enable_continuous_backup: false,
}));

it('accepts frequent recent backups and weekly historical backups', () => {
  expect(inspectPlan(plan('aws_backup_plan', { rule: backupRules }))).toEqual(
    [],
  );
});
it('rejects missing, duplicate or incorrectly retained backup tiers', () => {
  for (const rules of [
    backupRules.slice(0, 1),
    [backupRules[0], backupRules[0]],
    backupRules.map((rule) => ({ ...rule, lifecycle: [{ delete_after: 90 }] })),
  ]) {
    expect(
      inspectPlan(plan('aws_backup_plan', { rule: rules })).join(),
    ).toContain('12-hour/seven-day');
  }
});
it('rejects forgetting state, including the abandoned edge stack', () => {
  const retained = {
    resource_changes: [
      {
        address: 'aws_cloudformation_stack.edge_free',
        type: 'aws_cloudformation_stack',
        change: {
          actions: ['forget'],
          before: { name: 'quartermaster-dev-edge-free' },
          after: null,
        },
      },
    ],
  };
  expect(inspectPlan(retained).join()).toContain('separately reviewed');
  retained.resource_changes[0]!.address = 'aws_cloudformation_stack.unrelated';
  expect(inspectPlan(retained).join()).toContain('separately reviewed');
});

it('accepts the private zero-minimum database contract', () =>
  expect(inspectPlan(plan('aws_rds_cluster', database))).toEqual([]));
it.each([
  'aws_nat_gateway',
  'aws_lb',
  'aws_eip',
  'aws_db_proxy',
  'aws_opensearch_domain',
  'aws_eks_cluster',
  'aws_elasticache_cluster',
  'aws_bedrock_provisioned_model_throughput',
  'aws_rds_global_cluster',
  'aws_lambda_provisioned_concurrency_config',
  'aws_iam_role_policy_attachment',
])('rejects always-on or out-of-scope %s', (type) =>
  expect(inspectPlan(plan(type, {})).length).toBeGreaterThan(0),
);
it('rejects a nonzero database minimum', () =>
  expect(
    inspectPlan(
      plan('aws_rds_cluster', {
        ...database,
        serverlessv2_scaling_configuration: [
          { min_capacity: 0.5, max_capacity: 4, seconds_until_auto_pause: 300 },
        ],
      }),
    ).join(),
  ).toContain('pause at zero'));
it('fails closed on unknown scale settings', () =>
  expect(
    inspectPlan(
      plan('aws_rds_cluster', {
        ...database,
        serverlessv2_scaling_configuration: [],
      }),
    ).length,
  ).toBeGreaterThan(0));
it('rejects public or provisioned database instances', () =>
  expect(
    inspectPlan(
      plan('aws_rds_cluster_instance', {
        instance_class: 'db.r7g.large',
        publicly_accessible: true,
      }),
    ).length,
  ).toBeGreaterThan(0));
it('rejects replacement even if the new resource is safe', () =>
  expect(
    inspectPlan(plan('aws_rds_cluster', database, ['delete', 'create'])).join(),
  ).toContain('replacement'));
it('rejects missing cost allocation tags', () =>
  expect(
    inspectPlan(
      plan('aws_s3_bucket', { force_destroy: false, tags_all: {} }),
    ).join(),
  ).toContain('Application'));
it('rejects public media', () =>
  expect(
    inspectPlan(
      plan('aws_s3_bucket_public_access_block', {
        block_public_acls: true,
        block_public_policy: false,
        ignore_public_acls: true,
        restrict_public_buckets: true,
      }),
    ).length,
  ).toBeGreaterThan(0));
it('rejects premature content expiry', () =>
  expect(
    inspectPlan(
      plan('aws_s3_bucket_lifecycle_configuration', {
        rule: [{ status: 'Enabled' }],
      }),
    ).length,
  ).toBeGreaterThan(0));
it('rejects budget drift', () =>
  expect(
    inspectPlan(
      plan('aws_budgets_budget', {
        limit_amount: '500',
        limit_unit: 'USD',
        time_unit: 'MONTHLY',
      }),
    ).length,
  ).toBeGreaterThan(0));
it('rejects enabling logical replication over the pinned disabled default', () =>
  expect(
    inspectPlan(
      plan('aws_rds_cluster_parameter_group', {
        parameter: [{ name: 'rds.logical_replication', value: '1' }],
      }),
    ).join(),
  ).toContain('Logical replication'));
it('rejects an anonymously accessible API origin', () =>
  expect(
    inspectPlan(
      plan('aws_lambda_function_url', { authorization_type: 'NONE' }),
    ).join(),
  ).toContain('CloudFront IAM'));
it('rejects a paid or opaque CloudFormation subscription', () => {
  for (const template of [
    undefined,
    JSON.stringify({
      Resources: {
        Plan: {
          Type: 'AWS::PricingPlanManager::Subscription',
          Properties: { PlanTier: 'PRO' },
          DeletionPolicy: 'Retain',
        },
      },
    }),
  ]) {
    expect(
      inspectPlan(plan('aws_cloudformation_stack', { template_body: template }))
        .length,
    ).toBeGreaterThan(0);
  }
});
it('rejects recreating the abandoned FREE subscription bridge', () =>
  expect(
    inspectPlan(
      plan('aws_cloudformation_stack', {
        template_body: JSON.stringify({
          Resources: {
            Plan: {
              Type: 'AWS::PricingPlanManager::Subscription',
              Properties: { PlanTier: 'FREE' },
              DeletionPolicy: 'Retain',
            },
          },
        }),
      }),
    ),
  ).not.toEqual([]));
it('rejects privileged CI and unbounded compute', () =>
  expect(
    inspectPlan(
      plan('aws_codebuild_project', {
        environment: [
          {
            compute_type: 'BUILD_GENERAL1_LARGE',
            type: 'LINUX_CONTAINER',
            privileged_mode: true,
          },
        ],
        concurrent_build_limit: 5,
        build_timeout: 60,
      }),
    ).join(),
  ).toContain('unprivileged'));
it('rejects an unbounded API function', () =>
  expect(
    inspectPlan(
      plan('aws_lambda_function', {
        reserved_concurrent_executions: -1,
        timeout: 60,
      }),
    ).join(),
  ).toContain('bounded'));
it('rejects fixed-price or racing pipeline executions', () =>
  expect(
    inspectPlan(
      plan('aws_codepipeline', {
        pipeline_type: 'V1',
        execution_mode: 'PARALLEL',
      }),
    ).join(),
  ).toContain('serialized'));
it('rejects shorter snapshots and impossible extended PITR', () =>
  expect(
    inspectPlan(
      plan('aws_backup_plan', {
        rule: [
          { enable_continuous_backup: true, lifecycle: [{ delete_after: 7 }] },
        ],
      }),
    ).length,
  ).toBeGreaterThan(0));
it.each([
  null,
  {},
  { errored: true },
  { complete: false, resource_changes: [] },
])('rejects incomplete or malformed plan %#', (input) =>
  expect(inspectPlan(input).length).toBeGreaterThan(0),
);
