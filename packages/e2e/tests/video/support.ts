import { execFile } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { createServer, type PluginOption, type ViteDevServer } from 'vite';
import { expect } from 'vitest';
import { nativeSurface as viteSurface } from '../../../native-surface/src/vite';
import { host } from './host';

const FFPROBE = '/usr/bin/ffprobe';
const run = promisify(execFile);

const compat = process.env.SURFACE_E2E_COMPAT;
export const runnerRoot = compat ?? fileURLToPath(new URL('../../', import.meta.url));
const runnerEngine = createRequire(join(runnerRoot, 'package.json')).resolve('e2e/engine');
export const e2eBinary = join(runnerEngine, '../../cli/bin.js');
export const e2eVersion: string = JSON.parse(readFileSync(join(runnerEngine, '../../../package.json'), 'utf8')).version;
export const engineModule = compat ? '@native-surface/e2e' : '../dist/index.js';
export const videoProject = compat ? join(compat, 'video') : fileURLToPath(new URL('./', import.meta.url));

export const chromiumPath = process.env.SURFACE_E2E_CHROMIUM ?? (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined);

export async function startFixture(): Promise<{ server: ViteDevServer; url: string; appUrl: string }> {
  const server = await createServer({ configFile: false,
    root: fileURLToPath(new URL('../fixture', import.meta.url)),
    plugins: viteSurface() as PluginOption[],
    server: { host, port: 0, fs: { allow: [fileURLToPath(new URL('../../../../..', import.meta.url))] } },
    logLevel: 'error',
  });
  await server.listen();
  const address = server.httpServer!.address() as { port: number };
  const url = `http://${host}:${address.port}`;
  return { server, url, appUrl: url };
}

export async function expectPlayable(file: string) {
  expect(existsSync(file), file).toBe(true);
  if (!existsSync(FFPROBE)) return;
  const duration = await run(FFPROBE, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]);
  expect(Number(duration.stdout.trim()), file).toBeGreaterThan(0);
  const streams = await run(FFPROBE, ['-v', 'error', '-select_streams', 'v', '-show_entries', 'stream=codec_type', '-of', 'csv=p=0', file]);
  expect(streams.stdout, file).toContain('video');
}
