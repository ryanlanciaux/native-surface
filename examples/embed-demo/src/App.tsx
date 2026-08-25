import { lazy, Suspense, useCallback, useState, type ReactNode } from 'react';
import { NativeSurface } from 'native-surface';
import { ButtonRow } from './rn/ButtonRow';
import { Counter } from './rn/Counter';
import { Feed } from './rn/Feed';
import { SheetScreen } from './rn/SheetScreen';
import { ProfileCard } from './rn/ProfileCard';
// Raw source strings for the Code tabs — text only, none of these trigger the
// modules themselves.
import feedSource from './rn/Feed.tsx?raw';
import navAppSource from './rn/NavApp.tsx?raw';
import sheetSource from './rn/SheetScreen.tsx?raw';

// The heavy islands carry react-navigation / @gorhom/bottom-sheet /
// reanimated — lazy chunks so first paint ships only React + the engine.
const NavApp = lazy(() => import('./rn/NavApp').then((m) => ({ default: m.NavApp })));
// Prism + the highlighter load only when someone opens a Code tab.
const CodePanel = lazy(() => import('./CodePanel'));

interface ActionEntry {
  id: number;
  name: string;
  detail: string;
}

let nextActionId = 0;

export function App() {
  const [actions, setActions] = useState<ActionEntry[]>([]);

  const handleAction = useCallback((name: string, payload?: unknown) => {
    const point = payload as { locationX?: number; locationY?: number } | undefined;
    const detail =
      typeof point?.locationX === 'number' && typeof point?.locationY === 'number'
        ? `${Math.round(point.locationX)}, ${Math.round(point.locationY)}`
        : '';
    setActions((prev) => [{ id: nextActionId++, name, detail }, ...prev].slice(0, 12));
  }, []);

  return (
    <div className="page">
      <header className="hero">
        <div className="hero__corner">
          <span className="badge-experimental" title="A speed-run test project — expect rough edges">
            Experimental
          </span>
          <a
            className="corner-link"
            href="https://github.com/ryanlanciaux/native-surface"
            target="_blank"
            rel="noreferrer"
          >
            <GitHubIcon />
            View project on GitHub
          </a>
          <a
            className="corner-link"
            href="https://x.com/ryanlanciaux"
            target="_blank"
            rel="noreferrer"
          >
            <XIcon />
            @ryanlanciaux
          </a>
        </div>
        <p className="eyebrow">wasm-playground · native-surface</p>
        <h1>Surfaces</h1>
      </header>

      <section className="islands">
        <article className="island island--wide">
          <IslandHead name="Counter" meta="390 × 140" />
          <div className="island--wide__body">
            <div className="surface-frame">
              <NativeSurface width={390} height={140} onAction={handleAction}>
                <Counter />
              </NativeSurface>
            </div>
            <ActionLog actions={actions} />
          </div>
        </article>

        <article className="island">
          <IslandHead name="Profile" meta="390 × 220" />
          <div className="surface-frame">
            <NativeSurface width={390} height={220}>
              <ProfileCard />
            </NativeSurface>
          </div>
        </article>

        <article className="island">
          <IslandHead name="Buttons" meta="390 × 180" />
          <div className="surface-frame">
            <NativeSurface width={390} height={180}>
              <ButtonRow />
            </NativeSurface>
          </div>
        </article>

        <CodeToggleIsland name="Feed" meta="390 × 420" file="rn/Feed.tsx" source={feedSource}>
          <div className="surface-frame">
            <NativeSurface width={390} height={420}>
              <Feed />
            </NativeSurface>
          </div>
        </CodeToggleIsland>

        <CodeToggleIsland
          name="Navigation"
          meta="390 × 720"
          file="rn/NavApp.tsx"
          source={navAppSource}
        >
          <div className="surface-frame">
            <Suspense fallback={<div style={{ width: 390, height: 720 }} />}>
              <NativeSurface width={390} height={720}>
                <NavApp />
              </NativeSurface>
            </Suspense>
          </div>
        </CodeToggleIsland>

        <CodeToggleIsland
          name="BottomSheet"
          meta="390 × 640"
          file="rn/SheetScreen.tsx"
          source={sheetSource}
        >
          <div className="surface-frame">
            <Suspense fallback={<div style={{ width: 390, height: 640 }} />}>
              <NativeSurface width={390} height={640}>
                <SheetScreen />
              </NativeSurface>
            </Suspense>
          </div>
        </CodeToggleIsland>



      </section>
    </div>
  );
}

function GitHubIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" fill="currentColor">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}

function XIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

function IslandHead({ name, meta }: { name: string; meta: string }) {
  return (
    <div className="island__head">
      <span className="island__name">{name}</span>
      <span className="island__meta">{meta}</span>
    </div>
  );
}

function CodeToggleIsland({
  name,
  meta,
  file,
  source,
  children,
}: {
  name: string;
  meta: string;
  file: string;
  source: string;
  children: ReactNode;
}) {
  const [view, setView] = useState<'preview' | 'code'>('preview');
  return (
    <article className="island island--wide">
      <div className="island__head">
        <span className="island__name">{name}</span>
        <div className="island__side">
          <div className="pill-tabs" role="tablist" aria-label={`${name} view`}>
            <button
              type="button"
              role="tab"
              aria-selected={view === 'preview'}
              className={`pill-tab${view === 'preview' ? ' pill-tab--active' : ''}`}
              onClick={() => setView('preview')}
            >
              Preview
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={view === 'code'}
              className={`pill-tab${view === 'code' ? ' pill-tab--active' : ''}`}
              onClick={() => setView('code')}
            >
              Code
            </button>
          </div>
          <span className="island__meta">{meta}</span>
        </div>
      </div>
      {/* The surface stays mounted behind the code view, so scroll position,
          navigation stacks, and sheet state survive the toggle. */}
      <div className={view === 'code' ? 'is-hidden' : undefined}>{children}</div>
      {view === 'code' ? (
        <Suspense fallback={<div className="code-panel code-panel--loading">loading source…</div>}>
          <CodePanel file={file} source={source} />
        </Suspense>
      ) : null}
    </article>
  );
}

function ActionLog({ actions }: { actions: ActionEntry[] }) {
  return (
    <div className="log">
      <div className="log__head">
        <span className="log__title">onAction</span>
      </div>
      {actions.length === 0 ? (
        <p className="log__empty">—</p>
      ) : (
        <ol className="log__list">
          {actions.map((entry) => (
            <li key={entry.id} className="log__row">
              <span className="log__name">{entry.name}</span>
              {entry.detail ? <span className="log__detail">@ {entry.detail}</span> : null}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
