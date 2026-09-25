import { expect, it } from 'vitest';
import {
  assertStandardEdge,
  assertNoEdgeSubscription,
} from '../tools/edge-policy.mjs';

function fixture() {
  const acl = {
    ARN: 'test-web-acl',
    Name: 'quartermaster-dev',
    DefaultAction: { Allow: {} },
    Rules: [
      {
        Name: 'PerIPRateLimit',
        Action: { Block: {} },
        Statement: {
          RateBasedStatement: {
            Limit: 300,
            AggregateKeyType: 'IP',
            EvaluationWindowSec: 300,
          },
        },
      },
    ],
  };
  const distribution = {
    Status: 'Deployed',
    DistributionConfig: {
      Aliases: { Items: ['qm.ejtbrown.com'] },
      WebACLId: acl.ARN,
      ViewerCertificate: { MinimumProtocolVersion: 'TLSv1.2_2021' },
      Origins: {
        Items: [
          { Id: 'web', OriginAccessControlId: 's3-oac' },
          { Id: 'api', OriginAccessControlId: 'api-oac' },
        ],
      },
      CacheBehaviors: {
        Items: [
          {
            PathPattern: '/api/*',
            TargetOriginId: 'api',
            CachePolicyId: '4135ea2d-6df8-44a3-9df3-4b5a84be39ad',
          },
        ],
      },
    },
  };
  return { distribution, acl };
}
it('accepts a standard edge without any flat-rate subscriptions', () => {
  const { distribution, acl } = fixture();
  expect(() => assertStandardEdge(distribution, acl)).not.toThrow();
  expect(() =>
    assertNoEdgeSubscription([], ['distribution', 'acl']),
  ).not.toThrow();
});
it('allows unrelated subscriptions but rejects either exact edge resource', () => {
  expect(() =>
    assertNoEdgeSubscription(
      [{ resourceArns: ['unrelated'] }],
      ['distribution', 'acl'],
    ),
  ).not.toThrow();
  for (const arn of ['distribution', 'acl']) {
    expect(() =>
      assertNoEdgeSubscription(
        [{ resourceArns: [arn] }],
        ['distribution', 'acl'],
      ),
    ).toThrow();
  }
  expect(() => assertNoEdgeSubscription(undefined, ['distribution'])).toThrow();
});
it('rejects firewall changes, origin bypass and cached API responses', () => {
  const noWaf = fixture();
  noWaf.distribution.DistributionConfig.WebACLId = '';
  expect(() => assertStandardEdge(noWaf.distribution, noWaf.acl)).toThrow();
  const rate = fixture();
  rate.acl.Rules[0]!.Statement.RateBasedStatement.Limit = 10000;
  expect(() => assertStandardEdge(rate.distribution, rate.acl)).toThrow();
  const origin = fixture();
  origin.distribution.DistributionConfig.Origins.Items[0]!.OriginAccessControlId =
    '';
  expect(() => assertStandardEdge(origin.distribution, origin.acl)).toThrow();
  const cached = fixture();
  cached.distribution.DistributionConfig.CacheBehaviors.Items[0]!.CachePolicyId =
    'caching-enabled';
  expect(() => assertStandardEdge(cached.distribution, cached.acl)).toThrow();
});
