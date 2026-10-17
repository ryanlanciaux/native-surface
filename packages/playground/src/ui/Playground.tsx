import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, ReactElement, ReactNode } from 'react';
import { setPlatformOS } from 'native-surface';
import type { StoryIndex } from '../csf';
import {
  DEFAULT_WRITE_BACK,
  applyStory,
  bindActions,
  buildFields,
  cloneArgs,
  matchStory,
  primaryAction,
  schemeArg,
  schemeOfStory,
  setArg,
} from '../fields';
import type { PlaygroundEvent, WriteBack } from '../fields';
import { describeValue } from '../args';
import { filterItems, itemOfStory, toItems } from '../items';
import type { PlaygroundItem } from '../items';
import { publishShootSelection } from '../shoot-mode';
import type { ShootParams } from '../shoot-mode';
import type { SourceFile, SourceProvider } from '../sources';
import type { Args, ColorScheme } from '../story-types';
import { usageLines } from '../usage';
import type { UsageHooks } from '../usage';
import { useHashSelection } from '../useHashSelection';
import { useStoryNav } from '../useStoryNav';
import { VIEWPORTS, customViewport, matchViewport } from '../viewports';
import type { Viewport } from '../viewports';
import { Actions } from './Actions';
import type { ActionRecord } from './Actions';
import { useAudit } from './Audit';
import { Code, Muted } from './Code';
import { Controls } from './Controls';
import { Drawer } from './Drawer';
import type { DrawerTab, LogLine } from './Drawer';
import { Environment } from './Environment';
import type { DprMode } from './Environment';
import { DefaultSurface, Preview, ShootStage } from './Preview';
import type { RenderSurface } from './Preview';
import { Segmented } from './Segmented';
import { Sidebar } from './Sidebar';
import { Toolbar } from './Toolbar';
import type { View } from './Toolbar';

export interface PlaygroundProps {
  /** The loaded story index (csf.ts buildIndex / loadIndex). */
  index: StoryIndex;
  /** Read-only source text for the Code view and the Source tab. */
  sources?: SourceProvider;
  /** Device picker rows; default: every built-in viewport. */
  devices?: Viewport[];
  /** Initial device id (default: the first device). */
  defaultDevice?: string;
  /** Story id selected when the URL names none. */
  defaultStory?: string;
  /** Keep the selection in the URL hash (`#/story/<id>`) and make the URL pill copy it. Default false. */
  hash?: boolean;
  /** ↑/↓ move through stories, `/` focuses the filter (page-wide keys: standalone only). Default false. */
  keyboard?: boolean;
  /** Offer the Custom W × H device and the pixel-ratio picker. Default false. */
  devTools?: boolean;
  /** Poll the CLI's import-audit endpoint and show the Audit tab when it answers. Default false. */
  audit?: boolean;
  /** Screen gutter components lay out inside (device width minus twice this). Default 16. */
  gutter?: number;
  /** Canvas sheet behind components. */
  sheet?: Partial<Record<ColorScheme, string>>;
  /** Callback name → args update, run when the component calls it (`onPressFavorite` → flip `isFavorite`).
   *  Keys may be `<Component>.<callback>`. Merged over React Native's controlled-input defaults. */
  writeBack?: Record<string, WriteBack>;
  /** Teach the Usage tab the host's idioms. */
  usage?: UsageHooks;
  /** Address in the URL pill. */
  urlLabel?: (item: PlaygroundItem, storyId: string) => string;
  /** Name of the app in the console's mount lines. */
  appName?: string;
  /** Render the canvas yourself (wrap NativeSurface: lazy mount, context budget, input remapping). */
  renderSurface?: RenderSurface;
  /** Painted behind the stage (e.g. a shader); default a CSS dot grid. */
  canvasBackground?: ReactNode;
  /** Top-bar link to the design plane (standalone tool). */
  planeHref?: string;
  /** `native-surface playground shoot`: deterministic stage, selection published for the driver. */
  shoot?: ShootParams;
  /** Skinning: extra class on the root (`.nsp`); theme it through the `--nsp-*` custom properties. */
  className?: string;
  style?: CSSProperties;
}

