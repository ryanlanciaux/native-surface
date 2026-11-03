import type { E2EConfig } from 'e2e';
import type { RecordingMode } from 'e2e';
import { surface } from './engine';

const executablePath = process.env.SURFACE_E2E_CHROMIUM;
const configVideo = process.env.SURFACE_VIDEO_CONFIG as RecordingMode | undefined;
const targetVideo = process.env.SURFACE_VIDEO_TARGET as RecordingMode | undefined;

export default {
  targets: [{
    name: 'surface',
    engine: surface({ launch: { executablePath }, viewport: { width: 760, height: 720 } }),
    app: { url: process.env.SURFACE_VIDEO_URL ?? 'http://127.0.0.1:5173' },
    ...(targetVideo ? { video: targetVideo } : {}),
  }],
  tests: '*.e2e.ts',
  workers: 1,
  retries: 0,
  trace: 'off',
  cache: 'off',
  assertionTimeout: 20000,
  ...(configVideo ? { video: configVideo } : {}),
} satisfies E2EConfig;
