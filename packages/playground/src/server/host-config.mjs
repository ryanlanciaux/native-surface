// Host-side configuration sources, in priority order (createPlaygroundServer
// applies them): CLI --stories > .native-surface/playground.config stories >
// .storybook/main stories globs > DEFAULT_STORY_GLOBS.
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * `.native-surface/playground.config.{mjs,js}` in the host root. Shape (all
 * optional, default export):
 *   { stories?: string[], port?: number, decorators?: 'none',
 *     optimizeDeps?: { include?: string[], exclude?: string[] },
 *     aliases?: Record<string, string> }
 * `decorators: 'none'` is accepted for forward-compat (it will opt out of
 * auto-applied environment decorators once those exist); today it is a no-op.
 * `optimizeDeps` merges into the Vite config — the escape hatch the engine
 * preset's docs assign to the consumer config layer: exclude host UI kits
 * that import the aliased 'react-native' (prebundling would freeze a private
 * engine copy into their dep chunk), include their bare-CJS leaves.
 * `aliases` maps exact import specifiers to replacements (paths resolve
 * against the host root) and — unlike the host tsconfig's paths — takes
 * priority over the engine preset's own aliases: the escape hatch for
 * patching over a missing engine export until a real bridge ships.
 */
export async function loadHostConfig(hostRoot) {
  for (const name of ['playground.config.mjs', 'playground.config.js']) {
    const path = join(hostRoot, '.native-surface', name);
    if (!existsSync(path)) continue;
    const mod = await import(pathToFileURL(path).href);
    const config = mod.default ?? mod;
    if (typeof config !== 'object' || config === null) {
      return { config: {}, configPath: path, warnings: [`${path}: expected a default-exported object; ignoring`] };
    }
    const warnings = [];
    const clean = {};
    if (config.stories !== undefined) {
      if (Array.isArray(config.stories) && config.stories.every((s) => typeof s === 'string')) {
        clean.stories = config.stories;
      } else {
        warnings.push(`${path}: "stories" must be an array of glob strings; ignoring`);
      }
    }
    if (config.port !== undefined) {
      const port = Number(config.port);
      if (Number.isInteger(port) && port > 0) clean.port = port;
      else warnings.push(`${path}: "port" must be a positive integer; ignoring`);
    }
    if (config.decorators !== undefined && config.decorators !== 'none') {
      warnings.push(`${path}: "decorators" only supports 'none' for now; ignoring`);
    }
    if (config.optimizeDeps !== undefined) {
      const deps = config.optimizeDeps;
      const stringList = (value) => value === undefined || (Array.isArray(value) && value.every((s) => typeof s === 'string'));
      if (deps && typeof deps === 'object' && stringList(deps.include) && stringList(deps.exclude)) {
        clean.optimizeDeps = {
          ...(deps.include ? { include: deps.include } : {}),
          ...(deps.exclude ? { exclude: deps.exclude } : {}),
        };
      } else {
        warnings.push(`${path}: "optimizeDeps" must be { include?: string[], exclude?: string[] }; ignoring`);
      }
    }
    if (config.aliases !== undefined) {
      const aliases = config.aliases;
      if (
        aliases &&
        typeof aliases === 'object' &&
        !Array.isArray(aliases) &&
        Object.entries(aliases).every(([k, v]) => typeof k === 'string' && typeof v === 'string')
      ) {
        clean.aliases = { ...aliases };
      } else {
        warnings.push(`${path}: "aliases" must be a { specifier: replacement } string map; ignoring`);
      }
    }
    return { config: clean, configPath: path, warnings };
  }
  return { config: {}, configPath: null, warnings: [] };
}

const STORYBOOK_DIRS = ['.storybook', '.rnstorybook'];
const DEFAULT_STORYBOOK_FILES = '**/*.stories.@(js|jsx|mjs|ts|tsx)';

/**
 * Adopts the host's Storybook story globs from `.storybook/main.{js,mjs,cjs}`
 * (also `.rnstorybook/`). Globs resolve relative to the config's directory —
 * Storybook semantics — and come back ABSOLUTE, ready for createStoryMatcher.
 * A TS-only main config is not executed: returns a warning instead.
 */
export async function storybookStoryGlobs(hostRoot) {
  for (const dirName of STORYBOOK_DIRS) {
    const dir = join(hostRoot, dirName);
    if (!existsSync(dir)) continue;
    const mainJs = ['main.js', 'main.mjs', 'main.cjs'].map((f) => join(dir, f)).find(existsSync);
    if (!mainJs) {
      if (['main.ts', 'main.mts', 'main.cts'].some((f) => existsSync(join(dir, f)))) {
        return { globs: null, warning: `${dirName}/main.ts found — TS Storybook config not read yet; pass --stories` };
      }
      continue;
    }
    let mod;
    try {
      mod = await import(pathToFileURL(mainJs).href);
    } catch (error) {
      return { globs: null, warning: `could not load ${mainJs}: ${error.message}` };
    }
    const main = mod.default ?? mod;
    const stories = main?.stories;
    if (!Array.isArray(stories) || stories.length === 0) continue;
    const globs = [];
    for (const entry of stories) {
      if (typeof entry === 'string') {
        globs.push(resolve(dir, entry));
      } else if (entry && typeof entry === 'object' && typeof entry.directory === 'string') {
        globs.push(resolve(dir, entry.directory, entry.files ?? DEFAULT_STORYBOOK_FILES));
      }
    }
    if (globs.length > 0) return { globs, source: mainJs };
  }
  return { globs: null };
}
