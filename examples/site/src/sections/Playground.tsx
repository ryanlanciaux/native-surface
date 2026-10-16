import { Box, ChevronsUpDown, Lock, Search, Smartphone } from 'lucide-react';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { BRAND } from '../brand';
import { PlaygroundPreviewSlot } from '../live/PlaygroundPreviewSlot';
import type { EpisodeCardState, EpisodeProps } from '../live/types';
import { FILLS, ShaderCanvas } from '../shaders';
import './playground.css';

const COMPONENTS = ['AutoImage', 'Button', 'Card', 'EpisodeCard', 'Header', 'ListItem', 'TextField', 'Toggle'];
const SCREENS = ['WelcomeScreen', 'DemoShowroomScreen', 'DemoPodcastListScreen'];
const STATES: EpisodeCardState[] = ['default', 'favorited', 'pressed'];
const FIELDS: { key: keyof EpisodeProps; label: string }[] = [
  { key: 'title', label: 'episode.title' },
  { key: 'pubDate', label: 'episode.pubDate' },
  { key: 'duration', label: 'episode.duration' },
  { key: 'cover', label: 'episode.cover' },
];

export function Playground() {
  const [state, setState] = useState<EpisodeCardState>('favorited');
  const [episode, setEpisode] = useState<EpisodeProps>({
    title: 'RNR 314 - Shipping the New Architecture',
    pubDate: '2023-07-13',
    duration: '47:02',
    cover: 'rnr-314.png',
  });
  const [isFavorite, setFavorite] = useState(true);
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [view, setView] = useState<'preview' | 'code'>('preview');
  const [drawer, setDrawer] = useState<'Usage' | 'Source' | 'Console'>('Usage');
  const [log, setLog] = useState<{ n: number; guid: string }>({ n: 0, guid: 'rnr-314' });
  const [renderMs, setRenderMs] = useState(2.1);
  const previewWidth = usePreviewWidth();

  const onPressFavorite = useCallback(({ guid }: { guid: string }) => {
    setFavorite((f) => !f);
    setState((s) => (s === 'favorited' ? 'default' : s === 'default' ? 'favorited' : s));
    setLog((l) => ({ n: l.n + 1, guid }));
  }, []);

  const pickState = (s: EpisodeCardState) => {
    setState(s);
    if (s === 'favorited') setFavorite(true);
    if (s === 'default') setFavorite(false);
  };

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
            <span>{`${BRAND.playgroundHost}/ignite-demo/EpisodeCard`}</span>
          </span>
          <span className="ide__spacer" />
          <span className="ide__size">390 × 160</span>
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
            <p className="ide__heading">COMPONENTS · 18</p>
            {COMPONENTS.map((name) => (
              <SidebarItem key={name} name={name} selected={name === 'EpisodeCard'} icon={<Box size={13} />} />
            ))}
            <div className="ide__group">
              <p className="ide__heading">SCREENS · 6</p>
              <div style={{ height: 8 }} />
              {SCREENS.map((name) => (
                <SidebarItem key={name} name={name} icon={<Smartphone size={13} />} />
              ))}
            </div>
          </aside>

          <div className="ide__center">
            <div className="ide__canvas">
              <ShaderCanvas className="shader-fill" {...FILLS.playground} still />
              {view === 'preview' ? (
                <div className="ide__stage">
                  <Segmented
                    className="ide__states"
                    value={state}
                    options={STATES}
                    onChange={pickState}
                    label="State"
                  />
                  <div className="ide__preview">
                    <PlaygroundPreviewSlot
                      component="EpisodeCard"
                      width={previewWidth}
                      state={state}
                      episode={episode}
                      isFavorite={isFavorite}
                      theme={theme}
                      onPressFavorite={onPressFavorite}
                      onRendered={({ ms }) => setRenderMs(ms)}
                    />
                  </div>
                  <p className="ide__timing">{`rendered in ${renderMs.toFixed(1)} ms  ·  12.9 kb  ·  Skia`}</p>
                </div>
              ) : (
                <pre className="ide__source">{SOURCE}</pre>
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
                {drawer === 'Console' && <ConsoleLines log={log} />}
                {drawer === 'Source' && <pre className="ide__drawer-source">{SOURCE}</pre>}
                {drawer === 'Usage' && <UsageLines isFavorite={isFavorite} />}
              </div>
            </div>
          </div>

          <aside className="ide__props" aria-label="Props">
            <p className="ide__heading">PROPS</p>
            {FIELDS.map(({ key, label }) => (
              <label key={key} className="prop">
                <span className="prop__key">{label}</span>
                <input
                  className={`prop__input${key === 'pubDate' ? ' is-hot' : ''}`}
                  value={episode[key]}
                  spellCheck={false}
                  onChange={(e) => setEpisode((ep) => ({ ...ep, [key]: e.target.value }))}
                />
              </label>
            ))}
            <div className="prop prop--row">
              <span className="prop__key" id="prop-fav">
                isFavorite
              </span>
              <button
                type="button"
                role="switch"
                aria-checked={isFavorite}
                aria-labelledby="prop-fav"
                className={`switch${isFavorite ? ' is-on' : ''}`}
                onClick={() => {
                  setFavorite(!isFavorite);
                  if (state !== 'pressed') setState(isFavorite ? 'default' : 'favorited');
                }}
              >
                <span />
              </button>
            </div>
            <div className="ide__event" aria-live="polite">
              <span className="ide__event-name">{'onPressFavorite()  fired'}</span>
              <span>{`{ guid: '${log.guid}' }`}</span>
            </div>
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

function SidebarItem({ name, selected, icon }: { name: string; selected?: boolean; icon: ReactNode }) {
  return (
    <div className={`ide__item${selected ? ' is-selected' : ''}`} aria-current={selected ? 'true' : undefined}>
      {icon}
      <span>{name}</span>
    </div>
  );
}

function Segmented<T extends string>({
  value,
  options,
  labels,
  onChange,
  className,
  label,
}: {
  value: T;
  options: readonly T[];
  labels?: Partial<Record<T, string>>;
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

function UsageLines({ isFavorite }: { isFavorite: boolean }) {
  return (
    <>
      <div>
        <N n={1} />
        <T c="#7A8496">{'<'}</T>
        <T c="#67E8F9">EpisodeCard</T>
      </div>
      <div>
        <N n={2} />
        <T c="#C4B5FD">{'  episode'}</T>
        <T c="#7A8496">{'={'}</T>
        <T c="#F2F5F9">episodeStore</T>
        <T c="#7A8496">.episodes[</T>
        <T c="#C6F432">0</T>
        <T c="#7A8496">{']}'}</T>
      </div>
      <div>
        <N n={3} />
        <T c="#C4B5FD">{'  isFavorite'}</T>
        <T c="#7A8496">{'={'}</T>
        <T c="#C6F432">{String(isFavorite)}</T>
        <T c="#7A8496">{'}'}</T>
      </div>
      <div>
        <N n={4} />
        <T c="#C4B5FD">{'  onPressFavorite'}</T>
        <T c="#7A8496">{'={'}</T>
        <T c="#7A8496">{'() => '}</T>
        <T c="#F2F5F9">episodeStore</T>
        <T c="#7A8496">.toggleFavorite(</T>
        <T c="#F2F5F9">episode</T>
        <T c="#7A8496">{')}'}</T>
      </div>
      <div>
        <N n={5} />
        <T c="#7A8496">{'/>'}</T>
      </div>
    </>
  );
}

function ConsoleLines({ log }: { log: { n: number; guid: string } }) {
  return (
    <>
      <div>
        <T c="#3D4452">{'›  '}</T>
        <T c="#98A2B3">mounted EpisodeCard · ignite-demo</T>
      </div>
      <div>
        <T c="#3D4452">{'›  '}</T>
        <T c="#C6F432">onPressFavorite()</T>
        <T c="#98A2B3">{` fired ${log.n}× · last { guid: '${log.guid}' }`}</T>
      </div>
    </>
  );
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
