import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createServer, type ViteDevServer } from 'vite';
import { nativeSurface as viteSurface } from '../../native-surface/src/vite';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { PNG } from 'pngjs';
import { surface } from '../src/index';
import { browserArgs, browserHost } from './video/host';
import type { EngineHandle, EngineInitInfo, OperationContext, SemanticNode } from 'e2e/engine';

const signal = new AbortController().signal;
const operation = (): OperationContext => ({ signal, timeoutMs: 10000, runId: 'test', attemptId: 'test', origin: 'test' });
const query = (testId: string) => ({ kind: 'query' as const, query: {
  kind: 'testId' as const, value: { kind: 'string' as const, value: testId, exact: true },
} });
const host = process.env.SURFACE_E2E_HOST ?? '127.0.0.1';
let server: ViteDevServer, url: string, artifactDir: string;
let engine: EngineHandle;
async function locate(id: string): Promise<SemanticNode> {
  return (await engine.locate!(query(id), operation()))[0]!;
}
async function action(id: string, action: Parameters<NonNullable<EngineHandle['perform']>>[1]) {
  await engine.perform!((await locate(id)).ref, action, operation());
}
async function value(id: string) { return (await locate(id)).value; }

beforeAll(async () => {
  artifactDir = await mkdtemp(join(tmpdir(), 'surface-e2e-test-'));
  server = await createServer({ configFile: false,
    root: fileURLToPath(new URL('./fixture', import.meta.url)),
    plugins: viteSurface() as import('vite').PluginOption[],
    server: { host, port: 0, fs: { allow: [fileURLToPath(new URL('../../../..', import.meta.url))] } },
    logLevel: 'error',
  });
  await server.listen();
  const address = server.httpServer!.address() as { port: number };
  url = `http://${host}:${address.port}`;
  const executablePath = process.env.SURFACE_E2E_CHROMIUM ?? (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined);
  engine = surface({ launch: { executablePath }, viewport: { width: 760, height: 720 } });
  await engine.init!({ signal, env: process.env, headed: false } as EngineInitInfo);
});
beforeEach(async () => {
  await engine.startAttempt!({ attemptId: 'test', artifactsDir: artifactDir, signal, resolveSecret: async () => '',
    appLog: () => {}, navigation: () => {}, environment: () => {} });
  await engine.session!.open!(url, operation());
});
afterEach(async () => { await engine?.endAttempt!({ signal, timeoutMs: 10000 }); });
afterAll(async () => {
  await engine?.dispose!({ signal, timeoutMs: 10000 });
  await server?.close(); await rm(artifactDir, { recursive: true, force: true });
});

