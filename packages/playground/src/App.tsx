import { createElement, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { setPlatformOS } from 'native-surface';
import { loadStoryIndex } from './registry';
import type { StoryIndex } from './registry';
import { composeStory, filterGroups, findStory } from './csf';
import type { StoryEntry } from './csf';
import { describeCall, describeValue, wrapActions } from './args';
import { publishShootError, publishShootIndex, publishShootSelection, shootParams } from './shoot-mode';
import { useHashSelection } from './useHashSelection';
import { useStoryNav } from './useStoryNav';
import { DEFAULT_VIEWPORT, matchViewport } from './viewports';
import { storyPadding } from 'virtual:playground-config';
import { Sidebar } from './ui/Sidebar';
import { Toolbar } from './ui/Toolbar';
import type { DprMode } from './ui/Toolbar';
import { Preview } from './ui/Preview';
import { Controls } from './ui/Controls';
import { Actions } from './ui/Actions';
import type { ActionRecord } from './ui/Actions';
import { Audit } from './ui/Audit';
import type { Args, StoryContext, Theme } from './story-types';

const MAX_ACTIONS = 200;

function useDevicePixelRatio(): number {
  const [dpr, setDpr] = useState(() => (typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1));
  useLayoutEffect(() => {
    const onResize = (): void => setDpr(window.devicePixelRatio || 1);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return dpr;
}

/**
 * Runs the story's render/decorator code during ITS OWN render — inside the
 * surface, inside the preview boundary — so a throwing story (or an unbridged
 * native import's proxy) breaks one story pane, never the whole playground.
 */
function StoryShell(props: { entry: StoryEntry; args: Args; context: StoryContext }): ReactElement {
  return composeStory(props.entry, props.args, props.context);
}

export function App(): React.JSX.Element {
  const [index, setIndex] = useState<StoryIndex | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    loadStoryIndex().then(
      (loaded) => {
        if (live) setIndex(loaded);
        if (shootParams().enabled) publishShootIndex(loaded);
      },
      (error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        if (live) setLoadError(message);
        if (shootParams().enabled) publishShootError(message);
      }
    );
    return () => {
      live = false;
    };
  }, []);

  if (loadError) return <div className="app-message">Failed to load stories: {loadError}</div>;
  if (!index) return <div className="app-message">Loading stories…</div>;
  return <Playground index={index} />;
}

function Playground({ index }: { index: StoryIndex }): React.JSX.Element {
  const { groups, allStories } = index;
  // Read once: shoot mode is a page-load decision (the query string never
  // changes without a full navigation).
  const shoot = useMemo(shootParams, []);
  const [filter, setFilter] = useState('');
  const [selectedId, select] = useHashSelection(allStories[0]?.id ?? null);
  const [theme, setTheme] = useState<Theme>(shoot.theme ?? 'ios');
  const [size, setSize] = useState({
    width: shoot.width ?? DEFAULT_VIEWPORT.width,
    height: shoot.height ?? DEFAULT_VIEWPORT.height,
  });
  const [dprMode, setDprMode] = useState<DprMode>(shoot.enabled ? 1 : 'auto');
  const [overrides, setOverrides] = useState<Record<string, Args>>({});
  // Bumped on reset so uncontrolled knob editors (the JSON textarea) resync.
  const [resetNonce, setResetNonce] = useState(0);
  const [actions, setActions] = useState<ActionRecord[]>([]);
  const actionKey = useRef(0);

  const visibleGroups = useMemo(() => filterGroups(groups, filter), [groups, filter]);
  const visibleIds = useMemo(
    () => visibleGroups.flatMap((group) => group.stories.map((entry) => entry.id)),
    [visibleGroups]
  );
  useStoryNav(visibleIds, selectedId, select);

  const entry = findStory(allStories, selectedId) ?? allStories[0] ?? null;

  // Runs before the surface's mount effect, so a remounted root sees the new OS.
  useLayoutEffect(() => {
    setPlatformOS(theme);
  }, [theme]);

  // The shoot driver navigates by hash and needs to know when the selection
  // it asked for is the one actually on stage.
  useEffect(() => {
    if (shoot.enabled) publishShootSelection(entry?.id ?? null);
  }, [shoot, entry]);

  const log = useCallback((source: ActionRecord['source'], name: string, payload: string) => {
    setActions((previous) => {
      const head = previous[0];
      if (head && head.source === source && head.name === name && head.payload === payload) {
        const merged: ActionRecord = { ...head, count: head.count + 1, time: new Date().toLocaleTimeString() };
        return [merged, ...previous.slice(1)];
      }
      const record: ActionRecord = {
        key: actionKey.current++,
        source,
        name,
        payload,
        time: new Date().toLocaleTimeString(),
        count: 1,
      };
      return [record, ...previous].slice(0, MAX_ACTIONS);
    });
  }, []);

  const logArgCall = useCallback(
    (name: string, callArgs: unknown[]) => log('arg', name, describeCall(callArgs)),
    [log]
  );
  const onSurfaceAction = useCallback(
    (name: string, payload?: unknown) => log('surface', name, payload === undefined ? '' : describeValue(payload)),
    [log]
  );

  const storyOverrides = entry ? overrides[entry.id] : undefined;
  const mergedArgs = useMemo<Args>(() => ({ ...entry?.args, ...storyOverrides }), [entry, storyOverrides]);
  const overriddenKeys = useMemo(() => new Set(Object.keys(storyOverrides ?? {})), [storyOverrides]);

  const element = useMemo<ReactElement | null>(() => {
    if (!entry) return null;
    const args = wrapActions(mergedArgs, logArgCall);
    const context: StoryContext = { id: entry.id, title: entry.title, name: entry.name, args, theme };
    return createElement(StoryShell, { entry, args, context });
  }, [entry, mergedArgs, logArgCall, theme]);

  const autoDpr = useDevicePixelRatio();
  const dpr = dprMode === 'auto' ? autoDpr : dprMode;
  const activeViewport = matchViewport(size.width, size.height);

  const setArg = useCallback(
    (name: string, value: unknown) => {
      if (!entry) return;
      setOverrides((previous) => ({ ...previous, [entry.id]: { ...previous[entry.id], [name]: value } }));
    },
    [entry]
  );

  const resetArgs = useCallback(() => {
    if (!entry) return;
    setOverrides((previous) => {
      const next = { ...previous };
      delete next[entry.id];
      return next;
    });
    setResetNonce((n) => n + 1);
  }, [entry]);

  return (
    <div className="app">
      <Toolbar
        width={size.width}
        height={size.height}
        activeViewportId={activeViewport?.id ?? null}
        onViewport={(width, height) => setSize({ width, height })}
        onSize={(next) => setSize((previous) => ({ ...previous, ...next }))}
        dprMode={dprMode}
        onDprMode={setDprMode}
        effectiveDpr={dpr}
        theme={theme}
        onTheme={setTheme}
      />
      <div className="main">
        <Sidebar
          groups={visibleGroups}
          filter={filter}
          onFilterChange={setFilter}
          selectedId={entry?.id ?? null}
          onSelect={select}
          total={allStories.length}
        />
        {entry && element ? (
          <Preview
            surfaceKey={`${entry.id}:${theme}`}
            element={element}
            width={size.width}
            height={size.height}
            dpr={dpr}
            theme={theme}
            onAction={onSurfaceAction}
            title={entry.title}
            storyName={entry.name}
            padding={storyPadding}
          />
        ) : (
          <main className="stage">
            <p className="empty">
              {groups.length === 0
                ? index.source === 'host'
                  ? 'No story files matched. Add *.stories.tsx files, or point the CLI at them with --stories.'
                  : 'No *.stories.tsx files found in src/stories.'
                : 'Select a story from the sidebar.'}
            </p>
          </main>
        )}
        <div className="inspector">
          {entry ? (
            <Controls
              key={`${entry.id}:${resetNonce}`}
              entry={entry}
              args={mergedArgs}
              overriddenKeys={overriddenKeys}
              onChange={setArg}
              onReset={resetArgs}
            />
          ) : (
            <section className="panel controls">
              <header className="panel-head">
                <h2>Controls</h2>
              </header>
            </section>
          )}
          <Actions records={actions} onClear={() => setActions([])} />
          <Audit />
        </div>
      </div>
    </div>
  );
}
