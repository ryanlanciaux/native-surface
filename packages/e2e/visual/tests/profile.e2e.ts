import { test, expect } from 'e2e';

const tolerance = { threshold: 0.2, maxDiffPixelRatio: 0.002 };

test('profile card', async ({ app, screen }) => {
  await app.open('/profile');
  await expect(screen.getByText('Lorem Ipsum')).toBeVisible();
  const follow = screen.getByRole('button', { name: 'Follow' });
  await expect(follow).toBeVisible();
  await expect(screen).toHaveScreenshot('profile.png', tolerance);
  await expect(follow).toHaveScreenshot('profile-follow-button.png', tolerance);
});

test('profile card after following', async ({ app, screen }) => {
  await app.open('/profile');
  await screen.getByRole('button', { name: 'Follow' }).tap();
  await expect(screen.getByRole('button', { name: 'Following' })).toBeVisible();
  await expect(screen).toHaveScreenshot('profile-following.png', tolerance);
});
