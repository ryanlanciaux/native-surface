import { Box, ChevronsUpDown, Lock, Search, Smartphone } from 'lucide-react';
import { getControlValue, setControlValue } from 'ignite-demo';
import type { AnyCatalogEntry, CatalogControl } from 'ignite-demo';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { BRAND } from '../brand';
import { PlaygroundPreviewSlot } from '../live/PlaygroundPreviewSlot';
import {
  COMPONENT_LIST,
  DEFAULT_ENTRY,
  DEFAULT_VARIANT,
  SCREEN_LIST,
  applyVariant,
  matchVariant,
  primaryEvent,
  seedProps,
  usageLines,
  withHandlers,
  type ListItem,
  type PlaygroundEvent,
  type Props,
  type Tok,
} from '../live/playground';
import { FILLS, ShaderCanvas } from '../shaders';
import './playground.css';

const ALL = [...COMPONENT_LIST, ...SCREEN_LIST];

interface Selection {
  item: ListItem;
  /** Full props (deep copy of defaultProps + edits), never partial overrides. */
  props: Props;
  variant: string | null;
}

function select(item: ListItem, variantName?: string): Selection {
  const { entry } = item;
  const v = entry.variants.find((x) => x.name === variantName) ?? entry.variants[0];
  return { item, props: seedProps(entry, v), variant: v?.name ?? null };
}

const INITIAL = select(ALL.find((i) => i.entry.name === DEFAULT_ENTRY)!, DEFAULT_VARIANT);

