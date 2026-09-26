import { randomUUID } from 'node:crypto';
import { Auth, DynamoAuthStore, cognitoExchange } from './auth';
import { DataApiDatabase } from './database';
import { Operations } from './operations';
import { Problem, json } from './http';
import type { Request } from './http';

export function application(auth?: Auth, operations?: Operations) {
  return async (request: Request) => {
    const requestId = randomUUID(),
      path = request.rawPath,
      method = request.requestContext?.http?.method;
    try {
      // Liveness never reads sessions, secrets or the database.
      if ((path === '/health' || path === '/api/health') && method === 'GET')
        return json(200, {
          service: 'quartermaster',
          status: auth && operations ? 'synthetic-workspace' : 'foundation',
          assetApiReady: Boolean(auth && operations),
          syntheticOnly: true,
          release: process.env.QM_RELEASE_SHA ?? 'local-preview',
        });
      if (path === '/api/auth/session' && method === 'GET' && !auth)
        return json(200, {
          authenticated: false,
          authenticationEnabled: false,
        });
      if (!auth || !operations) throw new Problem(404, 'not_found');
      if (path === '/api/auth/login' && method === 'GET')
        return await auth.login();
      if (path === '/api/auth/callback' && method === 'GET')
        return await auth.callback(request);
      if (
        !path?.startsWith('/api/v1/') &&
        !['/api/auth/session', '/api/auth/logout'].includes(path ?? '')
      )
        throw new Problem(404, 'not_found');
      const session = await auth.session(request);
      if (path === '/api/auth/session' && method === 'GET')
        return json(
          200,
          session
            ? {
                authenticated: true,
                authenticationEnabled: true,
                actorId: session.actorId,
                csrfToken: session.csrf,
                expiresAt: new Date(session.expiresAt * 1000).toISOString(),
                memberships: await operations.memberships(session.actorId),
              }
            : { authenticated: false, authenticationEnabled: true },
        );
      if (!session) throw new Problem(401, 'sign_in_required');
      if (method !== 'GET') auth.requireCsrf(request, session);
      if (path === '/api/auth/logout' && method === 'POST')
        return await auth.logout(request, session);
      if (path === '/api/v1/me' && method === 'GET')
        return json(200, {
          memberships: await operations.memberships(session.actorId),
        });
      return json(200, await operations.handle(session.actorId, request));
    } catch (error) {
      const problem =
        error instanceof Problem
          ? error
          : new Problem(503, 'temporarily_unavailable');
      if (!(error instanceof Problem))
        console.error(
          JSON.stringify({
            event: 'request_failed',
            requestId,
            code: problem.code,
          }),
        );
      if (path === '/api/auth/callback' && method === 'GET') {
        const response = json(problem.status, {}, [], {
          'content-type': 'text/html; charset=utf-8',
          'content-security-policy':
            "default-src 'none'; base-uri 'none'; frame-ancestors 'none'",
        });
        return {
          ...response,
          body: '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Quartermaster sign-in</title><h1>Sign-in could not be completed</h1><p>The sign-in attempt may have expired. Return to Quartermaster and start again.</p><a href="/">Return to Quartermaster</a></html>',
        };
      }
      return json(
        problem.status,
        {
          type: `urn:quartermaster:problem:${problem.code}`,
          title: problem.code,
          status: problem.status,
          code: problem.code,
          requestId,
        },
        [],
        {
          'content-type': 'application/problem+json',
          ...(problem.status === 503 ? { 'retry-after': '5' } : {}),
        },
      );
    }
  };
}
let configured: ReturnType<typeof application> | undefined;
export async function handler(request: Request) {
  if (!configured) {
    const keys = [
      'QM_ORIGIN',
      'QM_COGNITO_DOMAIN',
      'QM_CLIENT_ID',
      'QM_USER_POOL_ID',
      'QM_SESSIONS_TABLE',
      'QM_DATABASE_ARN',
      'QM_APP_SECRET_ARN',
    ];
    const values = keys.map((key) => process.env[key]);
    if (process.env.QM_WORKSPACE_ENABLED === 'true') {
      if (values.some((value) => !value))
        return json(503, { code: 'configuration_incomplete' });
      const [
        origin,
        cognitoDomain,
        clientId,
        userPoolId,
        table,
        resourceArn,
        secretArn,
      ] = values as string[];
      const config = {
        origin: origin!,
        cognitoDomain: cognitoDomain!,
        clientId: clientId!,
        userPoolId: userPoolId!,
      };
      if (
        config.origin !== 'https://qm.ejtbrown.com' ||
        !/^https:\/\/[a-z0-9-]+\.auth\.us-east-2\.amazoncognito\.com$/.test(
          config.cognitoDomain,
        )
      )
        return json(503, { code: 'configuration_invalid' });
      configured = application(
        new Auth(config, new DynamoAuthStore(table!), cognitoExchange(config)),
        new Operations(
          new DataApiDatabase({
            resourceArn: resourceArn!,
            secretArn: secretArn!,
            database: 'quartermaster',
          }),
        ),
      );
    } else configured = application();
  }
  return configured(request);
}
