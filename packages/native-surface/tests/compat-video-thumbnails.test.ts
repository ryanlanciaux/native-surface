import { describe, expect, it } from 'vitest';
import { getThumbnailAsync, grabVideoFrame } from '../../compat/src/video';

describe('expo-video-thumbnails fallback', () => {
  it('getThumbnailAsync returns the source uri when grabVideoFrame cannot run', async () => {
    await expect(grabVideoFrame('https://cdn.example/clip.mp4', 0)).rejects.toThrow(/document/);
    await expect(getThumbnailAsync('https://cdn.example/clip.mp4')).resolves.toEqual({
      uri: 'https://cdn.example/clip.mp4',
      width: 0,
      height: 0,
    });
  });
});
