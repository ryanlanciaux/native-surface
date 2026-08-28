// Host tsconfig `paths` → Vite resolve.alias, dependency-free and lenient.
//
// Deliberate limits (documented in the README):
// - one relative `extends` hop is followed; chains and package-name extends
//   ("@tsconfig/strictest") are ignored with a warning
// - non-wildcard keys and single-wildcard keys/targets only; multi-target
//   arrays use the first target
// - bare `baseUrl` resolution (importing 'components/Button' relative to
//   baseUrl without a paths entry) is NOT emulated — it would shadow
//   node_modules resolution
import { readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';

/** JSONC → object: strips // and /* comments (string-aware) and trailing commas. */
export function parseJsonc(text) {
  let out = '';
  let i = 0;
  let inString = false;
  while (i < text.length) {
    const c = text[i];
    if (inString) {
      out += c;
      if (c === '\\') {
        out += text[i + 1] ?? '';
        i += 2;
        continue;
      }
      if (c === '"') inString = false;
      i += 1;
    } else if (c === '"') {
      inString = true;
      out += c;
      i += 1;
    } else if (c === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i += 1;
    } else if (c === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      i = end === -1 ? text.length : end + 2;
    } else {
      out += c;
      i += 1;
    }
  }
  return JSON.parse(out.replace(/,\s*([}\]])/g, '$1'));
}

/**
 * Pure mapping: a tsconfig `paths` object (targets relative to baseDir) into
 * Vite alias entries. Regex finds so `@app` never swallows `@app/anything`
 * the way a string find would.
 */
export function pathsToAliases(paths, baseDir) {
  const aliases = [];
  const warnings = [];
  const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  for (const [key, targets] of Object.entries(paths)) {
    const list = Array.isArray(targets) ? targets : [targets];
    const target = list[0];
    if (typeof target !== 'string') continue;
    if (list.length > 1) warnings.push(`tsconfig paths "${key}": multiple targets, using "${target}"`);
    const keyStars = (key.match(/\*/g) ?? []).length;
    const targetStars = (target.match(/\*/g) ?? []).length;
    if (keyStars > 1 || targetStars > 1) {
      warnings.push(`tsconfig paths "${key}": multiple wildcards not supported, skipped`);
      continue;
    }
    if (keyStars === 0) {
      aliases.push({
        find: new RegExp(`^${escape(key)}$`),
        replacement: resolve(baseDir, target),
      });
      continue;
    }
    if (targetStars === 0) {
      warnings.push(`tsconfig paths "${key}": wildcard key with non-wildcard target, skipped`);
      continue;
    }
    const [keyHead, keyTail] = key.split('*');
    const absTarget = isAbsolute(target) ? target : join(baseDir, target);
    aliases.push({
      find: new RegExp(`^${escape(keyHead)}(.*)${escape(keyTail ?? '')}$`),
      replacement: absTarget.replace('*', '$1'),
    });
  }
  return { aliases, warnings };
}

/** Reads <hostRoot>/tsconfig.json (one relative extends hop) and returns
 *  Vite aliases for its paths. Missing/broken configs return empty. */
export function tsconfigAliases(hostRoot) {
  const warnings = [];
  const configPath = join(hostRoot, 'tsconfig.json');
  let config;
  try {
    config = parseJsonc(readFileSync(configPath, 'utf8'));
  } catch (error) {
    if (error?.code !== 'ENOENT') warnings.push(`could not read ${configPath}: ${error.message}`);
    return { aliases: [], warnings };
  }

  let options = config.compilerOptions ?? {};
  let optionsDir = dirname(configPath);
  if (typeof config.extends === 'string') {
    if (config.extends.startsWith('.')) {
      const parentPath = resolve(dirname(configPath), config.extends.endsWith('.json') ? config.extends : `${config.extends}.json`);
      try {
        const parent = parseJsonc(readFileSync(parentPath, 'utf8'));
        const parentOptions = parent.compilerOptions ?? {};
        // Child keys win; paths/baseUrl are whole-value overrides like tsc's.
        // Paths from the parent resolve relative to the PARENT file.
        if (options.paths === undefined && parentOptions.paths !== undefined) {
          optionsDir = dirname(parentPath);
        }
        options = { ...parentOptions, ...options };
        if (typeof parent.extends === 'string') {
          warnings.push(`tsconfig extends chain deeper than one hop (${parent.extends}) ignored`);
        }
      } catch (error) {
        warnings.push(`could not follow tsconfig extends "${config.extends}": ${error.message}`);
      }
    } else {
      warnings.push(`tsconfig extends "${config.extends}" is not a relative path; its paths are ignored`);
    }
  }

  if (!options.paths || typeof options.paths !== 'object') return { aliases: [], warnings };
  const baseDir = resolve(optionsDir, options.baseUrl ?? '.');
  const mapped = pathsToAliases(options.paths, baseDir);
  return { aliases: mapped.aliases, warnings: [...warnings, ...mapped.warnings] };
}
