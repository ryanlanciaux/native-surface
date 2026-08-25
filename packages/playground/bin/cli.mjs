#!/usr/bin/env node
// @native-surface/playground CLI — serve a host app's stories on the canvas
// engine. Usually reached as `npx native-surface playground` (the engine bin
// forwards here), or directly as `native-surface-playground`.
import { parseArgs } from 'node:util';
import { relative } from 'node:path';

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
export default { stories?: string[], port?: number, decorators?: 'none' }.
CLI flags win over the config file.`;

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
