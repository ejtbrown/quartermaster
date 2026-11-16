import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { test, expect } from '@playwright/test';
import { PGlite } from '@electric-sql/pglite';
import { Auth, hash } from '../../services/core-api/src/auth';
import type {
  AuthStore,
  Session,
  Login,
} from '../../services/core-api/src/auth';
import { application } from '../../services/core-api/src/handler';
import { Operations } from '../../services/core-api/src/operations';
import { Capability } from '../../packages/contracts/src/index';
import { Worker } from '../../services/core-api/src/worker';
import type {
  Platform,
  QueueMessage,
} from '../../services/core-api/src/platform';
import type { Database } from '../../services/core-api/src/database';

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
let compatibilityMode = false,
  compatibilityAuth: Auth;
let compatibilityLogin: Login | undefined;
let compatibilityNonce = '';
const compatibilitySessions = new Map<string, Session>();
test.beforeEach(async ({ page }) => {
  compatibilityMode = false;
  compatibilityLogin = undefined;
  compatibilitySessions.clear();
  db = new PGlite();
  mutationKeys = [];
  dropCreateResponse = false;
  for (const file of [
    '0001_asset_foundation.sql',
    '0002_authenticated_operations.sql',
    '0003_operator_rls_access.sql',
    '0004_operational_estate.sql',
  ])
    await db.exec(await readFile('db/migrations/' + file, 'utf8'));
  await db.query('INSERT INTO qm.tenants(id,name) VALUES($1,$2)', [
    tenant,
    'Synthetic browser workspace',
  ]);
  await db.query(
    'INSERT INTO qm.memberships(tenant_id,actor_id,capabilities) VALUES($1,$2,$3)',
    [tenant, actor, Capability.options],
  );
  session = {
    actorId: actor,
    csrf,
    expiresAt: Math.floor(Date.now() / 1000) + 3600,
    authenticatedAt: Math.floor(Date.now() / 1000),
  };
  const store: AuthStore = {
    async putLogin(login) {
      if (!compatibilityMode) throw new Error('Not a Cognito test');
      compatibilityLogin = login;
    },
    async takeLogin(state, binding, now) {
      const login = compatibilityLogin;
      if (
        !login ||
        login.state !== state ||
        login.binding !== binding ||
        login.expiresAt <= now
      )
        return undefined;
      compatibilityLogin = undefined;
      return login;
    },
    async putSession(key, value) {
      compatibilitySessions.set(key, value);
    },
    async getSession(key) {
      return compatibilityMode
        ? compatibilitySessions.get(key)
        : key === hash(id)
          ? session
          : undefined;
    },
    async deleteSession(key) {
      compatibilitySessions.delete(key);
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
    async (code, verifier) => {
      if (!compatibilityMode) throw new Error('Not a Cognito test');
      expect(code).toBe('synthetic-authorization-code');
      expect(verifier.length).toBeGreaterThanOrEqual(43);
      return {
        actorId: actor,
        nonce: compatibilityNonce,
        expiresAt: Math.floor(Date.now() / 1000) + 3600,
        authenticatedAt: Math.floor(Date.now() / 1000),
      };
    },
  );
  compatibilityAuth = auth;
  const pending: QueueMessage[] = [];
  const platform: Platform = {
    enqueue: async (m) => {
      pending.push(m);
    },
    schedule: async () => {},
    invite: async () => ({ actorId: crypto.randomUUID(), created: true }),
    model: async () => ({
      text: JSON.stringify({
        reply: 'Please review the insulation task and coil access note.',
        fields: {
          name: 'Roof AC',
          assetClass: 'air_conditioner',
          location: 'Roof northwest',
          manufacturer: 'Test',
          model: 'ZYX',
          serialNumber: '1234',
          notes: '',
        },
        components: [
          {
            name: 'Outdoor coil',
            kind: 'coil',
            accessConstraints: 'Cover screws rounded out',
            notes: '',
          },
        ],
        maintenance: [
          {
            title: 'Replace tubing insulation',
            dueDate: '2026-12-31',
            notes: '',
          },
        ],
        readings: [
          {
            label: 'Compressor current',
            value: 4.3,
            unit: 'A',
            notes: 'Volunteered observation',
          },
        ],
        requestedPhoto: null,
        readyForReview: true,
      }),
      model: 'test',
      inputTokens: 1,
      outputTokens: 1,
    }),
    transcribe: async () => 'Test voice observation',
    upload: async () => {
      throw new Error('Not a photo transport test');
    },
    headUpload: async () => {
      throw new Error('Not a photo transport test');
    },
    download: async () => {
      throw new Error('Not a signed URL test');
    },
    read: async () => new Uint8Array(),
    write: async () => {},
    purge: async () => {},
    tombstone: async () => {},
  };
  const database = (role: string): Database => ({
    transaction: (action) =>
      db.transaction(async (tx) => {
        await tx.exec(`SET LOCAL ROLE ${role}`);
        return action({
          query: async (q, v) => (await tx.query(q, v)).rows as never,
        });
      }),
  });
  const ops = new Operations(database('qm_app'), platform),
    worker = new Worker(database('qm_worker'), platform);
  const handle = application(auth, ops);
  await page.route('**/api/**', async (route) => {
    const request = route.request(),
      url = new URL(request.url()),
      headers = await request.allHeaders();
    if (!['GET', 'HEAD'].includes(request.method()))
      expect(headers['x-amz-content-sha256']).toBe(
        createHash('sha256')
          .update(request.postData() ?? '')
          .digest('hex'),
      );
    const create =
      url.pathname.endsWith('/assets') && request.method() === 'POST';
    if (create) mutationKeys.push(headers['idempotency-key']!);
    const result = await handle({
      rawPath: url.pathname,
      rawQueryString: url.search.slice(1),
      headers,
      cookies: compatibilityMode
        ? (headers.cookie ?? '')
            .split(';')
            .map((value) => value.trim())
            .filter(Boolean)
        : ['__Host-qm_session=' + id],
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
      headers: {
        ...result.headers,
        ...(compatibilityMode && result.cookies.length
          ? { 'set-cookie': result.cookies.join('\n') }
          : {}),
      },
      body: result.body,
    });
    while (pending.length) await worker.run(pending.shift()!);
  });
  page.on('dialog', (dialog) => dialog.accept());
  await page.addLocatorHandler(page.getByRole('dialog'), async () => {
    await page
      .getByRole('dialog')
      .getByRole('button', { name: /^(Continue|Confirm deletion)$/ })
      .click();
  });
});

test('assisted capture keeps human review separate and commits components, tasks and readings together', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByRole('link', { name: 'Capture', exact: true }).click();
  await page
    .getByRole('button', { name: 'Start capture', exact: true })
    .click();
  await page
    .getByLabel('Your answer', { exact: true })
    .fill(
      'Add the roof AC. Coil cover screws are rounded out. Current is 4.3 amps and insulation needs replacing before year end.',
    );
  await page.getByRole('button', { name: 'Send answer', exact: true }).click();
  await expect(
    page
      .locator('.transcript')
      .getByText(/Please review the insulation task and coil access note/),
  ).toBeVisible({ timeout: 15000 });
  expect((await db.query('SELECT id FROM qm.assets')).rows).toHaveLength(0);
  await page
    .getByRole('button', { name: 'Apply proposal to review form' })
    .click();
  await expect(
    page.getByLabel('Access Constraints', { exact: true }),
  ).toHaveValue('Cover screws rounded out');
  await page.getByRole('button', { name: 'Save draft details' }).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'Saved on the server' }),
  ).toBeVisible();
  await page
    .getByRole('checkbox', {
      name: 'I have reviewed the asset, photos, components, tasks and readings.',
    })
    .check();
  await page.getByRole('button', { name: 'Create reviewed asset' }).click();
  await expect(page.getByText(/Asset saved with the confirmed/)).toBeVisible();
  expect(
    (
      await db.query(
        "SELECT content->>'accessConstraints' AS note FROM qm.records WHERE kind='components'",
      )
    ).rows,
  ).toEqual([{ note: 'Cover screws rounded out' }]);
  expect((await db.query('SELECT value FROM qm.readings')).rows).toEqual([
    { value: 4.3 },
  ]);
  expect(
    (await db.query('SELECT due_date::text AS due FROM qm.maintenance')).rows,
  ).toEqual([{ due: '2026-12-31' }]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test.describe('Foreground voice with generated test audio', () => {
  test('loads the real AudioWorklet, transcribes only on request and discards interrupted recording', async ({
    page,
  }) => {
    // This host's headless capture device returns NotSupportedError. Inject
    // only the device stream; use the real AudioContext/Worklet/PCM path.
    // Permission prompts and physical microphones remain device acceptance.
    await page.addInitScript(() => {
      navigator.mediaDevices.getUserMedia = async () => {
        const context = new AudioContext();
        const source = context.createOscillator();
        const output = context.createMediaStreamDestination();
        source.connect(output);
        source.start();
        return output.stream;
      };
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    await page.getByRole('link', { name: 'Capture', exact: true }).click();
    await page
      .getByRole('button', { name: 'Start capture', exact: true })
      .click();
    await page.getByRole('button', { name: 'Record a voice answer' }).click();
    await expect(
      page.getByRole('button', { name: 'Stop and transcribe' }),
    ).toBeVisible();
    // Collect several real worklet frames from the generated audio stream.
    await page.waitForTimeout(500);
    const audioRequest = page.waitForRequest((request) =>
      request.url().endsWith('/transcribe'),
    );
    await page.getByRole('button', { name: 'Stop and transcribe' }).click();
    const audio = Buffer.from(
      (await audioRequest).postDataJSON().pcm as string,
      'base64',
    );
    expect(audio.length).toBeGreaterThan(3200);
    expect(audio.length).toBeLessThanOrEqual(640000);
    expect(audio.length % 2).toBe(0);
    await expect(
      page.getByRole('textbox', { name: 'Your answer', exact: true }),
    ).toHaveValue('Test voice observation');
    expect((await db.query('SELECT id FROM qm.assets')).rows).toHaveLength(0);
    expect(
      (await db.query("SELECT id FROM qm.turns WHERE role='transcript'")).rows,
    ).toHaveLength(1);
    expect(
      (await db.query("SELECT id FROM qm.turns WHERE role='user'")).rows,
    ).toHaveLength(0);
    await page.getByRole('button', { name: 'Record a voice answer' }).click();
    await expect(
      page.getByRole('button', { name: 'Stop and transcribe' }),
    ).toBeVisible();
    await page.evaluate(() => {
      Object.defineProperty(navigator, 'onLine', {
        configurable: true,
        get: () => false,
      });
      window.dispatchEvent(new Event('offline'));
    });
    await expect(
      page.getByText(
        'Recording discarded after an interruption. Tap Record when ready.',
      ),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Stop and transcribe' }),
    ).toHaveCount(0);
    expect(
      (await db.query("SELECT id FROM qm.turns WHERE role='transcript'")).rows,
    ).toHaveLength(1);
  });
});

test('creates an organizational location, edits it with history, and runs an empty report without demo data', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('link', { name: 'Locations', exact: true }).click();
  await page.getByRole('button', { name: 'Add location', exact: true }).click();
  await page.getByLabel('Name', { exact: true }).fill('Main building');
  await page
    .getByRole('button', { name: 'Save location', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Main building v1' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByLabel('Notes', { exact: true }).fill('North entrance');
  await page
    .getByRole('button', { name: 'Save location', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Main building v2' }),
  ).toBeVisible();
  await page.getByRole('link', { name: 'Reports', exact: true }).click();
  await page.getByRole('button', { name: 'Run report', exact: true }).click();
  await expect(page.getByText('Preparing report…')).toHaveCount(0);
  expect((await db.query('SELECT id FROM qm.assets')).rows).toHaveLength(0);
  expect(
    (await db.query('SELECT version FROM qm.record_history ORDER BY version'))
      .rows,
  ).toEqual([{ version: 1 }]);
});
test.afterEach(async () => {
  await db?.close();
});

test('accepted styling, help, narrow reflow and structured asset types are usable', async ({
  page,
}) => {
  await page.goto('/');
  await page.evaluate(() => document.fonts.ready);
  await expect(
    page.getByRole('heading', { name: 'Your asset estate' }),
  ).toBeVisible();
  expect(
    await page.locator('h1').evaluate((el) => getComputedStyle(el).fontFamily),
  ).toContain('Manrope');
  await page.getByRole('button', { name: 'About Needs attention' }).click();
  await expect(page.getByRole('note')).toContainText('counted separately');
  await page.keyboard.press('Escape');
  await expect(
    page.getByRole('button', { name: 'About Needs attention' }),
  ).toBeFocused();
  await page.screenshot({
    path: '.local/redesign-register-desktop.png',
    fullPage: true,
  });
  await page.getByRole('link', { name: 'Asset types', exact: true }).click();
  await page
    .getByRole('button', { name: 'Add asset type', exact: true })
    .click();
  await page.getByLabel('Name', { exact: true }).fill('Test generator');
  await page.getByLabel('Code', { exact: true }).fill('test_generator');
  await page.getByRole('button', { name: 'Add field', exact: true }).click();
  await page.getByLabel('Field label', { exact: true }).fill('Output');
  await page.getByLabel('Field key', { exact: false }).fill('output');
  await page.getByLabel('Value type').selectOption('number');
  await page
    .getByRole('button', { name: 'Save asset type', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Test generator v1' }),
  ).toBeVisible();
  await page.setViewportSize({ width: 320, height: 800 });
  await page
    .getByRole('navigation', { name: 'Quick navigation' })
    .getByRole('link', { name: 'Assets', exact: true })
    .click();
  await page.getByRole('button', { name: 'About Open maintenance' }).click();
  await expect(page.getByRole('note')).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: '.local/redesign-register-mobile.png',
    fullPage: true,
  });
});

test('confirmation defaults to cancel, traps focus and can be dismissed with Escape', async ({
  page,
}) => {
  await page.removeLocatorHandler(page.getByRole('dialog'));
  await page.goto('/');
  await page.getByRole('button', { name: 'Add asset', exact: true }).click();
  await page.getByLabel('Name', { exact: true }).fill('Unsaved test entry');
  await page.getByRole('button', { name: 'Close editor', exact: true }).click();
  const modal = page.getByRole('dialog');
  await expect(
    modal.getByRole('button', { name: 'Cancel', exact: true }),
  ).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(modal).not.toBeVisible();
  await expect(page.getByLabel('Name', { exact: true })).toHaveValue(
    'Unsaved test entry',
  );
  await expect(
    page.getByRole('button', { name: 'Close editor', exact: true }),
  ).toBeFocused();
});

test('invitation-only landing page never treats an anonymous visitor as a member', async ({
  page,
}) => {
  session = undefined;
  await page.goto('/');
  await expect(
    page.getByRole('link', { name: 'Sign in', exact: true }),
  ).toHaveAttribute('href', '/sign-in');
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
  await page.goto('/#assets');
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
    .getByRole('navigation', { name: 'Asset sections' })
    .getByRole('button', { name: 'Maintenance', exact: true })
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
  await page.getByText('Account & session', { exact: true }).click();
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
  await page.getByText('Account & session', { exact: true }).click();
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

async function seedRegister(count = 55) {
  for (let n = 1; n <= count; n++) {
    await db.query(
      'INSERT INTO qm.assets(tenant_id,id,name,asset_class,status,location,serial_number) VALUES($1,$2,$3,$4,$5,$6,$7)',
      [
        tenant,
        `aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12, '0')}`,
        n === 55
          ? 'Roof ventilation unit with a realistically long descriptive asset name'
          : `Estate unit ${n}`,
        'air_conditioner',
        n === 55 ? 'needs_attention' : n === 54 ? 'retired' : 'in_service',
        'Main building / Upper floor / Mechanical room',
        `TEST-${n}`,
      ],
    );
  }
}

test('desktop list/detail restores the second page, filters, focus and keyboard navigation', async ({
  page,
}) => {
  await seedRegister();
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto('/');
  await expect(
    page.getByRole('link', { name: 'Capture', exact: true }),
  ).toHaveCount(0);
  await page.getByRole('button', { name: 'Load more assets' }).click();
  const name =
    'Roof ventilation unit with a realistically long descriptive asset name';
  const row = page.getByRole('button', { name, exact: true });
  await row.scrollIntoViewIfNeeded();
  const listY = await page.evaluate(() => window.scrollY);
  const rowY = (await row.boundingBox())!.y;
  await row.dblclick();
  await expect(page).toHaveURL(/asset=aaaaaaaa-aaaa-4aaa-8aaa-000000000055/);
  await expect(
    page.getByRole('region', { name: 'Asset register', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Photos', exact: true }).click();
  await expect(page).toHaveURL(/detail=Photos/);
  await page.goBack();
  await expect(page.getByLabel('Field notes', { exact: true })).toBeVisible();
  await page
    .getByLabel('Field notes', { exact: true })
    .fill('Reviewed locally');
  let releaseRefresh!: () => void;
  const refreshGate = new Promise<void>((resolve) => {
    releaseRefresh = resolve;
  });
  await page.route('**/assets?*', async (route) => {
    if (route.request().method() === 'GET') await refreshGate;
    await route.fallback();
  });
  await page.getByRole('button', { name: 'Save asset', exact: true }).click();
  await expect(
    page.getByText('Refreshing assets… Your current results remain available.'),
  ).toBeVisible();
  await expect(
    page.getByRole('region', { name: 'Asset workspace', exact: true }),
  ).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(listY);
  await expect.poll(async () => (await row.boundingBox())!.y).toBe(rowY);
  await expect(row).toBeInViewport();
  releaseRefresh();
  await expect(
    page.getByRole('button', { name: 'Search', exact: true }),
  ).toBeEnabled();
  await expect(row).toBeVisible();
  await expect(row).toBeFocused();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(listY);
  await expect.poll(async () => (await row.boundingBox())!.y).toBe(rowY);
  await expect(row).toBeInViewport();
  await expect(page.locator('.asset-button')).toHaveCount(55);
  await page.getByRole('searchbox').fill('TEST-55');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(page.locator('.asset-button')).toHaveCount(1);
  await row.click();
  await page.goBack();
  await expect(page.getByRole('searchbox')).toHaveValue('TEST-55');
  await expect(row).toBeFocused();
  await page
    .getByRole('link', { name: 'View assets needing attention' })
    .click();
  await expect(page.locator('.asset-button')).toHaveCount(1);
  await page.screenshot({
    path: '.local/qm4-desktop-register.png',
    fullPage: true,
  });
  await row.click();
  await expect(
    page.getByRole('heading', { name: 'Asset details', exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: '.local/qm4-desktop-detail.png',
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test('mobile default is explicit capture, with manual entry and stable activity on resize', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const writes: string[] = [];
  page.on('request', (r) => {
    if (r.method() === 'POST') writes.push(r.url());
  });
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: 'Assisted asset capture' }),
  ).toBeVisible();
  expect(writes).toEqual([]);
  await expect(
    page.getByRole('button', { name: 'Record a voice answer' }),
  ).toHaveCount(0);
  await page
    .getByRole('navigation', { name: 'Quick navigation' })
    .getByRole('link', { name: 'Assets', exact: true })
    .click();
  await page.getByRole('button', { name: 'Add asset', exact: true }).click();
  await page.getByLabel('Name', { exact: true }).fill('Unsent phone entry');
  await page.setViewportSize({ width: 1600, height: 1000 });
  await expect(page.getByLabel('Name', { exact: true })).toHaveValue(
    'Unsent phone entry',
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: '.local/qm4-mobile-manual.png',
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test('dirty Back cancellation retains the editor and clean navigation does not prompt', async ({
  page,
}) => {
  await page.removeLocatorHandler(page.getByRole('dialog'));
  await seedRegister(1);
  await page.goto('/#assets');
  await page
    .getByRole('button', { name: 'Estate unit 1', exact: true })
    .click();
  await page.getByLabel('Field notes', { exact: true }).fill('Keep this input');
  await page.getByRole('button', { name: 'Photos', exact: true }).click();
  // Dirty overview fields remain protected when another asset detail tab is visible.
  await page.getByRole('link', { name: 'Maintenance', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.goBack(); // Photos -> Overview, no discarded input.
  await page.goBack(); // Overview -> register, requires confirmation.
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Cancel', exact: true })
    .click();
  await expect(
    page.getByRole('textbox', { name: 'Field notes', exact: true }),
  ).toHaveValue('Keep this input');
  await expect(page).toHaveURL(/asset=/);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Continue', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Estate unit 1', exact: true })
    .click();
  await page.getByRole('button', { name: 'Close editor' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('independent summary and draft failures leave the register usable; failed asset loading is not empty', async ({
  page,
}) => {
  await seedRegister(1);
  for (const tail of ['summary', 'drafts'])
    await page.route(`**/api/v1/tenants/*/${tail}`, (r) =>
      r.fulfill({ status: 403, json: { code: 'capability_required' } }),
    );
  await page.goto('/#assets');
  await expect(
    page.getByRole('button', { name: 'Estate unit 1', exact: true }),
  ).toBeVisible();
  await expect(page.getByText(/Estate summary unavailable:/)).toBeVisible();
  await expect(page.getByText(/Drafts unavailable:/)).toBeVisible();
  await page.route('**/api/v1/tenants/*/assets?*', (r) =>
    r.fulfill({ status: 403, json: { code: 'capability_required' } }),
  );
  await page.getByRole('searchbox').fill('Nothing');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Retry loading' }),
  ).toBeVisible();
  await expect(
    page.getByText('No matching assets', { exact: true }),
  ).toHaveCount(0);
  await page.screenshot({
    path: '.local/qm4-register-error.png',
    fullPage: true,
  });
  await page.unroute('**/api/v1/tenants/*/assets?*');
  await page.getByRole('button', { name: 'Retry loading' }).click();
  await expect(
    page.getByText('No matching assets', { exact: true }),
  ).toBeVisible();
});

test('read-only mobile uses Assets and cross-workspace history cannot restore private context', async ({
  page,
}) => {
  await seedRegister(1);
  const other = '22222222-2222-4222-8222-222222222222';
  await db.query('INSERT INTO qm.tenants(id,name) VALUES($1,$2)', [
    other,
    'Second estate',
  ]);
  await db.query(
    'INSERT INTO qm.memberships(tenant_id,actor_id,capabilities) VALUES($1,$2,$3)',
    [other, actor, ['assets:read']],
  );
  await db.query('UPDATE qm.memberships SET capabilities=$1', [
    ['assets:read'],
  ]);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: 'Your asset estate' }),
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'Estate unit 1', exact: true })
    .click();
  await page.getByLabel('Organization', { exact: true }).selectOption(other);
  await expect(page.getByLabel('Organization', { exact: true })).toHaveValue(
    other,
  );
  await expect(
    page.getByRole('button', { name: 'Estate unit 1', exact: true }),
  ).toHaveCount(0);
  await page.goBack();
  await expect(
    page.getByRole('button', { name: 'Estate unit 1', exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole('region', { name: 'Asset workspace', exact: true }),
  ).toHaveCount(0);
});

test('complete location hierarchy links exact-location assets and maintenance links named asset details', async ({
  page,
}) => {
  await seedRegister(1);
  const assetId = 'aaaaaaaa-aaaa-4aaa-8aaa-000000000001';
  const root = 'bbbbbbbb-bbbb-4bbb-8bbb-000000000001',
    leaf = 'bbbbbbbb-bbbb-4bbb-8bbb-000000000052';
  for (let n = 1; n <= 52; n++) {
    const id = `bbbbbbbb-bbbb-4bbb-8bbb-${String(n).padStart(12, '0')}`;
    await db.query(
      "INSERT INTO qm.records(tenant_id,id,kind,content) VALUES($1,$2,'locations',$3::jsonb)",
      [
        tenant,
        id,
        JSON.stringify({
          name: n === 1 ? 'Main site' : n === 52 ? 'Roof plant' : `Area ${n}`,
          kind: n === 1 ? 'site' : 'area',
          parentId: n === 1 ? null : root,
          address: '',
          notes: '',
        }),
      ],
    );
  }
  await db.query('UPDATE qm.assets SET details=$1::jsonb', [
    JSON.stringify({ locationId: leaf }),
  ]);
  await db.query(
    "INSERT INTO qm.maintenance(tenant_id,id,asset_id,title,status,notes) VALUES($1,$2,$3,$4,$5,'')",
    [
      tenant,
      'cccccccc-cccc-4ccc-8ccc-000000000001',
      assetId,
      'Inspect ventilation',
      'open',
    ],
  );
  await page.goto('/#locations');
  await page
    .getByRole('link', { name: 'Main site / Roof plant', exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: 'Estate unit 1', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(
      'Exact location only; descendant locations are not included.',
    ),
  ).toBeVisible();
  await page.getByRole('link', { name: 'Maintenance', exact: true }).click();
  await page.getByRole('link', { name: 'Estate unit 1', exact: true }).click();
  await expect(page).toHaveURL(/detail=Maintenance/);
  await expect(
    page.getByText('Inspect ventilation', { exact: true }),
  ).toBeVisible();
});

test('expired sessions preserve edits through same-identity refresh and retry', async ({
  page,
}) => {
  await seedRegister(1);
  await page.goto('/#assets');
  await page
    .getByRole('button', { name: 'Estate unit 1', exact: true })
    .click();
  await page
    .getByLabel('Field notes', { exact: true })
    .fill('Keep through reauthentication');
  const validSession = session;
  session = undefined;
  await page.getByRole('button', { name: 'Save asset', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('session expired');
  await expect(
    page.getByRole('textbox', { name: 'Field notes', exact: true }),
  ).toHaveValue('Keep through reauthentication');
  session = validSession;
  await page.getByText('Account & session', { exact: true }).click();
  await page
    .getByRole('button', { name: 'Refresh session', exact: true })
    .click();
  await page.getByRole('button', { name: 'Save asset', exact: true }).click();
  await expect(
    page.getByRole('region', { name: 'Asset workspace', exact: true }),
  ).toHaveCount(0);
  expect((await db.query('SELECT notes FROM qm.assets')).rows).toEqual([
    { notes: 'Keep through reauthentication' },
  ]);
});

test('Forward restores asset detail, tab and filters after Back without losing edits', async ({
  page,
}) => {
  await page.removeLocatorHandler(page.getByRole('dialog'));
  await seedRegister(1);
  await page.goto('/#assets?q=TEST-1');
  const row = page.getByRole('button', { name: 'Estate unit 1', exact: true });
  await row.click();
  await page.getByRole('button', { name: 'Photos', exact: true }).click();
  await page.goBack();
  await expect(
    page.getByRole('textbox', { name: 'Field notes', exact: true }),
  ).toBeVisible();
  await page.goForward();
  await expect(page).toHaveURL(/detail=Photos/);
  await expect(
    page.getByRole('button', { name: 'Photos', exact: true }),
  ).toHaveAttribute('aria-current', 'page');
  await page.goBack();
  await page
    .getByRole('textbox', { name: 'Field notes', exact: true })
    .fill('Retain across detail history');
  await page.goForward();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.goBack();
  await expect(
    page.getByRole('textbox', { name: 'Field notes', exact: true }),
  ).toHaveValue('Retain across detail history');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Continue', exact: true })
    .click();
  await expect(row).toBeVisible();
  await expect(page.getByRole('searchbox')).toHaveValue('TEST-1');
  await row.click();
  await page.goBack();
  await expect(row).toBeVisible();
  await page.goForward();
  await expect(
    page.getByRole('textbox', { name: 'Name', exact: true }),
  ).toHaveValue('Estate unit 1');
  await expect(
    page.getByRole('textbox', { name: 'Field notes', exact: true }),
  ).toHaveValue('');
  await expect(page).toHaveURL(/q=TEST-1/);
});

test('dirty write-enabled organization switching cancels safely and discards only after confirmation', async ({
  page,
}) => {
  await page.removeLocatorHandler(page.getByRole('dialog'));
  await seedRegister(1);
  const other = '22222222-2222-4222-8222-222222222222';
  await db.query('INSERT INTO qm.tenants(id,name) VALUES($1,$2)', [
    other,
    'Second writable estate',
  ]);
  await db.query(
    'INSERT INTO qm.memberships(tenant_id,actor_id,capabilities) VALUES($1,$2,$3)',
    [other, actor, Capability.options],
  );
  await page.goto('/#assets');
  await page
    .getByRole('button', { name: 'Estate unit 1', exact: true })
    .click();
  await page
    .getByRole('textbox', { name: 'Field notes', exact: true })
    .fill('Private unsaved input');
  const organization = page.getByLabel('Organization', { exact: true });
  await organization.selectOption(other);
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Cancel', exact: true })
    .click();
  await expect(organization).toHaveValue(tenant);
  await expect(
    page.getByRole('textbox', { name: 'Field notes', exact: true }),
  ).toHaveValue('Private unsaved input');
  await organization.selectOption(other);
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Continue', exact: true })
    .click();
  await expect(organization).toHaveValue(other);
  await expect(
    page.getByRole('button', { name: 'Add asset', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('region', { name: 'Asset workspace', exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByText('Private unsaved input', { exact: true }),
  ).toHaveCount(0);
  await organization.selectOption(tenant);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page
    .getByRole('button', { name: 'Estate unit 1', exact: true })
    .click();
  await expect(
    page.getByRole('textbox', { name: 'Field notes', exact: true }),
  ).toHaveValue('');
  expect((await db.query('SELECT notes FROM qm.assets')).rows).toEqual([
    { notes: '' },
  ]);
});

test('synthetic compatibility callback issues browser cookies and renders the desktop workspace', async ({
  page,
}) => {
  compatibilityMode = true;
  session = undefined;
  const traffic: string[] = [];
  page.on('request', (request) => traffic.push(request.url()));
  // Arrange only the pending synthetic login and its browser binding. No
  // provider navigation or credential exchange is performed. From callback
  // onward, the real router, cookie issuance, session lookup, RLS and UI run.
  const login = await compatibilityAuth.login();
  const authorization = new URL(login.headers.location!);
  compatibilityNonce = compatibilityLogin!.nonce;
  expect(authorization.searchParams.get('code_challenge_method')).toBe('S256');
  await page.route('**/__test/prepare-compatibility', (route) =>
    route.fulfill({
      status: 200,
      headers: {
        'content-type': 'text/html',
        'cache-control': 'no-store',
        'set-cookie': login.cookies[0]!,
      },
      body: '<!doctype html><title>Synthetic login prepared</title>',
    }),
  );
  await page.goto('/__test/prepare-compatibility');
  const callback =
    '/api/auth/callback?' +
    new URLSearchParams({
      state: authorization.searchParams.get('state')!,
      code: 'synthetic-authorization-code',
    });
  await page.goto(callback);
  await expect(
    page.getByRole('heading', { name: 'Your asset estate' }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Add asset', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('link', { name: 'Capture', exact: true }),
  ).toHaveCount(0);
  await expect(page).toHaveURL(/\/#assets/);
  expect(compatibilityLogin).toBeUndefined();
  expect(compatibilitySessions.size).toBe(1);
  const cookies = await page.context().cookies();
  expect(
    cookies.find((cookie) => cookie.name === '__Host-qm_session'),
  ).toMatchObject({ httpOnly: true, secure: true, sameSite: 'Lax' });
  expect(cookies.some((cookie) => cookie.name === '__Host-qm_login')).toBe(
    false,
  );
  expect(await page.evaluate(() => document.cookie)).not.toContain(
    '__Host-qm_session',
  );
  expect(traffic.some((url) => url.includes('/api/auth/callback?'))).toBe(true);
  expect(
    traffic.every((url) => new URL(url).origin === 'http://127.0.0.1:4173'),
  ).toBe(true);
  await page.screenshot({
    path: '.local/qm4-compatibility-callback.png',
    fullPage: true,
  });
});

test('keyboard-only find edit cancel and return preserves focus and leaves the asset unchanged', async ({
  page,
}) => {
  await page.removeLocatorHandler(page.getByRole('dialog'));
  await seedRegister(1);
  await page.goto('/#assets');
  await expect(
    page.getByRole('heading', { name: 'Your asset estate' }),
  ).toBeVisible();
  // Navigation and editing below use only keyboard events: no click, focus,
  // fill, or DOM mutation shortcuts. Locators are used solely for assertions.
  const tabTo = async (target: ReturnType<typeof page.getByRole>) => {
    for (let n = 0; n < 100; n++) {
      if (await target.evaluate((el) => el === document.activeElement)) return;
      await page.keyboard.press('Tab');
    }
    throw new Error('Target was not reachable by Tab');
  };
  await tabTo(page.getByRole('searchbox'));
  await page.keyboard.type('TEST-1');
  await page.keyboard.press('Enter');
  const row = page.getByRole('button', { name: 'Estate unit 1', exact: true });
  await expect(row).toBeVisible();
  await tabTo(row);
  await page.keyboard.press('Enter');
  const notes = page.getByRole('textbox', { name: 'Field notes', exact: true });
  await expect(notes).toBeVisible();
  await tabTo(notes);
  await page.keyboard.type('Keyboard-only unsaved edit');
  await tabTo(page.getByRole('button', { name: 'Cancel', exact: true }));
  await page.keyboard.press('Enter');
  await expect(
    page
      .getByRole('dialog')
      .getByRole('button', { name: 'Cancel', exact: true }),
  ).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(notes).toHaveValue('Keyboard-only unsaved edit');
  await expect(
    page.getByRole('button', { name: 'Cancel', exact: true }),
  ).toBeFocused();
  await page.keyboard.press('Enter');
  await tabTo(
    page
      .getByRole('dialog')
      .getByRole('button', { name: 'Continue', exact: true }),
  );
  await page.keyboard.press('Enter');
  await expect(row).toBeFocused();
  await expect(page.getByRole('searchbox')).toHaveValue('TEST-1');
  expect((await db.query('SELECT notes FROM qm.assets')).rows).toEqual([
    { notes: '' },
  ]);
  await page.screenshot({
    path: '.local/qm4-keyboard-return.png',
    fullPage: true,
  });
});

test('narrow keyboard focus and final editor actions remain above the fixed navigation', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/#assets');
  await page.getByRole('button', { name: 'Add asset', exact: true }).click();
  const targets = [
    page.getByRole('textbox', { name: 'Location', exact: true }),
    page.getByRole('combobox', { name: 'Asset status', exact: true }),
    page.getByRole('textbox', { name: 'Field notes', exact: true }),
    page.getByRole('button', { name: 'Create asset', exact: true }),
    page.getByRole('button', { name: 'Cancel', exact: true }),
    page.getByRole('button', { name: 'Save draft', exact: true }),
  ];
  for (const target of targets) {
    for (let n = 0; n < 100; n++) {
      if (await target.evaluate((el) => el === document.activeElement)) break;
      await page.keyboard.press('Tab');
    }
    await expect(target).toBeFocused();
    await expect
      .poll(async () => {
        const field = await target.boundingBox();
        const nav = await page
          .getByRole('navigation', { name: 'Quick navigation' })
          .boundingBox();
        return Boolean(
          field && nav && field.y >= 0 && field.y + field.height <= nav.y,
        );
      })
      .toBe(true);
  }
  await page.screenshot({ path: '.local/qm4-mobile-focused-actions.png' });
});
