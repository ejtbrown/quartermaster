import { readFile } from 'node:fs/promises';
import { test, expect } from '@playwright/test';
import { PGlite } from '@electric-sql/pglite';
import { Auth, hash } from '../../services/core-api/src/auth';
import type { AuthStore, Session } from '../../services/core-api/src/auth';
import { application } from '../../services/core-api/src/handler';
import { Operations } from '../../services/core-api/src/operations';

// Browser -> actual API router -> actual PostgreSQL/RLS. Only Cognito and the
// DynamoDB session lookup are injected; these are not live-provider/device tests.
const tenant = '11111111-1111-4111-8111-111111111111',
  actor = '33333333-3333-4333-8333-333333333333';
const id = 's'.repeat(43),
  csrf = 'c'.repeat(43);
let db: PGlite,
  session: Session | undefined,
  dropCreateResponse = false;
let mutationKeys: string[] = [];
test.beforeEach(async ({ page }) => {
  db = new PGlite();
  mutationKeys = [];
  dropCreateResponse = false;
  for (const file of [
    '0001_asset_foundation.sql',
    '0002_authenticated_operations.sql',
  ])
    await db.exec(await readFile('db/migrations/' + file, 'utf8'));
  await db.query('INSERT INTO qm.tenants(id,name) VALUES($1,$2)', [
    tenant,
    'Synthetic browser workspace',
  ]);
  await db.query(
    'INSERT INTO qm.memberships(tenant_id,actor_id,capabilities) VALUES($1,$2,$3)',
    [
      tenant,
      actor,
      ['assets:read', 'assets:write', 'maintenance:write', 'audit:read'],
    ],
  );
  session = {
    actorId: actor,
    csrf,
    expiresAt: Math.floor(Date.now() / 1000) + 3600,
    authenticatedAt: Math.floor(Date.now() / 1000),
  };
  const store: AuthStore = {
    async putLogin() {
      throw new Error('Not a Cognito test');
    },
    async takeLogin() {
      return undefined;
    },
    async putSession() {},
    async getSession(key) {
      return key === hash(id) ? session : undefined;
    },
    async deleteSession() {
      session = undefined;
    },
  };
  const auth = new Auth(
    {
      origin: 'http://127.0.0.1:4173',
      cognitoDomain: 'https://test.auth.us-east-2.amazoncognito.com',
      clientId: 'test',
      userPoolId: 'us-east-2_test',
    },
    store,
    async () => {
      throw new Error('Not a Cognito test');
    },
  );
  const ops = new Operations({
    transaction: (action) =>
      db.transaction(async (tx) => {
        await tx.exec('SET LOCAL ROLE qm_app');
        return action({
          query: async (q, v) => (await tx.query(q, v)).rows as never,
        });
      }),
  });
  const handle = application(auth, ops);
  await page.route('**/api/**', async (route) => {
    const request = route.request(),
      url = new URL(request.url()),
      headers = await request.allHeaders();
    const create =
      url.pathname.endsWith('/assets') && request.method() === 'POST';
    if (create) mutationKeys.push(headers['idempotency-key']!);
    const result = await handle({
      rawPath: url.pathname,
      rawQueryString: url.search.slice(1),
      headers,
      cookies: ['__Host-qm_session=' + id],
      requestContext: { http: { method: request.method() } },
      ...(request.postData() ? { body: request.postData()! } : {}),
    });
    if (create && dropCreateResponse) {
      dropCreateResponse = false;
      await route.abort('failed');
      return;
    }
    await route.fulfill({
      status: result.statusCode,
      headers: result.headers,
      body: result.body,
    });
  });
  page.on('dialog', (dialog) => dialog.accept());
});
test.afterEach(async () => {
  await db?.close();
});

