// The developer journey: sign up, see the first key, create another, then call the API from the playground.
import { expect, test } from '@playwright/test';

test('sign up → dashboard → create key → playground food search', async ({ page }) => {
  const email = `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;

  await page.goto('/signup');
  await expect(page.getByRole('heading', { name: 'Create your account' })).toBeVisible();
  await page.getByLabel('Name or company').fill('E2E Health');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('correct horse battery');
  await page.getByRole('button', { name: 'Create account' }).click();

  // The dashboard shows the first key once.
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByText(email)).toBeVisible();
  const reveal = page.locator('.key-reveal');
  await expect(reveal.locator('code')).toHaveText(/^nk_/);
  await reveal.getByRole('button', { name: "I've saved it" }).click();

  // Create a second key; it is revealed once and listed.
  await page.getByLabel('New key name').fill('e2e key');
  await page.getByRole('button', { name: 'Create key' }).click();
  await expect(reveal.locator('code')).toHaveText(/^nk_/);
  await expect(page.getByRole('cell', { name: 'e2e key' })).toBeVisible();

  // The playground signs in with a short-lived token for the newest key and searches.
  await page.goto('/playground#search');
  await expect(page.getByText('Signed in · key “e2e key”')).toBeVisible();
  const search = page.waitForResponse((r) => r.url().includes('/v1/foods/search') && r.request().method() === 'GET');
  await page.locator('.pg-request').getByRole('button', { name: 'banana', exact: true }).click();
  const res = await search;
  expect(res.status()).toBe(200);
  expect(res.headers()['x-tokens-charged']).toBe('1');
  expect(res.request().headers().authorization).toMatch(/^Bearer nkat_/);

  const response = page.locator('.pg-response');
  await expect(response.locator('.pg-results li').first()).toContainText('Banana, raw');
  await expect(response.getByText('1 token', { exact: true })).toBeVisible();
  await expect(response.getByText(/^1,?999 left$/)).toBeVisible();
});
