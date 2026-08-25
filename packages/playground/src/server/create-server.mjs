// Programmatic playground server: the playground package's own Vite +
// plugin-react (they are its dependencies, resolved from THIS file), the
// nativeSurface() preset re-rooted at the host app, story discovery, and the
// import-audit stub. `createPlaygroundServer` returns an unlistened
// ViteDevServer — the CLI listens on it; a future headless `shoot` mode can
// drive the same server without a browser-facing port.
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createServer, searchForWorkspaceRoot } from 'vite';
import react from '@vitejs/plugin-react';
import { loadHostConfig, storybookStoryGlobs } from './host-config.mjs';
import { hostStoriesPlugin, importAuditPlugin } from './plugins.mjs';
import { tsconfigAliases } from './tsconfig-paths.mjs';

const PLAYGROUND_ROOT = fileURLToPath(new URL('../..', import.meta.url));

export const DEFAULT_STORY_GLOBS = ['src/**/*.stories.{tsx,ts,jsx,js}', '**/*.play.{tsx,jsx}'];
export const DEFAULT_PORT = 5170;

/**
 * The engine's Vite helper. Published installs resolve native-surface/vite to
 * the compiled dist/vite.mjs (publishConfig exports); inside the workspace it
 * is TS source, which Node type-strips because the workspace link resolves
 * outside node_modules. The explicit dist fallback covers Node versions
 * without type stripping.
 */
async function loadEnginePreset() {
  try {
    return await import('native-surface/vite');
  } catch (error) {
    const req = createRequire(import.meta.url);
    const engineRoot = dirname(req.resolve('native-surface/package.json'));
    const compiled = join(engineRoot, 'dist/vite.mjs');
    if (existsSync(compiled)) return import(pathToFileURL(compiled).href);
    throw error;
  }
}

/**
 * @param {object} options
 * @param {string} [options.root] host app directory (default: cwd)
 * @param {number} [options.port]
 * @param {string[]} [options.stories] story globs relative to root
 * @param {boolean} [options.open]
 * @param {'ios'|'android'} [options.platform]
 */
export async function createPlaygroundServer(options = {}) {
  const hostRoot = resolve(options.root ?? process.cwd());
  if (!existsSync(hostRoot)) throw new Error(`--root ${hostRoot} does not exist`);
  const warn = (message) => console.warn(`[native-surface] ${message}`);

  const { config, configPath, warnings: configWarnings } = await loadHostConfig(hostRoot);
  configWarnings.forEach(warn);

  // Story glob priority: CLI --stories > config file > .storybook main > defaults.
  let globs = options.stories?.length ? options.stories : config.stories;
  let globSource = options.stories?.length ? '--stories' : config.stories ? configPath : null;
  if (!globs) {
    const storybook = await storybookStoryGlobs(hostRoot);
    if (storybook.warning) warn(storybook.warning);
    if (storybook.globs) {
      globs = storybook.globs;
      globSource = storybook.source;
    }
  }
  if (!globs) {
    globs = DEFAULT_STORY_GLOBS;
    globSource = 'defaults';
  }

  const port = options.port ?? config.port ?? DEFAULT_PORT;
  const platform = options.platform ?? 'ios';
  const audit = new Map();

  const { aliases: hostAliases, warnings: tsWarnings } = tsconfigAliases(hostRoot);
  tsWarnings.forEach(warn);

  // Metro parity for the host's own story source: when the host ships
  // reanimated, its Babel plugin must workletize story files (the preset's
  // rnWorkletsPlugin only covers node_modules).
  const hostRequire = createRequire(join(hostRoot, 'package.json'));
  let reanimatedBabelPlugin = null;
  try {
    reanimatedBabelPlugin = hostRequire.resolve('react-native-reanimated/plugin');
  } catch {
    // Host has no reanimated; the preset aliases the shim.
  }

  const { nativeSurface } = await loadEnginePreset();

  const server = await createServer({
    configFile: false,
    root: PLAYGROUND_ROOT,
    clearScreen: false,
    plugins: [
      ...nativeSurface({ platform, resolveFrom: hostRoot }),
      react(reanimatedBabelPlugin ? { babel: { plugins: [reanimatedBabelPlugin] } } : {}),
      hostStoriesPlugin({ hostRoot, globs }),
      importAuditPlugin({ hostRoot, audit }),
    ],
    resolve: { alias: hostAliases },
    server: {
      port,
      host: true,
      open: options.open ?? false,
      fs: {
        allow: [
          PLAYGROUND_ROOT,
          hostRoot,
          searchForWorkspaceRoot(PLAYGROUND_ROOT),
          searchForWorkspaceRoot(hostRoot),
        ],
      },
    },
  });

  return { server, hostRoot, globs, globSource, port, audit };
}