export function Playground() {
  const [sel, setSel] = useState<Selection>(INITIAL);
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [view, setView] = useState<'preview' | 'code'>('preview');
  const [drawer, setDrawer] = useState<'Usage' | 'Source' | 'Console'>('Usage');
  const [log, setLog] = useState<{ n: number; event: PlaygroundEvent | null }>({ n: 0, event: null });
  const [renderMs, setRenderMs] = useState<number | null>(null);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const previewWidth = usePreviewWidth();
  const { entry } = sel.item;

  const update = useCallback((fn: (p: Props) => Props) => {
    setSel((s) => {
      const props = fn(s.props);
      return { ...s, props, variant: matchVariant(s.item.entry, props, s.variant) };
    });
  }, []);

  const emit = useCallback(
    (event: PlaygroundEvent, apply?: (p: Props) => Props) => {
      setLog((l) => ({ n: l.n + 1, event }));
      if (apply) update(apply);
    },
    [update],
  );

  // Stable between edits: the preview re-measures its render time on change.
  const liveProps = useMemo(() => withHandlers(entry, sel.props, emit), [entry, sel.props, emit]);
  const onRendered = useCallback(({ ms }: { ms: number }) => setRenderMs(ms), []);

  const pickEntry = (item: ListItem) => {
    if (item === sel.item) return;
    setSel(select(item));
    setLog({ n: 0, event: null });
    setRenderMs(null);
  };
  const pickState = (name: string) => {
    const v = entry.variants.find((x) => x.name === name);
    if (v) setSel((s) => ({ ...s, props: applyVariant(entry, s.props, v), variant: v.name }));
  };
  const lastEvent = log.event ?? (primaryEvent(entry) ? { name: primaryEvent(entry)!, payload: '' } : null);

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
            <span>{`${BRAND.playgroundHost}/ignite-demo/${sel.item.label}`}</span>
          </span>
          <span className="ide__spacer" />
          <span className="ide__size">{size ? `${size.width} × ${size.height}` : ' '}</span>
          <span className="ide__live">
            <span className="live-dot" />
            LIVE · WASM
          </span>
        </div>

        <div className="ide__body">
          <aside className="ide__sidebar" aria-label="Components">
            <div className="ide__search">
              <Search size={13} color="#5F6879" />
              <span>Filter components</span>
              <span className="ide__spacer" />
              <kbd>⌘K</kbd>
            </div>
            <div style={{ height: 14 }} />
            <p className="ide__heading">{`COMPONENTS · ${COMPONENT_LIST.length}`}</p>
            {COMPONENT_LIST.map((item) => (
              <SidebarItem
                key={item.label}
                name={item.label}
                selected={item === sel.item}
                onSelect={() => pickEntry(item)}
                icon={<Box size={13} />}
              />
            ))}
            <div className="ide__group">
              <p className="ide__heading">{`SCREENS · ${SCREEN_LIST.length}`}</p>
              <div style={{ height: 8 }} />
              {SCREEN_LIST.map((item) => (
                <SidebarItem
                  key={item.label}
                  name={item.label}
                  selected={item === sel.item}
                  onSelect={() => pickEntry(item)}
                  icon={<Smartphone size={13} />}
                />
              ))}
            </div>
          </aside>

          <div className="ide__center">
            <div className="ide__canvas">
              <ShaderCanvas className="shader-fill" {...FILLS.playground} still />
              {view === 'preview' ? (
                <div className="ide__stage">
                  {entry.variants.length > 1 && (
                    <Segmented
                      className="ide__states"
                      value={sel.variant ?? ''}
                      options={entry.variants.map((v) => v.name)}
                      onChange={pickState}
                      label="State"
                    />
                  )}
                  <div className="ide__preview">
                    <PlaygroundPreviewSlot
                      entry={entry}
                      props={liveProps}
                      width={previewWidth}
                      onRendered={onRendered}
                      onSize={setSize}
                    />
                  </div>
                  <p className="ide__timing">
                    {`rendered in ${renderMs === null ? '…' : renderMs.toFixed(1)} ms  ·  ${entry.kind === 'screen' ? 'screen' : 'component'}  ·  Skia`}
                  </p>
                </div>
              ) : (
                <pre className="ide__source">{sourceFor(entry)}</pre>
              )}
            </div>

            <div className="ide__drawer">
              <div className="ide__drawer-bar" role="tablist" aria-label="Drawer">
                {(['Usage', 'Source', 'Console'] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    role="tab"
                    aria-selected={drawer === t}
                    className={drawer === t ? 'is-on' : ''}
                    onClick={() => setDrawer(t)}
                  >
                    {t}
                  </button>
                ))}
              </div>
              <div className="ide__code">
                {drawer === 'Console' && <ConsoleLines entry={entry} log={log} />}
                {drawer === 'Source' && <pre className="ide__drawer-source">{sourceFor(entry)}</pre>}
                {drawer === 'Usage' && <UsageLines lines={usageLines(entry, sel.props)} />}
              </div>
            </div>
          </div>

          <aside className="ide__props" aria-label="Props">
            <p className="ide__heading">PROPS</p>
            {Object.keys(entry.controls).length === 0 && <p className="prop__key">No props: this screen owns its state.</p>}
            {Object.entries(entry.controls).map(([key, control]) => (
              <PropControl
                key={`${entry.name}:${key}`}
                id={key}
                control={control}
                value={getControlValue(sel.props, key)}
                onChange={(v) => update((p) => setControlValue(p, key, v))}
              />
            ))}
            {lastEvent && (
              <div className="ide__event" aria-live="polite">
                <span className="ide__event-name">{`${lastEvent.name}()  ${log.event ? 'fired' : 'waiting'}`}</span>
                <span>{log.event ? lastEvent.payload || '—' : 'tap the preview'}</span>
              </div>
            )}
            <div className="ide__spacer" />
            <div className="ide__env">
              <p className="ide__heading">ENVIRONMENT</p>
              <div className="ide__select">
                <span>iPhone 16 Pro</span>
                <ChevronsUpDown size={13} color="#5F6879" />
              </div>
              <Segmented
                className="ide__theme"
                value={theme}
                options={['light', 'dark']}
                disabled={['dark']}
                titles={{ dark: 'ignite-demo ships a light theme only' }}
                onChange={setTheme}
                label="Theme"
              />
            </div>
          </aside>
        </div>
      </div>
    </section>
  );
}

