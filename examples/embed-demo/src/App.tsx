import { lazy, Suspense, useCallback, useState } from 'react';
import { NativeSurface } from 'native-surface';
import { ButtonRow } from './rn/ButtonRow';
import { Counter } from './rn/Counter';
import { Feed } from './rn/Feed';
import { SheetScreen } from './rn/SheetScreen';
import { ProfileCard } from './rn/ProfileCard';

// The heavy islands carry react-navigation / @gorhom/bottom-sheet /
// reanimated — lazy chunks so first paint ships only React + the engine.
const NavApp = lazy(() => import('./rn/NavApp').then((m) => ({ default: m.NavApp })));

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

        <article className="island island--wide">
          <IslandHead name="Feed" meta="390 × 420" />
          <div className="surface-frame">
            <NativeSurface width={390} height={420}>
              <Feed />
            </NativeSurface>
          </div>
        </article>

        <article className="island island--wide">
          <IslandHead name="Navigation" meta="390 × 720" />
          <div className="surface-frame">
            <Suspense fallback={<div style={{ width: 390, height: 720 }} />}>
              <NativeSurface width={390} height={720}>
                <NavApp />
              </NativeSurface>
            </Suspense>
          </div>
        </article>

        <article className="island island--wide">
          <IslandHead name="BottomSheet" meta="390 × 640" />
          <div className="surface-frame">
            <Suspense fallback={<div style={{ width: 390, height: 640 }} />}>
              <NativeSurface width={390} height={640}>
                <SheetScreen />
              </NativeSurface>
            </Suspense>
          </div>
        </article>



      </section>
    </div>
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
