import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { filesUnder, digest, validReleasePath } from './release-files.mjs';

function required(name) {
  assert.ok(process.env[name], `Missing ${name}`);
  return process.env[name];
}
const account = required('QM_EXPECTED_ACCOUNT_ID');
const bucket = required('QM_WEB_BUCKET');
const functionName = required('QM_API_FUNCTION');
const distribution = required('QM_DISTRIBUTION_ID');
const publicUrl = required('QM_PUBLIC_URL');
const commit = required('QM_RELEASE_SHA');
assert.match(account, /^\d{12}$/);
assert.equal(bucket, `quartermaster-dev-web-${account}-us-east-2`);
assert.equal(functionName, 'quartermaster-dev-api');
assert.equal(publicUrl, 'https://qm.ejtbrown.com');
assert.equal(
  process.env.AWS_DEFAULT_REGION ?? process.env.AWS_REGION,
  'us-east-2',
);
function aws(args, region = 'us-east-2') {
  return JSON.parse(
    execFileSync('aws', [...args, '--region', region, '--output', 'json'], {
      encoding: 'utf8',
    }) || '{}',
  );
}
assert.equal(aws(['sts', 'get-caller-identity']).Account, account);
// Subscription outputs can be stale after console changes. Verify live state too.
execFileSync(process.execPath, ['edge-check.mjs'], { stdio: 'inherit' });
const stack = aws(
  [
    'cloudformation',
    'describe-stacks',
    '--stack-name',
    required('QM_FREE_PLAN_STACK'),
  ],
  'us-east-1',
).Stacks[0];
const outputs = Object.fromEntries(
  stack.Outputs.map((o) => [o.OutputKey, o.OutputValue]),
);
assert.equal(
  outputs.CurrentPlanTier,
  'FREE',
  'Paid or unverified edge plan cannot deploy',
);
assert.equal(outputs.Status, 'ACTIVE', 'Edge plan must be active');
const manifest = JSON.parse(readFileSync('manifest.json', 'utf8'));
assert.equal(manifest.version, 1);
assert.equal(manifest.commit, commit);
assert.match(commit, /^[0-9a-f]{40}$/);
const artifacts = ['api.zip', ...filesUnder('web', 'web/')].sort();
assert.deepEqual(Object.keys(manifest.files).sort(), artifacts);
for (const path of artifacts) {
  assert.ok(validReleasePath(path));
  assert.equal(
    digest(path),
    manifest.files[path],
    `Artifact checksum mismatch: ${path}`,
  );
}
assert.ok(manifest.files['web/index.html']);
const priorAlias = aws([
  'lambda',
  'get-alias',
  '--function-name',
  functionName,
  '--name',
  'live',
]);
let priorIndex;
try {
  priorIndex = aws([
    's3api',
    'head-object',
    '--bucket',
    bucket,
    '--key',
    'index.html',
  ]);
} catch (error) {
  if (!String(error.stderr).includes('(404)')) throw error;
}
let changedAlias = false;
let changedIndex = false;
function invalidate() {
  const result = aws([
    'cloudfront',
    'create-invalidation',
    '--distribution-id',
    distribution,
    '--paths',
    '/*',
  ]);
  execFileSync(
    'aws',
    [
      'cloudfront',
      'wait',
      'invalidation-completed',
      '--distribution-id',
      distribution,
      '--id',
      result.Invalidation.Id,
    ],
    { stdio: 'inherit' },
  );
}
try {
  const version = aws([
    'lambda',
    'update-function-code',
    '--function-name',
    functionName,
    '--zip-file',
    'fileb://api.zip',
    '--publish',
  ]).Version;
  assert.match(version, /^\d+$/);
  execFileSync(
    'aws',
    [
      'lambda',
      'wait',
      'function-updated-v2',
      '--function-name',
      functionName,
      '--region',
      'us-east-2',
    ],
    { stdio: 'inherit' },
  );
  const resultPath = join(
    mkdtempSync(join(tmpdir(), 'qm-release-')),
    'health.json',
  );
  const invocation = aws([
    'lambda',
    'invoke',
    '--function-name',
    functionName,
    '--qualifier',
    version,
    '--cli-binary-format',
    'raw-in-base64-out',
    '--payload',
    JSON.stringify({
      rawPath: '/api/health',
      requestContext: { http: { method: 'GET' } },
    }),
    resultPath,
  ]);
  assert.equal(invocation.FunctionError, undefined);
  const response = JSON.parse(readFileSync(resultPath, 'utf8'));
  assert.equal(response.statusCode, 200);
  assert.equal(JSON.parse(response.body).release, commit);
  assert.equal(JSON.parse(response.body).assetApiReady, false);
  // Content-addressed assets first; retain old assets for rollback and open tabs.
  execFileSync(
    'aws',
    [
      's3',
      'cp',
      'web/',
      `s3://${bucket}/`,
      '--recursive',
      '--exclude',
      'index.html',
      '--cache-control',
      'public,max-age=31536000,immutable',
      '--only-show-errors',
      '--region',
      'us-east-2',
    ],
    { stdio: 'inherit' },
  );
  aws([
    'lambda',
    'update-alias',
    '--function-name',
    functionName,
    '--name',
    'live',
    '--function-version',
    version,
    '--revision-id',
    priorAlias.RevisionId,
  ]);
  changedAlias = true;
  execFileSync(
    'aws',
    [
      's3',
      'cp',
      'web/index.html',
      `s3://${bucket}/index.html`,
      '--content-type',
      'text/html',
      '--cache-control',
      'no-cache,max-age=0,must-revalidate',
      '--only-show-errors',
      '--region',
      'us-east-2',
    ],
    { stdio: 'inherit' },
  );
  changedIndex = true;
  invalidate();
  const healthResponse = await fetch(publicUrl + '/api/health', {
    signal: AbortSignal.timeout(60000),
  });
  assert.equal(healthResponse.status, 200);
  assert.match(healthResponse.headers.get('cache-control') ?? '', /no-store/);
  const health = await healthResponse.json();
  assert.equal(health.release, commit);
  assert.equal(health.assetApiReady, false);
  const page = await fetch(publicUrl, { signal: AbortSignal.timeout(60000) });
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Quartermaster/);
  assert.ok(page.headers.get('content-security-policy'));
  assert.equal(
    (
      await fetch(publicUrl + '/api/assets', {
        signal: AbortSignal.timeout(60000),
      })
    ).status,
    404,
  );
  console.log(
    `Deployed and verified ${commit} at ${publicUrl}; live API version ${version}.`,
  );
} catch (error) {
  console.error(
    'Release failed; restoring prior live pointers where available.',
  );
  if (changedAlias)
    aws([
      'lambda',
      'update-alias',
      '--function-name',
      functionName,
      '--name',
      'live',
      '--function-version',
      priorAlias.FunctionVersion,
    ]);
  if (changedIndex && priorIndex?.VersionId) {
    aws([
      's3api',
      'copy-object',
      '--bucket',
      bucket,
      '--key',
      'index.html',
      '--copy-source',
      `${bucket}/index.html?versionId=${encodeURIComponent(priorIndex.VersionId)}`,
    ]);
    invalidate();
  }
  throw error;
}
