import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { NativeSurface } from 'native-surface';
import type { NativeRoot } from 'native-surface';
import { createAutomationController } from 'native-surface/automation';
import { View } from 'react-native';
import { App } from '../app/app';
import { IgniteApp, catalogSurfaceSize, componentCatalog, device, loadIgnite, screenCatalog } from '../src';
import type { AnyCatalogEntry, IgniteRoute } from '../src';

/**
 * Routes (hash):
 *   #/            design phone (03.png) + every catalog entry, light and dark
 *   #/phone       phone frame running IgniteApp (host-drawn status bar, safeAreaInsets top 50)
 *   #/screen      bare 320x684 IgniteApp with its in-app status bar
 *   #/app         app/app.tsx exactly as generated (Login first, like a fresh install)
 *   #/c/<Name>[/<variant>]   one catalog entry at its size
 *   #/measure     lays every component entry out at its width, reports content heights
 * Query: ?theme=dark, ?route=<IgniteRoute>, ?bleed=1 (#/c/ pads by the shadow bleed)
 */
type Controller = ReturnType<typeof createAutomationController>;
type Win = Window & { __ignite?: { ready: number; log: unknown[]; controllers: Record<string, Controller>; measured?: Record<string, number> } };
const w = window as Win;
w.__ignite = { ready: 0, log: [], controllers: {} };

function onReadyFor(id: string) {
  return (root: NativeRoot) => {
    w.__ignite!.controllers[id] = createAutomationController(root);
    w.__ignite!.ready += 1;
    document.body.dataset.ready = String(w.__ignite!.ready);
  };
}

const params = new URLSearchParams(location.search);
const theme = params.get('theme') === 'dark' ? 'dark' : 'light';
const route = (params.get('route') ?? undefined) as IgniteRoute | undefined;
const bleedParam = params.get('bleed') === '1';
const log = (...entry: unknown[]) => w.__ignite!.log.push(entry);

function Phone() {
  return (
    <div
      data-testid="phone"
      style={{
        width: device.frameWidth,
        height: device.frameHeight,
        boxSizing: 'border-box',
        padding: device.bezel,
        borderRadius: device.frameRadius,
        background: 'linear-gradient(135deg, #3A3F4A 0%, #1A1D24 45%, #4A505C 100%)',
        boxShadow: 'inset 0 0 0 1.5px #8A93A2',
        flex: 'none',
      }}
    >
      <div style={{ width: device.screenWidth, height: device.screenHeight, borderRadius: device.screenRadius, overflow: 'hidden', position: 'relative' }}>
        <NativeSurface
          width={device.screenWidth}
          height={device.screenHeight}
          safeAreaInsets={{ ...device.safeAreaInsets, left: 0, right: 0 }}
          onReady={onReadyFor('phone')}
        >
          <IgniteApp
            theme={theme}
            initialRoute={route}
            onPressFavorite={(ep, fav) => log('favorite', ep.guid, fav)}
            onTabChange={(r, legacy) => log('route', r, legacy)}
          />
        </NativeSurface>
        {/* The bezel's status bar (design 03): drawn by the host, like a device would. */}
        <div
          style={{
            position: 'absolute',
            inset: '0 0 auto 0',
            height: device.statusBarHeight,
            pointerEvents: 'none',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '0 34px 3px 40px',
            boxSizing: 'border-box',
            font: '600 15px system-ui',
            color: theme === 'dark' ? '#fff' : '#191015',
          }}
        >
          <span>9:41</span>
          <span style={{ width: device.island.width, height: device.island.height, borderRadius: device.island.height / 2, background: '#000', marginLeft: 6 }} />
          <span style={{ width: 54 }} />
        </div>
      </div>
    </div>
  );
}

function Entry({ entry, variant, id, bleed, scheme }: { entry: AnyCatalogEntry; variant?: string; id: string; bleed?: boolean; scheme: 'light' | 'dark' }) {
  const v = entry.variants.find((x) => x.name === variant);
  const size = bleed ? catalogSurfaceSize(entry) : entry.size;
  const props = { ...v?.props, onPressFavorite: (ep: { guid: string }, fav: boolean) => log('favorite', ep.guid, fav) };
  return (
    <div data-testid={id} style={size}>
      <NativeSurface width={size.width} height={size.height} onReady={onReadyFor(id)}>
        {entry.render(props, { bleed, theme: scheme })}
      </NativeSurface>
    </div>
  );
}

