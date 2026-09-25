import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

// Read-only control-plane checks. No SQL, credential retrieval, or keepalive.
const execute = promisify(execFile);
const account = process.env.QM_EXPECTED_ACCOUNT_ID;
const recipient = process.env.QM_ALERT_EMAIL;
assert.match(account ?? '', /^\d{12}$/, 'Set QM_EXPECTED_ACCOUNT_ID privately');
assert.ok(recipient?.includes('@'), 'Set QM_ALERT_EMAIL privately');
const checks = [];
const warnings = [];
async function aws(service, operation, ...args) {
  try {
    const { stdout } = await execute(
      'aws',
      [
        service,
        operation,
        '--profile',
        'default',
        '--region',
        service === 'ce' ? 'us-east-1' : 'us-east-2',
        '--output',
        'json',
        ...args,
      ],
      { maxBuffer: 8 * 1024 * 1024 },
    );
    return JSON.parse(stdout);
  } catch {
    throw new Error(`${service} ${operation} failed; inspect privately`);
  }
}
function check(label, condition) {
  assert.ok(condition, label);
  checks.push(label);
}
check(
  'expected development account',
  (await aws('sts', 'get-caller-identity')).Account === account,
);

const {
  DBClusters: [db],
} = await aws(
  'rds',
  'describe-db-clusters',
  '--db-cluster-identifier',
  'quartermaster-dev',
);
check(
  'Aurora available/backing-up, encrypted, protected, Data API enabled',
  ['available', 'backing-up'].includes(db.Status) &&
    db.StorageEncrypted &&
    db.DeletionProtection &&
    db.HttpEndpointEnabled,
);
check(
  'pinned Aurora PostgreSQL 16.14',
  db.Engine === 'aurora-postgresql' && db.EngineVersion === '16.14',
);
check(
  'zero-to-four ACU with five-minute pause',
  db.ServerlessV2ScalingConfiguration.MinCapacity === 0 &&
    db.ServerlessV2ScalingConfiguration.MaxCapacity === 4 &&
    db.ServerlessV2ScalingConfiguration.SecondsUntilAutoPause === 300,
);
check(
  'active managed migration credential, seven-day PITR',
  db.MasterUserSecret?.SecretStatus === 'active' &&
    db.BackupRetentionPeriod === 7,
);
const { Parameters: parameters } = await aws(
  'rds',
  'describe-db-cluster-parameters',
  '--db-cluster-parameter-group-name',
  db.DBClusterParameterGroup,
);
check(
  'SSL required and logical replication disabled in AWS parameters',
  parameters.some(
    (parameter) =>
      parameter.ParameterName === 'rds.force_ssl' &&
      parameter.ParameterValue === '1',
  ) &&
    parameters.some(
      (parameter) =>
        parameter.ParameterName === 'rds.logical_replication' &&
        parameter.ParameterValue === '0',
    ),
);
check(
  'cluster parameter group is in sync',
  db.DBClusterMembers.every(
    (member) => member.DBClusterParameterGroupStatus === 'in-sync',
  ),
);
const {
  DBInstances: [writer],
} = await aws(
  'rds',
  'describe-db-instances',
  '--db-instance-identifier',
  'quartermaster-dev-writer',
);
check(
  'private serverless writer',
  writer.DBInstanceStatus === 'available' &&
    writer.DBInstanceClass === 'db.serverless' &&
    !writer.PubliclyAccessible,
);
const { SecurityGroups: groups } = await aws(
  'ec2',
  'describe-security-groups',
  '--group-ids',
  ...db.VpcSecurityGroups.map((group) => group.VpcSecurityGroupId),
);
check(
  'database security groups have no ingress or egress',
  groups.every(
    (group) =>
      group.IpPermissions.length === 0 &&
      group.IpPermissionsEgress.length === 0,
  ),
);
const { RouteTables: routes } = await aws(
  'ec2',
  'describe-route-tables',
  '--filters',
  `Name=vpc-id,Values=${writer.DBSubnetGroup.VpcId}`,
);
check(
  'isolated VPC has only local routes',
  routes.every((table) =>
    table.Routes.every((route) => route.GatewayId === 'local'),
  ),
);
for (const kind of ['tfstate', 'media']) {
  const bucket = `quartermaster-dev-${kind}-${account}-us-east-2`;
  const [versioning, publicAccess, encryption, policy] = await Promise.all([
    aws('s3api', 'get-bucket-versioning', '--bucket', bucket),
    aws('s3api', 'get-public-access-block', '--bucket', bucket),
    aws('s3api', 'get-bucket-encryption', '--bucket', bucket),
    aws('s3api', 'get-bucket-policy', '--bucket', bucket),
  ]);
  check(
    `${kind} bucket versioned and private`,
    versioning.Status === 'Enabled' &&
      Object.values(publicAccess.PublicAccessBlockConfiguration).every(
        (value) => value === true,
      ),
  );
  check(
    `${kind} bucket encrypted`,
    encryption.ServerSideEncryptionConfiguration.Rules.some(
      (rule) =>
        rule.ApplyServerSideEncryptionByDefault.SSEAlgorithm === 'AES256',
    ),
  );
  check(
    `${kind} bucket denies insecure transport`,
    JSON.parse(policy.Policy).Statement.some(
      (statement) =>
        statement.Effect === 'Deny' &&
        statement.Principal === '*' &&
        statement.Action === 's3:*' &&
        statement.Condition?.Bool?.['aws:SecureTransport'] === 'false',
    ),
  );
  if (kind === 'media') {
    const lifecycle = await aws(
      's3api',
      'get-bucket-lifecycle-configuration',
      '--bucket',
      bucket,
    );
    check(
      'no active media expiry; original-only 15-day intent',
      lifecycle.Rules.length === 1 &&
        lifecycle.Rules[0].Status === 'Disabled' &&
        lifecycle.Rules[0].Filter.Prefix === 'originals/' &&
        lifecycle.Rules[0].Expiration.Days === 15,
    );
  }
}
const { Table: sessions } = await aws(
  'dynamodb',
  'describe-table',
  '--table-name',
  'quartermaster-dev-sessions',
);
check(
  'sessions on-demand, active, deletion-protected',
  sessions.TableStatus === 'ACTIVE' &&
    sessions.BillingModeSummary.BillingMode === 'PAY_PER_REQUEST' &&
    sessions.DeletionProtectionEnabled,
);
const { Budget: budget } = await aws(
  'budgets',
  'describe-budget',
  '--account-id',
  account,
  '--budget-name',
  'quartermaster-dev-monthly',
);
check(
  '$100 monthly project-filtered budget',
  Number(budget.BudgetLimit.Amount) === 100 &&
    budget.TimeUnit === 'MONTHLY' &&
    budget.CostFilters.TagKeyValue[0] === 'CostScope$Quartermaster-dev',
);
const { Notifications: notifications } = await aws(
  'budgets',
  'describe-notifications-for-budget',
  '--account-id',
  account,
  '--budget-name',
  budget.BudgetName,
);
check(
  'five actual/forecast budget notifications',
  notifications.length === 5 &&
    notifications
      .map((item) => `${item.NotificationType}:${item.Threshold}`)
      .sort()
      .join() ===
      [
        'ACTUAL:50',
        'ACTUAL:80',
        'ACTUAL:100',
        'FORECASTED:80',
        'FORECASTED:100',
      ]
        .sort()
        .join(),
);
for (const notification of notifications) {
  const { Subscribers: subscribers } = await aws(
    'budgets',
    'describe-subscribers-for-notification',
    '--account-id',
    account,
    '--budget-name',
    budget.BudgetName,
    '--notification',
    JSON.stringify(notification),
  );
  check(
    `configured recipient for ${notification.NotificationType} ${notification.Threshold}%`,
    subscribers.length === 1 &&
      subscribers[0].Address === recipient &&
      subscribers[0].SubscriptionType === 'EMAIL',
  );
}
const { Subscriptions: subscriptions } = await aws(
  'sns',
  'list-subscriptions-by-topic',
  '--topic-arn',
  `arn:aws:sns:us-east-2:${account}:quartermaster-dev-operations`,
);
check(
  'operator email subscription exists',
  subscriptions.some(
    (subscription) =>
      subscription.Protocol === 'email' && subscription.Endpoint === recipient,
  ),
);
if (
  subscriptions.some(
    (subscription) => subscription.SubscriptionArn === 'PendingConfirmation',
  )
)
  warnings.push(
    'SNS email confirmation is still required; operational publishers are not yet implemented.',
  );
