import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import type { ViteDevServer } from 'vite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromiumPath, expectPlayable, startFixture } from './video/support';

interface Artifact { kind: string; path?: string; size?: number; startedAt?: string; redaction?: string }
interface Attempt { artifacts: Artifact[] }
interface Result { titlePath: string[]; selected: boolean; status: string; attempts: Attempt[] }
interface Report { run: { results: Result[] } }

const project = fileURLToPath(new URL('./video/', import.meta.url));
const outputs = join(project, '.e2e');
const binary = join(createRequire(import.meta.url).resolve('e2e/engine'), '../../cli/bin.js');
let server: ViteDevServer, appUrl: string;

async function e2e(args: readonly string[], env: Readonly<Record<string, string>> = {}) {
  await mkdir(outputs, { recursive: true });
  const output = await mkdtemp(join(outputs, 'run-'));
  const result = await promisify(execFile)(process.execPath, [binary, 'run', '--config', join(project, 'e2e.config.ts'), '--output', output, ...args], {
    cwd: project, timeout: 150000, maxBuffer: 1 << 24,
    env: { ...process.env, E2E_TELEMETRY_DISABLED: '1', SURFACE_VIDEO_URL: appUrl, ...(chromiumPath ? { SURFACE_E2E_CHROMIUM: chromiumPath } : {}), ...env },
  }).catch(error => {
    if (error.code !== 1) throw new Error(`e2e exited with ${error.code}\n${error.stdout}\n${error.stderr}`, { cause: error });
    return error as { stdout: string };
  });
  const report = JSON.parse(await readFile(join(output, 'report.json'), 'utf8')) as Report;
  report.run.results = report.run.results.filter(entry => entry.selected);
  return { report, stdout: result.stdout, results: join(output, 'results') };
}
async function webmFiles(directory: string): Promise<string[]> {
  if (!existsSync(directory)) return [];
  const entries = await readdir(directory, { recursive: true, withFileTypes: true });
  return entries.filter(entry => entry.isFile() && /\.(webm|mp4)$/.test(entry.name))
    .map(entry => relative(directory, join(entry.parentPath, entry.name))).sort();
}
const titled = (report: Report, title: string) => {
  const result = report.run.results.find(entry => entry.titlePath.includes(title));
  expect(result, title).toBeDefined();
  return result!;
};
const videos = (result: Result) => result.attempts.flatMap(attempt => attempt.artifacts.filter(artifact => artifact.kind === 'video'));
const reportedPaths = (report: Report) => report.run.results.flatMap(videos).map(artifact => artifact.path!).sort();

beforeAll(async () => { ({ server, appUrl } = await startFixture()); });
afterAll(async () => {
  await server?.close();
  await rm(outputs, { recursive: true, force: true });
});

describe('e2e CLI video recording', { timeout: 180000 }, () => {
  it('--video=on --workers=2 keeps one playable video per attempt under its own directory', async () => {
    const { report, results, stdout } = await e2e(['three.e2e.ts', '--video=on', '--workers=2']);
    expect(report.run.results).toHaveLength(3);
    expect(report.run.results.every(result => result.status === 'passed'), stdout).toBe(true);
    const directories = new Set<string>();
    for (const result of report.run.results) {
      expect(result.attempts).toHaveLength(1);
      const [video, ...rest] = videos(result);
      expect(rest).toEqual([]);
      const slug = result.titlePath.at(-1)!.replaceAll(' ', '-');
      expect(video!.path).toMatch(new RegExp(`^three-${slug}-[^/]+/attempt-1/video/segment-001\\.webm$`));
      expect(video!.size).toBeGreaterThan(0);
      expect(video!.redaction).toBe('incomplete');
      expect(Number.isNaN(Date.parse(video!.startedAt!))).toBe(false);
      directories.add(video!.path!.replace(/\/video\/.*$/, ''));
      await expectPlayable(join(results, video!.path!));
    }
    expect(directories.size).toBe(3);
    expect(await webmFiles(results)).toEqual(reportedPaths(report));
  });
  it('--video=retain-on-failure keeps only the failing attempt video', async () => {
    const { report, results, stdout } = await e2e(['mixed.e2e.ts', '--video=retain-on-failure']);
    expect(titled(report, 'deliberate failure').status, stdout).toBe('failed');
    expect(videos(titled(report, 'first pass'))).toEqual([]);
    expect(videos(titled(report, 'second pass'))).toEqual([]);
    const [video, ...rest] = videos(titled(report, 'deliberate failure'));
    expect(rest).toEqual([]);
    await expectPlayable(join(results, video!.path!));
    expect(await webmFiles(results)).toEqual([video!.path]);
  });
  it('records one segment per page across clearState and restart', async () => {
    const { report, results, stdout } = await e2e(['segments.e2e.ts', '--video=on']);
    for (const title of ['clears state', 'restarts']) {
      const result = titled(report, title);
      expect(result.status, stdout).toBe('passed');
      const segments = videos(result);
      expect(segments.map(segment => segment.path!.replace(/^.*\/video\//, ''))).toEqual(['segment-001.webm', 'segment-002.webm']);
      for (const segment of segments) await expectPlayable(join(results, segment.path!));
    }
  });
  it('--video=off writes no video', async () => {
    const { report, results, stdout } = await e2e(['one.e2e.ts', '--video=off']);
    expect(report.run.results.map(result => result.status), stdout).toEqual(['passed']);
    expect(reportedPaths(report)).toEqual([]);
    expect(await webmFiles(results)).toEqual([]);
  });
  it('records nothing without a flag or config', async () => {
    const { report, results, stdout } = await e2e(['one.e2e.ts']);
    expect(report.run.results.map(result => result.status), stdout).toEqual(['passed']);
    expect(reportedPaths(report)).toEqual([]);
    expect(await webmFiles(results)).toEqual([]);
  });
  it('honors the config video key and a per-test opt out', async () => {
    const { report, results, stdout } = await e2e(['options.e2e.ts'], { SURFACE_VIDEO_CONFIG: 'on' });
    expect(report.run.results.every(result => result.status === 'passed'), stdout).toBe(true);
    expect(videos(titled(report, 'follows the run'))).toHaveLength(1);
    expect(videos(titled(report, 'opted in'))).toHaveLength(1);
    expect(videos(titled(report, 'opted out'))).toEqual([]);
    expect(await webmFiles(results)).toEqual(reportedPaths(report));
  });
  it('honors the target video key as a required mode', async () => {
    const { report, results, stdout } = await e2e(['one.e2e.ts'], { SURFACE_VIDEO_TARGET: 'on' });
    expect(report.run.results.map(result => result.status), stdout).toEqual(['passed']);
    const [video] = videos(report.run.results[0]!);
    await expectPlayable(join(results, video!.path!));
  });
  it('lets a per-test video win over --video=off', async () => {
    const { report, results, stdout } = await e2e(['options.e2e.ts', '--video=off']);
    expect(report.run.results.every(result => result.status === 'passed'), stdout).toBe(true);
    expect(videos(titled(report, 'follows the run'))).toEqual([]);
    expect(videos(titled(report, 'opted out'))).toEqual([]);
    const [video] = videos(titled(report, 'opted in'));
    await expectPlayable(join(results, video!.path!));
  });
});
