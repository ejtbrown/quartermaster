import { expect, test } from '@playwright/test';
test.beforeEach(async ({ page }) => {
  await page.route('**/api/auth/session', (route) =>
    route.fulfill({
      json: { authenticated: false, authenticationEnabled: true },
    }),
  );
});
test('invitation landing contains no synthetic register or nonfunctional controls', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: 'A clearer picture of your estate.' }),
  ).toBeVisible();
  await expect(
    page.getByRole('link', { name: 'Sign in', exact: true }),
  ).toHaveAttribute('href', '/api/auth/login');
  await expect(
    page.getByRole('button', { name: /sample|preview/i }),
  ).toHaveCount(0);
  await expect(
    page.getByText('Main building rooftop AC', { exact: true }),
  ).toHaveCount(0);
  await page.getByText('Privacy and data retention', { exact: true }).click();
  await expect(
    page.getByText(/inaccessible backup copies expire/),
  ).toBeVisible();
  expect(errors).toEqual([]);
});
test('phone landing fits and remains navigable without camera permission', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(
    page.getByRole('link', { name: 'Sign in', exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: '.local/estate-mobile.png', fullPage: true });
});
