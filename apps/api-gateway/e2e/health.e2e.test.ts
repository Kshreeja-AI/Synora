import { expect, test } from '@playwright/test';

test('GET /health responds with 200 and the running version', async ({ request }) => {
  const response = await request.get('/health');
  expect(response.ok()).toBeTruthy();

  const body = await response.json();
  expect(body).toEqual({ success: true, data: { status: 'ok', version: expect.any(String) } });
});
