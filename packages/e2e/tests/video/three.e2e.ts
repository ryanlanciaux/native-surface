import { test, expect } from 'e2e';

test('types a name', async ({ app, screen }) => {
  await app.open('/');
  await screen.getByLabel('Name').pressSequentially('abc');
  await expect(screen.getByTestId('input')).toHaveValue('ABC');
});
test('taps increment', async ({ app, screen }) => {
  await app.open('/');
  await screen.getByRole('button', { name: 'Increment' }).tap();
  await expect(screen.getByTestId('count')).toHaveText('Count 1');
});
test('starts empty', async ({ app, screen }) => {
  await app.open('/');
  await expect(screen.getByTestId('input')).toHaveValue('');
});
