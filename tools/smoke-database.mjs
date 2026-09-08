import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { setTimeout } from 'node:timers/promises';

// Operator-only deployment test. This wakes Aurora: never run on a schedule or
// attach to application health probes. No writes or secret values are exposed.
const execute = promisify(execFile);
const account = process.env.QM_EXPECTED_ACCOUNT_ID;
assert.match(account ?? '', /^\d{12}$/, 'Set QM_EXPECTED_ACCOUNT_ID privately');
async function aws(...args) {
  return execute(
    'aws',
    [
      ...args,
      '--profile',
      'default',
      '--region',
      'us-east-2',
      '--output',
      'json',
      '--cli-connect-timeout',
      '5',
      '--cli-read-timeout',
      '15',
    ],
    {
      timeout: 17000,
      maxBuffer: 1024 * 1024,
      env: { ...process.env, AWS_MAX_ATTEMPTS: '1' },
    },
  );
}
const identity = JSON.parse((await aws('sts', 'get-caller-identity')).stdout);
assert.equal(identity.Account, account, 'Wrong development account');
const {
  DBClusters: [db],
} = JSON.parse(
  (
    await aws(
      'rds',
      'describe-db-clusters',
      '--db-cluster-identifier',
      'quartermaster-dev',
    )
  ).stdout,
);
assert.equal(
  db.DBClusterArn,
  `arn:aws:rds:us-east-2:${account}:cluster:quartermaster-dev`,
);
assert.ok(
  ['available', 'backing-up'].includes(db.Status),
  'Database is not ready',
);
const started = Date.now();
let result;
let attempts = 0;
for (; attempts < 3; attempts++) {
  try {
    result = JSON.parse(
      (
        await aws(
          'rds-data',
          'execute-statement',
          '--resource-arn',
          db.DBClusterArn,
          '--secret-arn',
          db.MasterUserSecret.SecretArn,
          '--database',
          'quartermaster',
          '--sql',
          "SELECT 1, current_database(), current_setting('wal_level')",
        )
      ).stdout,
    );
    break;
  } catch (error) {
    if (!String(error.stderr).includes('DatabaseResumingException'))
      throw new Error('Read-only Data API check failed; inspect privately.');
    if (attempts < 2) await setTimeout(2500);
  }
}
assert.ok(result, 'Database did not resume within three bounded attempts');
const elapsedMs = Date.now() - started;
assert.equal(result.records[0][0].longValue, 1);
assert.equal(result.records[0][1].stringValue, 'quartermaster');
assert.ok(
  ['minimal', 'replica'].includes(result.records[0][2].stringValue),
  'Logical WAL must be disabled',
);
assert.ok(
  elapsedMs <= 60000,
  'Read-only query exceeded the accepted 60-second allowance',
);
process.stdout.write(
  JSON.stringify(
    {
      checkedAt: new Date().toISOString(),
      test: 'one-off read-only Data API smoke',
      attempts: attempts + 1,
      elapsedMs,
      walLevel: result.records[0][2].stringValue,
      logicalReplication: false,
      coldStartProven: false,
      note: 'Cold-start timing requires independent evidence that the database was paused immediately before invocation; no application tenant integration or migration is tested.',
    },
    null,
    2,
  ) + '\n',
);
