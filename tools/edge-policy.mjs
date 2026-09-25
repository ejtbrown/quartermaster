import assert from 'node:assert/strict';

export function assertStandardEdge(distribution, webAcl) {
  const config = distribution.DistributionConfig;
  assert.equal(distribution.Status, 'Deployed');
  assert.deepEqual(config.Aliases.Items, ['qm.ejtbrown.com']);
  assert.equal(config.WebACLId, webAcl.ARN);
  assert.equal(config.ViewerCertificate.MinimumProtocolVersion, 'TLSv1.2_2021');
  assert.equal(webAcl.Name, 'quartermaster-dev');
  assert.deepEqual(webAcl.DefaultAction, { Allow: {} });
  assert.equal(
    webAcl.Rules.length,
    1,
    'Extra firewall rules require cost/security review',
  );
  const rule = webAcl.Rules[0];
  assert.equal(rule.Name, 'PerIPRateLimit');
  assert.deepEqual(rule.Action, { Block: {} });
  assert.deepEqual(rule.Statement, {
    RateBasedStatement: {
      Limit: 300,
      AggregateKeyType: 'IP',
      EvaluationWindowSec: 300,
    },
  });
  assert.equal(config.Origins.Items.length, 2);
  assert.deepEqual(config.Origins.Items.map((origin) => origin.Id).sort(), [
    'api',
    'web',
  ]);
  for (const origin of config.Origins.Items)
    assert.ok(origin.OriginAccessControlId, 'Every origin requires OAC');
  const api = config.CacheBehaviors.Items.find(
    (behavior) => behavior.PathPattern === '/api/*',
  );
  assert.ok(api);
  assert.equal(api.TargetOriginId, 'api');
  // AWS Managed-CachingDisabled; tenant API responses must never be cached.
  assert.equal(api.CachePolicyId, '4135ea2d-6df8-44a3-9df3-4b5a84be39ad');
}

export function assertNoEdgeSubscription(subscriptions, resourceArns) {
  assert.ok(
    Array.isArray(subscriptions),
    'Subscription response must be complete',
  );
  for (const subscription of subscriptions) {
    assert.ok(
      Array.isArray(subscription.resourceArns),
      'Subscription resource list missing',
    );
    assert.ok(
      !subscription.resourceArns.some((arn) => resourceArns.includes(arn)),
      'Development edge must remain on standard pay-as-you-go billing',
    );
  }
}
