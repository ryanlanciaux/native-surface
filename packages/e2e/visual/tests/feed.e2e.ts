import { test, expect } from 'e2e';

test('timeline feed', async ({ app, screen }) => {
  await app.open('/feed');
  await expect(screen.getByText('Timeline')).toBeVisible();
  await expect(screen.getByText('Dolor Sit').first()).toBeVisible();
  await expect(screen).toHaveScreenshot('feed.png', {
    threshold: 0.2,
    maxDiffPixelRatio: 0.002,
    // Relative timestamps ("@handle · 3m") are fixed fixture data here but
    // dynamic in a real feed; masked to show the pattern.
    mask: [screen.getByText(/^@\w+ · \d+m$/)],
  });
});
