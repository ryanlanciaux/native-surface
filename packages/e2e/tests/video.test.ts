import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ViteDevServer } from 'vite';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { EngineHandle, EngineInitInfo, OperationContext, VideoFile } from 'e2e/engine';
import { surface } from '../src/index';
import { chromiumPath, expectPlayable, startFixture } from './video/support';

const signal = new AbortController().signal;
const operation = (): OperationContext => ({ signal, timeoutMs: 20000, runId: 'video', attemptId: 'video', origin: 'test' });
const cleanupContext = { signal, timeoutMs: 20000 };
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
let server: ViteDevServer, url: string, root: string, artifactsDir: string, engine: EngineHandle;
let attempts = 0;

const startAttempt = (directory: string) => engine.startAttempt!({ attemptId: 'video', artifactsDir: directory, signal,
  resolveSecret: async () => '', appLog: () => {}, navigation: () => {}, environment: () => {} });
const open = () => engine.session!.open!(url, operation());
const start = () => engine.artifacts!.startVideo!(operation());
async function stop() {
  return await engine.artifacts!.stopVideo!(operation()) as readonly VideoFile[];
}
async function expectSegments(segments: readonly VideoFile[], names: readonly string[]) {
  expect(segments.map(segment => segment.path)).toEqual(names.map(name => `video/${name}`));
  for (const segment of segments) {
    expect(Number.isNaN(Date.parse(segment.startedAt))).toBe(false);
    await expectPlayable(join(artifactsDir, segment.path));
  }
}

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'surface-e2e-video-'));
  ({ server, url } = await startFixture());
  engine = surface({ launch: { executablePath: chromiumPath }, viewport: { width: 760, height: 720 } });
  await engine.init!({ signal, env: process.env, headed: false } as EngineInitInfo);
});
beforeEach(async () => {
  artifactsDir = join(root, `attempt-${++attempts}`);
  await startAttempt(artifactsDir);
});
afterEach(async () => { await engine.endAttempt!(cleanupContext); });
afterAll(async () => {
  await engine?.dispose!(cleanupContext);
  await server?.close();
  await rm(root, { recursive: true, force: true });
});

describe('engine video recording', { timeout: 60000 }, () => {
  it('declares the paired video hooks', () => {
    expect(engine.artifacts?.startVideo).toBeTypeOf('function');
    expect(engine.artifacts?.stopVideo).toBeTypeOf('function');
    expect(engine.capabilities.has('artifacts')).toBe(true);
  });
  it('records nothing when no page was opened', async () => {
    await start();
    expect(existsSync(join(artifactsDir, 'video'))).toBe(false);
    expect(await stop()).toEqual([]);
    expect(existsSync(join(artifactsDir, 'video'))).toBe(false);
  });
  it('does not record about:blank', async () => {
    await start();
    await expect(engine.session!.open!('about:blank', { ...operation(), timeoutMs: 300 })).rejects.toBeDefined();
    expect(await stop()).toEqual([]);
  });
  it('defers the start until the app opens and records once across reopens', async () => {
    await start();
    expect(existsSync(join(artifactsDir, 'video'))).toBe(false);
    await open();
    expect((await stat(join(artifactsDir, 'video'))).isDirectory()).toBe(true);
    await open();
    await pause(250);
    await expectSegments(await stop(), ['segment-001.webm']);
  });
  it('refuses a second start while recording', async () => {
    await start();
    await expect(start()).rejects.toMatchObject({ code: 'INVALID_STATE' });
    await open();
    await expect(start()).rejects.toMatchObject({ code: 'INVALID_STATE' });
    await pause(250);
    await expectSegments(await stop(), ['segment-001.webm']);
  });
  it('returns [] from a stop with nothing recording', async () => {
    expect(await stop()).toEqual([]);
  });
  it('yields one segment per page across a reset', async () => {
    await start();
    await open();
    await pause(250);
    await engine.session!.reset!(operation());
    await open();
    await pause(250);
    const segments = await stop();
    await expectSegments(segments, ['segment-001.webm', 'segment-002.webm']);
    expect(Date.parse(segments[0]!.startedAt)).toBeLessThanOrEqual(Date.parse(segments[1]!.startedAt));
  });
  it('yields one segment per page across a restart', async () => {
    await start();
    await open();
    await pause(250);
    await engine.session!.restart!(operation());
    await open();
    await pause(250);
    await expectSegments(await stop(), ['segment-001.webm', 'segment-002.webm']);
  });
  it('does not record the page a reset leaves unopened', async () => {
    await start();
    await open();
    await pause(250);
    await engine.session!.reset!(operation());
    await expectSegments(await stop(), ['segment-001.webm']);
  });
  it('starts at once on an open page and numbers repeated cycles distinctly', async () => {
    await open();
    await start();
    await pause(250);
    await expectSegments(await stop(), ['segment-001.webm']);
    await start();
    await pause(250);
    await expectSegments(await stop(), ['segment-002.webm']);
    await expectPlayable(join(artifactsDir, 'video/segment-001.webm'));
  });
  it('finalizes a running recording in endAttempt within its budget', async () => {
    await start();
    await open();
    await pause(250);
    const started = Date.now();
    await engine.endAttempt!(cleanupContext);
    expect(Date.now() - started).toBeLessThan(cleanupContext.timeoutMs);
    await expectPlayable(join(artifactsDir, 'video/segment-001.webm'));
    await expect(engine.endAttempt!(cleanupContext)).resolves.toBeUndefined();
    await startAttempt(artifactsDir);
    expect(await stop()).toEqual([]);
  });
  it('bounds endAttempt when its budget is already spent', async () => {
    await start();
    await open();
    const cancelled = new AbortController();
    cancelled.abort();
    await expect(engine.endAttempt!({ signal: cancelled.signal, timeoutMs: 20000 })).rejects.toMatchObject({ code: 'CANCELLED' });
    await expect(engine.observe!(operation())).rejects.toMatchObject({ code: 'INVALID_STATE' });
  });
  it('reports a deferred start failure at stop without failing the open', async () => {
    const blocked = join(root, `blocked-${attempts}`);
    await writeFile(blocked, 'not a directory');
    await startAttempt(blocked);
    await start();
    await expect(open()).resolves.toBeUndefined();
    await expect(stop()).rejects.toMatchObject({ code: 'ENGINE_FAILURE' });
  });
  it('rejects a failed immediate start and stays able to run', async () => {
    const blocked = join(root, `blocked-${attempts}`);
    await writeFile(blocked, 'not a directory');
    await startAttempt(blocked);
    await open();
    await expect(start()).rejects.toMatchObject({ code: 'ENGINE_FAILURE' });
    expect(await stop()).toEqual([]);
    await expect(engine.observe!(operation())).resolves.toHaveProperty('root');
  });
});