/** Mounts its surface only near the viewport: browsers cap live WebGL contexts (~16 in Chromium). */
function Lazy({ width, height, children }: { width: number; height: number; children: React.ReactNode }) {
  const ref = React.useRef<HTMLDivElement | null>(null);
  const [visible, setVisible] = React.useState(false);
  React.useEffect(() => {
    const io = new IntersectionObserver(([e]) => setVisible(!!e?.isIntersecting), { rootMargin: '100px' });
    if (ref.current) io.observe(ref.current);
    return () => io.disconnect();
  }, []);
  return (
    <div ref={ref} style={{ width, height, flex: 'none' }}>
      {visible ? children : null}
    </div>
  );
}

function GalleryItem({ entry }: { entry: AnyCatalogEntry }) {
  const [variant, setVariant] = React.useState(entry.variants[0]?.name);
  const [scheme, setScheme] = React.useState<'light' | 'dark'>(theme);
  const pill = (active: boolean): React.CSSProperties => ({
    font: '11px ui-monospace, monospace',
    border: '1px solid #D7CEC9',
    borderRadius: 999,
    padding: '2px 8px',
    background: active ? '#191015' : '#fff',
    color: active ? '#fff' : '#191015',
  });
  return (
    <section>
      <h3 style={{ margin: '0 0 6px', font: '600 13px ui-monospace, monospace' }}>
        {entry.name} <span style={{ fontWeight: 400, opacity: 0.6 }}>{entry.kind}</span>
      </h3>
      <div style={{ display: 'flex', gap: 4, marginBottom: 8, flexWrap: 'wrap', maxWidth: Math.max(entry.size.width, 220) }}>
        {entry.variants.map((v) => (
          <button key={v.name} onClick={() => setVariant(v.name)} style={pill(v.name === variant)}>
            {v.name}
          </button>
        ))}
        <button onClick={() => setScheme(scheme === 'dark' ? 'light' : 'dark')} style={pill(scheme === 'dark')}>
          dark
        </button>
      </div>
      <Lazy {...catalogSurfaceSize(entry)}>
        <Entry key={`${variant}:${scheme}`} entry={entry} variant={variant} id={`${entry.name}/${variant}`} bleed scheme={scheme} />
      </Lazy>
    </section>
  );
}

function Gallery() {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 32, padding: 32, alignItems: 'flex-start' }}>
      <Phone />
      {[...componentCatalog, ...screenCatalog].map((entry) => (
        <GalleryItem key={entry.name} entry={entry} />
      ))}
    </div>
  );
}

/** Lays each component entry out at its width with free height; reports the content height. */
function Measure() {
  const [ready, setReady] = React.useState(false);
  const measured = React.useRef<Record<string, number>>({});
  React.useEffect(() => {
    loadIgnite().then(() => setReady(true));
  }, []);
  React.useEffect(() => {
    if (!ready) return;
    // Layout settles over a few frames (images, fonts); publish once it has.
    const t = setTimeout(() => (w.__ignite!.measured = { ...measured.current }), 4000);
    return () => clearTimeout(t);
  }, [ready]);
  return (
    <NativeSurface width={400} height={6000} onReady={onReadyFor('measure')}>
      <View style={{ alignItems: 'flex-start' }}>
        {ready &&
          componentCatalog.flatMap((e) =>
            e.variants.map((v) => {
              const id = `${e.name}/${v.name}`;
              return (
                <View
                  key={id}
                  style={{ width: e.size.width, marginBottom: 8 }}
                  onLayout={(ev) => (measured.current[id] = Math.ceil(ev.nativeEvent.layout.height))}
                >
                  {e.render({ ...v.props }, { theme, fit: true })}
                </View>
              );
            }),
          )}
      </View>
    </NativeSurface>
  );
}

function Root() {
  const r = location.hash.replace(/^#\/?/, '');
  if (r === 'app') {
    return (
      <NativeSurface width={device.screenWidth} height={device.screenHeight} onReady={onReadyFor('app')}>
        <App />
      </NativeSurface>
    );
  }
  if (r === 'phone') return <div style={{ padding: 24 }}><Phone /></div>;
  if (r === 'screen') {
    return (
      <NativeSurface width={device.screenWidth} height={device.screenHeight} onReady={onReadyFor('screen')}>
        <IgniteApp showStatusBar theme={theme} initialRoute={route} onPressFavorite={(ep, fav) => log('favorite', ep.guid, fav)} />
      </NativeSurface>
    );
  }
  if (r === 'measure') return <Measure />;
  if (r.startsWith('c/')) {
    const [, name, variant] = r.split('/');
    const entry = [...componentCatalog, ...screenCatalog].find((e) => e.name === name);
    if (!entry) return <p>Unknown component {name}</p>;
    document.body.classList.add('bare');
    return <Entry entry={entry} variant={variant} id="entry" bleed={bleedParam} scheme={theme} />;
  }
  return <Gallery />;
}

window.addEventListener('hashchange', () => location.reload());
createRoot(document.getElementById('root')!).render(<Root />);
