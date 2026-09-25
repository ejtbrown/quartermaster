import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  PricingPlanManagerClient,
  ListSubscriptionsCommand,
} from '@aws-sdk/client-pricing-plan-manager';
import {
  assertStandardEdge,
  assertNoEdgeSubscription,
} from './edge-policy.mjs';

const account = process.env.QM_EXPECTED_ACCOUNT_ID;
const distributionId = process.env.QM_DISTRIBUTION_ID;
assert.match(account ?? '', /^\d{12}$/);
assert.match(distributionId ?? '', /^[A-Z0-9]+$/);
function aws(args) {
  return JSON.parse(
    execFileSync(
      'aws',
      [...args, '--region', 'us-east-1', '--output', 'json'],
      { encoding: 'utf8' },
    ),
  );
}
assert.equal(aws(['sts', 'get-caller-identity']).Account, account);
const { Distribution: distribution } = aws([
  'cloudfront',
  'get-distribution',
  '--id',
  distributionId,
]);
assert.equal(
  distribution.ARN,
  `arn:aws:cloudfront::${account}:distribution/${distributionId}`,
);
const config = distribution.DistributionConfig;
const prefix = `arn:aws:wafv2:us-east-1:${account}:global/webacl/quartermaster-dev/`;
assert.ok(config.WebACLId?.startsWith(prefix));
const { WebACL: webAcl } = aws([
  'wafv2',
  'get-web-acl',
  '--scope',
  'CLOUDFRONT',
  '--name',
  'quartermaster-dev',
  '--id',
  config.WebACLId.slice(prefix.length),
]);
assertStandardEdge(distribution, webAcl);
const client = new PricingPlanManagerClient({ region: 'us-east-1' });
let nextToken;
const seen = new Set();
do {
  const page = await client.send(new ListSubscriptionsCommand({ nextToken }));
  assertNoEdgeSubscription(page.subscriptionSummaries, [
    distribution.ARN,
    webAcl.ARN,
  ]);
  nextToken = page.nextToken;
  if (nextToken) {
    assert.ok(!seen.has(nextToken), 'Repeated subscription pagination token');
    seen.add(nextToken);
  }
} while (nextToken);
console.log(
  'Standard CloudFront/WAF verified for the exact development resources; no flat-rate association. Publication and origin-denial checks remain separate.',
);