const { CostAllocationTags: allocationTags } = await aws(
  'ce',
  'list-cost-allocation-tags',
  '--tag-keys',
  'CostScope',
);
if (!allocationTags.some((tag) => tag.Status === 'Active'))
  warnings.push(
    'CostScope is not active for cost allocation yet; budget spend attribution is not ready.',
  );

const { BackupPlansList: plans } = await aws('backup', 'list-backup-plans');
const plan = plans.find(
  (item) => item.BackupPlanName === 'quartermaster-dev-90-days',
);
check('database backup plan exists', Boolean(plan));
const { BackupPlan: backupPlan } = await aws(
  'backup',
  'get-backup-plan',
  '--backup-plan-id',
  plan.BackupPlanId,
);
check(
  '12-hour/seven-day and weekly/90-day database snapshots',
  backupPlan.Rules.length === 2 &&
    [
      ['database-every-12-hours', 'cron(0 0/12 * * ? *)', 7],
      ['database-weekly-90-days', 'cron(0 0 ? * SUN *)', 90],
    ].every(([name, schedule, retention]) =>
      backupPlan.Rules.some(
        (rule) =>
          rule.RuleName === name &&
          rule.ScheduleExpression === schedule &&
          rule.ScheduleExpressionTimezone === 'Etc/UTC' &&
          rule.Lifecycle.DeleteAfterDays === retention &&
          rule.TargetBackupVaultName === 'quartermaster-dev-database' &&
          rule.EnableContinuousBackup === false &&
          rule.StartWindowMinutes === 60 &&
          rule.CompletionWindowMinutes === 180,
      ),
    ),
);
const { BackupSelectionsList: selections } = await aws(
  'backup',
  'list-backup-selections',
  '--backup-plan-id',
  plan.BackupPlanId,
);
check('single backup selection', selections.length === 1);
const { BackupSelection: selection } = await aws(
  'backup',
  'get-backup-selection',
  '--backup-plan-id',
  plan.BackupPlanId,
  '--selection-id',
  selections[0].SelectionId,
);
check(
  'backup selects only the development database',
  selection.Resources.length === 1 &&
    selection.Resources[0] === db.DBClusterArn &&
    selection.IamRoleArn ===
      `arn:aws:iam::${account}:role/quartermaster-dev-backup`,
);
const { AttachedPolicies: attached } = await aws(
  'iam',
  'list-attached-role-policies',
  '--role-name',
  'quartermaster-dev-backup',
);
check('no broad managed policy attached to backup role', attached.length === 0);
const { PolicyDocument: backupPolicy } = await aws(
  'iam',
  'get-role-policy',
  '--role-name',
  'quartermaster-dev-backup',
  '--policy-name',
  'quartermaster-dev-database-snapshots',
);
check(
  'backup role has no compute, command, or restore permissions',
  backupPolicy.Statement.every((statement) =>
    statement.Action.every(
      (action) =>
        /^(rds:|kms:|backup:|tag:)/.test(action) && !action.includes('Restore'),
    ),
  ),
);

process.stdout.write(
  JSON.stringify(
    {
      checkedAt: new Date().toISOString(),
      region: 'us-east-2',
      scope: 'development data/governance foundation only',
      checks,
      warnings,
    },
    null,
    2,
  ) + '\n',
);
