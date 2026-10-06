import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { RDSDataClient } from '@aws-sdk/client-rds-data';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand } from '@aws-sdk/lib-dynamodb';
import {
  S3Client,
  ListObjectVersionsCommand,
  DeleteObjectsCommand,
  GetPublicAccessBlockCommand,
} from '@aws-sdk/client-s3';
import { DataApiDatabase } from './database';
import { Tombstone, replayDeletions } from './restore-ledger';
async function main() {
  if (process.argv[2] === '--help') {
    console.log(
      'Isolated restore deletion replay. Requires QM_EXPECTED_ACCOUNT_ID, QM_RESTORE_CLUSTER, QM_RESTORE_MEDIA_BUCKET and QM_RESTORE_CONFIRM=isolated:<cluster>. Never points public traffic at the restore.',
    );
    return;
  }
  const account = process.env.QM_EXPECTED_ACCOUNT_ID,
    cluster = process.env.QM_RESTORE_CLUSTER,
    bucket = process.env.QM_RESTORE_MEDIA_BUCKET,
    region = 'us-east-2';
  assert.match(account ?? '', /^\d{12}$/);
  assert.match(cluster ?? '', /^quartermaster-dev-restore-[a-z0-9-]+$/);
  assert.match(
    bucket ?? '',
    new RegExp(`^quartermaster-dev-restore-[a-z0-9-]+-${account}-us-east-2$`),
  );
  assert.equal(process.env.QM_RESTORE_CONFIRM, 'isolated:' + cluster);
  function aws(service: string, operation: string, input: unknown = {}) {
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
        { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] },
      ),
    );
  }
  assert.equal(aws('sts', 'get-caller-identity').Account, account);
  const details = aws('rds', 'describe-db-clusters', {
    DBClusterIdentifier: cluster,
  }).DBClusters[0];
  assert.equal(details.DBClusterIdentifier, cluster);
  assert.equal(details.Status, 'available');
  assert.equal(details.HttpEndpointEnabled, true);
  assert.ok(
    details.MasterUserSecret?.SecretArn,
    'Restore must have a managed migration-owner credential',
  );
  for (const name of ['quartermaster-dev-api', 'quartermaster-dev-worker']) {
    const live = aws('lambda', 'get-function-configuration', {
      FunctionName: name,
      Qualifier: 'live',
    });
    assert.notEqual(
      live.Environment?.Variables?.QM_DATABASE_ARN,
      details.DBClusterArn,
      'Refuse to replay against a live cluster',
    );
  }
  const instances = aws('rds', 'describe-db-instances', {
    Filters: [{ Name: 'db-cluster-id', Values: [cluster] }],
  }).DBInstances;
  assert.ok(instances.length > 0);
  assert.ok(
    instances.every(
      (v: { PubliclyAccessible: boolean }) => v.PubliclyAccessible === false,
    ),
    'Restore must be private',
  );
  const source = JSON.parse(
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
      { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] },
    ),
  );
  const credentials = {
    accessKeyId: source.AccessKeyId,
    secretAccessKey: source.SecretAccessKey,
    ...(source.SessionToken ? { sessionToken: source.SessionToken } : {}),
  };
  const configuration = { region, credentials, maxAttempts: 2 };
  const s3 = new S3Client(configuration),
    dynamo = DynamoDBDocumentClient.from(new DynamoDBClient(configuration));
  const access = (
    await s3.send(new GetPublicAccessBlockCommand({ Bucket: bucket }))
  ).PublicAccessBlockConfiguration;
  assert.ok(
    access &&
      Object.values(access).length === 4 &&
      Object.values(access).every((v) => v === true),
    'Restore media must block all public access',
  );
  const rows: Tombstone[] = [];
  let start: Record<string, unknown> | undefined;
  do {
    const result = await dynamo.send(
      new ScanCommand({
        TableName: 'quartermaster-dev-deletions',
        ConsistentRead: true,
        ...(start ? { ExclusiveStartKey: start } : {}),
      }),
    );
    for (const row of result.Items ?? []) rows.push(Tombstone.parse(row));
    start = result.LastEvaluatedKey;
  } while (start);
  const database = new DataApiDatabase(
    {
      resourceArn: details.DBClusterArn,
      secretArn: details.MasterUserSecret.SecretArn,
      database: 'quartermaster',
    },
    new RDSDataClient(configuration),
  );
  // The restore must be migrated explicitly before replay, not opportunistically
  // migrated as a hidden side effect of a destructive recovery command.
  await database.transaction(async (sql) => {
    assert.ok(
      (
        await sql.query(
          "SELECT 1 FROM information_schema.columns WHERE table_schema='qm' AND table_name='records' AND column_name='deleted_at'",
        )
      ).length,
      'Apply the current schema to the isolated restore first',
    );
  });
  const result = await replayDeletions(database, rows, async (prefix) => {
    let key: string | undefined, version: string | undefined;
    do {
      const page = await s3.send(
        new ListObjectVersionsCommand({
          Bucket: bucket,
          Prefix: prefix,
          ...(key ? { KeyMarker: key } : {}),
          ...(version ? { VersionIdMarker: version } : {}),
        }),
      );
      const objects = [
        ...(page.Versions ?? []),
        ...(page.DeleteMarkers ?? []),
      ].map((v) => ({ Key: v.Key!, VersionId: v.VersionId! }));
      if (objects.length) {
        const deletion = await s3.send(
          new DeleteObjectsCommand({
            Bucket: bucket,
            Delete: { Objects: objects, Quiet: true },
          }),
        );
        assert.ok(!deletion.Errors?.length, 'Restore media purge incomplete');
      }
      key = page.NextKeyMarker;
      version = page.NextVersionIdMarker;
      if (!page.IsTruncated) break;
    } while (key);
  });
  console.log(
    JSON.stringify({
      ...result,
      cluster,
      mediaBucket: bucket,
      ledgerDigest: createHash('sha256')
        .update(JSON.stringify(rows))
        .digest('hex'),
      checkedAt: new Date().toISOString(),
      publicAccessEnabled: false,
      remainingGate:
        'Verify backup age, migration/checksums, fresh ledger replay after freezing mutations, expired original/export copies, row/media checks and RPO/RTO before any cutover.',
    }),
  );
}
main().catch(() => {
  console.error(
    'Isolated restore replay failed; access remains closed. No raw service errors or customer content printed.',
  );
  process.exitCode = 1;
});
