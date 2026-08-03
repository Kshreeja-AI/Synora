import { test, expect } from '@playwright/test';

test.describe('Smoke tests', () => {
  test('login page renders the sign-in form', async ({ page }) => {
    await page.goto('/auth/login');

    await expect(page.getByRole('heading', { name: /sign in/i })).toBeVisible();
    await expect(page.getByLabel(/email/i)).toBeVisible();
    await expect(page.getByLabel('Password', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: /sign in/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /register/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /forgot password/i })).toBeVisible();
  });

  test('register page renders the sign-up form', async ({ page }) => {
    await page.goto('/auth/register');

    await expect(page.getByRole('heading', { name: /create.*account|register|sign up/i })).toBeVisible();
    await expect(page.getByLabel(/email/i)).toBeVisible();
  });

  test('unauthenticated dashboard access redirects to login', async ({ page }) => {
    await page.goto('/dashboard');

    await page.waitForURL(/\/auth\/login/, { timeout: 10_000 });
    await expect(page.getByRole('heading', { name: /sign in/i })).toBeVisible();
  });

  test('marketing landing page loads', async ({ page }) => {
    await page.goto('/');

    await expect(page.locator('body')).not.toBeEmpty();
    const title = await page.title();
    expect(title.length).toBeGreaterThan(0);
  });
});