describe('browser engine with real native-surface', () => {
  it('types per character through browser events and updates controlled values', async () => {
    await action('input', { kind: 'focus' });
    await engine.keyboard!.type('abc', { replace: false }, operation());
    expect(await value('input')).toBe('ABC');
    expect((await locate('keys')).text).toBe('a,b,c');
    expect((await locate('changes')).text).toBe('a,Ab,ABc');
    expect((await locate('trusted')).text).toBe('true,true,true');
    await engine.keyboard!.press('Backspace', operation());
    expect(await value('input')).toBe('AB');
    await engine.keyboard!.type('xy', { replace: true }, operation());
    expect(await value('input')).toBe('XY');
    await engine.keyboard!.press('Enter', operation());
    await expect(engine.keyboard!.type('lost', { replace: false }, operation())).rejects.toMatchObject({ code: 'NOT_ACTIONABLE' });
  });
  it('supports fill, clear, multiline typing, and explicitly refuses Tab and single-line newlines', async () => {
    await action('input', { kind: 'fill', value: 'hello', sensitive: false });
    expect(await value('input')).toBe('HELLO');
    await expect(engine.keyboard!.type('a\nb', { replace: false }, operation())).rejects.toMatchObject({ code: 'UNSUPPORTED_CAPABILITY' });
    await expect(engine.keyboard!.press('Tab', operation())).rejects.toMatchObject({ code: 'UNSUPPORTED_CAPABILITY' });
    await action('input', { kind: 'clear' });
    expect(await value('input')).toBe('');
    await action('multi', { kind: 'focus' });
    await engine.keyboard!.type('a\nb', { replace: false }, operation());
    expect(await value('multi')).toBe('a\nb');
    await expect(action('disabled', { kind: 'fill', value: 'no', sensitive: false })).rejects.toMatchObject({ code: 'NOT_ACTIONABLE' });
  });
  it('resolves roles and text, dispatches taps, and rejects removed references', async () => {
    const matches = await engine.locate!({ kind: 'query', query: { kind: 'role',
      value: { kind: 'string', value: 'button', exact: true }, name: { kind: 'string', value: 'Increment', exact: true } } }, operation());
    expect(matches).toHaveLength(1);
    await engine.perform!(matches[0]!.ref, { kind: 'tap' }, operation());
    expect((await locate('count')).text).toBe('Count 1');
    const stale = (await locate('temporary')).ref;
    await action('remove', { kind: 'tap' });
    await expect(engine.perform!(stale, { kind: 'tap' }, operation())).rejects.toMatchObject({ code: 'NODE_STALE', retryable: true });
  });
  it('captures focused DOM overlays and masks secure fields on all surfaces', async () => {
    await action('password', { kind: 'focus' });
    await engine.keyboard!.type('new-secret', { replace: true }, operation());
    const node = await locate('password');
    expect(node.states?.secure).toBe(true); expect(node.value).toBeUndefined(); expect(node.text).toBeUndefined();
    const observation = await engine.observe!(operation(), { pixels: true });
    expect(observation.maskedRegionCount).toBe(2);
    const png = PNG.sync.read(Buffer.from(observation.pixels!.data));
    const rect = node.rect!;
    const offset = (Math.floor(rect.y + rect.height / 2) * png.width + Math.floor(rect.x + rect.width / 2)) * 4;
    expect([...png.data.subarray(offset, offset + 4)]).toEqual([0, 0, 0, 255]);
    const file = await engine.artifacts!.screenshot('../../test', operation());
    expect(isAbsolute(file)).toBe(false);
    expect(PNG.sync.read(await readFile(join(artifactDir, file))).width).toBe(760);
  });
  it('rejects a node covered by another pressable on the same canvas', async () => {
    await expect(action('covered', { kind: 'tap' })).rejects.toMatchObject({ code: 'NOT_ACTIONABLE' });
    expect((await locate('count')).text).toBe('Count 0');
  });
  it('allows a box-none container to receive a tap through its child', async () => {
    await action('box-none', { kind: 'tap' });
    expect((await locate('count')).text).toBe('Count 42');
  });
  it('scrolls exposed content while an input overlay covers the surface center', async () => {
    await engine.session!.open!(`${url}?centerInput`, operation());
    await action('center-input', { kind: 'focus' });
    const observation = await engine.observe!(operation());
    await engine.perform!(observation.root.ref, { kind: 'swipe', direction: 'down' }, operation());
    await expect.poll(async () => (await engine.locate!({ kind: 'query', query: { kind: 'text',
      value: { kind: 'string', value: 'Row 0', exact: true }, visible: true } }, operation())).length).toBe(0);
  });
  it('refuses typing when the surface has no editable browser focus', async () => {
    await expect(engine.keyboard!.type('wrong', { replace: false }, operation())).rejects.toMatchObject({ code: 'NOT_ACTIONABLE' });
  });
  it('refuses focus owned by another surface', async () => {
    await engine.session!.open!(`${url}?otherFocus`, operation());
    await expect(engine.keyboard!.type('wrong', { replace: false }, operation())).rejects.toMatchObject({ code: 'NOT_ACTIONABLE' });
  });
  it('maps CSS-scaled canvas coordinates and scrolls the surface', async () => {
    await engine.session!.open!(`${url}?scaled`, operation());
    await action('input', { kind: 'fill', value: 'scaled', sensitive: false });
    expect(await value('input')).toBe('SCALED');
    await action('scroll', { kind: 'swipe', direction: 'down' });
    await expect.poll(async () => (await engine.locate!({ kind: 'query', query: { kind: 'text',
      value: { kind: 'string', value: 'Row 0', exact: true }, visible: true } }, operation())).length).toBe(0);
  });
  it('rejects old references after restart and recreates isolated attempts', async () => {
    const old = (await locate('button')).ref;
    await engine.perform!(old, { kind: 'tap' }, operation());
    await engine.session!.restart!(operation());
    await engine.session!.open!(url, operation());
    await expect(engine.perform!(old, { kind: 'tap' }, operation())).rejects.toMatchObject({ code: 'NODE_STALE' });
    expect(await value('input')).toBe('');
    expect((await locate('stored')).text).toBe('yes');
    await engine.session!.reset!(operation());
    await engine.session!.open!(url, operation());
    expect((await locate('stored')).text).toBe('empty');
  });
  it.each(['blurOnFirst', 'disableOnFirst'])('stops after partial input when a handler changes actionability: %s', async mode => {
    await engine.session!.open!(`${url}?${mode}`, operation());
    await action('input', { kind: 'focus' });
    await expect(engine.keyboard!.type('abc', { replace: false }, operation())).rejects.toMatchObject({ code: 'ACTION_MAY_HAVE_COMMITTED' });
    expect(await value('input')).toBe('A');
  });
  it('does not type into another input when the app redirects focus', async () => {
    await engine.session!.open!(`${url}?redirectFocus`, operation());
    await expect(action('input', { kind: 'fill', value: 'wrong', sensitive: false })).rejects.toMatchObject({ code: 'ACTION_MAY_HAVE_COMMITTED' });
    expect(await value('multi')).toBe('');
  });
  it('honors cancellation and timeout during typing while keeping failure evidence available', async () => {
    await action('input', { kind: 'focus' });
    const cancelled = new AbortController();
    const typing = engine.keyboard!.type('a'.repeat(500), { replace: false }, { ...operation(), signal: cancelled.signal });
    const timer = setTimeout(() => cancelled.abort(), 100);
    try { await expect(typing).rejects.toMatchObject({ code: 'CANCELLED' }); }
    finally { clearTimeout(timer); }
    await expect(engine.observe!(operation())).resolves.toHaveProperty('root');
    await expect(engine.keyboard!.type('b'.repeat(500), { replace: false }, { ...operation(), timeoutMs: 5 })).rejects.toMatchObject({ code: 'OPERATION_TIMEOUT' });
    await expect(engine.artifacts!.screenshot('after-timeout', operation())).resolves.toMatch(/\.png$/);
  });
  it('runs the published engine through the real e2e CLI and locator assertions', async () => {
    const project = await mkdtemp(join(fileURLToPath(new URL('../', import.meta.url)), '.runner-test-'));
    try {
      await writeFile(join(project, 'e2e.config.ts'), `
        import { surface } from '../dist/index.js';
        export default { targets: [{ name: 'surface', engine: surface({
          launch: { executablePath: ${JSON.stringify(process.env.SURFACE_E2E_CHROMIUM ?? (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined))}, args: ${JSON.stringify(browserArgs)} },
          viewport: { width: 760, height: 720 }
        }), app: { url: ${JSON.stringify(url.replace(host, browserHost))} } }], tests: '*.e2e.ts', workers: 1, retries: 0, trace: 'off' };
      `);
      await writeFile(join(project, 'smoke.e2e.ts'), `
        import { test, expect } from 'e2e';
        test('surface input and tap', async ({ app, screen }) => {
          await app.open('/');
          await screen.getByLabel('Name').pressSequentially('abc');
          await expect(screen.getByTestId('input')).toHaveValue('ABC');
          await screen.getByRole('button', { name: 'Increment' }).tap();
          await expect(screen.getByTestId('count')).toHaveText('Count 1');
        });
        test('fresh attempt', async ({ app, screen }) => {
          await app.open('/');
          await expect(screen.getByTestId('input')).toHaveValue('');
        });
        test('expected failure produces evidence', async ({ app, screen }) => {
          await app.open('/');
          await expect(screen.getByTestId('input')).toHaveValue('intentionally-wrong', { timeout: 200 });
        });
      `);
      const require = createRequire(import.meta.url);
      const binary = join(require.resolve('e2e/engine'), '../../cli/bin.js');
      const result = await promisify(execFile)(process.execPath, [binary, 'run', '--config', join(project, 'e2e.config.ts')], {
        cwd: project, env: { ...process.env, E2E_TELEMETRY_DISABLED: '1' }, timeout: 60000,
      }).catch(error => { if (error.code !== 1) throw error; return error as { stdout: string }; });
      expect(result.stdout).toContain('passed');
      const report = JSON.parse(await readFile(join(project, '.e2e/report.json'), 'utf8'));
      expect(report.run.results).toHaveLength(3);
      expect(report.run.results.filter((result: { status: string }) => result.status === 'passed'), result.stdout).toHaveLength(2);
      const failed = report.run.results.find((result: { status: string }) => result.status === 'failed');
      expect(failed).toBeDefined();
      const screenshot = failed.attempts[0].artifacts.find((artifact: { kind: string }) => artifact.kind === 'screenshot');
      expect(screenshot.path).toBeDefined(); expect(screenshot.size).toBeGreaterThan(0);
      expect(PNG.sync.read(await readFile(join(project, '.e2e/results', screenshot.path))).width).toBe(760);
    } finally { await rm(project, { recursive: true, force: true }); }
  }, 90000);
  it('starts teardown even when the cleanup signal is already aborted', async () => {
    const cancelled = new AbortController(); cancelled.abort();
    await expect(engine.endAttempt!({ signal: cancelled.signal, timeoutMs: 10000 })).rejects.toMatchObject({ code: 'CANCELLED' });
    await expect(engine.observe!(operation())).rejects.toMatchObject({ code: 'INVALID_STATE' });
  });
});
