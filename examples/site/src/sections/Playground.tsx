import { Box, CalendarDays, ChevronsUpDown, Lock, Search, Smartphone, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { BRAND } from '../brand';
import { PlaygroundPreviewSlot } from '../live/PlaygroundPreviewSlot';
import { Code } from '../playground/Code';
import {
  applyStory,
  bindActions,
  buildFields,
  matchStory,
  optionValue,
  primaryAction,
  selectIndex,
  selectOptions,
  setArg,
  type Field,
  type PlaygroundEvent,
} from '../playground/controls';
import { cloneArgs } from '../playground/catalogStories';
import { DEFAULT_DEVICE, DEVICES, type Device } from '../playground/devices';
import type { ColorScheme } from '../playground/globals';
import { loadComponentSource, loadStorySource, type SourceFile } from '../playground/source';
import { CATALOG_ONLY, catalogIndex, filterItems, loadPlaygroundIndex, type PlaygroundIndex } from '../playground/stories';
import type { Args, PlaygroundItem, StoryEntry } from '../playground/types';
import { usageLines, type Tok } from '../playground/usage';
import { FILLS, ShaderCanvas } from '../shaders';
import './playground.css';

const DEFAULT_ITEM = 'EpisodeCard';
const DEFAULT_STORY = 'favorited';

interface Selection {
  item: PlaygroundItem;
  /** The story whose render the canvas runs (the last chip picked). */
  story: StoryEntry;
  /** Full args: the story's merged args plus edits, never partial overrides. */
  args: Args;
  /** The chip the args currently match (null once edits leave every chip). */
  chip: string | null;
}

function select(item: PlaygroundItem, storyName?: string): Selection {
  const stories = item.group.stories;
  const story = stories.find((s) => s.name.toLowerCase() === storyName) ?? stories[0]!;
  return { item, story, args: cloneArgs(story.args), chip: story.id };
}

function initialSelection(index: PlaygroundIndex): Selection {
  const item = index.all.find((i) => i.name === DEFAULT_ITEM) ?? index.components[0] ?? index.all[0]!;
  return select(item, DEFAULT_STORY);
}

interface LogLine {
  n: number;
  kind: 'mount' | 'render' | 'event' | 'env' | 'error';
  text: string;
}

type DrawerTab = 'Usage' | 'Source' | 'Console';

export function Playground() {
  const [index, setIndex] = useState<PlaygroundIndex | null>(() => (CATALOG_ONLY ? catalogIndex() : null));
  useEffect(() => {
    if (!index) void loadPlaygroundIndex().then(setIndex);
  }, [index]);

  return (
    <section className="pg" id="playground" aria-labelledby="pg-title">
      <div className="pg__header">
        <div className="pg__copy">
          <p className="eyebrow" style={{ color: '#C4B5FD' }}>
            {'04  ·  PLAYGROUND'}
          </p>
          <h2 className="section-title pg__title" id="pg-title">
            Component playground of your real app components.
          </h2>
        </div>
        <p className="pg__body">
          Right here, on this page. Pick any component from your app, change its props, and watch the exact
          WebAssembly build repaint.
        </p>
      </div>
      {index && index.all.length > 0 ? <Ide index={index} /> : <div className="ide ide--loading" />}
    </section>
  );
}

function Ide({ index }: { index: PlaygroundIndex }) {
  const [sel, setSel] = useState<Selection>(() => initialSelection(index));
  const [theme, setTheme] = useState<ColorScheme>('light');
  const [device, setDevice] = useState<Device>(DEFAULT_DEVICE);
  const [view, setView] = useState<'preview' | 'code'>('preview');
  const [codeFile, setCodeFile] = useState<'component' | 'story'>('component');
  const [drawer, setDrawer] = useState<DrawerTab>('Usage');
  // Screens want the canvas height: the drawer folds to its tab bar for them (a tab click reopens it).
  const [drawerOpen, setDrawerOpen] = useState(true);
  const [query, setQuery] = useState('');
  const [lastEvent, setLastEvent] = useState<{ event: PlaygroundEvent; count: number } | null>(null);
  const [render, setRender] = useState<{ ms: number; nodes: number; first: boolean } | null>(null);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [log, setLog] = useState<LogLine[]>([]);
  const { item } = sel;

  const n = useRef(0);
  const pushLog = useCallback((kind: LogLine['kind'], text: string) => {
    setLog((l) => [...l.slice(-59), { n: ++n.current, kind, text }]);
  }, []);

  const update = useCallback((fn: (a: Args) => Args) => {
    setSel((s) => {
      const args = fn(s.args);
      return { ...s, args, chip: matchStory(s.item, args, s.chip) };
    });
  }, []);

  const emit = useCallback(
    (event: PlaygroundEvent, apply?: (a: Args) => Args) => {
      setLastEvent((e) => ({ event, count: e?.event.name === event.name ? e.count + 1 : 1 }));
      pushLog('event', `${event.name}(${event.payload})`);
      if (apply) update(apply);
    },
    [update, pushLog],
  );

  // Stable between edits: the preview re-times its render whenever this changes.
  const liveArgs = useMemo(() => bindActions(item, sel.args, emit), [item, sel.args, emit]);
  const fields = useMemo(() => buildFields(item, sel.story, sel.args), [item, sel.story, sel.args]);
  const chipName = item.group.stories.find((s) => s.id === sel.chip)?.name;

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
    [item.name, chipName, pushLog],
  );
  const onError = useCallback(
    (e: Error | null) => {
      setError(e);
      if (e) pushLog('error', `${item.name} threw: ${e.message}`);
    },
    [item.name, pushLog],
  );

  const mounted = useRef<PlaygroundItem | null>(null);
  useEffect(() => {
    if (mounted.current === item) return;
    mounted.current = item;
    pushLog('mount', `mount ${item.name} · ignite-demo · ${index.source === 'stories' ? item.path.split('/').pop() : 'catalog CSF'}`);
  }, [item, index.source, pushLog]);

  const pickItem = (next: PlaygroundItem) => {
    if (next === item) return;
    setSel(select(next));
    setDrawerOpen(next.kind !== 'screen');
    setLastEvent(null);
    setRender(null);
    setSize(null);
  };
  const pickChip = (id: string) => {
    const story = item.group.stories.find((s) => s.id === id);
    if (story) setSel((s) => ({ ...s, story, args: applyStory(s.item, s.args, story), chip: story.id }));
  };
  const pickDevice = (d: Device) => {
    setDevice(d);
    pushLog('env', `device → ${d.label} (${d.width} × ${d.height}, insets ${d.insets.top}/${d.insets.bottom})`);
  };
  const pickTheme = (t: ColorScheme) => {
    setTheme(t);
    pushLog('env', `theme → ${t}`);
  };

  // Real source text for the Code view and the Source tab.
  const [componentSrc, setComponentSrc] = useState<SourceFile | null>(null);
  const [storySrc, setStorySrc] = useState<SourceFile | null>(null);
  useEffect(() => {
    let live = true;
    setComponentSrc(null);
    setStorySrc(null);
    void loadComponentSource(item).then((s) => live && setComponentSrc(s));
    void loadStorySource(item).then((s) => live && setStorySrc(s));
    return () => {
      live = false;
    };
  }, [item]);

  const searchRef = useShortcutFocus();
  const components = filterItems(index.components, query);
  const screens = filterItems(index.screens, query);
  const action = lastEvent?.event.name ?? primaryAction(sel.args);
  const codeShown = codeFile === 'story' ? storySrc : (componentSrc ?? storySrc);

  return (
    <div className="ide">
      <div className="ide__bar">
        <span className="ide__lights" aria-hidden="true">
          <i style={{ background: '#FF5F57CC' }} />
          <i style={{ background: '#FEBC2ECC' }} />
          <i style={{ background: '#28C840CC' }} />
        </span>
        <Segmented
          className="ide__view"
          value={view}
          options={['preview', 'code']}
          labels={{ preview: 'Preview', code: 'Code' }}
          onChange={setView}
          label="View"
        />
        <span className="ide__url">
          <Lock size={12} color="#5F6879" />
          <span>{`${BRAND.playgroundHost}/ignite-demo/${item.name}`}</span>
        </span>
        <span className="ide__spacer" />
        <span className="ide__size" title="Laid-out size (pt)">
          {size ? `${size.width} × ${size.height}` : ' '}
        </span>
        <span className="ide__live">
          <span className="live-dot" />
          LIVE · WASM
        </span>
      </div>

      <div className="ide__body">
        <aside className="ide__sidebar" aria-label="Components">
          <label className="ide__search">
            <Search size={13} color="#5F6879" />
            <input
              ref={searchRef}
              type="search"
              value={query}
              placeholder="Filter components"
              aria-label="Filter components"
              spellCheck={false}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setQuery('');
                if (e.key === 'Enter') {
                  const first = components[0] ?? screens[0];
                  if (first) pickItem(first);
                }
              }}
            />
            {query ? (
              <button type="button" className="ide__clear" aria-label="Clear filter" onClick={() => setQuery('')}>
                <X size={12} />
              </button>
            ) : (
              <kbd>⌘K</kbd>
            )}
          </label>
          <div className="ide__lists">
            <div className="ide__group">
              <p className="ide__heading">{`COMPONENTS · ${index.components.length}`}</p>
              {components.map((i) => (
                <SidebarItem key={i.id} name={i.name} selected={i === item} onSelect={() => pickItem(i)} icon={<Box size={13} />} />
              ))}
            </div>
            <div className="ide__group">
              <p className="ide__heading">{`SCREENS · ${index.screens.length}`}</p>
              {screens.map((i) => (
                <SidebarItem key={i.id} name={i.name} selected={i === item} onSelect={() => pickItem(i)} icon={<Smartphone size={13} />} />
              ))}
            </div>
            {components.length + screens.length === 0 && <p className="ide__empty">{`Nothing matches “${query}”`}</p>}
          </div>
        </aside>

        <div className="ide__center">
          <div className="ide__canvas" data-layout={item.parameters.layout}>
            <ShaderCanvas className="shader-fill" {...FILLS.playground} still />
            <div className="ide__stage" hidden={view !== 'preview'}>
              {item.group.stories.length > 1 && (
                <Segmented
                  className="ide__states"
                  value={sel.chip ?? ''}
                  options={item.group.stories.map((s) => s.id)}
                  labels={Object.fromEntries(item.group.stories.map((s) => [s.id, s.name]))}
                  onChange={pickChip}
                  label="State"
                />
              )}
              <div className="ide__preview">
                <PlaygroundPreviewSlot
                  item={item}
                  story={sel.story}
                  args={liveArgs}
                  device={device}
                  theme={theme}
                  onRendered={onRendered}
                  onSize={setSize}
                  onError={onError}
                />
                {error && (
                  <div className="ide__error" role="alert">
                    <strong>{`${item.name} failed to render`}</strong>
                    <span>{error.message}</span>
                  </div>
                )}
              </div>
              <p className="ide__timing">
                {`${render?.first ? 'first paint' : 'rendered in'} ${render ? render.ms.toFixed(1) : '…'} ms  ·  ${render ? `${render.nodes} nodes` : '…'}  ·  Skia`}
              </p>
            </div>
            {view === 'code' && (
              <div className="ide__codeview">
                <div className="ide__files" role="tablist" aria-label="File">
                  <FileTab on={codeFile === 'component'} onClick={() => setCodeFile('component')}>
                    {componentSrc?.file.split('/').pop() ?? `${item.name}.tsx`}
                  </FileTab>
                  <FileTab on={codeFile === 'story'} onClick={() => setCodeFile('story')}>
                    {storySrc?.file.split('/').pop() ?? `${item.name}.stories.tsx`}
                  </FileTab>
                  <span className="ide__spacer" />
                  {codeShown && (
                    <span className="ide__filepath">{codeShown.generated ? 'generated from catalog' : `ignite-demo/${codeShown.file}`}</span>
                  )}
                </div>
                {codeShown ? <Code text={codeShown.text} className="ide__source" /> : <p className="ide__muted">loading…</p>}
              </div>
            )}
          </div>

          <div className="ide__drawer">
            <div className="ide__drawer-bar" role="tablist" aria-label="Drawer">
              {(['Usage', 'Source', 'Console'] as const).map((t) => (
                <button key={t} type="button" role="tab" aria-selected={drawer === t} className={drawer === t && drawerOpen ? 'is-on' : ''} onClick={() => {
                  setDrawerOpen(drawer !== t || !drawerOpen);
                  setDrawer(t);
                }}>
                  {t}
                  {t === 'Console' && log.some((l) => l.kind === 'event') && <span className="ide__badge">{log.filter((l) => l.kind === 'event').length}</span>}
                </button>
              ))}
              <span className="ide__spacer" />
              {!drawerOpen && <span className="ide__filepath">{`${item.name} · tap a tab to open`}</span>}
              {drawerOpen && drawer === 'Source' && componentSrc && <span className="ide__filepath">{`ignite-demo/${componentSrc.file}`}</span>}
              {drawerOpen && drawer === 'Console' && log.length > 0 && (
                <button type="button" className="ide__drawer-action" onClick={() => setLog([])}>
                  clear
                </button>
              )}
            </div>
            <div className="ide__code" data-tab={drawer} hidden={!drawerOpen}>
              {drawer === 'Usage' && <UsageLines lines={usageLines(item, sel.args)} />}
              {drawer === 'Source' && (componentSrc ? <Code text={componentSrc.text} /> : <p className="ide__muted">{storySrc ? 'no component file' : 'loading…'}</p>)}
              {drawer === 'Console' && <ConsoleLines log={log} />}
            </div>
          </div>
        </div>

        <aside className="ide__props" aria-label="Props">
          <p className="ide__heading">PROPS</p>
          <div className="ide__fields">
            {fields.length === 0 && <p className="prop__key">No props: this screen owns its state. Tap around in it.</p>}
            {fields.map((f) => (
              <PropControl key={`${item.id}:${f.key}`} field={f} onChange={(v) => update((a) => setArg(a, f.key, v))} />
            ))}
            {action && (
              <div className={`ide__event${lastEvent ? ' is-fired' : ''}`} aria-live="polite">
                <span className="ide__event-name">
                  {`${action}()  `}
                  <span className="ide__event-state">{lastEvent ? (lastEvent.count > 1 ? `fired ×${lastEvent.count}` : 'fired') : 'waiting'}</span>
                </span>
                <span>{lastEvent ? lastEvent.event.payload || '—' : 'tap the preview'}</span>
              </div>
            )}
          </div>
          <div className="ide__env">
            <p className="ide__heading">ENVIRONMENT</p>
            <label className="ide__select" data-label={device.label}>
              <select
                aria-label="Device"
                value={device.id}
                onChange={(e) => pickDevice(DEVICES.find((d) => d.id === e.target.value) ?? DEFAULT_DEVICE)}
              >
                {DEVICES.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.label}
                  </option>
                ))}
              </select>
              <span className="ide__select-dim">{`${device.width}×${device.height}`}</span>
              <ChevronsUpDown size={13} color="#5F6879" />
            </label>
            <Segmented
              className="ide__theme"
              value={theme}
              options={['light', 'dark']}
              disabled={index.supportsDark ? [] : ['dark']}
              titles={index.supportsDark ? {} : { dark: 'ignite-demo has no dark theme yet; it arrives with the generated Ignite app' }}
              onChange={pickTheme}
              label="Theme"
            />
          </div>
        </aside>
      </div>
    </div>
  );
}

