import { test, expect } from 'e2e';

test('counter after two increments', async ({ app, screen }) => {
  await app.open('/counter');
  await expect(screen.getByText('Counter')).toBeVisible();
  const increment = screen.getByRole('button', { name: '+' });
  await increment.tap();
  await increment.tap();
  await expect(screen.getByText('2', { exact: true })).toBeVisible();
  await expect(screen).toHaveScreenshot('counter.png', { threshold: 0.2, maxDiffPixelRatio: 0.002 });
});
