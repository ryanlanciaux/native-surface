import { test, expect } from 'e2e';

test('clears state', async ({ app, screen }) => {
  await app.open('/');
  await screen.getByRole('button', { name: 'Increment' }).tap();
  await app.clearState();
  await expect(screen.getByTestId('stored')).toHaveText('empty');
});
test('restarts', async ({ app, screen }) => {
  await app.open('/');
  await screen.getByRole('button', { name: 'Increment' }).tap();
  await app.restart();
  await expect(screen.getByTestId('stored')).toHaveText('yes');
});