function PropControl({
  id,
  control,
  value,
  onChange,
}: {
  id: string;
  control: CatalogControl;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  if (control.type === 'boolean') {
    const on = !!value;
    return (
      <div className="prop prop--row">
        <span className="prop__key" id={`prop-${id}`}>
          {id}
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-labelledby={`prop-${id}`}
          className={`switch${on ? ' is-on' : ''}`}
          onClick={() => onChange(!on)}
        >
          <span />
        </button>
      </div>
    );
  }
  if (control.type === 'enum') {
    const options = control.options ?? [];
    const index = options.findIndex((o) => o.value === value);
    return (
      <label className="prop">
        <span className="prop__key">{id}</span>
        <select
          className="prop__input prop__select"
          value={String(index)}
          onChange={(e) => onChange(options[Number(e.target.value)]?.value)}
        >
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
  const isNumber = control.type === 'number';
  return (
    <label className="prop">
      <span className="prop__key">{id}</span>
      <input
        className={`prop__input${id === 'episode.pubDate' ? ' is-hot' : ''}`}
        type={isNumber ? 'number' : 'text'}
        min={control.min}
        max={control.max}
        step={control.step}
        value={value === undefined || value === null ? '' : String(value)}
        placeholder={control.type === 'date' ? 'yyyy-mm-dd' : undefined}
        spellCheck={false}
        onChange={(e) => {
          if (!isNumber) return onChange(e.target.value);
          const n = e.target.valueAsNumber;
          onChange(Number.isNaN(n) ? undefined : n);
        }}
      />
    </label>
  );
}

/** 340 per the design; narrower only when the viewport cannot fit it. */
function usePreviewWidth() {
  const get = () => (typeof window === 'undefined' ? 340 : Math.min(340, window.innerWidth - 56));
  const [w, setW] = useState(get);
  useEffect(() => {
    const on = () => setW(get());
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return w;
}

function SidebarItem({
  name,
  selected,
  icon,
  onSelect,
}: {
  name: string;
  selected?: boolean;
  icon: ReactNode;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      className={`ide__item${selected ? ' is-selected' : ''}`}
      aria-current={selected ? 'true' : undefined}
      onClick={onSelect}
    >
      {icon}
      <span>{name}</span>
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
const N = ({ n }: { n: number }) => <T c="#3D4452">{`${n}  `}</T>;
const TOK_COLOR: Record<Tok['c'], string> = {
  punct: '#7A8496',
  tag: '#67E8F9',
  attr: '#C4B5FD',
  ident: '#F2F5F9',
  lit: '#C6F432',
};

function UsageLines({ lines }: { lines: Tok[][] }) {
  return (
    <>
      {lines.map((line, i) => (
        <div key={i}>
          <N n={i + 1} />
          {line.map((tok, j) => (
            <T key={j} c={TOK_COLOR[tok.c]}>
              {tok.t}
            </T>
          ))}
        </div>
      ))}
    </>
  );
}

function ConsoleLines({ entry, log }: { entry: AnyCatalogEntry; log: { n: number; event: PlaygroundEvent | null } }) {
  return (
    <>
      <div>
        <T c="#3D4452">{'›  '}</T>
        <T c="#98A2B3">{`mounted ${entry.name} · ignite-demo`}</T>
      </div>
      {log.event && (
        <div>
          <T c="#3D4452">{'›  '}</T>
          <T c="#C6F432">{`${log.event.name}()`}</T>
          <T c="#98A2B3">{` fired ${log.n}× · last ${log.event.payload || '()'}`}</T>
        </div>
      )}
    </>
  );
}

/** EpisodeCard shows its Ignite source (as designed); other entries their catalog usage + notes. */
function sourceFor(entry: AnyCatalogEntry): string {
  if (entry.name === 'EpisodeCard') return SOURCE;
  return `// ${entry.name} · ignite-demo\n// ${entry.description}\n\n${entry.usage}`;
}

const SOURCE = `export const EpisodeCard = observer(function EpisodeCard({
  episode,
  isFavorite,
  onPressFavorite,
}: EpisodeCardProps) {
  return (
    <Card
      style={$item}
      HeadingComponent={<Text style={$metadataText} size="xxs">{episode.datePublished.textLabel}</Text>}
      content={episode.parsedTitleAndSubtitle.title}
      RightComponent={<AutoImage source={{ uri: episode.thumbnail }} style={$itemThumbnail} />}
      FooterComponent={
        <Button onPress={onPressFavorite} style={[$favoriteButton, isFavorite && $unFavoriteButton]}>
          {isFavorite ? "Unlike" : "Like"}
        </Button>
      }
    />
  )
})`;
