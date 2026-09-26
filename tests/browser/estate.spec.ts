import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.route('**/api/auth/session', (route) =>
    route.fulfill({
      json: { authenticated: false, authenticationEnabled: false },
    }),
  );
});

test('search and selection work without implying cloud persistence', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: 'Your asset estate' }),
  ).toBeVisible();
  await expect(page.getByRole('note')).toContainText(
    'Changes cannot be saved yet',
  );
  await page.getByRole('searchbox').fill('dishwasher');
  await expect(
    page.getByRole('button', { name: 'Kitchen dishwasher' }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Main building rooftop AC' }),
  ).toHaveCount(0);
  await page.getByRole('searchbox').fill('not-a-real-asset');
  await expect(page.getByRole('status')).toContainText('No assets match');
  await page.getByRole('searchbox').clear();
  await page.getByRole('button', { name: 'Office air conditioner' }).click();
  await expect(
    page.getByRole('complementary', { name: 'Selected asset details' }),
  ).toContainText('Not recorded');
  await page.getByRole('button', { name: 'Main building rooftop AC' }).click();
  await page.screenshot({ path: '.local/estate-desktop.png', fullPage: true });
  expect(errors).toEqual([]);
});

test('small screens keep the page within the viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.getByRole('searchbox')).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: '.local/estate-mobile.png', fullPage: true });
});
