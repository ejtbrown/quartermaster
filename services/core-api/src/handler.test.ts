import { expect, it } from 'vitest';
import { handler } from './handler';

it('reports liveness without claiming database or application readiness', async () => {
  const response = await handler({
    rawPath: '/health',
    requestContext: { http: { method: 'GET' } },
  });
  expect(response.statusCode).toBe(200);
  expect(JSON.parse(response.body).assetApiReady).toBe(false);
  expect(response.headers['cache-control']).toBe('no-store');
});
it.each(['/assets', '/tenants', '/', '/health?bypass'])(
  'does not expose unfinished data routes: %s',
  async (rawPath) => {
    expect(
      (await handler({ rawPath, requestContext: { http: { method: 'GET' } } }))
        .statusCode,
    ).toBe(404);
  },
);
it('does not accept mutation methods on health', async () =>
  expect(
    (
      await handler({
        rawPath: '/health',
        requestContext: { http: { method: 'POST' } },
      })
    ).statusCode,
  ).toBe(404));