/** ⌘K / Ctrl+K focuses the filter while the playground is on screen. */
function useShortcutFocus() {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'k' || !ref.current) return;
      const r = ref.current.closest('.ide')?.getBoundingClientRect();
      if (!r || r.bottom < 0 || r.top > window.innerHeight) return;
      e.preventDefault();
      ref.current.focus();
      ref.current.select();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return ref;
}

function PropControl({ field, onChange }: { field: Field; onChange: (v: unknown) => void }) {
  const { key, kind, value } = field;
  const id = `prop-${key}`;
  if (kind === 'boolean') {
    const on = !!value;
    return (
      <div className="prop prop--row">
        <span className="prop__key" id={id}>
          {key}
        </span>
        <button type="button" role="switch" aria-checked={on} aria-labelledby={id} className={`switch${on ? ' is-on' : ''}`} onClick={() => onChange(!on)}>
          <span />
        </button>
      </div>
    );
  }
  if (kind === 'select') {
    const options = selectOptions(field);
    const index = selectIndex(field);
    return (
      <label className="prop">
        <span className="prop__key">{key}</span>
        <select className="prop__input prop__select" value={String(index)} onChange={(e) => onChange(optionValue(field, Number(e.target.value), e.target.value))}>
          {index < 0 && <option value="-1">{value === undefined ? 'none' : String(value)}</option>}
          {options.map((o, i) => (
            <option key={o.label} value={String(i)}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
    );
  }
  if (kind === 'json') return <JsonControl field={field} onChange={onChange} />;
  if (kind === 'date') return <DateControl field={field} onChange={onChange} />;
  const isNumber = kind === 'number';
  const at = field.argType;
  return (
    <label className="prop">
      <span className="prop__key">{key}</span>
      <input
        className="prop__input"
        type={isNumber ? 'number' : 'text'}
        min={at?.min}
        max={at?.max}
        step={at?.step}
        value={value === undefined || value === null ? '' : String(value)}
        spellCheck={false}
        onChange={(e) => {
          if (!isNumber) return onChange(e.target.value);
          const num = e.target.valueAsNumber;
          onChange(Number.isNaN(num) ? undefined : num);
        }}
      />
    </label>
  );
}

/**
 * ISO `yyyy-mm-dd`, typed or picked: the text stays exactly what the app
 * stores (a native date input would show the viewer's locale format). Only
 * real dates reach the component; anything else is held as a draft.
 */
function DateControl({ field, onChange }: { field: Field; onChange: (v: unknown) => void }) {
  const text = field.value == null ? '' : String(field.value).slice(0, 10);
  const [draft, setDraft] = useState(text);
  useEffect(() => setDraft(text), [text]);
  const picker = useRef<HTMLInputElement>(null);
  const valid = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));
  const commit = (v: string) => {
    setDraft(v);
    if (valid(v)) onChange(v);
  };
  return (
    <label className="prop">
      <span className="prop__key">{field.key}</span>
      <span className="prop__date">
        <input
          className={`prop__input${draft && !valid(draft) ? ' is-bad' : ''}`}
          value={draft}
          inputMode="numeric"
          placeholder="yyyy-mm-dd"
          spellCheck={false}
          onChange={(e) => commit(e.target.value)}
        />
        <button
          type="button"
          className="prop__pick"
          aria-label={`Pick ${field.key}`}
          onClick={(e) => {
            e.preventDefault();
            try {
              picker.current?.showPicker();
            } catch {
              picker.current?.focus();
            }
          }}
        >
          <CalendarDays size={13} />
        </button>
        <input ref={picker} className="prop__picker" type="date" tabIndex={-1} aria-hidden="true" value={valid(draft) ? draft : ''} onChange={(e) => e.target.value && commit(e.target.value)} />
      </span>
    </label>
  );
}

function JsonControl({ field, onChange }: { field: Field; onChange: (v: unknown) => void }) {
  const text = JSON.stringify(field.value) ?? '';
  const [draft, setDraft] = useState(text);
  const [bad, setBad] = useState(false);
  useEffect(() => setDraft(text), [text]);
  return (
    <label className="prop">
      <span className="prop__key">{field.key}</span>
      <input
        className={`prop__input${bad ? ' is-bad' : ''}`}
        value={draft}
        spellCheck={false}
        onChange={(e) => {
          setDraft(e.target.value);
          try {
            onChange(JSON.parse(e.target.value));
            setBad(false);
          } catch {
            setBad(true);
          }
        }}
      />
    </label>
  );
}

function SidebarItem({ name, selected, icon, onSelect }: { name: string; selected?: boolean; icon: ReactNode; onSelect: () => void }) {
  return (
    <button type="button" className={`ide__item${selected ? ' is-selected' : ''}`} aria-current={selected ? 'true' : undefined} onClick={onSelect}>
      {icon}
      <span>{name}</span>
    </button>
  );
}

function FileTab({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" role="tab" aria-selected={on} className={on ? 'is-on' : ''} onClick={onClick}>
      {children}
    </button>
  );
}

function Segmented<T extends string>({
  value,
  options,
  labels,
  disabled,
  titles,
  onChange,
  className,
  label,
}: {
  value: T;
  options: readonly T[];
  labels?: Partial<Record<T, string>>;
  disabled?: readonly T[];
  titles?: Partial<Record<T, string>>;
  onChange: (v: T) => void;
  className: string;
  label: string;
}) {
  return (
    <div className={`seg ${className}`} role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={o}
          type="button"
          role="radio"
          aria-checked={value === o}
          className={value === o ? 'is-on' : ''}
          disabled={disabled?.includes(o)}
          title={titles?.[o]}
          onClick={() => onChange(o)}
        >
          {labels?.[o] ?? o}
        </button>
      ))}
    </div>
  );
}

