import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';

// Explicit post-release development check, never a scheduled warm-up. Creates
// only a ten-minute login flow, then consumes it with a deliberately invalid code.
// Does not create users, memberships, sessions, assets or invitations.
const origin = 'https://qm.ejtbrown.com';
const sha = process.env.QM_EXPECTED_RELEASE;
assert.match(sha ?? '', /^[0-9a-f]{40}$/);
const get = (path, options = {}) =>
  fetch(new URL(path, origin), {
    redirect: 'manual',
    signal: AbortSignal.timeout(45000),
    ...options,
  });
function uncached(response) {
  assert.match(response.headers.get('cache-control') ?? '', /no-store/);
  assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
}
const health = await get('/api/health');
assert.equal(health.status, 200);
uncached(health);
assert.deepEqual(await health.json(), {
  service: 'quartermaster',
  status: 'workspace',
  assetApiReady: true,
  syntheticOnly: false,
  release: sha,
});
for (const headers of [
  {},
  { cookie: '__Host-qm_session=' + randomBytes(32).toString('base64url') },
]) {
  const session = await get('/api/auth/session', { headers });
  assert.equal(session.status, 200);
  uncached(session);
  assert.deepEqual(await session.json(), {
    authenticated: false,
    authenticationEnabled: true,
  });
}
assert.equal((await get('/api/assets')).status, 404);
assert.equal(
  (await get('/api/v1/tenants/11111111-1111-4111-8111-111111111111/assets'))
    .status,
  401,
);
// Prove each write verb reaches application authentication through OAC.
// No session means none of these requests can mutate a record.
for (const method of ['POST', 'PATCH', 'DELETE']) {
  const body = method === 'DELETE' ? undefined : '{}';
  const response = await get(
    '/api/v1/tenants/11111111-1111-4111-8111-111111111111/assets',
    {
      method,
      headers: {
        'content-type': 'application/json',
        'x-amz-content-sha256': createHash('sha256')
          .update(body ?? '')
          .digest('hex'),
      },
      ...(body === undefined ? {} : { body }),
    },
  );
  assert.equal(
    response.status,
    401,
    `Private-origin ${method} must reach authentication`,
  );
  assert.equal((await response.json()).code, 'sign_in_required');
}
const login = await get('/api/auth/login');
assert.equal(login.status, 302);
assert.equal(login.headers.get('location'), '/sign-in');
uncached(login);
const flow = await get('/api/auth/flow');
assert.equal(flow.status, 200);
uncached(flow);
const flowCookie = flow.headers
  .getSetCookie()
  .find((value) => value.startsWith('__Host-qm_signin='));
assert.ok(flowCookie);
for (const flag of [
  'Secure',
  'HttpOnly',
  'SameSite=Lax',
  'Path=/',
  'Max-Age=600',
])
  assert.ok(flowCookie.includes(flag));
assert.ok(!/domain=/i.test(flowCookie));
const challenge = await flow.json();
assert.equal(challenge.step, 'credentials');
assert.match(challenge.csrfToken, /^[A-Za-z0-9_-]{43}$/);
const body = JSON.stringify({ action: 'totp', code: '000000' });
const options = {
  method: 'POST',
  body,
  headers: {
    origin,
    'content-type': 'application/json',
    'x-csrf-token': challenge.csrfToken,
    cookie: flowCookie.split(';')[0],
    'x-amz-content-sha256': createHash('sha256').update(body).digest('hex'),
  },
};
const crossOrigin = await get('/api/auth/flow', {
  ...options,
  headers: { ...options.headers, origin: 'https://invalid.example' },
});
assert.equal(crossOrigin.status, 403);
const wrongStep = await get('/api/auth/flow', options);
assert.equal(wrongStep.status, 400);
assert.equal((await wrongStep.json()).code, 'invalid_fields');
assert.equal((await get('/api/auth/flow', options)).status, 400);
// No username/password was submitted; this proves application binding/replay
// protection, not a successful provider authentication.

const index = await get('/');
assert.equal(index.status, 200);
assert.ok(index.headers.get('content-security-policy'));
assert.ok(index.headers.get('strict-transport-security'));
assert.match(index.headers.get('permissions-policy') ?? '', /camera=\(self\)/);
assert.match(
  index.headers.get('permissions-policy') ?? '',
  /microphone=\(self\)/,
);
const html = await index.text();
assert.equal(html, await readFile('apps/web/dist/index.html', 'utf8'));
for (const [, path] of html.matchAll(/(?:src|href)="(\/assets\/[^\"]+)"/g)) {
  const response = await get(path);
  assert.equal(response.status, 200);
  const digest = (data) => createHash('sha256').update(data).digest('hex');
  assert.equal(
    digest(Buffer.from(await response.arrayBuffer())),
    digest(await readFile('apps/web/dist' + path)),
  );
}
for (const url of [
  'https://quartermaster-dev-web-264702148921-us-east-2.s3.us-east-2.amazonaws.com/index.html',
  'https://jhttbvqmcldzubj7xuf4armmsu0fhnrf.lambda-url.us-east-2.on.aws/api/health',
])
  assert.equal(
    (await fetch(url, { signal: AbortSignal.timeout(45000) })).status,
    403,
  );

const browser = await chromium.launch({ headless: true });
try {
  for (const width of [1440, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.name));
    await page.goto(origin, { waitUntil: 'networkidle' });
    await page.getByRole('link', { name: 'Sign in', exact: true }).waitFor();
    assert.equal(
      await page
        .getByRole('link', { name: 'Sign in', exact: true })
        .getAttribute('href'),
      '/sign-in',
    );
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    await page.screenshot({
      path: `.local/live-workspace-${width}.png`,
      fullPage: true,
    });
    assert.equal(
      await page
        .getByRole('button', { name: 'Explore the sample register' })
        .count(),
      0,
    );
    await page.getByRole('link', { name: 'Sign in', exact: true }).click();
    await page.getByLabel('Email address', { exact: true }).waitFor();
    assert.equal(new URL(page.url()).origin, origin);
    assert.equal(new URL(page.url()).pathname, '/sign-in');
    await page.evaluate(() => document.fonts.ready);
    assert.ok(
      await page.evaluate(
        () =>
          document.fonts.check('700 32px Manrope') &&
          document.fonts.check('400 16px "Source Sans 3"'),
      ),
    );
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    await page.screenshot({
      path: `.local/live-signin-${width}.png`,
      fullPage: true,
    });
    assert.deepEqual(errors, []);
    await page.close();
  }
} finally {
  await browser.close();
}
console.log(
  'Live operational entry verified: exact release/static hashes, anonymous denial, same-origin sign-in, cookie/CSRF binding and single-use challenge state, DynamoDB access, security headers, private origins and desktop/mobile-viewport rendering. This check creates no accounts and does not claim successful user/MFA enrollment.',
);