test('invitation-only landing page never treats an anonymous visitor as a member', async ({
  page,
}) => {
  session = undefined;
  await page.goto('/');
  await expect(
    page.getByRole('link', { name: 'Sign in', exact: true }),
  ).toHaveAttribute('href', '/api/auth/login');
  await expect(
    page.getByRole('button', { name: 'Add asset', exact: true }),
  ).toHaveCount(0);
});
test('creates once after a lost acknowledgement, searches, edits and preserves stale-edit input', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await page.getByRole('button', { name: 'Add asset', exact: true }).click();
  await page.getByLabel('Name', { exact: true }).fill('Roof AC');
  await page
    .getByLabel('Location', { exact: true })
    .fill('Main / northwest roof');
  await page.getByLabel('Serial number', { exact: true }).fill('TEST-1234');
  dropCreateResponse = true;
  await page.getByRole('button', { name: 'Create asset', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Roof AC', exact: true }),
  ).toBeVisible({ timeout: 15000 });
  expect(mutationKeys).toHaveLength(2);
  expect(mutationKeys[0]).toBe(mutationKeys[1]);
  expect((await db.query('SELECT * FROM qm.assets')).rows).toHaveLength(1);
  await page.getByRole('searchbox').fill('TEST-1234');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await page.getByRole('button', { name: 'Roof AC', exact: true }).click();
  await page
    .getByLabel('Field notes', { exact: true })
    .fill('Weathered insulation');
  await db.query('UPDATE qm.assets SET version=version+1');
  await page.getByRole('button', { name: 'Save asset', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText(
    'changed in another session',
  );
  await expect(
    page.getByRole('textbox', { name: 'Field notes', exact: true }),
  ).toHaveValue('Weathered insulation');
  expect(errors).toEqual([]);
});
test('phone viewport saves and resumes drafts, schedules maintenance, records readings and audits', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Add asset', exact: true }).click();
  await page.getByLabel('Name', { exact: true }).fill('Draft appliance');
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Saved on the server');
  await page.getByRole('button', { name: 'Close editor', exact: true }).click();
  await page
    .getByRole('button', { name: 'Draft appliance', exact: true })
    .click();
  await page.getByLabel('Location', { exact: true }).fill('Kitchen');
  await expect(
    page.getByRole('button', { name: 'Create asset from draft', exact: true }),
  ).toBeDisabled();
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await page
    .getByRole('button', { name: 'Create asset from draft', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Draft appliance', exact: true })
    .click();
  await page
    .getByLabel('Task', { exact: true })
    .fill('Replace tubing insulation');
  await page.getByLabel('Due date', { exact: true }).fill('2026-12-31');
  await page.getByRole('button', { name: 'Add task', exact: true }).click();
  await expect(
    page.getByText('Replace tubing insulation', { exact: true }),
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'Mark completed', exact: true })
    .click();
  await page
    .getByLabel('Measurement', { exact: true })
    .fill('Compressor current');
  await page.getByLabel('Value', { exact: true }).fill('4.3');
  await page.getByLabel('Unit', { exact: true }).fill('A');
  await page
    .getByLabel('Observed at (local time)', { exact: true })
    .fill('2026-09-24T12:00');
  await page.getByRole('button', { name: 'Add reading', exact: true }).click();
  await expect(
    page.getByText('Compressor current: 4.3 A', { exact: true }),
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'View audit history', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Content-free audit history' }),
  ).toBeVisible();
  expect((await db.query('SELECT * FROM qm.drafts')).rows).toHaveLength(0);
  expect((await db.query('SELECT status FROM qm.maintenance')).rows).toEqual([
    { status: 'completed' },
  ]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: '.local/workspace-mobile.png',
    fullPage: true,
  });
});
test('read-only memberships have no mutation controls and sign out clears access', async ({
  page,
}) => {
  await db.query('UPDATE qm.memberships SET capabilities=$1', [
    ['assets:read'],
  ]);
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: 'Your asset estate' }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Add asset', exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'View audit history', exact: true }),
  ).toHaveCount(0);
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(
    page.getByRole('link', { name: 'Sign in', exact: true }),
  ).toBeVisible();
});

test('refreshing after a different identity signs in clears the previous private editor', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Add asset', exact: true }).click();
  await page.getByLabel('Name', { exact: true }).fill('Private unsaved draft');
  const otherActor = '44444444-4444-4444-8444-444444444444';
  await db.query(
    'INSERT INTO qm.memberships(tenant_id,actor_id,capabilities) VALUES($1,$2,$3)',
    [tenant, otherActor, ['assets:read', 'assets:write']],
  );
  session = { ...session!, actorId: otherActor };
  await page
    .getByRole('button', { name: 'Refresh session', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Your asset estate' }),
  ).toBeVisible();
  await expect(
    page.getByRole('region', { name: 'Asset workspace', exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByText('Private unsaved draft', { exact: true }),
  ).toHaveCount(0);
});