interface Selection {
  item: PlaygroundItem;
  /** The story whose render the canvas runs (the last chip picked). */
  story: PlaygroundItem['group']['stories'][number];
  /** Full args: the story's merged args plus edits, never partial overrides. */
  args: Args;
  /** The chip the args currently match (null once edits leave every chip). */
  chip: string | null;
}

const MAX_ACTIONS = 200;
const DEFAULT_SHEET: Record<ColorScheme, string> = { light: '#FFFFFF', dark: '#151821' };

function fromStory(items: PlaygroundItem[], id: string | null, fallback: PlaygroundItem): Selection {
  const item = itemOfStory(items, id) ?? fallback;
  const story = item.group.stories.find((s) => s.id === id) ?? item.group.stories[0]!;
  return { item, story, args: cloneArgs(story.args), chip: story.id };
}

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
 * The native-surface playground: filterable sidebar (Components + Screens),
 * live canvas with state chips and measured render stats, props panel with
 * live controls and event log, Usage / Source / Console drawer, Environment
 * (device + light/dark). The standalone tool and embedding pages render this
 * same component.
 */
export function Playground(props: PlaygroundProps): ReactElement {
  const { index, className, style } = props;
  const items = useMemo(() => toItems(index), [index]);
  const root = `nsp${className ? ` ${className}` : ''}`;
  if (items.all.length === 0) {
    return (
      <div className={root} style={style}>
        <div className="nsp__blank">
          <Muted>
            {index.source === 'host'
              ? 'No story files matched. Add *.stories.tsx files, or point the CLI at them with --stories.'
              : 'No *.stories.tsx files found.'}
          </Muted>
        </div>
      </div>
    );
  }
  return <Ide {...props} items={items} rootClass={root} />;
}

