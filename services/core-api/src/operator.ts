import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { DataApiDatabase } from './database';
import { migrate } from './migrations';
import { integration } from './integration';
import { cloudIntegration } from './cloud-integration';
import { initialCredentialStages } from './credential-stages';
import { Identifier, Capability } from '@quartermaster/contracts';
import { RDSDataClient } from '@aws-sdk/client-rds-data';
import {
  SchedulerClient,
  CreateScheduleCommand,
} from '@aws-sdk/client-scheduler';
import {
  CognitoIdentityProviderClient,
  AdminCreateUserCommand,
  AdminGetUserCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import {
  SecretsManagerClient,
  DescribeSecretCommand,
  GetSecretValueCommand,
  PutSecretValueCommand,
  UpdateSecretVersionStageCommand,
} from '@aws-sdk/client-secrets-manager';

// Operator-only tool. Not part of the Lambda artifact or normal release.
// Every mutation needs a named command and exact development-account confirmation.
const command = process.argv[2];
async function main() {
  if (command === '--help') {
    console.log(
      'Usage: workspace-admin.mjs migrate|credentials|worker-credentials|invite|grant|revoke|check|worker-check|integration|cloud-check',
    );
    return;
  }
  assert.ok(
    [
      'migrate',
      'credentials',
      'worker-credentials',
      'worker-check',
      'invite',
      'grant',
      'revoke',
      'check',
      'integration',
      'cloud-check',
    ].includes(command ?? ''),
    'Usage: workspace-admin.mjs migrate|credentials|grant|revoke|check',
  );
  const account = process.env.QM_EXPECTED_ACCOUNT_ID;
  assert.match(account ?? '', /^\d{12}$/, 'Set QM_EXPECTED_ACCOUNT_ID');
  assert.equal(
    process.env.QM_OPERATOR_CONFIRM,
    `quartermaster-dev:${command}`,
    'Set QM_OPERATOR_CONFIRM to the exact development command',
  );
  const region = 'us-east-2';
  function aws(
    service: string,
    operation: string,
    input: Record<string, unknown> = {},
  ) {
    assert.notEqual(
      service,
      'secretsmanager',
      'Secret operations must use the SDK, never CLI arguments',
    );
    try {
      return JSON.parse(
        execFileSync(
          'aws',
          [
            service,
            operation,
            '--profile',
            'default',
            '--region',
            region,
            '--cli-input-json',
            JSON.stringify(input),
            '--output',
            'json',
            '--no-cli-pager',
          ],
          {
            encoding: 'utf8',
            maxBuffer: 1024 * 1024,
            timeout: 45000,
            stdio: ['pipe', 'pipe', 'pipe'],
          },
        ) || '{}',
      ) as Record<string, unknown>;
    } catch {
      throw new Error(
        `Operator call failed: ${service} ${operation}. No credentials or request data were printed.`,
      );
    }
  }
  const operatorIdentity = aws('sts', 'get-caller-identity');
  assert.equal(operatorIdentity.Account, account, 'Wrong account');
  // Pin SDK calls to the SAME explicit profile checked by the CLI, even when
  // the invoking shell has unrelated AWS_* credentials or region variables.
  const resolvedCredentials = JSON.parse(
    execFileSync(
      'aws',
      [
        'configure',
        'export-credentials',
        '--profile',
        'default',
        '--format',
        'process',
      ],
      {
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 15000,
      },
    ),
  ) as { AccessKeyId: string; SecretAccessKey: string; SessionToken?: string };
  const client = new RDSDataClient({
    region,
    maxAttempts: 1,
    credentials: {
      accessKeyId: resolvedCredentials.AccessKeyId,
      secretAccessKey: resolvedCredentials.SecretAccessKey,
      ...(resolvedCredentials.SessionToken
        ? { sessionToken: resolvedCredentials.SessionToken }
        : {}),
    },
  });
  const secrets = new SecretsManagerClient({
    region,
    maxAttempts: 2,
    credentials: client.config.credentials,
  });
  const scheduleAuditExpiry = async (tenant: string) => {
    const at = new Date();
    at.setUTCFullYear(at.getUTCFullYear() + 1);
    at.setUTCHours(23, 59, 59, 0);
    try {
      await new SchedulerClient({
        region,
        credentials: client.config.credentials,
      }).send(
        new CreateScheduleCommand({
          Name: `qm-owner-${tenant}-${at.toISOString().slice(0, 10)}`,
          GroupName: 'quartermaster-dev-estate',
          ScheduleExpression: `at(${at.toISOString().slice(0, 19)})`,
          ScheduleExpressionTimezone: 'UTC',
          FlexibleTimeWindow: { Mode: 'OFF' },
          ActionAfterCompletion: 'DELETE',
          Target: {
            Arn: `arn:aws:lambda:${region}:${account}:function:quartermaster-dev-worker:live`,
            RoleArn: `arn:aws:iam::${account}:role/quartermaster-dev-scheduler`,
            Input: JSON.stringify({
              tenant,
              kind: 'expiry',
              id: '',
              scheduledAt: at.toISOString(),
            }),
            RetryPolicy: {
              MaximumEventAgeInSeconds: 86400,
              MaximumRetryAttempts: 10,
            },
            DeadLetterConfig: {
              Arn: `arn:aws:sqs:${region}:${account}:quartermaster-dev-jobs-dlq`,
            },
          },
        }),
      );
    } catch (e) {
      if (!(e instanceof Error) || e.name !== 'ConflictException') throw e;
    }
  };
  const cluster = (
    aws('rds', 'describe-db-clusters', {
      DBClusterIdentifier: 'quartermaster-dev',
    }).DBClusters as {
      DBClusterArn: string;
      MasterUserSecret: { SecretArn: string };
    }[]
  )[0]!;
  assert.equal(
    cluster.DBClusterArn,
    `arn:aws:rds:${region}:${account}:cluster:quartermaster-dev`,
  );
  const database = (secretArn: string) =>
    new DataApiDatabase(
      {
        resourceArn: cluster.DBClusterArn,
        secretArn,
        database: 'quartermaster',
      },
      client,
    );
  const master = database(cluster.MasterUserSecret.SecretArn);
  if (command === 'cloud-check') {
    await cloudIntegration(master, client.config.credentials, account!);
    return;
  }
  if (command === 'integration') {
    const secret = await secrets.send(
      new DescribeSecretCommand({
        SecretId: 'quartermaster-dev/database-runtime',
      }),
    );
    await integration(master, database(String(secret.ARN)));
    return;
  }
  if (command === 'migrate') {
    const folder = resolve('db/migrations');
    const names = (await readdir(folder))
      .filter((name) => /^\d{4}_[a-z_]+\.sql$/.test(name))
      .sort();
    const applied = await migrate(
      master,
      await Promise.all(
        names.map(async (name) => ({
          name,
          source: await readFile(resolve(folder, name), 'utf8'),
        })),
      ),
    );
    console.log(JSON.stringify({ applied }));
    return;
  }
  if (command === 'credentials' || command === 'worker-credentials') {
    const worker = command === 'worker-credentials',
      login = worker ? 'qm_worker_runtime' : 'qm_runtime',
      roleName = worker ? 'qm_worker' : 'qm_app',
      secretName = worker ? 'database-worker' : 'database-runtime';
    const configuration = aws('lambda', 'get-function-configuration', {
      FunctionName: 'quartermaster-dev-api',
      Qualifier: 'live',
    });
    const variables = (
      configuration.Environment as
        { Variables?: Record<string, string> } | undefined
    )?.Variables;
    if (!worker)
      assert.notEqual(
        variables?.QM_WORKSPACE_ENABLED,
        'true',
        'Disable the workspace before initializing/rotating credentials',
      );
    const secret = await secrets.send(
      new DescribeSecretCommand({
        SecretId: 'quartermaster-dev/' + secretName,
      }),
    );
    const arn = String(secret.ARN);
    assert.ok(
      arn.startsWith(
        `arn:aws:secretsmanager:${region}:${account}:secret:quartermaster-dev/${secretName}-`,
      ),
    );
    const versions = secret.VersionIdsToStages as
      Record<string, string[]> | undefined;
    const { pending } = initialCredentialStages(versions);
    let password: string, versionId: string;
    if (pending) {
      const value = await secrets.send(
        new GetSecretValueCommand({
          SecretId: arn,
          VersionId: pending,
        }),
      );
      const credentials = JSON.parse(String(value.SecretString)) as {
        username: string;
        password: string;
      };
      assert.equal(credentials.username, login);
      password = credentials.password;
      versionId = pending;
    } else {
      password = randomBytes(48).toString('hex');
      versionId = randomUUID();
      await secrets.send(
        new PutSecretValueCommand({
          SecretId: arn,
          ClientRequestToken: versionId,
          VersionStages: ['AWSPENDING'],
          SecretString: JSON.stringify({ username: login, password }),
        }),
      );
    }
    assert.match(password, /^[0-9a-f]{96}$/);
    await master.transaction(async (sql) => {
      const roles = await sql.query<{
        rolsuper: boolean;
        rolbypassrls: boolean;
        rolcreatedb: boolean;
        rolcreaterole: boolean;
        rolinherit: boolean;
      }>(
        'SELECT rolsuper,rolbypassrls,rolcreatedb,rolcreaterole,rolinherit FROM pg_roles WHERE rolname=$1',
        [login],
      );
      if (!roles.length)
        await sql.query(
          `CREATE ROLE ${login} LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS`,
        );
      else
        assert.deepEqual(
          roles[0],
          {
            rolsuper: false,
            rolbypassrls: false,
            rolcreatedb: false,
            rolcreaterole: false,
            rolinherit: true,
          },
          'Refuse an unexpectedly privileged existing runtime role',
        );
      // Generated hex only; PostgreSQL utility statements cannot bind passwords.
      await sql.query(`ALTER ROLE ${login} PASSWORD '${password}'`);
      await sql.query(`GRANT ${roleName} TO ${login}`);
      await sql.query(
        `ALTER ROLE ${login} SET statement_timeout = ${worker ? 10000 : 4000}`,
      );
      await sql.query(
        `ALTER ROLE ${login} SET idle_in_transaction_session_timeout = ${worker ? 120000 : 30000}`,
      );
    });
    // AWS may automatically label the first newly written version CURRENT.
    // Read back the stage instead of using the pre-write metadata snapshot.
    const afterWrite = initialCredentialStages(
      (await secrets.send(new DescribeSecretCommand({ SecretId: arn })))
        .VersionIdsToStages,
    );
    assert.equal(
      afterWrite.pending,
      versionId,
      'Credential changed during initialization',
    );
    if (afterWrite.current !== versionId)
      await secrets.send(
        new UpdateSecretVersionStageCommand({
          SecretId: arn,
          VersionStage: 'AWSCURRENT',
          MoveToVersionId: versionId,
        }),
      );
    await secrets.send(
      new UpdateSecretVersionStageCommand({
        SecretId: arn,
        VersionStage: 'AWSPENDING',
        RemoveFromVersionId: versionId,
      }),
    );
    console.log(
      'Initialized non-owner runtime credential; no secret value printed.',
    );
    return;
  }
  if (command === 'check' || command === 'worker-check') {
    const worker = command === 'worker-check';
    const secret = await secrets.send(
      new DescribeSecretCommand({
        SecretId: worker
          ? 'quartermaster-dev/database-worker'
          : 'quartermaster-dev/database-runtime',
      }),
    );
    await database(String(secret.ARN)).transaction(async (sql) => {
      const [role] = await sql.query<{
        name: string;
        safe: boolean;
      }>(`SELECT current_user AS name, NOT rolsuper AND NOT rolbypassrls
        AND NOT pg_has_role(current_user,(SELECT relowner FROM pg_class WHERE oid='qm.assets'::regclass),'MEMBER') AS safe FROM pg_roles WHERE rolname=current_user`);
      assert.equal(role?.name, worker ? 'qm_worker_runtime' : 'qm_runtime');
      assert.equal(role.safe, true);
      assert.deepEqual(
        await sql.query('SELECT id FROM qm.assets'),
        [],
        'Unscoped runtime access must return no rows',
      );
      const migrations = await sql.query('SELECT 1 FROM qm.assets LIMIT 1');
      assert.deepEqual(migrations, []);
    });
    console.log(
      'Runtime role and unscoped RLS check passed. This is not an authenticated browser or restore test.',
    );
    return;
  }
  if (command === 'invite') {
    const tenantId = Identifier.parse(process.env.QM_TENANT_ID),
      email = process.env.QM_INVITE_EMAIL,
      name = process.env.QM_TENANT_NAME,
      pool = process.env.QM_USER_POOL_ID;
    assert.equal(
      email,
      'self@ejtbrown.com',
      'Initial owner invitation must match the approved recipient',
    );
    assert.equal(name, 'Quartermaster');
    assert.match(pool ?? '', /^us-east-2_[a-zA-Z0-9]+$/);
    const description = aws('cognito-idp', 'describe-user-pool', {
      UserPoolId: pool,
    });
    assert.equal(
      (description.UserPool as { Name: string }).Name,
      'quartermaster-dev',
    );
    const cognito = new CognitoIdentityProviderClient({
      region,
      credentials: client.config.credentials,
    });
    let subject: string | undefined;
    try {
      const created = await cognito.send(
        new AdminCreateUserCommand({
          UserPoolId: pool,
          Username: email,
          UserAttributes: [
            { Name: 'email', Value: email },
            { Name: 'email_verified', Value: 'true' },
          ],
          DesiredDeliveryMediums: ['EMAIL'],
        }),
      );
      subject = created.User?.Attributes?.find((a) => a.Name === 'sub')?.Value;
    } catch (error) {
      if (!(error instanceof Error) || error.name !== 'UsernameExistsException')
        throw error;
      const existing = await cognito.send(
        new AdminGetUserCommand({ UserPoolId: pool, Username: email }),
      );
      assert.equal(existing.Enabled, true);
      subject = existing.UserAttributes?.find((a) => a.Name === 'sub')?.Value;
    }
    const actorId = Identifier.parse(subject);
    await scheduleAuditExpiry(tenantId);
    await master.transaction(async (sql) => {
      const rows = await sql.query<{
        id: string;
        name: string;
        deleted_at: string | null;
      }>('SELECT id,name,deleted_at FROM qm.tenants WHERE id=$1::uuid', [
        tenantId,
      ]);
      if (rows.length) {
        assert.equal(rows[0]!.name, name);
        assert.equal(rows[0]!.deleted_at, null);
      } else
        await sql.query(
          'INSERT INTO qm.tenants(id,name,synthetic) VALUES($1::uuid,$2,false)',
          [tenantId, name],
        );
      const inserted = await sql.query(
        'INSERT INTO qm.memberships(tenant_id,actor_id,email,capabilities) VALUES($1::uuid,$2::uuid,$3,ARRAY(SELECT jsonb_array_elements_text($4::jsonb))) ON CONFLICT DO NOTHING RETURNING actor_id',
        [tenantId, actorId, email, JSON.stringify(Capability.options)],
      );
      if (inserted.length)
        await sql.query(
          "INSERT INTO qm.audit_events(tenant_id,id,entity_id,operator_id,action,expires_at) VALUES($1::uuid,$2::uuid,$3::uuid,$4,'membership.invited',now()+interval '1 year')",
          [tenantId, randomUUID(), actorId, String(operatorIdentity.UserId)],
        );
      assert.equal(
        (
          await sql.query<{ count: number }>(
            'SELECT count(*)::int AS count FROM qm.assets WHERE tenant_id=$1::uuid',
            [tenantId],
          )
        )[0]!.count,
        0,
        'Initial workspace must be empty',
      );
    });
    console.log(
      JSON.stringify({
        invitationRecipient: email,
        tenantId,
        actorId,
        workspace: name,
        assetCount: 0,
      }),
    );
    return;
  }
  const tenantId = Identifier.parse(process.env.QM_TENANT_ID),
    actorId = Identifier.parse(process.env.QM_ACTOR_ID);
  const pool = process.env.QM_USER_POOL_ID,
    username = process.env.QM_COGNITO_USERNAME;
  assert.match(pool ?? '', /^us-east-2_[a-zA-Z0-9]+$/);
  assert.ok(username, 'Set QM_COGNITO_USERNAME to an existing invited account');
  const poolDetails = aws('cognito-idp', 'describe-user-pool', {
    UserPoolId: pool,
  });
  assert.equal(
    (poolDetails.UserPool as { Name: string }).Name,
    'quartermaster-dev',
    'Use the project development pool',
  );
  const user = aws('cognito-idp', 'admin-get-user', {
    UserPoolId: pool,
    Username: username,
  });
  assert.equal(
    (user.UserAttributes as { Name: string; Value: string }[]).find(
      (a) => a.Name === 'sub',
    )?.Value,
    actorId,
    'Cognito subject does not match',
  );
  await master.transaction(async (sql) => {
    await sql.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
      'estate:' + tenantId,
    ]);
    const recordAccessChange = () =>
      sql.query(
        `INSERT INTO qm.audit_events(tenant_id,id,entity_id,operator_id,action,expires_at)
      VALUES($1::uuid,$2::uuid,$3::uuid,$4,$5,now()+interval '1 year')`,
        [
          tenantId,
          randomUUID(),
          actorId,
          String(operatorIdentity.UserId),
          command === 'grant' ? 'membership.granted' : 'membership.revoked',
        ],
      );
    const [tenant] = await sql.query<{ deleted_at: string | null }>(
      'SELECT deleted_at FROM qm.tenants WHERE id=$1::uuid',
      [tenantId],
    );
    if (command === 'revoke') {
      assert.ok(
        tenant && tenant.deleted_at === null,
        'Workspace must exist and be active',
      );
      const admins = await sql.query<{ actor_id: string }>(
        "SELECT actor_id FROM qm.memberships WHERE tenant_id=$1::uuid AND active AND (expires_at IS NULL OR expires_at>now()) AND 'workspace:admin'=ANY(capabilities)",
        [tenantId],
      );
      assert.ok(
        admins.some((a) => a.actor_id !== actorId),
        'Refuse to revoke the last administrator',
      );
      const changed = await sql.query(
        'UPDATE qm.memberships SET active=false WHERE tenant_id=$1::uuid AND actor_id=$2::uuid RETURNING actor_id',
        [tenantId, actorId],
      );
      assert.equal(changed.length, 1, 'Membership not found');
      await recordAccessChange();
      return;
    }
    assert.equal(user.Enabled, true, 'Identity is disabled');
    if (!tenant) {
      const name = process.env.QM_TENANT_NAME;
      assert.ok(
        name && name.trim().length > 0 && name.length <= 160,
        'Set a workspace name',
      );
      await sql.query(
        'INSERT INTO qm.tenants(id,name,synthetic) VALUES($1::uuid,$2,false)',
        [tenantId, name],
      );
    } else assert.equal(tenant.deleted_at, null, 'Workspace was deleted');
    const capabilities = (process.env.QM_CAPABILITIES ?? 'assets:read')
      .split(',')
      .map((item) => Capability.parse(item));
    assert.ok(capabilities.includes('assets:read'));
    if (!capabilities.includes('workspace:admin'))
      assert.ok(
        (
          await sql.query(
            "SELECT actor_id FROM qm.memberships WHERE tenant_id=$1::uuid AND actor_id<>$2::uuid AND active AND (expires_at IS NULL OR expires_at>now()) AND 'workspace:admin'=ANY(capabilities)",
            [tenantId, actorId],
          )
        ).length,
        'An active administrator is required',
      );
    await sql.query(
      `INSERT INTO qm.memberships(tenant_id,actor_id,capabilities) VALUES($1::uuid,$2::uuid,ARRAY(SELECT jsonb_array_elements_text($3::jsonb)))
      ON CONFLICT(tenant_id,actor_id) DO UPDATE SET capabilities=EXCLUDED.capabilities,active=true,expires_at=NULL`,
      [tenantId, actorId, JSON.stringify(capabilities)],
    );
    await recordAccessChange();
    await scheduleAuditExpiry(tenantId);
  });
  console.log(
    `${command} completed for the specified membership; no identity created or invitation sent.`,
  );
}
main().catch((error: unknown) => {
  if (error instanceof Error)
    console.error(
      JSON.stringify({
        command,
        errorType: error.name,
        sqlState: error.message.match(/SQLState:\s*([A-Z0-9]{5})/)?.[1],
      }),
    );
  console.error(
    'Operator command failed. Check prerequisites and protected inputs; no raw service error or credentials are logged.',
  );
  process.exitCode = 1;
});
