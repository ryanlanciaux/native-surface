import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EngineAppDeclaration, EngineHandle, OperationContext } from 'e2e/engine';
import { surface } from '../src/index';

const signal = new AbortController().signal;
const operation: OperationContext = { signal, timeoutMs: 1000, runId: 'contract', attemptId: 'contract', origin: 'test' };
const validate = (app: Record<string, unknown>) =>
  (surface() as EngineHandle).validateApp!(app as EngineAppDeclaration, { targetName: 'web' } as never);

afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

describe('validateApp', () => {
  it('accepts a url', () => {
    expect(() => validate({ url: 'http://127.0.0.1:5173' })).not.toThrow();
  });
  it.each([
    ['launchArguments', ['--flag'], /app\.launchArguments, which describes an installed device app/],
    ['bundleId', 'com.example.app', /app\.bundleId, which describes an installed device app/],
    ['appPath', '/tmp/app', /app\.appPath, which describes an installed device app/],
    ['permissions', { camera: 'grant' }, /cannot grant permissions; remove app\.permissions/],
  ])('refuses app.%s as INVALID_CONFIG', (key, value, message) => {
    expect(() => validate({ url: 'http://127.0.0.1:5173', [key]: value })).toThrow(expect.objectContaining({ code: 'INVALID_CONFIG', message: expect.stringMatching(message) }));
  });
  it('refuses a target without app.url', () => {
    expect(() => validate({})).toThrow(expect.objectContaining({ code: 'INVALID_CONFIG', message: expect.stringMatching(/needs app\.url/) }));
  });
});

describe('engine state errors', () => {
  it('reports an uninitialized browser as ENGINE_FAILURE', async () => {
    const engine = surface();
    await expect(engine.startAttempt!({ attemptId: 'contract', artifactsDir: '/tmp', signal, resolveSecret: async () => '',
      appLog: () => {}, navigation: () => {}, environment: () => {} })).rejects.toMatchObject({ code: 'ENGINE_FAILURE', retryable: false });
  });
  it('reports a missing artifact directory as ENGINE_FAILURE', async () => {
    const engine = surface();
    await expect(engine.artifacts!.startVideo!(operation)).rejects.toMatchObject({ code: 'ENGINE_FAILURE', retryable: false });
  });
});

describe('test server host', () => {
  it('fails clearly for a non-loopback SURFACE_E2E_HOST', async () => {
    vi.stubEnv('SURFACE_E2E_HOST', '192.168.1.20');
    await expect(import('./video/host')).rejects.toThrow(/SURFACE_E2E_HOST=192\.168\.1\.20 is not a loopback address/);
  });
  it('defaults to 127.0.0.1', async () => {
    vi.stubEnv('SURFACE_E2E_HOST', undefined);
    await expect(import('./video/host')).resolves.toMatchObject({ host: '127.0.0.1' });
  });
});
