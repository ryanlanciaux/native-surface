import { test, expect } from 'e2e';

test('first pass', async ({ app, screen }) => {
  await app.open('/');
  await expect(screen.getByTestId('input')).toHaveValue('');
});
test('deliberate failure', async ({ app, screen }) => {
  await app.open('/');
  await expect(screen.getByTestId('input')).toHaveValue('intentionally-wrong', { timeout: 200 });
});
test('second pass', async ({ app, screen }) => {
  await app.open('/');
  await expect(screen.getByTestId('count')).toHaveText('Count 0');
});
