export type StoryRef = { id: string; group: string; name: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function titleFromPath(path: string): string {
  const base = path.split('/').pop() ?? path;
  return base.replace(/\.(stories|story|play)\.[jt]sx?$/, '').replace(/\.[jt]sx?$/, '');
}

/** Story ids/titles for "Show component" — not rendered on the plane. */
export async function loadStoryCatalog(): Promise<StoryRef[]> {
  let modules: Record<string, () => Promise<Record<string, unknown>>>;
  try {
    const loaded = await import('virtual:host-stories');
    modules = loaded.modules;
  } catch {
    return [];
  }
  const out: StoryRef[] = [];
  for (const [path, load] of Object.entries(modules)) {
    let mod: Record<string, unknown>;
    try {
      mod = await load();
    } catch {
      continue;
    }
    const meta = isRecord(mod.meta) ? mod.meta : isRecord(mod.default) ? mod.default : {};
    const group = typeof meta.title === 'string' && meta.title.length > 0 ? meta.title : titleFromPath(path);
    for (const exportName of Object.keys(mod)) {
      if (exportName === 'meta' || exportName === 'default' || exportName === '__esModule') continue;
      const groupSlug = group
        .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
        .replace(/[^a-zA-Z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .toLowerCase();
      const exportSlug = exportName
        .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
        .replace(/[^a-zA-Z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .toLowerCase();
      out.push({ id: `${groupSlug}--${exportSlug}`, group, name: exportName });
    }
  }
  return out;
}

/** First story whose group name matches the composite component name. */
export function matchStory(name: string | undefined, catalog: readonly StoryRef[]): StoryRef | null {
  if (!name) return null;
  const n = name.toLowerCase();
  return catalog.find((story) => story.group.toLowerCase() === n) ?? null;
}
