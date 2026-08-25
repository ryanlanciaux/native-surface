import { createElement, useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { setPlatformOS } from 'native-surface';
import { allStories, filterGroups, findStory, groups } from './registry';
import { describeCall, describeValue, wrapActions } from './args';
import { useHashSelection } from './useHashSelection';
import { useStoryNav } from './useStoryNav';
import { DEFAULT_VIEWPORT, matchViewport } from './viewports';
import { Sidebar } from './ui/Sidebar';
import { Toolbar } from './ui/Toolbar';
import type { DprMode } from './ui/Toolbar';
import { Preview } from './ui/Preview';
import { Controls } from './ui/Controls';
import { Actions } from './ui/Actions';
import type { ActionRecord } from './ui/Actions';
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

export function App(): React.JSX.Element {
  const [filter, setFilter] = useState('');
  const [selectedId, select] = useHashSelection(allStories[0]?.id ?? null);
  const [theme, setTheme] = useState<Theme>('ios');
  const [size, setSize] = useState({ width: DEFAULT_VIEWPORT.width, height: DEFAULT_VIEWPORT.height });
  const [dprMode, setDprMode] = useState<DprMode>('auto');
  const [overrides, setOverrides] = useState<Record<string, Args>>({});
  // Bumped on reset so uncontrolled knob editors (the JSON textarea) resync.
  const [resetNonce, setResetNonce] = useState(0);
  const [actions, setActions] = useState<ActionRecord[]>([]);
  const actionKey = useRef(0);

  const visibleGroups = useMemo(() => filterGroups(filter), [filter]);
  const visibleIds = useMemo(
    () => visibleGroups.flatMap((group) => group.stories.map((entry) => entry.id)),
    [visibleGroups]
  );
  useStoryNav(visibleIds, selectedId, select);

  const entry = findStory(selectedId) ?? allStories[0] ?? null;

  // Runs before the surface's mount effect, so a remounted root sees the new OS.
  useLayoutEffect(() => {
    setPlatformOS(theme);
  }, [theme]);

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
    const base = (): ReactElement => {
      if (entry.story.render) return entry.story.render(args);
      const component = entry.meta.component;
      if (!component) throw new Error(`Story "${entry.id}" has no component and no render()`);
      return createElement(component, args);
    };
    const decorators = [...(entry.story.decorators ?? []), ...(entry.meta.decorators ?? [])];
    return decorators.reduce<() => ReactElement>(
      (inner, decorator) => () => decorator(inner, context),
      base
    )();
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
          />
        ) : (
          <main className="stage">
            <p className="empty">
              {groups.length === 0
                ? 'No *.stories.tsx files found in src/stories.'
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
        </div>
      </div>
    </div>
  );
}
