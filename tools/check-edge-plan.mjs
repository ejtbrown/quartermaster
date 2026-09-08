import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  PricingPlanManagerClient,
  GetSubscriptionCommand,
} from '@aws-sdk/client-pricing-plan-manager';

const account = process.env.QM_EXPECTED_ACCOUNT_ID;
assert.match(account ?? '', /^\d{12}$/);
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
const stack = aws([
  'cloudformation',
  'describe-stacks',
  '--stack-name',
  'quartermaster-dev-edge-free',
]).Stacks[0];
assert.ok(['CREATE_COMPLETE', 'UPDATE_COMPLETE'].includes(stack.StackStatus));
const outputs = Object.fromEntries(
  stack.Outputs.map((o) => [o.OutputKey, o.OutputValue]),
);
const parameters = Object.fromEntries(
  stack.Parameters.map((p) => [p.ParameterKey, p.ParameterValue]),
);
const client = new PricingPlanManagerClient({ region: 'us-east-1' });
const { subscription } = await client.send(
  new GetSubscriptionCommand({ arn: outputs.SubscriptionArn }),
);
assert.equal(subscription.status, 'ACTIVE');
assert.equal(subscription.planTier, 'FREE');
assert.equal(subscription.planFamily, 'CloudFront');
assert.equal(
  subscription.scheduledChange,
  undefined,
  'Pending subscription changes need review',
);
assert.deepEqual(
  [...subscription.resourceArns].sort(),
  [parameters.DistributionArn, parameters.WebAclArn].sort(),
);
assert.ok(
  parameters.DistributionArn.startsWith(
    `arn:aws:cloudfront::${account}:distribution/`,
  ),
);
assert.ok(
  parameters.WebAclArn.startsWith(
    `arn:aws:wafv2:us-east-1:${account}:global/webacl/quartermaster-dev/`,
  ),
);
console.log(
  'Live FREE subscription is ACTIVE for the exact development distribution and WAF only.',
);
