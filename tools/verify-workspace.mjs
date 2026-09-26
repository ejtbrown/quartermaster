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
  status: 'synthetic-workspace',
  assetApiReady: true,
  syntheticOnly: true,
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
const login = await get('/api/auth/login');
assert.equal(login.status, 302);
uncached(login);
const cookie = login.headers
  .getSetCookie()
  .find((value) => value.startsWith('__Host-qm_login='));
assert.ok(cookie);
for (const flag of [
  'Secure',
  'HttpOnly',
  'SameSite=Lax',
  'Path=/',
  'Max-Age=600',
])
  assert.ok(cookie.includes(flag), `Login cookie needs ${flag}`);
assert.ok(!/domain=/i.test(cookie));
const authorize = new URL(login.headers.get('location'));
assert.equal(
  authorize.origin,
  'https://quartermaster-dev-264702148921.auth.us-east-2.amazoncognito.com',
);
assert.equal(authorize.pathname, '/oauth2/authorize');
assert.equal(authorize.searchParams.get('code_challenge_method'), 'S256');
assert.equal(authorize.searchParams.get('response_type'), 'code');
assert.equal(
  authorize.searchParams.get('redirect_uri'),
  origin + '/api/auth/callback',
);
const provider = await fetch(authorize, {
  redirect: 'follow',
  signal: AbortSignal.timeout(45000),
});
assert.equal(provider.status, 200);
assert.ok(
  (await provider.text()).includes('password'),
  'Provider sign-in form must be available',
);
const callback =
  '/api/auth/callback?' +
  new URLSearchParams({
    state: authorize.searchParams.get('state'),
    code: 'invalid-deployment-check',
  });
const wrongBinding = await get(callback, {
  headers: { cookie: '__Host-qm_login=wrong-binding' },
});
assert.equal(wrongBinding.status, 400);
uncached(wrongBinding);
const failedExchange = await get(callback, {
  headers: { cookie: cookie.split(';')[0] },
});
assert.equal(failedExchange.status, 401);
uncached(failedExchange);
assert.ok(!(await failedExchange.text()).includes('invalid-deployment-check'));
assert.equal(
  (await get(callback, { headers: { cookie: cookie.split(';')[0] } })).status,
  400,
);

const index = await get('/');
assert.equal(index.status, 200);
assert.ok(index.headers.get('content-security-policy'));
assert.ok(index.headers.get('strict-transport-security'));
assert.match(index.headers.get('permissions-policy') ?? '', /camera=\(\)/);
assert.match(index.headers.get('permissions-policy') ?? '', /microphone=\(\)/);
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
      '/api/auth/login',
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
    await page
      .getByRole('button', { name: 'Explore the sample register' })
      .click();
    await page.getByRole('heading', { name: 'Your asset estate' }).waitFor();
    assert.deepEqual(errors, []);
    await page.close();
  }
} finally {
  await browser.close();
}
console.log(
  'Live synthetic workspace verified: exact release/static hashes, anonymous denial, login PKCE/cookie binding/single-use state, provider form, DynamoDB access, security headers, private origins and desktop/mobile-viewport rendering. No accounts created; successful user/MFA enrollment remains untested.',
);