function Ide(props: PlaygroundProps & { items: ReturnType<typeof toItems>; rootClass: string }): ReactElement {
  const { items, rootClass, style, sources, shoot } = props;
  const devices = props.devices ?? VIEWPORTS;
  const writeBack = useMemo(() => ({ ...DEFAULT_WRITE_BACK, ...props.writeBack }), [props.writeBack]);
  const fallbackItem = items.components[0] ?? items.all[0]!;

  const [selectedId, selectId] = useHashSelection(props.defaultStory ?? fallbackItem.group.stories[0]!.id, props.hash ?? false);
  const [sel, setSel] = useState<Selection>(() => fromStory(items.all, selectedId, fallbackItem));
  const { item } = sel;

  const [device, setDevice] = useState<Viewport>(() => {
    if (shoot?.enabled && (shoot.width || shoot.height || shoot.theme)) {
      const width = shoot.width ?? 390;
      const height = shoot.height ?? 720;
      return matchViewport(width, height, devices) ?? customViewport(width, height, shoot.theme ?? 'ios');
    }
    return devices.find((d) => d.id === props.defaultDevice) ?? devices[0] ?? VIEWPORTS[0]!;
  });
  const [schemePick, setSchemePick] = useState<ColorScheme>('light');
  const [dprMode, setDprMode] = useState<DprMode>(shoot?.enabled ? 1 : 'auto');
  const autoDpr = useDevicePixelRatio();
  const dpr = dprMode === 'auto' ? autoDpr : dprMode;
  const [view, setView] = useState<View>('preview');
  const [codeFile, setCodeFile] = useState<'component' | 'story'>('component');
  const [drawer, setDrawer] = useState<DrawerTab>('Usage');
  // Screens want the canvas height: the drawer folds to its tab bar for them (a tab click reopens it).
  const [drawerOpen, setDrawerOpen] = useState(item.kind !== 'screen');
  const [query, setQuery] = useState('');
  const [actions, setActions] = useState<ActionRecord[]>([]);
  const [render, setRender] = useState<{ ms: number; nodes: number; first: boolean } | null>(null);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const [log, setLog] = useState<LogLine[]>([]);
  const audit = useAudit(props.audit ?? false);

  const n = useRef(0);
  const pushLog = useCallback((kind: LogLine['kind'], text: string) => {
    setLog((l) => [...l.slice(-199), { n: ++n.current, kind, text }]);
  }, []);

  // The selected story (hash link, keyboard, chip, sidebar) drives the selection.
  useEffect(() => {
    if (!selectedId || selectedId === sel.story.id) return;
    const target = fromStory(items.all, selectedId, fallbackItem);
    if (target.item === sel.item) {
      setSel((s) => ({ ...s, story: target.story, args: applyStory(s.item, s.args, target.story), chip: target.story.id }));
      return;
    }
    setSel(target);
    setActions([]);
    setDrawerOpen(target.item.kind !== 'screen');
    setRender(null);
    setSize(null);
  }, [selectedId, sel.story.id, sel.item, items.all, fallbackItem]);

  useEffect(() => {
    if (shoot?.enabled) publishShootSelection(sel.story.id);
  }, [shoot, sel.story.id]);

  // Platform follows the device (Pixel → android). Runs before the surface's
  // render, so the remounted story reads the new Platform.OS.
  useLayoutEffect(() => {
    setPlatformOS(device.platform);
  }, [device.platform]);

  const update = useCallback((fn: (a: Args) => Args) => {
    setSel((s) => {
      const args = fn(s.args);
      return { ...s, args, chip: matchStory(s.item, args, s.chip) };
    });
  }, []);

  const record = useCallback((source: ActionRecord['source'], name: string, payload: string) => {
    setActions((previous) => {
      const head = previous[0];
      const time = new Date().toLocaleTimeString();
      if (head && head.source === source && head.name === name && head.payload === payload) {
        return [{ ...head, count: head.count + 1, time }, ...previous.slice(1)];
      }
      return [{ key: n.current++, source, name, payload, time, count: 1 }, ...previous].slice(0, MAX_ACTIONS);
    });
    pushLog('event', `${name}(${payload})`);
  }, [pushLog]);

  const emit = useCallback(
    (event: PlaygroundEvent, apply?: (a: Args) => Args) => {
      record('arg', event.name, event.payload);
      if (apply) update(apply);
    },
    [record, update]
  );
  const onSurfaceAction = useCallback(
    (name: string, payload?: unknown) => record('surface', name, payload === undefined ? '' : describeValue(payload)),
    [record]
  );

  // Stable between edits: the preview re-times its render whenever this changes.
  const liveArgs = useMemo(() => bindActions(item, sel.args, writeBack, emit), [item, sel.args, writeBack, emit]);
  const fields = useMemo(() => buildFields(item, sel.story, sel.args), [item, sel.story, sel.args]);
  const chipName = item.group.stories.find((s) => s.id === sel.chip)?.name;

  // Light/dark: the story's own scheme arg, else a dark chip, else the canvas sheet + globals.
  const argKey = schemeArg(sel.args);
  const scheme: ColorScheme = argKey
    ? (sel.args[argKey] as ColorScheme)
    : (schemeOfStory(sel.story) ?? schemePick);
  const pickScheme = (next: ColorScheme): void => {
    pushLog('env', `theme → ${next}`);
    setSchemePick(next);
    if (argKey) return update((a) => ({ ...a, [argKey]: next }));
    const stories = item.group.stories;
    if (next === 'dark') {
      const dark = stories.find((s) => schemeOfStory(s) === 'dark');
      if (dark && dark.id !== sel.story.id) selectId(dark.id);
    } else if (schemeOfStory(sel.story) === 'dark') {
      const light = stories.find((s) => schemeOfStory(s) !== 'dark');
      if (light) selectId(light.id);
    }
  };

  const lastRender = useRef('');
  const onRendered = useCallback(
    (info: { ms: number; nodes: number }) => {
      // The first paint of an entry includes mounting it (and, once, the engine); later ones are edits.
      setRender((r) => ({ ...info, first: r === null }));
      const label = `${item.name}${chipName ? ` · ${chipName.toLowerCase()}` : ''}`;
      // One console line per distinct paint, not per keystroke-identical repeat.
      const line = `render ${label} · ${info.ms.toFixed(1)} ms · ${info.nodes} nodes`;
      if (line !== lastRender.current) pushLog('render', line);
      lastRender.current = line;
    },
    [item.name, chipName, pushLog]
  );
  const onError = useCallback(
    (e: Error | null) => {
      if (e) pushLog('error', `${item.name} threw: ${e.message}`);
    },
    [item.name, pushLog]
  );

  const mounted = useRef<PlaygroundItem | null>(null);
  useEffect(() => {
    if (mounted.current === item) return;
    mounted.current = item;
    const file = item.path.split('/').pop();
    pushLog('mount', `mount ${item.name}${props.appName ? ` · ${props.appName}` : ''}${file ? ` · ${file}` : ''}`);
  }, [item, props.appName, pushLog]);

  const pickItem = (next: PlaygroundItem): void => {
    if (next !== item) selectId(next.group.stories[0]!.id);
  };
  const pickDevice = (next: Viewport): void => {
    setDevice(next);
    pushLog('env', `device → ${next.label} (${next.width} × ${next.height}, insets ${next.insets.top}/${next.insets.bottom})`);
  };
  const setCustomSize = (next: { width?: number; height?: number }): void => {
    setDevice((d) => customViewport(next.width ?? d.width, next.height ?? d.height, d.platform));
  };

  // Real source text for the Code view and the Source tab (undefined: loading, null: none).
  const [componentSrc, setComponentSrc] = useState<SourceFile | null | undefined>(undefined);
  const [storySrc, setStorySrc] = useState<SourceFile | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    setComponentSrc(sources ? undefined : null);
    setStorySrc(sources ? undefined : null);
    if (!sources) return;
    sources.component(item).then((s) => live && setComponentSrc(s), () => live && setComponentSrc(null));
    sources.story(item).then((s) => live && setStorySrc(s), () => live && setStorySrc(null));
    return () => {
      live = false;
    };
  }, [item, sources]);

  const components = filterItems(items.components, query);
  const screens = filterItems(items.screens, query);
  const visibleIds = useMemo(
    () => [...components, ...screens].flatMap((i) => i.group.stories.map((s) => s.id)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [items, query]
  );
  useStoryNav(visibleIds, sel.story.id, selectId, props.keyboard ?? false);

  const renderSurface = props.renderSurface ?? DefaultSurface;
  const sheet = { ...DEFAULT_SHEET, ...props.sheet };
  const url = props.urlLabel?.(item, sel.story.id) ?? `${typeof location === 'undefined' ? '' : location.host}/#/story/${sel.story.id}`;
  const codeShown = codeFile === 'story' ? storySrc : (componentSrc ?? storySrc);

  if (shoot?.enabled) {
    return (
      <div className={`${rootClass} nsp--shoot`} style={style}>
        <ShootStage story={sel.story} args={liveArgs} device={device} padding={props.gutter ?? 16} onAction={onSurfaceAction} />
      </div>
    );
  }

  return (
    <div className={rootClass} style={style}>
      <Toolbar view={view} onView={setView} url={url} copyable={props.hash ?? false} size={size} planeHref={props.planeHref} />

      <div className="nsp__body">
        <Sidebar
          components={components}
          screens={screens}
          totals={{ components: items.components.length, screens: items.screens.length }}
          selected={item}
          query={query}
          onQuery={setQuery}
          onSelect={pickItem}
        />

        <div className="nsp__center">
          <div className="nsp__canvas" data-layout={item.parameters.layout}>
            {props.canvasBackground ?? <div className="nsp__dots" aria-hidden="true" />}
            <div className="nsp__stage" hidden={view !== 'preview'}>
              {item.group.stories.length > 1 && (
                <Segmented
                  className="nsp__states"
                  value={sel.chip ?? ''}
                  options={item.group.stories.map((s) => s.id)}
                  labels={Object.fromEntries(item.group.stories.map((s) => [s.id, s.name]))}
                  onChange={selectId}
                  label="State"
                />
              )}
              <Preview
                item={item}
                story={sel.story}
                args={liveArgs}
                device={device}
                scheme={scheme}
                dpr={dpr}
                sheet={sheet}
                gutter={props.gutter ?? 16}
                renderSurface={renderSurface}
                onAction={onSurfaceAction}
                onRendered={onRendered}
                onSize={setSize}
                onError={onError}
              />
              <p className="nsp__timing">
                {render
                  ? `${render.first ? 'first paint' : 'rendered in'} ${render.ms.toFixed(1)} ms  ·  ${render.nodes} nodes  ·  Skia`
                  : 'rendering…'}
              </p>
            </div>
            {view === 'code' && (
              <div className="nsp__codeview">
                <div className="nsp__files" role="tablist" aria-label="File">
                  <FileTab on={codeFile === 'component'} onClick={() => setCodeFile('component')}>
                    {componentSrc?.file.split('/').pop() ?? `${item.name}.tsx`}
                  </FileTab>
                  <FileTab on={codeFile === 'story'} onClick={() => setCodeFile('story')}>
                    {storySrc?.file.split('/').pop() ?? `${item.name}.stories.tsx`}
                  </FileTab>
                  <span className="nsp__spacer" />
                  {codeShown && <span className="nsp__filepath">{codeShown.file}</span>}
                </div>
                {codeShown ? (
                  <Code text={codeShown.text} className="nsp__source" />
                ) : (
                  <Muted>{codeShown === undefined ? 'loading…' : 'No source available for this entry.'}</Muted>
                )}
              </div>
            )}
          </div>

          <Drawer
            tab={drawer}
            open={drawerOpen}
            onTab={(t) => {
              setDrawerOpen(drawer !== t || !drawerOpen);
              setDrawer(t);
            }}
            itemName={item.name}
            usage={usageLines(item.name, sel.args, props.usage)}
            componentSource={componentSrc}
            storySource={storySrc}
            log={log}
            onClearLog={() => setLog([])}
            audit={audit}
          />
        </div>

        <aside className="nsp__props" aria-label="Props">
          <div className="nsp__props-head">
            <p className="nsp__heading">PROPS</p>
            {sel.chip === null && (
              <button
                type="button"
                className="nsp__drawer-action"
                title="Restore the story's declared args"
                onClick={() => setSel((s) => ({ ...s, args: cloneArgs(s.story.args), chip: s.story.id }))}
              >
                reset
              </button>
            )}
          </div>
          <div className="nsp__fields">
            <Controls
              itemId={item.id}
              fields={fields}
              isScreen={item.kind === 'screen'}
              onChange={(key, value) => update((a) => setArg(a, key, value))}
            />
            <Actions records={actions} waitingFor={primaryAction(sel.args)} onClear={() => setActions([])} />
          </div>
          <Environment
            devices={devices}
            device={device}
            onDevice={pickDevice}
            allowCustom={props.devTools ?? false}
            onCustomSize={setCustomSize}
            scheme={scheme}
            onScheme={pickScheme}
            dpr={props.devTools ? { mode: dprMode, effective: dpr, onMode: setDprMode } : undefined}
          />
        </aside>
      </div>
    </div>
  );
}

function FileTab({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }): ReactElement {
  return (
    <button type="button" role="tab" aria-selected={on} className={on ? 'is-on' : ''} onClick={onClick}>
      {children}
    </button>
  );
}
