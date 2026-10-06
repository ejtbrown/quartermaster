import { describe, expect, it, vi } from 'vitest';
import { Auth, hash } from './auth';
import type { AuthStore, Login, Session } from './auth';
import { PasswordAuth } from './password-auth';
import type { PasswordProvider } from './password-auth';
import type { Request } from './http';

const origin = 'https://qm.ejtbrown.com';
function setup() {
  let now = 1000;
  const logins = new Map<string, Login>(),
    sessions = new Map<string, Session>();
  const store: AuthStore = {
    async putLogin(value) {
      logins.set(value.state, value);
    },
    async takeLogin(state, binding, time) {
      const flow = logins.get(state);
      if (!flow || flow.binding !== binding || flow.expiresAt <= time)
        return undefined;
      logins.delete(state);
      return flow;
    },
    async putSession(id, value) {
      sessions.set(id, value);
    },
    async getSession(id) {
      return sessions.get(id);
    },
    async deleteSession(id) {
      sessions.delete(id);
    },
  };
  const provider = {
    start: vi.fn<PasswordProvider['start']>().mockResolvedValue({
      step: 'totp',
      providerSession: 'private-provider-session',
      username: 'private-username',
    }),
    respond: vi.fn<PasswordProvider['respond']>().mockResolvedValue({
      identity: {
        actorId: '11111111-1111-4111-8111-111111111111',
        nonce: '',
        expiresAt: 4600,
        authenticatedAt: 1000,
      },
    }),
    forgot: vi.fn<PasswordProvider['forgot']>().mockResolvedValue(),
    reset: vi.fn<PasswordProvider['reset']>().mockResolvedValue(),
  };
  const auth = new Auth(
    {
      origin,
      clientId: 'test',
      userPoolId: 'us-east-2_test',
      cognitoDomain: 'https://test.auth.us-east-2.amazoncognito.com',
    },
    store,
    async () => {
      throw new Error('Not a hosted UI test');
    },
    () => now,
  );
  const direct = new PasswordAuth(origin, store, provider, auth, () => now);
  const request = (
    response: Awaited<ReturnType<typeof direct.begin>>,
    body: unknown,
  ): Request => ({
    headers: {
      origin,
      'content-type': 'application/json',
      'x-csrf-token': JSON.parse(response.body).csrfToken,
    },
    cookies: [response.cookies[0]!.split(';')[0]!],
    body: JSON.stringify(body),
  });
  return {
    direct,
    auth,
    provider,
    store,
    logins,
    sessions,
    request,
    setTime: (value: number) => {
      now = value;
    },
  };
}
const credentials = {
  action: 'sign_in',
  email: 'person@example.test',
  password: 'not-a-real-password',
};
describe('Same-origin Cognito challenge plumbing', () => {
  it('requires MFA and keeps tokens/challenges server-side, then rotates the session', async () => {
    const s = setup(),
      start = await s.direct.begin({});
    expect(start.cookies[0]).toMatch(/Secure; HttpOnly; SameSite=Lax/);
    const challenge = await s.direct.submit(s.request(start, credentials));
    expect(JSON.parse(challenge.body).step).toBe('totp');
    expect(challenge.body).not.toContain('private-provider-session');
    expect(s.sessions.size).toBe(0);
    const old = 'x'.repeat(43);
    await s.store.putSession(hash(old), {
      actorId: 'old',
      csrf: 'old',
      expiresAt: 2000,
      authenticatedAt: 1,
    });
    const request = s.request(challenge, { action: 'totp', code: '123456' });
    request.cookies!.push('__Host-qm_session=' + old);
    const complete = await s.direct.submit(request);
    expect(JSON.parse(complete.body)).toEqual({ step: 'complete' });
    expect(s.sessions.size).toBe(1);
    expect(s.sessions.has(hash(old))).toBe(false);
    expect([...s.sessions.values()][0]?.authenticatedAt).toBe(1000);
    expect(
      [...s.logins.values()].some((v) =>
        JSON.stringify(v).includes(credentials.password),
      ),
    ).toBe(false);
  });
  it('rejects cross-origin login and cookie/CSRF substitution without consuming valid state', async () => {
    const s = setup(),
      start = await s.direct.begin({});
    const request = s.request(start, credentials);
    for (const bad of [
      {
        ...request,
        headers: { ...request.headers, origin: 'https://evil.test' },
      },
      {
        ...request,
        headers: { ...request.headers, 'x-csrf-token': 'x'.repeat(43) },
      },
      {
        ...request,
        headers: { ...request.headers, 'content-type': 'text/plain' },
      },
      { ...request, cookies: ['__Host-qm_signin=' + 'x'.repeat(43)] },
      { ...request, cookies: [...request.cookies!, ...request.cookies!] },
    ])
      await expect(s.direct.submit(bad)).rejects.toBeDefined();
    expect(s.provider.start).not.toHaveBeenCalled();
    expect((await s.direct.submit(request)).statusCode).toBe(200);
  });
  it('consumes each step exactly once, including simultaneous replay', async () => {
    const s = setup(),
      start = await s.direct.begin({}),
      request = s.request(start, credentials);
    const results = await Promise.allSettled([
      s.direct.submit(request),
      s.direct.submit(request),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(s.provider.start).toHaveBeenCalledTimes(1);
  });
  it('expires challenges independently of DynamoDB cleanup', async () => {
    const s = setup(),
      start = await s.direct.begin({});
    s.setTime(1600);
    await expect(
      s.direct.submit(s.request(start, credentials)),
    ).rejects.toMatchObject({ code: 'login_expired' });
    expect(s.provider.start).not.toHaveBeenCalled();
  });
  it('bounds attempts, rotates CSRF on failure, and redacts provider messages', async () => {
    const s = setup();
    s.provider.start.mockRejectedValue(
      Object.assign(new Error('Sensitive private provider details'), {
        name: 'NotAuthorizedException',
      }),
    );
    let state = await s.direct.begin({});
    for (let i = 0; i < 5; i++) {
      const next = await s.direct.submit(s.request(state, credentials));
      expect(next.statusCode).toBe(400);
      expect(JSON.parse(next.body).code).toBe('login_failed');
      expect(next.body).not.toContain('Sensitive');
      expect(next.cookies).not.toEqual(state.cookies);
      state = next;
    }
    await expect(
      s.direct.submit(s.request(state, credentials)),
    ).rejects.toMatchObject({ code: 'login_attempts_exhausted' });
    expect(s.provider.start).toHaveBeenCalledTimes(5);
  });
  it('handles invitation password then authenticator setup without storing passwords or seeds', async () => {
    const s = setup();
    s.provider.start.mockResolvedValue({
      step: 'new_password',
      username: 'user',
      providerSession: 'password-challenge',
    });
    s.provider.respond.mockResolvedValueOnce({
      step: 'setup_totp',
      username: 'user',
      providerSession: 'setup-challenge',
      secret: 'PRIVATESEED',
    });
    const start = await s.direct.begin({});
    const first = await s.direct.submit(s.request(start, credentials));
    const enrollment = await s.direct.submit(
      s.request(first, {
        action: 'new_password',
        password: 'a-different-private-password',
      }),
    );
    expect(JSON.parse(enrollment.body)).toMatchObject({
      step: 'setup_totp',
      secret: 'PRIVATESEED',
    });
    expect(JSON.stringify([...s.logins.values()])).not.toMatch(
      /PRIVATESEED|a-different-private-password/,
    );
    expect(s.sessions.size).toBe(0);
    expect(
      (
        await s.direct.submit(
          s.request(enrollment, { action: 'totp', code: '123456' }),
        )
      ).statusCode,
    ).toBe(200);
    expect(s.sessions.size).toBe(1);
  });
  it('recovers passwords but never skips authentication or MFA', async () => {
    const s = setup(),
      start = await s.direct.begin({});
    const sent = await s.direct.submit(
      s.request(start, {
        action: 'reset_request',
        email: 'person@example.test',
      }),
    );
    expect(JSON.parse(sent.body).step).toBe('reset_code');
    const done = await s.direct.submit(
      s.request(sent, {
        action: 'reset_confirm',
        password: 'replacement-password',
        code: '123456',
      }),
    );
    expect(JSON.parse(done.body)).toMatchObject({
      step: 'credentials',
      notice: 'password_changed',
    });
    expect(s.sessions.size).toBe(0);
    expect(s.provider.start).not.toHaveBeenCalled();
  });
  it('does not accept a challenge response in the wrong step or unbounded input', async () => {
    const s = setup(),
      start = await s.direct.begin({});
    await expect(
      s.direct.submit(
        s.request(start, { ...credentials, password: 'x'.repeat(4097) }),
      ),
    ).rejects.toMatchObject({ code: 'invalid_fields' });
    const bad = await s.direct.submit(
      s.request(start, { action: 'totp', code: '123456' }),
    );
    expect(JSON.parse(bad.body).code).toBe('invalid_fields');
    expect(s.provider.respond).not.toHaveBeenCalled();
  });
  it('refuses a cross-site flow initializer', async () => {
    const s = setup();
    await expect(
      s.direct.begin({ headers: { 'sec-fetch-site': 'cross-site' } }),
    ).rejects.toMatchObject({ code: 'csrf_failed' });
  });
});
