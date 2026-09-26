import { expect, it, vi } from 'vitest';
import { application, handler } from './handler';
import { Auth } from './auth';
import type { AuthStore, Session } from './auth';
import type { Operations } from './operations';

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

it('keeps health and anonymous probes independent of database and session storage', async () => {
  const store: AuthStore = {
    putLogin: vi.fn(),
    takeLogin: vi.fn(),
    putSession: vi.fn(),
    getSession: vi.fn(),
    deleteSession: vi.fn(),
  };
  const ops = {
    memberships: vi.fn(),
    handle: vi.fn(),
  } as unknown as Operations;
  const auth = new Auth(
    {
      origin: 'https://qm.ejtbrown.com',
      cognitoDomain: 'https://qm.auth.us-east-2.amazoncognito.com',
      clientId: 'test',
      userPoolId: 'us-east-2_test',
    },
    store,
    vi.fn(),
  );
  const app = application(auth, ops);
  expect(
    (
      await app({
        rawPath: '/api/health',
        requestContext: { http: { method: 'GET' } },
      })
    ).statusCode,
  ).toBe(200);
  expect(
    (
      await app({
        rawPath: '/api/auth/session',
        requestContext: { http: { method: 'GET' } },
      })
    ).body,
  ).toContain('"authenticated":false');
  expect(
    (
      await app({
        rawPath: '/api/v1/tenants/11111111-1111-4111-8111-111111111111/assets',
        requestContext: { http: { method: 'GET' } },
      })
    ).statusCode,
  ).toBe(401);
  expect(store.getSession).not.toHaveBeenCalled();
  expect(ops.handle).not.toHaveBeenCalled();
  expect(ops.memberships).not.toHaveBeenCalled();
});
it('rejects missing and cross-origin CSRF before any mutation reaches the repository', async () => {
  const session: Session = {
    actorId: '11111111-1111-4111-8111-111111111111',
    csrf: 'c'.repeat(43),
    expiresAt: Math.floor(Date.now() / 1000) + 60,
    authenticatedAt: Math.floor(Date.now() / 1000),
  };
  const store: AuthStore = {
    putLogin: vi.fn(),
    takeLogin: vi.fn(),
    putSession: vi.fn(),
    getSession: vi.fn(async () => session),
    deleteSession: vi.fn(),
  };
  const ops = { handle: vi.fn() } as unknown as Operations;
  const app = application(
    new Auth(
      {
        origin: 'https://qm.ejtbrown.com',
        cognitoDomain: 'https://qm.auth.us-east-2.amazoncognito.com',
        clientId: 'test',
        userPoolId: 'us-east-2_test',
      },
      store,
      vi.fn(),
    ),
    ops,
  );
  for (const headers of [
    {},
    { origin: 'https://attacker.example', 'x-csrf-token': session.csrf },
    { origin: 'https://qm.ejtbrown.com' },
  ]) {
    const response = await app({
      rawPath: '/api/v1/tenants/11111111-1111-4111-8111-111111111111/assets',
      requestContext: { http: { method: 'POST' } },
      cookies: ['__Host-qm_session=' + 's'.repeat(43)],
      headers,
    });
    expect(response.statusCode).toBe(403);
    expect(response.headers['content-type']).toBe('application/problem+json');
    expect(response.headers['cache-control']).toBe('no-store');
  }
  expect(ops.handle).not.toHaveBeenCalled();
});
