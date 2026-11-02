// Visual-regression host: mounts one embed-demo screen per URL path on a
// native-surface canvas and attaches the e2e bridge once it has painted.
import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { NativeSurface } from 'native-surface';
import { createAutomationController } from 'native-surface/automation';
import { attachSurface } from '../src/browser';
import { Counter } from '../../../examples/embed-demo/src/rn/Counter';
import { Feed } from '../../../examples/embed-demo/src/rn/Feed';
import { ProfileCard } from '../../../examples/embed-demo/src/rn/ProfileCard';

// Nothing on these screens should be random; pin it anyway so a future
// screen cannot make baselines flaky by accident.
let seed = 1;
Math.random = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;

// Same surface sizes as the embed-demo page.
const screens: Record<string, { width: number; height: number; render: () => React.ReactElement }> = {
  '/profile': { width: 390, height: 220, render: () => <ProfileCard /> },
  '/counter': { width: 390, height: 180, render: () => <Counter /> },
  '/feed': { width: 390, height: 720, render: () => <Feed /> },
};

function Host() {
  const screen = screens[location.pathname];
  React.useEffect(() => () => cleanup?.(), []);
  if (!screen) return <p>Unknown screen {location.pathname}</p>;
  return <NativeSurface width={screen.width} height={screen.height} dpr={1}
    onReady={async root => {
      // CanvasKit fonts load before onReady; DOM overlay fonts may still be pending.
      await document.fonts.ready;
      const controller = createAutomationController(root);
      const detach = attachSurface({ id: 'app', controller, canvas: root.canvas as HTMLCanvasElement });
      cleanup = () => { detach(); controller.dispose(); };
    }}>
    {screen.render()}
  </NativeSurface>;
}
let cleanup: (() => void) | undefined;

createRoot(document.getElementById('root')!).render(<Host />);
