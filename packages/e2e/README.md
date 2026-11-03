# @native-surface/e2e

A [TesterArmy e2e engine](https://e2e.tester.army/docs/writing-an-engine) for
browser-hosted React Native canvas surfaces, with a separate reusable browser
bridge. Supports e2e `>=0.19.0 <0.23.0`, including e2e's own `toHaveScreenshot`
visual comparison.

## Install

```sh
pnpm add -D @native-surface/e2e e2e
```

Add `native-surface` too if the project doesn't already have it. Requirements:

- Node `^22.22.3 || >=24.8.0`
- e2e `>=0.19.0 <0.23.0`
- Playwright `^1.63` comes bundled as a dependency of this package; you don't
  install it yourself.

pnpm doesn't link a dependency's binaries into your project, so
`pnpm exec playwright` isn't available. Install the browser with the Playwright
version this package resolved, which `pnpm why playwright` prints:

```sh
pnpm dlx playwright@<version> install chromium
```

On Linux CI use `pnpm dlx playwright@<version> install --with-deps chromium`.

`install chromium` includes the ffmpeg build that video recording needs. If you
launch your own browser through `executablePath`, also run
`pnpm dlx playwright@<version> install ffmpeg`. Without it the attempt writes no
video and reports a cleanup failure naming the missing binary; the test keeps
its status.

## Attach the test host

```tsx
import { NativeSurface } from 'native-surface';
import { createAutomationController } from 'native-surface/automation';
import { attachSurface } from '@native-surface/e2e/browser';

// Store these handles in the host's effect/ref and clean up on unmount.
let detach: (() => void) | undefined;
let controller: ReturnType<typeof createAutomationController> | undefined;

<NativeSurface width={390} height={844} onReady={root => {
  controller = createAutomationController(root);
  detach = attachSurface({ id: 'app', controller, canvas: root.canvas! });
}}>
  <App />
</NativeSurface>;

// Host cleanup:
// detach?.();
// controller?.dispose();
```

Attachment explicitly exposes a same-origin `window.__surfaceE2E` registry
(protocol version 1). Use a dedicated test host or a test-only build flag.
Importing the browser entry installs nothing. IDs identify individual canvases;
duplicate IDs fail. Detach removes the bridge; the application owns controller
disposal. The normal native-surface entry does not import this package.

## Configure and run

```ts
// e2e.config.ts
import type { E2EConfig } from 'e2e';
import { nativeSurface } from '@native-surface/e2e';

export default {
  targets: [{
    name: 'surface',
    engine: nativeSurface({ surfaceId: 'app', viewport: { width: 430, height: 900 } }),
    app: { url: 'http://127.0.0.1:5173' },
  }],
  workers: 1,
} satisfies E2EConfig;
```

```ts
// tests/profile.e2e.ts
import { test, expect } from 'e2e';

test('updates the profile', async ({ app, screen }) => {
  await app.open('/profile');
  await screen.getByLabel('Name').pressSequentially('Ada');
  await expect(screen.getByTestId('name')).toHaveValue('Ada');
  await screen.getByRole('button', { name: 'Save' }).tap();
  await expect(screen.getByText('Saved')).toBeVisible();
});
```

Start the host with your existing CI app-start command or e2e's `server`
configuration, then run `pnpm exec e2e run --target surface`. Agent steps use the
same engine; configure their model through e2e. Each attempt gets a fresh browser
context. Restart keeps persisted state; reset replaces the context. `launch`
accepts Playwright launch options, including `executablePath`. `browser` can be
`chromium` (default), `firefox`, or `webkit` when that browser is installed.

## Custom renderers

The engine and bridge have **no runtime dependency on native-surface**. The
exported `SurfaceController`/`SurfaceObservation` interfaces are structural.
The e2e peer (`>=0.19.0 <0.23.0`) is required.
A custom renderer can supply its own controller:

```tsx
import { createAutomationController } from 'your-renderer/automation';
import { attachSurface } from '@native-surface/e2e/browser';

const controller = createAutomationController(root);
const detach = attachSurface({ id: 'preview', controller, canvas: root.canvas!,
  // Older forks do not expose controller.inputElement(). This is combined
  // with the controller's focused-node and owning-overlay checks.
  getInputElement: () => {
    const active = root.canvas!.ownerDocument.activeElement;
    return active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement ? active : null;
  },
});
```

```ts
import { surface } from '@native-surface/e2e';
const engine = surface({ surfaceId: 'preview', platform: 'custom-renderer' });
```

For full input assertions, carry these snapshot fields into the owned renderer:
`value` for nonsecure inputs, `secure`, `editable`, `placeholder`, and
`inputPurpose`. Also forward TextInput accessibility labels/roles to its host
node. Root-scoped `controller.inputElement()` and `hitTest(point)` methods are
recommended; `hitTest` verifies the requested node is on the normal topmost input
path, including canvas occlusion. Older snapshots
can still drive pointer/keyboard input: the bridge reads the focused DOM input
and conservatively masks fields with unknown secure metadata. Unfocused value
assertions require the snapshot additions.

Any host can use `attachSurface` and `BrowserBridge` directly without the e2e
runner. The browser entry contains no Node, Playwright, renderer, or e2e imports.

## Capabilities and limits

- Queries: roles, labels, text, placeholders, display values, testIDs, scopes,
  filters, and indexes. CSS selectors and frame selectors are unsupported.
- Node actions: tap, focus, fill, clear, press, and directional swipe/scroll.
  Pointer actions: tap, directional swipe/scroll, drag, and swipe-to.
- Keyboard input uses Playwright browser events per character, with focus checks
  between characters. Selection replacement and controlled inputs are supported.
  Tab traversal is unsupported. Single-line typing with newlines is refused;
  use an explicit Enter press to submit. Focus loss after partial input reports
  `ACTION_MAY_HAVE_COMMITTED` instead of repeating the mutation.
- Headless browsers work. Browserless Node rendering has no keyboard capability
  through this engine. Playwright does not simulate complete IME sessions.
- Bounds and pointer points use browser viewport CSS coordinates. Canvas offsets,
  positive axis-aligned CSS scaling, and DPR are handled. Arbitrary host
  rotation/skew/perspective is unsupported.
- Screenshots capture the browser viewport, including input overlays and portals.
  Secure canvas fields across **all attached bridges** and DOM password inputs
  are masked before pixels leave the engine. Secure values are omitted. Captures
  retry if surface revisions or geometry change. Keep unrelated canvases out of
  the test host or attach their bridges too.
- Portals mark the semantic tree incomplete. Their DOM descendants are not
  surface locators, and node actions intercepted by unrelated DOM content fail.
  Use a web target when full DOM portal semantics are needed.
- Screenshots are available as artifacts and as observation pixels, so e2e's
  `expect(screen).toHaveScreenshot()` and `expect(locator).toHaveScreenshot()`
  work. There is no `scrollIntoView` action; element screenshots need the node
  on screen already. State export, trace, uploads, and native modules are not
  declared. Keep device targets for Hermes/Fabric and
  native behavior; a surface pass does not prove a device pass.

## Video

Pass `--video` to `e2e run`, or set the `video` key in the config, on a target,
or on a single test. Each takes `off`, `on`, `retain-on-failure`,
`on-first-retry`, or `on-all-retries`.

```sh
pnpm exec e2e run --video=retain-on-failure
```

```ts
export default {
  video: 'retain-on-failure',
  targets: [{ name: 'surface', engine: nativeSurface(), app: { url }, video: 'on' }],
} satisfies E2EConfig;
```

```ts
test('checkout', { video: 'on' }, async ({ app }) => { await app.open('/'); });
```

A test's own `video` wins over `--video`, which wins over the target's, which
wins over the config's. With e2e 0.22 and later, a test can also call
`app.startRecording()` and `app.stopRecording()`; set `video: 'off'` on that
test, because e2e allows one recording at a time.

Recordings are WebM files at the engine viewport size, under the attempt's
artifact directory as `video/segment-001.webm`, `video/segment-002.webm`, and so
on. The JSON report lists them as `video` artifacts of each attempt.

- Recording follows the page. `app.clearState()` and `app.restart()` replace the
  page, so each produces a new segment once the app reopens.
- A page that was never opened records nothing, and `about:blank` is never
  recorded. An attempt that opens no page has no video.
- Recording needs Playwright's ffmpeg; see [Install](#install).

**Security: videos are not masked.** Secure fields are masked in screenshots, but
a recording masks nothing, as the e2e docs state, and e2e labels it
`redaction: 'incomplete'`. A video can show anything the page showed, including
passwords and tokens. Treat video files as secrets when you store or share them.

## Visual regression

`visual/` holds a small Vite host that mounts embed-demo screens
(`/profile`, `/counter`, `/feed`) on a native-surface canvas at DPR 1 and
attaches the bridge once the surface has painted and fonts are ready.
`visual/e2e.config.ts` starts that host on <http://127.0.0.1:5292> through
`app.command` and stops it after the run. Each test in `visual/tests/` first
asserts a semantic node, then compares the 430x900 viewport (and one element)
with e2e's `toHaveScreenshot`.

```sh
pnpm test:visual          # compare against the committed baselines
pnpm test:visual:update   # rewrite baselines after an intended change
```

Both are root shortcuts for `pnpm --filter @native-surface/e2e test:visual[:update]`.
Baselines live next to each test in `visual/tests/<file>.e2e.ts-snapshots/`,
named `<name>-surface-linux.png`. Review the PNGs before committing them.
They are Linux-only: font rasterization differs on macOS, so other platforms
write their own `-<os>` files and must not commit them. Generate and compare
on Linux with one Chromium build (`SURFACE_E2E_CHROMIUM` picks it,
otherwise `/usr/bin/chromium`). Failure
diffs, actuals, and traces go to `visual/.e2e/results/` (git-ignored).

## Development

From the repository root, run `pnpm --filter @native-surface/e2e preview` and
open <http://127.0.0.1:5175>. This serves the browser test fixture with its
automation bridges attached (`app` and `other`). Click the Name field and type:
the controlled value becomes uppercase, while the rows below show key and
change events. You can also try the multiline/password inputs, Increment, and
the scroll list. This is a local development preview, not a deployed website.
Point an e2e target's `app.url` at this URL and use `surfaceId: 'app'` to automate
it. Stop the preview with Ctrl+C. The automated suite starts its own isolated
server, so it does not require this preview to be running.

```sh
pnpm --filter @native-surface/e2e build
pnpm --filter @native-surface/e2e typecheck
pnpm --filter @native-surface/e2e test
```

Tests build the package, start an isolated Vite fixture, run real
Chromium/CanvasKit, and invoke the e2e CLI. Set `SURFACE_E2E_CHROMIUM`
to choose an executable; tests otherwise use `/usr/bin/chromium` when available
or Playwright's installed Chromium. Video tests also need Playwright's ffmpeg and
use `ffprobe` when it is at `/usr/bin/ffprobe`.

Test and visual servers bind to `127.0.0.1`, and the e2e configs open
`http://127.0.0.1`, because e2e accepts plain HTTP only on loopback hosts.
`SURFACE_E2E_HOST` may name another `127.x.x.x` address; any other value fails
with an error.

The dev dependency pins e2e to the peer range floor. To run the vitest and
visual suites against a newer e2e in the peer range, run:

```sh
pnpm --filter @native-surface/e2e test:compat
```

It packs this package, installs the tarball and the e2e version named in the
`test:compat` script into a temporary consumer project, runs both suites against
that copy, and deletes the project. It refuses an e2e release published less
than 7 days ago unless `minimumReleaseAgeExclude` in `pnpm-workspace.yaml`
lists it. `node scripts/e2e-compat.mjs <version>...` takes other
versions.
