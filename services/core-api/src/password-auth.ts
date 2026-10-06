import { randomBytes } from 'node:crypto';
import {
  CognitoIdentityProviderClient,
  AdminInitiateAuthCommand,
  AdminRespondToAuthChallengeCommand,
  AssociateSoftwareTokenCommand,
  VerifySoftwareTokenCommand,
  ForgotPasswordCommand,
  ConfirmForgotPasswordCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import type { AdminInitiateAuthCommandOutput } from '@aws-sdk/client-cognito-identity-provider';
import { CognitoJwtVerifier } from 'aws-jwt-verify';
import { z } from 'zod';
import { hash } from './auth';
import type { Auth, AuthConfig, AuthStore, Identity } from './auth';
import { browserCookie, cookie, header, json, Problem } from './http';
import type { Request } from './http';

const FLOW_COOKIE = '__Host-qm_signin';
const opaque = () => randomBytes(32).toString('base64url');
export type LoginStep =
  'credentials' | 'new_password' | 'totp' | 'setup_totp' | 'reset_code';
export interface LoginFlow {
  step: LoginStep;
  email?: string;
  username?: string;
  providerSession?: string;
  attempts: number;
}
export interface ProviderResult {
  step?: LoginStep;
  username?: string;
  providerSession?: string;
  secret?: string;
  identity?: Identity;
}
export interface PasswordProvider {
  start(email: string, password: string): Promise<ProviderResult>;
  respond(flow: LoginFlow, value: string): Promise<ProviderResult>;
  forgot(email: string): Promise<void>;
  reset(email: string, code: string, password: string): Promise<void>;
}
const inputSchema = z
  .object({
    action: z.enum([
      'sign_in',
      'new_password',
      'totp',
      'reset_request',
      'reset_confirm',
    ]),
    email: z.string().email().max(254).optional(),
    password: z.string().min(1).max(256).optional(),
    code: z
      .string()
      .regex(/^\d{6}$/)
      .optional(),
  })
  .strict();

// A browser-bound, one-use challenge chain. Only the pending Cognito challenge
// session is persisted (encrypted at rest by the existing DynamoDB table).
// Passwords, verification codes, TOTP seeds and identity tokens are never stored.
export class PasswordAuth {
  constructor(
    private origin: string,
    private store: AuthStore,
    private provider: PasswordProvider,
    private auth: Auth,
    private now = () => Math.floor(Date.now() / 1000),
  ) {}
  private async next(
    flow: LoginFlow,
    expiresAt: number,
    extra: Record<string, unknown> = {},
    status = 200,
  ) {
    const token = opaque(),
      csrf = opaque();
    await this.store.putLogin({
      state: hash(token),
      binding: hash(csrf),
      verifier: '',
      nonce: '',
      expiresAt,
      direct: flow,
    });
    return json(status, { step: flow.step, csrfToken: csrf, ...extra }, [
      browserCookie(FLOW_COOKIE, token, Math.max(0, expiresAt - this.now())),
    ]);
  }
  async begin(request: Request) {
    // No CORS. A cross-origin initiator must not reset an active login flow.
    if (header(request, 'sec-fetch-site') === 'cross-site')
      throw new Problem(403, 'csrf_failed');
    return this.next({ step: 'credentials', attempts: 0 }, this.now() + 600);
  }
  async submit(request: Request) {
    if (
      header(request, 'origin') !== this.origin ||
      !/^application\/json(?:;|$)/i.test(header(request, 'content-type') ?? '')
    )
      throw new Problem(403, 'csrf_failed');
    const token = cookie(request, FLOW_COOKIE),
      csrf = header(request, 'x-csrf-token');
    if (!token || !csrf || !/^[A-Za-z0-9_-]{43}$/.test(csrf))
      throw new Problem(403, 'csrf_failed');
    let input: z.infer<typeof inputSchema>;
    try {
      if (!request.body || request.body.length > 4096) throw new Error();
      input = inputSchema.parse(
        JSON.parse(
          request.isBase64Encoded
            ? Buffer.from(request.body, 'base64').toString('utf8')
            : request.body,
        ),
      );
    } catch {
      throw new Problem(400, 'invalid_fields');
    }
    const stored = await this.store.takeLogin(
      hash(token),
      hash(csrf),
      this.now(),
    );
    if (!stored?.direct) throw new Problem(400, 'login_expired');
    const flow = stored.direct;
    if (flow.attempts >= 5) throw new Problem(429, 'login_attempts_exhausted');
    const nextFlow = { ...flow, attempts: flow.attempts + 1 };
    try {
      let result: ProviderResult;
      if (
        input.action === 'sign_in' &&
        flow.step === 'credentials' &&
        input.email &&
        input.password
      ) {
        nextFlow.email = input.email.trim().toLowerCase();
        result = await this.provider.start(nextFlow.email, input.password);
      } else if (
        input.action === 'reset_request' &&
        flow.step === 'credentials' &&
        input.email
      ) {
        const email = input.email.trim().toLowerCase();
        await this.provider.forgot(email);
        return this.next(
          { step: 'reset_code', email, attempts: 0 },
          stored.expiresAt,
        );
      } else if (
        input.action === 'reset_confirm' &&
        flow.step === 'reset_code' &&
        flow.email &&
        input.code &&
        input.password
      ) {
        await this.provider.reset(flow.email, input.code, input.password);
        return this.next(
          { step: 'credentials', attempts: 0 },
          this.now() + 600,
          { notice: 'password_changed' },
        );
      } else if (
        input.action === 'new_password' &&
        flow.step === 'new_password' &&
        input.password
      ) {
        result = await this.provider.respond(flow, input.password);
      } else if (
        input.action === 'totp' &&
        ['totp', 'setup_totp'].includes(flow.step) &&
        input.code
      ) {
        result = await this.provider.respond(flow, input.code);
      } else throw new Problem(400, 'invalid_fields');
      if (result.identity) return this.auth.complete(request, result.identity);
      if (!result.step || !result.providerSession || !result.username)
        throw new Problem(401, 'login_failed');
      return this.next(
        {
          ...nextFlow,
          step: result.step,
          providerSession: result.providerSession,
          username: result.username,
          attempts: 0,
        },
        stored.expiresAt,
        result.secret ? { secret: result.secret } : {},
      );
    } catch (error) {
      const name = error instanceof Error ? error.name : '';
      const code =
        error instanceof Problem
          ? error.code
          : [
                'CodeMismatchException',
                'EnableSoftwareTokenMFAException',
              ].includes(name)
            ? 'incorrect_code'
            : name === 'InvalidPasswordException' ||
                name === 'PasswordHistoryPolicyViolationException'
              ? 'password_policy'
              : name === 'PasswordResetRequiredException'
                ? 'password_reset_required'
                : name === 'TooManyRequestsException' ||
                    name === 'LimitExceededException'
                  ? 'auth_rate_limited'
                  : name === 'ExpiredCodeException'
                    ? 'code_expired'
                    : [
                          'NotAuthorizedException',
                          'UserNotFoundException',
                          'UserNotConfirmedException',
                          'InvalidParameterException',
                        ].includes(name)
                      ? 'login_failed'
                      : 'auth_unavailable';
      // Rotate the browser binding even on failure. Do not leak raw provider errors.
      return this.next(
        nextFlow,
        stored.expiresAt,
        { code },
        code === 'auth_rate_limited'
          ? 429
          : code === 'auth_unavailable'
            ? 503
            : 400,
      );
    }
  }
}

export function cognitoPasswordProvider(config: AuthConfig): PasswordProvider {
  const client = new CognitoIdentityProviderClient({ maxAttempts: 1 });
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
  async function result(
    value: AdminInitiateAuthCommandOutput,
    username: string,
  ): Promise<ProviderResult> {
    const tokens = value.AuthenticationResult;
    if (tokens?.IdToken && tokens.AccessToken) {
      const [id, access] = await Promise.all([
        idVerifier.verify(tokens.IdToken),
        accessVerifier.verify(tokens.AccessToken),
      ]);
      if (id.sub !== access.sub || typeof id.auth_time !== 'number')
        throw new Problem(401, 'invalid_identity');
      return {
        identity: {
          actorId: id.sub,
          nonce: '',
          authenticatedAt: id.auth_time,
          expiresAt: Math.min(id.exp, access.exp),
        },
      };
    }
    const name =
      value.ChallengeParameters?.USER_ID_FOR_SRP ??
      value.ChallengeParameters?.USERNAME ??
      username;
    if (!value.Session) throw new Problem(401, 'login_failed');
    if (value.ChallengeName === 'MFA_SETUP') {
      const setup = await client.send(
        new AssociateSoftwareTokenCommand({ Session: value.Session }),
      );
      if (!setup.Session || !setup.SecretCode)
        throw new Problem(401, 'login_failed');
      return {
        step: 'setup_totp',
        providerSession: setup.Session,
        username: name,
        secret: setup.SecretCode,
      };
    }
    if (
      value.ChallengeName === 'NEW_PASSWORD_REQUIRED' ||
      value.ChallengeName === 'SOFTWARE_TOKEN_MFA'
    )
      return {
        step:
          value.ChallengeName === 'NEW_PASSWORD_REQUIRED'
            ? 'new_password'
            : 'totp',
        providerSession: value.Session,
        username: name,
      };
    throw new Problem(401, 'unsupported_challenge');
  }
  return {
    async start(email, password) {
      return result(
        await client.send(
          new AdminInitiateAuthCommand({
            UserPoolId: config.userPoolId,
            ClientId: config.clientId,
            AuthFlow: 'ADMIN_USER_PASSWORD_AUTH',
            AuthParameters: { USERNAME: email, PASSWORD: password },
          }),
        ),
        email,
      );
    },
    async respond(flow, value) {
      if (!flow.providerSession || !flow.username)
        throw new Problem(400, 'login_expired');
      let session = flow.providerSession;
      if (flow.step === 'setup_totp') {
        const verified = await client.send(
          new VerifySoftwareTokenCommand({
            Session: session,
            UserCode: value,
            FriendlyDeviceName: 'Quartermaster authenticator',
          }),
        );
        if (verified.Status !== 'SUCCESS' || !verified.Session)
          throw new Problem(400, 'incorrect_code');
        session = verified.Session;
      }
      return result(
        await client.send(
          new AdminRespondToAuthChallengeCommand({
            UserPoolId: config.userPoolId,
            ClientId: config.clientId,
            Session: session,
            ChallengeName:
              flow.step === 'new_password'
                ? 'NEW_PASSWORD_REQUIRED'
                : flow.step === 'setup_totp'
                  ? 'MFA_SETUP'
                  : 'SOFTWARE_TOKEN_MFA',
            ChallengeResponses: {
              USERNAME: flow.username,
              ...(flow.step === 'new_password'
                ? { NEW_PASSWORD: value }
                : flow.step === 'totp'
                  ? { SOFTWARE_TOKEN_MFA_CODE: value }
                  : {}),
            },
          }),
        ),
        flow.username,
      );
    },
    async forgot(email) {
      try {
        await client.send(
          new ForgotPasswordCommand({
            ClientId: config.clientId,
            Username: email,
          }),
        );
      } catch (error) {
        // Recovery always gives the same account-existence-neutral response.
        if (
          !(error instanceof Error) ||
          ![
            'UserNotFoundException',
            'InvalidParameterException',
            'NotAuthorizedException',
          ].includes(error.name)
        )
          throw error;
      }
    },
    async reset(email, code, password) {
      await client.send(
        new ConfirmForgotPasswordCommand({
          ClientId: config.clientId,
          Username: email,
          ConfirmationCode: code,
          Password: password,
        }),
      );
    },
  };
}