const T = ({ c, children }: { c: string; children: ReactNode }) => <span style={{ color: c }}>{children}</span>;
const N = ({ n }: { n: number }) => <span className="pg-code__n">{n}</span>;
const TOK_COLOR: Record<Tok['c'], string> = {
  punct: '#7A8496',
  tag: '#67E8F9',
  attr: '#C4B5FD',
  ident: '#F2F5F9',
  lit: '#C6F432',
};

function UsageLines({ lines }: { lines: Tok[][] }) {
  return (
    <pre className="pg-code">
      <code>
        {lines.map((line, i) => (
          <span key={i} className="pg-code__line">
            <N n={i + 1} />
            <span>
              {line.map((tok, j) => (
                <T key={j} c={TOK_COLOR[tok.c]}>
                  {tok.t}
                </T>
              ))}
            </span>
          </span>
        ))}
      </code>
    </pre>
  );
}

const LOG_COLOR: Record<LogLine['kind'], string> = {
  mount: '#98A2B3',
  render: '#67E8F9',
  event: '#C6F432',
  env: '#C4B5FD',
  error: '#FB7185',
};

function ConsoleLines({ log }: { log: LogLine[] }) {
  const end = useRef<HTMLSpanElement>(null);
  // Scroll the drawer, never the page.
  useEffect(() => {
    const box = end.current?.closest<HTMLElement>('.ide__code');
    if (box) box.scrollTop = box.scrollHeight;
  }, [log]);
  if (!log.length) return <p className="ide__muted">Renders, events and environment changes show up here.</p>;
  return (
    <pre className="pg-code pg-console">
      <code>
        {log.map((l) => (
          <span key={l.n} className="pg-code__line">
            <span className="pg-code__n">›</span>
            <T c={LOG_COLOR[l.kind]}>{l.text}</T>
          </span>
        ))}
        <span ref={end} />
      </code>
    </pre>
  );
}
