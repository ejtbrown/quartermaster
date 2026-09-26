import { describe, expect, it } from 'vitest';
import { Auth, hash } from './auth';
import type { AuthStore, Identity, Login, Session } from './auth';
import type { Request } from './http';

export class MemoryAuthStore implements AuthStore {
  logins = new Map<string, Login>();
  sessions = new Map<string, Session>();
  async putLogin(login: Login) {
    this.logins.set(login.state, login);
  }
  async takeLogin(state: string, binding: string, now: number) {
    const login = this.logins.get(state);
    if (!login || login.binding !== binding || login.expiresAt <= now)
      return undefined;
    this.logins.delete(state);
    return login;
  }
  async putSession(id: string, session: Session) {
    this.sessions.set(id, session);
  }
  async getSession(id: string) {
    return this.sessions.get(id);
  }
  async deleteSession(id: string) {
    this.sessions.delete(id);
  }
}
const config = {
  origin: 'https://qm.ejtbrown.com',
  cognitoDomain: 'https://qm-test.auth.us-east-2.amazoncognito.com',
  clientId: 'client',
  userPoolId: 'us-east-2_test',
};
const actorId = '11111111-1111-4111-8111-111111111111';
function setup() {
  const store = new MemoryAuthStore();
  let now = 1000;
  let identity: Identity = {
    actorId,
    nonce: '',
    expiresAt: 4600,
    authenticatedAt: 1000,
  };
  const auth = new Auth(
    config,
    store,
    async () => identity,
    () => now,
  );
  return {
    auth,
    store,
    setTime: (time: number) => {
      now = time;
    },
    setIdentity: (change: Partial<Identity>) => {
      identity = { ...identity, ...change };
    },
    async begin() {
      const start = await auth.login();
      const url = new URL(start.headers.location!);
      const flow = [...store.logins.values()][0]!;
      identity.nonce = flow.nonce;
      return {
        start,
        url,
        request: {
          cookies: start.cookies.map((c) => c.split(';')[0]!),
          rawQueryString: new URLSearchParams({
            state: url.searchParams.get('state')!,
            code: 'code',
          }).toString(),
        } satisfies Request,
      };
    },
  };
}
describe('BFF authorization code flow', () => {
  it('uses S256, an opaque HttpOnly cookie and single-use bound state', async () => {
    const { auth, store, begin } = setup();
    const { start, url, request } = await begin();
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(start.cookies[0]).toContain('Secure; HttpOnly; SameSite=Lax');
    expect(JSON.stringify([...store.logins.values()])).not.toContain(
      url.searchParams.get('state'),
    );
    const result = await auth.callback(request);
    expect(result.statusCode).toBe(303);
    expect(result.headers.location).toBe('/');
    expect(result.body).toBe('{}');
    expect(result.cookies[0]).toMatch(/^__Host-qm_session=/);
    expect(store.logins.size).toBe(0);
    expect(store.sessions.size).toBe(1);
    await expect(auth.callback(request)).rejects.toMatchObject({
      code: 'invalid_login',
    });
  });
  it('rejects cookie substitution without consuming the legitimate login', async () => {
    const { auth, store, begin } = setup();
    const { request } = await begin();
    await expect(
      auth.callback({
        ...request,
        cookies: ['__Host-qm_login=' + 'x'.repeat(43)],
      }),
    ).rejects.toMatchObject({ code: 'invalid_login' });
    expect(store.logins.size).toBe(1);
    expect((await auth.callback(request)).statusCode).toBe(303);
  });
  it.each([
    { nonce: 'wrong' },
    { expiresAt: 999 },
    { authenticatedAt: 0 },
    { actorId: 'not-a-sub' },
  ])('rejects invalid identity %j', async (change) => {
    const { auth, begin, setIdentity } = setup();
    const { request } = await begin();
    setIdentity(change);
    await expect(auth.callback(request)).rejects.toMatchObject({
      code: 'invalid_identity',
    });
  });
  it('expires flows and sessions independently of DynamoDB cleanup', async () => {
    const { auth, store, begin, setTime } = setup();
    const { request } = await begin();
    setTime(1600);
    await expect(auth.callback(request)).rejects.toMatchObject({
      code: 'invalid_login',
    });
    const token = 's'.repeat(43);
    await store.putSession(hash(token), {
      actorId,
      csrf: 'csrf',
      expiresAt: 1600,
      authenticatedAt: 1000,
    });
    expect(
      await auth.session({ cookies: ['__Host-qm_session=' + token] }),
    ).toBeUndefined();
  });
  it('requires exact origin and CSRF and invalidates server-side logout', async () => {
    const { auth, store, begin } = setup();
    const { request } = await begin();
    const result = await auth.callback(request);
    const cookies = [result.cookies[0]!.split(';')[0]!];
    const session = (await auth.session({ cookies }))!;
    expect(() =>
      auth.requireCsrf(
        {
          headers: {
            origin: 'https://attacker.test',
            'x-csrf-token': session.csrf,
          },
        },
        session,
      ),
    ).toThrow('csrf_failed');
    expect(() =>
      auth.requireCsrf({ headers: { origin: config.origin } }, session),
    ).toThrow('csrf_failed');
    await auth.logout(
      {
        cookies,
        headers: { origin: config.origin, 'x-csrf-token': session.csrf },
      },
      session,
    );
    expect(store.sessions.size).toBe(0);
    expect(await auth.session({ cookies })).toBeUndefined();
  });
  it('rejects duplicate cookies and duplicate callback parameters', async () => {
    const { auth, begin } = setup();
    const { request } = await begin();
    await expect(
      auth.callback({
        ...request,
        rawQueryString: request.rawQueryString + '&code=another',
      }),
    ).rejects.toMatchObject({ code: 'invalid_login' });
    expect(
      await auth.session({
        cookies: [
          '__Host-qm_session=' + 'x'.repeat(43),
          '__Host-qm_session=' + 'x'.repeat(43),
        ],
      }),
    ).toBeUndefined();
  });
});
