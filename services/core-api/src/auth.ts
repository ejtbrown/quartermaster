import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { CognitoJwtVerifier } from 'aws-jwt-verify';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  DeleteCommand,
} from '@aws-sdk/lib-dynamodb';
import { Problem, browserCookie, cookie, header, json } from './http';
import type { Request } from './http';

const SESSION = '__Host-qm_session';
const FLOW = '__Host-qm_login';
const opaque = () => randomBytes(32).toString('base64url');
export const hash = (value: string) =>
  createHash('sha256').update(value).digest('hex');
function equal(a: string, b: string) {
  const left = Buffer.from(a),
    right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
export interface Session {
  actorId: string;
  csrf: string;
  expiresAt: number;
  authenticatedAt: number;
}
export interface Login {
  state: string;
  binding: string;
  verifier: string;
  nonce: string;
  expiresAt: number;
}
export interface AuthStore {
  putLogin(login: Login): Promise<void>;
  takeLogin(
    state: string,
    binding: string,
    now: number,
  ): Promise<Login | undefined>;
  putSession(id: string, session: Session): Promise<void>;
  getSession(id: string): Promise<Session | undefined>;
  deleteSession(id: string): Promise<void>;
}
export interface Identity {
  actorId: string;
  nonce: string;
  expiresAt: number;
  authenticatedAt: number;
}
export interface AuthConfig {
  origin: string;
  cognitoDomain: string;
  clientId: string;
  userPoolId: string;
}
export class Auth {
  constructor(
    private config: AuthConfig,
    private store: AuthStore,
    private exchange: (code: string, verifier: string) => Promise<Identity>,
    private now = () => Math.floor(Date.now() / 1000),
  ) {}

  async login() {
    const state = opaque(),
      binding = opaque(),
      verifier = opaque(),
      nonce = opaque();
    await this.store.putLogin({
      state: hash(state),
      binding: hash(binding),
      verifier,
      nonce,
      expiresAt: this.now() + 600,
    });
    const url = new URL('/oauth2/authorize', this.config.cognitoDomain);
    url.search = new URLSearchParams({
      client_id: this.config.clientId,
      response_type: 'code',
      scope: 'openid email',
      redirect_uri: this.config.origin + '/api/auth/callback',
      state,
      nonce,
      code_challenge: createHash('sha256').update(verifier).digest('base64url'),
      code_challenge_method: 'S256',
    }).toString();
    return json(302, {}, [browserCookie(FLOW, binding, 600)], {
      location: url.toString(),
    });
  }
  async callback(request: Request) {
    const params = new URLSearchParams(request.rawQueryString);
    const state = params.get('state'),
      code = params.get('code'),
      binding = cookie(request, FLOW);
    if (
      !state ||
      !/^[A-Za-z0-9_-]{43}$/.test(state) ||
      !binding ||
      !code ||
      code.length > 4096 ||
      params.getAll('code').length !== 1 ||
      params.getAll('state').length !== 1
    )
      throw new Problem(400, 'invalid_login');
    const flow = await this.store.takeLogin(
      hash(state),
      hash(binding),
      this.now(),
    );
    if (!flow) throw new Problem(400, 'invalid_login');
    let identity: Identity;
    try {
      identity = await this.exchange(code, flow.verifier);
    } catch {
      throw new Problem(401, 'login_failed');
    }
    if (
      !equal(identity.nonce, flow.nonce) ||
      identity.expiresAt <= this.now() ||
      identity.authenticatedAt <= 0 ||
      identity.authenticatedAt > this.now() + 60 ||
      !/^[0-9a-f-]{36}$/i.test(identity.actorId)
    )
      throw new Problem(401, 'invalid_identity');
    const id = opaque();
    const session = {
      actorId: identity.actorId,
      csrf: opaque(),
      expiresAt: Math.min(this.now() + 3600, identity.expiresAt),
      authenticatedAt: identity.authenticatedAt,
    };
    // Rotate, never carry a pre-login session identifier through authentication.
    const previous = cookie(request, SESSION);
    if (previous) await this.store.deleteSession(hash(previous));
    await this.store.putSession(hash(id), session);
    return json(
      303,
      {},
      [
        browserCookie(SESSION, id, session.expiresAt - this.now()),
        browserCookie(FLOW, '', 0),
      ],
      { location: '/' },
    );
  }
  async session(request: Request): Promise<Session | undefined> {
    const id = cookie(request, SESSION);
    if (!id) return undefined;
    const session = await this.store.getSession(hash(id));
    // DynamoDB TTL removal is asynchronous; TTL is not an authorization check.
    return session && session.expiresAt > this.now() ? session : undefined;
  }
  requireCsrf(request: Request, session: Session) {
    if (
      header(request, 'origin') !== this.config.origin ||
      !equal(header(request, 'x-csrf-token') ?? '', session.csrf)
    )
      throw new Problem(403, 'csrf_failed');
  }
  async logout(request: Request, session: Session) {
    this.requireCsrf(request, session);
    const id = cookie(request, SESSION);
    if (id) await this.store.deleteSession(hash(id));
    return json(200, { signedOut: true }, [
      browserCookie(SESSION, '', 0),
      browserCookie(FLOW, '', 0),
    ]);
  }
}

export class DynamoAuthStore implements AuthStore {
  private client = DynamoDBDocumentClient.from(
    new DynamoDBClient({ maxAttempts: 2 }),
  );
  constructor(private table: string) {}
  private key(kind: string, id: string) {
    return { pk: `${kind}#${id}`, sk: 'AUTH' };
  }
  async putLogin(login: Login) {
    await this.client.send(
      new PutCommand({
        TableName: this.table,
        Item: {
          ...this.key('LOGIN', login.state),
          ...login,
          expires_at: login.expiresAt,
        },
        ConditionExpression: 'attribute_not_exists(pk)',
      }),
    );
  }
  async takeLogin(state: string, binding: string, now: number) {
    try {
      const result = await this.client.send(
        new DeleteCommand({
          TableName: this.table,
          Key: this.key('LOGIN', state),
          ConditionExpression: 'binding = :binding AND expires_at > :now',
          ExpressionAttributeValues: { ':binding': binding, ':now': now },
          ReturnValues: 'ALL_OLD',
        }),
      );
      return result.Attributes as Login | undefined;
    } catch (error) {
      if (
        error instanceof Error &&
        error.name === 'ConditionalCheckFailedException'
      )
        return undefined;
      throw error;
    }
  }
  async putSession(id: string, session: Session) {
    await this.client.send(
      new PutCommand({
        TableName: this.table,
        Item: {
          ...this.key('SESSION', id),
          ...session,
          expires_at: session.expiresAt,
        },
        ConditionExpression: 'attribute_not_exists(pk)',
      }),
    );
  }
  async getSession(id: string) {
    const result = await this.client.send(
      new GetCommand({
        TableName: this.table,
        Key: this.key('SESSION', id),
        ConsistentRead: true,
      }),
    );
    return result.Item as Session | undefined;
  }
  async deleteSession(id: string) {
    await this.client.send(
      new DeleteCommand({
        TableName: this.table,
        Key: this.key('SESSION', id),
      }),
    );
  }
}
export function cognitoExchange(config: AuthConfig) {
  const idVerifier = CognitoJwtVerifier.create({
    userPoolId: config.userPoolId,
    tokenUse: 'id',
    clientId: config.clientId,
  });
  const accessVerifier = CognitoJwtVerifier.create({
    userPoolId: config.userPoolId,
    tokenUse: 'access',
    clientId: config.clientId,
  });
  return async (code: string, verifier: string): Promise<Identity> => {
    const response = await fetch(
      new URL('/oauth2/token', config.cognitoDomain),
      {
        method: 'POST',
        signal: AbortSignal.timeout(8000),
        redirect: 'error',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          client_id: config.clientId,
          redirect_uri: config.origin + '/api/auth/callback',
          code,
          code_verifier: verifier,
        }),
      },
    );
    if (!response.ok) throw new Error('Token exchange failed');
    const tokens = (await response.json()) as {
      id_token: string;
      access_token: string;
    };
    const [id, access] = await Promise.all([
      idVerifier.verify(tokens.id_token),
      accessVerifier.verify(tokens.access_token),
    ]);
    if (
      id.sub !== access.sub ||
      typeof id.nonce !== 'string' ||
      typeof id.auth_time !== 'number'
    )
      throw new Error('Invalid identity');
    // Tokens (including any refresh token) are never returned to the browser,
    // logged or persisted. Sessions expire in <=1h. Hosted UI may reuse its own
    // SSO cookie; auth_time is retained, never replaced with callback time.
    // High-risk operations needing recent authentication are not exposed yet.
    return {
      actorId: id.sub,
      nonce: id.nonce,
      expiresAt: Math.min(id.exp, access.exp),
      authenticatedAt: id.auth_time,
    };
  };
}
