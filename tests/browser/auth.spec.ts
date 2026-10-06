import { expect, test } from '@playwright/test';
import { createHash } from 'node:crypto';

// Browser interaction coverage uses deterministic Cognito challenge responses.
// The operator-only live probe separately exercises the real Cognito boundary.
test.beforeEach(async ({ page }) => {
  await page.route('**/api/auth/session', (route) =>
    route.fulfill({
      json: { authenticated: false, authenticationEnabled: true },
    }),
  );
});
test('sign-in, code retry and recent verification stay on the application origin', async ({
  page,
}) => {
  let csrf = 'c'.repeat(43),
    attempts = 0;
  const requests: string[] = [];
  page.on('request', (request) => requests.push(request.url()));
  await page.route('**/api/auth/flow', async (route) => {
    const request = route.request();
    if (request.method() === 'GET') {
      await route.fulfill({ json: { step: 'credentials', csrfToken: csrf } });
      return;
    }
    expect(request.headers()['x-amz-content-sha256']).toBe(
      createHash('sha256').update(request.postData()!).digest('hex'),
    );
    expect(request.headers()['x-csrf-token']).toBe(csrf);
    const data = request.postDataJSON();
    csrf = (csrf[0] === 'c' ? 'd' : 'c').repeat(43);
    if (data.action === 'sign_in') {
      expect(data.email).toBe('person@example.test');
      await route.fulfill({ json: { step: 'totp', csrfToken: csrf } });
    } else {
      attempts++;
      await route.fulfill({
        status: attempts === 1 ? 400 : 200,
        json:
          attempts === 1
            ? { step: 'totp', csrfToken: csrf, code: 'incorrect_code' }
            : { step: 'complete' },
      });
    }
  });
  await page.goto('/sign-in?reauth=1');
  await page
    .getByLabel('Email address', { exact: true })
    .fill('person@example.test');
  await page.getByLabel('Password', { exact: true }).fill('A-test-password1!');
  await page.screenshot({ path: '.local/sign-in-desktop.png', fullPage: true });
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByLabel('Password', { exact: true })).toHaveCount(0);
  await page.getByLabel('Authenticator code', { exact: true }).fill('123456');
  await page.getByRole('button', { name: 'Verify code', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('did not match');
  await page.getByLabel('Authenticator code', { exact: true }).fill('654321');
  await page.getByRole('button', { name: 'Verify code', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Sign-in verified' }),
  ).toBeVisible();
  expect(new URL(page.url()).hostname).toBe('127.0.0.1');
  expect(requests.every((url) => new URL(url).hostname === '127.0.0.1')).toBe(
    true,
  );
  expect(
    await page.evaluate(() => ({
      local: localStorage.length,
      session: sessionStorage.length,
    })),
  ).toEqual({ local: 0, session: 0 });
});
test('invitation setup, password confirmation and TOTP enrollment fit a narrow phone', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 740 });
  const steps: Record<string, unknown> = {
    sign_in: { step: 'new_password' },
    new_password: { step: 'setup_totp', secret: 'TESTONLYNOTAREALSEED' },
    totp: { step: 'complete' },
  };
  let writes = 0;
  await page.route('**/api/auth/flow', async (route) => {
    const data =
      route.request().method() === 'POST'
        ? (writes++, steps[route.request().postDataJSON().action])
        : { step: 'credentials' };
    await route.fulfill({
      json: { csrfToken: 'c'.repeat(43), ...(data as object) },
    });
  });
  await page.goto('/sign-in?reauth=1');
  await page
    .getByLabel('Email address', { exact: true })
    .fill('person@example.test');
  await page.getByLabel('Password', { exact: true }).fill('Temporary-test1!');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page
    .getByLabel('New password', { exact: true })
    .fill('New-test-password1!');
  await page
    .getByLabel('Confirm new password', { exact: true })
    .fill('Mismatch-password1!');
  await page
    .getByRole('button', { name: 'Save password and continue' })
    .click();
  await expect(page.getByRole('alert')).toContainText('do not match');
  expect(writes).toBe(1);
  await page
    .getByLabel('Confirm new password', { exact: true })
    .fill('New-test-password1!');
  await page
    .getByRole('button', { name: 'Save password and continue' })
    .click();
  await expect(page.getByText('TESTONLYNOTAREALSEED')).toBeVisible();
  await page.getByRole('button', { name: 'About Authenticator apps' }).click();
  await expect(page.getByRole('note')).toContainText(
    'password recovery does not bypass',
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: '.local/sign-in-mobile-enrollment.png',
    fullPage: true,
  });
  await page.keyboard.press('Escape');
  await page.getByLabel('Authenticator code', { exact: true }).fill('123456');
  await page.getByRole('button', { name: 'Verify code' }).click();
  await expect(page.getByText('TESTONLYNOTAREALSEED')).toHaveCount(0);
});
test('recovery returns to password sign-in and does not claim an authenticated session', async ({
  page,
}) => {
  await page.route('**/api/auth/flow', async (route) => {
    const action =
      route.request().method() === 'POST'
        ? route.request().postDataJSON().action
        : '';
    await route.fulfill({
      json: {
        step: action === 'reset_request' ? 'reset_code' : 'credentials',
        csrfToken: 'c'.repeat(43),
        ...(action === 'reset_confirm' ? { notice: 'password_changed' } : {}),
      },
    });
  });
  await page.goto('/sign-in');
  await page.getByRole('button', { name: 'Forgot password?' }).click();
  await page.getByLabel('Email address').fill('person@example.test');
  await page.getByRole('button', { name: 'Send recovery code' }).click();
  await expect(page.getByText(/If your account is eligible/)).toBeVisible();
  await page.getByLabel('Email recovery code').fill('123456');
  await page
    .getByLabel('New password', { exact: true })
    .fill('New-test-password1!');
  await page
    .getByLabel('Confirm new password', { exact: true })
    .fill('New-test-password1!');
  await page
    .getByRole('button', { name: 'Reset password', exact: true })
    .click();
  await expect(page.getByRole('status')).toContainText('password was changed');
  await expect(
    page.getByRole('button', { name: 'Sign in', exact: true }),
  ).toBeVisible();
});
