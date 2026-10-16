import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { NativeSurface } from 'native-surface';
import type { NativeRoot } from 'native-surface';
import { createAutomationController } from 'native-surface/automation';
import { IgniteApp, catalogSurfaceSize, componentCatalog, device, loadIgniteFonts, screenCatalog } from '../src';
import type { AnyCatalogEntry } from '../src';

/**
 * Routes (hash):
 *   #/            phone frame (design 03) + every component below
 *   #/phone       phone frame only (screenshot target, 340x704)
 *   #/screen      bare 320x684 app surface (host draws no bezel; in-app status bar)
 *   #/c/<Name>[/<variant>]   one catalog entry at its design size
 * Query: ?statusbar=0 hides the in-app status bar on the phone routes;
 *        ?bleed=1 pads #/c/ entries by their shadow bleed (the gallery always does).
 */
type Win = Window & { __ignite?: { ready: number; controllers: Record<string, ReturnType<typeof createAutomationController>> } };
const w = window as Win;
w.__ignite = { ready: 0, controllers: {} };

function onReadyFor(id: string) {
  return (root: NativeRoot) => {
    w.__ignite!.controllers[id] = createAutomationController(root);
    w.__ignite!.ready += 1;
    document.body.dataset.ready = String(w.__ignite!.ready);
  };
}

const params = new URLSearchParams(location.search);
const statusBar = params.get('statusbar') !== '0';
const bleedParam = params.get('bleed') === '1';

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
      }}
    >
      <div style={{ width: device.screenWidth, height: device.screenHeight, borderRadius: device.screenRadius, overflow: 'hidden' }}>
        <NativeSurface width={device.screenWidth} height={device.screenHeight} onReady={onReadyFor('phone')}>
          <IgniteApp showStatusBar={statusBar} />
        </NativeSurface>
      </div>
    </div>
  );
}

function Entry({ entry, variant, id, bleed }: { entry: AnyCatalogEntry; variant?: string; id: string; bleed?: boolean }) {
  const v = entry.variants.find((x) => x.name === variant);
  const size = bleed ? catalogSurfaceSize(entry) : entry.size;
  return (
    <div data-testid={id} style={size}>
      <NativeSurface width={size.width} height={size.height} onReady={onReadyFor(id)}>
        {entry.render(v?.props, { bleed })}
      </NativeSurface>
    </div>
  );
}

/**
 * Mounts its surface only while near the viewport: browsers cap live WebGL
 * contexts (~16 in Chromium), so a page of 40 always-on surfaces loses some.
 */
function Lazy({ width, height, children }: { width: number; height: number; children: React.ReactNode }) {
  const ref = React.useRef<HTMLDivElement | null>(null);
  const [visible, setVisible] = React.useState(false);
  React.useEffect(() => {
    const io = new IntersectionObserver(([e]) => setVisible(!!e?.isIntersecting), { rootMargin: '100px' });
    if (ref.current) io.observe(ref.current);
    return () => io.disconnect();
  }, []);
  return (
    <div ref={ref} style={{ width, height }}>
      {visible ? children : null}
    </div>
  );
}

function GalleryItem({ entry }: { entry: AnyCatalogEntry }) {
  const [variant, setVariant] = React.useState(entry.variants[0]?.name);
  return (
    <section>
      <h3 style={{ margin: '0 0 6px', font: '600 13px ui-monospace, monospace' }}>{entry.name}</h3>
      <div style={{ display: 'flex', gap: 4, marginBottom: 8, flexWrap: 'wrap', maxWidth: Math.max(entry.size.width, 200) }}>
        {entry.variants.map((v) => (
          <button
            key={v.name}
            onClick={() => setVariant(v.name)}
            style={{
              font: '11px ui-monospace, monospace',
              border: '1px solid #D7CEC9',
              borderRadius: 999,
              padding: '2px 8px',
              background: v.name === variant ? '#191015' : '#fff',
              color: v.name === variant ? '#fff' : '#191015',
            }}
          >
            {v.name}
          </button>
        ))}
      </div>
      <Lazy {...catalogSurfaceSize(entry)}>
        <Entry key={variant} entry={entry} variant={variant} id={`${entry.name}/${variant}`} bleed />
      </Lazy>
    </section>
  );
}

function Gallery() {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 32, padding: 32, alignItems: 'flex-start' }}>
      <Phone />
      {[...componentCatalog, ...screenCatalog.slice(1)].map((entry) => (
        <GalleryItem key={entry.name} entry={entry} />
      ))}
    </div>
  );
}

function App() {
  const route = location.hash.replace(/^#\/?/, '');
  if (route === 'phone') return <Phone />;
  if (route === 'screen') {
    return (
      <NativeSurface width={device.screenWidth} height={device.screenHeight} onReady={onReadyFor('screen')}>
        <IgniteApp showStatusBar={statusBar} />
      </NativeSurface>
    );
  }
  if (route.startsWith('c/')) {
    const [, name, variant] = route.split('/');
    const entry = [...componentCatalog, ...screenCatalog].find((e) => e.name === name);
    if (!entry) return <p>Unknown component {name}</p>;
    document.body.classList.add('bare');
    return <Entry entry={entry} variant={variant} id={`${name}/${variant ?? ''}`} bleed={bleedParam} />;
  }
  return <Gallery />;
}

window.addEventListener('hashchange', () => location.reload());
// Fonts first: the first paint already has Space Grotesk metrics.
void loadIgniteFonts().finally(() => createRoot(document.getElementById('root')!).render(<App />));
