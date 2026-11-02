import { test, expect } from 'e2e';

test('single pass', async ({ app, screen }) => {
  await app.open('/');
  await expect(screen.getByTestId('input')).toHaveValue('');
});
