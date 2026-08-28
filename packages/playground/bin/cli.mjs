#!/usr/bin/env node
// @native-surface/playground CLI — serve a host app's stories on the canvas
// engine, or screenshot them headless (`shoot`). Usually reached as
// `npx native-surface playground` (the engine bin forwards here), or directly
// as `native-surface-playground`.
import { parseArgs } from 'node:util';
import { relative } from 'node:path';

const SHOOT_USAGE = `Usage: native-surface playground shoot [options]

Render every story headless and write one PNG per story (canvas only).
Needs puppeteer-core (resolved from $NS_SHOOT_PUPPETEER_DIR, the app root,
or the playground package) and a Chromium binary.

Options:
  --root <dir>        Host app directory (default: cwd)
  --out <dir>         Output dir, relative to root (default: .native-surface/shots)
  --diff <dir>        Compare each shot against <dir>/<storyId>.png
  --update            With --diff: copy current shots over the baseline
  --stories <glob>    Story file glob relative to --root; repeatable
  --filter <substr>   Only stories whose id/title/name contains <substr>
  --viewport <WxH>    Surface size in px (default: 390x720)
  --tolerance <frac>  Max differing-pixel fraction still a match (default: 0.001)
  --browser <path>    Chromium binary (default: $CHROME_PATH or /usr/bin/chromium)
  --platform <os>     ios | android — file-extension resolution (default: ios)
  --theme <t>         ios | android — surface theme (default: ios)
  -h, --help          Show this help

Exits 1 when a story hard-errors or (with --diff, without --update) any
shot mismatches or misses its baseline. Writes <out>/report.json.`;

async function runShoot(args) {
  let parsed;
  try {
    parsed = parseArgs({
      args,
      options: {
        root: { type: 'string' },
        out: { type: 'string' },
        diff: { type: 'string' },
        update: { type: 'boolean' },
        stories: { type: 'string', multiple: true },
        filter: { type: 'string' },
        viewport: { type: 'string' },
        tolerance: { type: 'string' },
        browser: { type: 'string' },
        platform: { type: 'string' },
        theme: { type: 'string' },
        help: { type: 'boolean', short: 'h' },
      },
    });
  } catch (error) {
    console.error(`native-surface playground shoot: ${error.message}\n`);
    console.error(SHOOT_USAGE);
    process.exit(1);
  }
  const { values } = parsed;
  if (values.help) {
    console.log(SHOOT_USAGE);
    process.exit(0);
  }
  let viewport;
  if (values.viewport !== undefined) {
    const match = /^(\d+)x(\d+)$/.exec(values.viewport);
    if (!match) {
      console.error(`native-surface playground shoot: invalid --viewport "${values.viewport}" (expected WxH, e.g. 390x720)`);
      process.exit(1);
    }
    viewport = { width: Number(match[1]), height: Number(match[2]) };
  }
  let tolerance;
  if (values.tolerance !== undefined) {
    tolerance = Number(values.tolerance);
    if (!Number.isFinite(tolerance) || tolerance < 0 || tolerance > 1) {
      console.error(`native-surface playground shoot: invalid --tolerance "${values.tolerance}" (expected a fraction 0..1)`);
      process.exit(1);
    }
  }
  for (const key of ['platform', 'theme']) {
    if (values[key] !== undefined && values[key] !== 'ios' && values[key] !== 'android') {
      console.error(`native-surface playground shoot: --${key} must be "ios" or "android"`);
      process.exit(1);
    }
  }
  if (values.update && !values.diff) {
    console.error('native-surface playground shoot: --update requires --diff <baselineDir>');
    process.exit(1);
  }

  try {
    const { shoot, formatSummary } = await import('../src/shoot.mjs');
    const { ok, results, reportPath } = await shoot({
      root: values.root,
      out: values.out,
      diff: values.diff,
      update: values.update,
      stories: values.stories,
      filter: values.filter,
      viewport,
      tolerance,
      browser: values.browser,
      platform: values.platform,
      theme: values.theme,
    });
    console.log(`\n${formatSummary(results)}\n\nreport: ${reportPath}`);
    process.exit(ok ? 0 : 1);
  } catch (error) {
    console.error(`native-surface playground shoot: ${error?.message ?? error}`);
    if (process.env.DEBUG) console.error(error);
    process.exit(1);
  }
}

if (process.argv[2] === 'shoot') {
  await runShoot(process.argv.slice(3));
}

const USAGE = `Usage: native-surface playground [options]

Serve the component playground against the app in the current directory.

Options:
  --root <dir>       Host app directory (default: cwd)
  --port <n>         Dev server port (default: 5170)
  --stories <glob>   Story file glob relative to --root; repeatable.
                     (default: src/**/*.stories.{tsx,ts,jsx,js} and
                      **/*.play.{tsx,jsx}, or the host's .storybook globs)
  --platform <os>    ios | android — file-extension resolution (default: ios)
  --open             Open the browser
  -h, --help         Show this help

Config file: .native-surface/playground.config.mjs in the host root may
export default { stories?: string[], port?: number, decorators?: 'none',
optimizeDeps?: { include?: string[], exclude?: string[] },
aliases?: { [specifier]: replacement } }.
CLI flags win over the config file.

Subcommands:
  shoot              Headless screenshot run — see \`playground shoot --help\`.`;

let parsed;
try {
  parsed = parseArgs({
    options: {
      root: { type: 'string' },
      port: { type: 'string' },
      stories: { type: 'string', multiple: true },
      platform: { type: 'string' },
      open: { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
    allowPositionals: true,
  });
} catch (error) {
  console.error(`native-surface playground: ${error.message}\n`);
  console.error(USAGE);
  process.exit(1);
}

const { values, positionals } = parsed;
if (values.help) {
  console.log(USAGE);
  process.exit(0);
}
if (positionals.length > 0) {
  console.error(`native-surface playground: unknown argument "${positionals[0]}"\n`);
  console.error(USAGE);
  process.exit(1);
}

let port;
if (values.port !== undefined) {
  port = Number.parseInt(values.port, 10);
  if (!Number.isInteger(port) || port <= 0) {
    console.error(`native-surface playground: invalid --port "${values.port}"`);
    process.exit(1);
  }
}
if (values.platform !== undefined && values.platform !== 'ios' && values.platform !== 'android') {
  console.error(`native-surface playground: --platform must be "ios" or "android"`);
  process.exit(1);
}

try {
  const { createPlaygroundServer } = await import('../src/server/create-server.mjs');
  const { server, hostRoot, globs, globSource } = await createPlaygroundServer({
    root: values.root,
    port,
    stories: values.stories,
    platform: values.platform,
    open: values.open,
  });
  await server.listen();
  const shownGlobs = globs.map((g) => (g.startsWith('/') ? relative(hostRoot, g) || g : g)).join(', ');
  console.log(`\n  native-surface playground\n  root:    ${hostRoot}\n  stories: ${shownGlobs} (${globSource})\n`);
  server.printUrls();
} catch (error) {
  console.error(`native-surface playground: ${error?.message ?? error}`);
  if (process.env.DEBUG) console.error(error);
  process.exit(1);
}
