import { test, expect } from 'e2e';

test('opted in', { video: 'on' }, async ({ app, screen }) => {
  await app.open('/');
  await expect(screen.getByTestId('input')).toHaveValue('');
});
test('opted out', { video: 'off' }, async ({ app, screen }) => {
  await app.open('/');
  await expect(screen.getByTestId('input')).toHaveValue('');
});
test('follows the run', async ({ app, screen }) => {
  await app.open('/');
  await expect(screen.getByTestId('input')).toHaveValue('');
});
