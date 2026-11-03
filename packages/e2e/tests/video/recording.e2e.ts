import { statSync } from 'node:fs';
import { test, expect } from 'e2e';

interface Recorder {
  startRecording(options: { name: string }): Promise<void>;
  stopRecording(): Promise<readonly { path: string; startedAt: string }[]>;
}

test('records a named clip', { video: 'off' }, async ({ app, screen }) => {
  const recorder = app as unknown as Recorder;
  await app.open('/');
  await recorder.startRecording({ name: 'clip' });
  await screen.getByRole('button', { name: 'Increment' }).tap();
  await expect(screen.getByTestId('count')).toHaveText('Count 1');
  await new Promise(resolve => setTimeout(resolve, 300));
  const videos = await recorder.stopRecording();
  const [video] = videos;
  if (videos.length !== 1 || !video || !/\/recordings\/001-clip\.webm$/.test(video.path) || statSync(video.path).size === 0) {
    throw new Error(`unexpected recordings: ${JSON.stringify(videos)}`);
  }
});
