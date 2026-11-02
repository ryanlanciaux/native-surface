import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { createServer, type PluginOption, type ViteDevServer } from 'vite';
import { expect } from 'vitest';
import { nativeSurface as viteSurface } from '../../../native-surface/src/vite';
import { bindHost, browserHost } from './host';

const FFPROBE = '/usr/bin/ffprobe';
const run = promisify(execFile);

export const chromiumPath = process.env.SURFACE_E2E_CHROMIUM ?? (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined);

export async function startFixture(): Promise<{ server: ViteDevServer; url: string; appUrl: string }> {
  const server = await createServer({ configFile: false,
    root: fileURLToPath(new URL('../fixture', import.meta.url)),
    plugins: viteSurface() as PluginOption[],
    server: { host: bindHost, port: 0, fs: { allow: [fileURLToPath(new URL('../../../../..', import.meta.url))] } },
    logLevel: 'error',
  });
  await server.listen();
  const address = server.httpServer!.address() as { port: number };
  return { server, url: `http://${bindHost}:${address.port}`, appUrl: `http://${browserHost}:${address.port}` };
}

export async function expectPlayable(file: string) {
  expect(existsSync(file), file).toBe(true);
  if (!existsSync(FFPROBE)) return;
  const duration = await run(FFPROBE, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]);
  expect(Number(duration.stdout.trim()), file).toBeGreaterThan(0);
  const streams = await run(FFPROBE, ['-v', 'error', '-select_streams', 'v', '-show_entries', 'stream=codec_type', '-of', 'csv=p=0', file]);
  expect(streams.stdout, file).toContain('video');
}
