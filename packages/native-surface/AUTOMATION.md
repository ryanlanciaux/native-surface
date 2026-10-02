# Remote control

`native-surface/automation` is an optional control and observation API: coordinate
input, screenshots, structural snapshots, and frame synchronization. Connect it
to your application's WebSocket, HTTP, or IPC transport so another process can
drive a surface. The library opens no connections, starts no servers, and
installs no globals.

## Attach a controller

```tsx
import { NativeSurface } from 'native-surface';
import { createAutomationController } from 'native-surface/automation';

<NativeSurface width={390} height={640} onReady={root => {
  const controller = createAutomationController(root);
  // Hand the controller to your application's remote connection here.
}}>
  <MyScreen />
</NativeSurface>
```

`onReady(root)` fires after the first committed paint. `rootRef` also receives the
root and is cleared on teardown. Imperative hosts can pass their
`createNativeRoot(...)` result directly. Call `controller.dispose()` when the
connection ends; unmount also disposes it and cancels waits.

Importing the entry does not enable control. The main entry does not import it.
Without a controller, there are no observation subscriptions, counters, timers,
tree scans, or image copies. Integrations using `__nativeSurfaceRoots` must
explicitly pass `<NativeSurface debug>` to enable that legacy registry; `debug`
alone does not create a controller.

## Connect another process

This application-side JavaScript adapter accepts requests over an already
connected browser WebSocket. The other process owns the server and chooses the
commands. Call `attachControl` explicitly when your surface and connection are
ready; call the returned function when disconnecting the integration.

```js
function attachControl(controller, socket) {
  const commands = {
    observe: options => controller.observe({ snapshot: !!options?.snapshot }),
    snapshot: () => controller.snapshot(),
    screenshot: async () => {
      const shot = await controller.screenshot({ format: 'pixels' });
      return { ...shot, data: Array.from(shot.data) };
    },
    tap: point => controller.tap(point),
    pointerDown: point => controller.pointerDown(point),
    pointerMove: point => controller.pointerMove(point),
    pointerUp: point => controller.pointerUp(point),
    pointerCancel: () => controller.pointerCancel(),
    scroll: options => controller.scroll(options),
    drag: options => controller.drag(options),
    type: text => controller.type(text),
    key: (key, options) => controller.key(key, options),
    waitForChange: (revision, options) => controller.waitForChange(revision, options),
    waitForStable: options => controller.waitForStable(options),
    releaseCapture: () => controller.releaseCapture(),
  };
  const reply = message => {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
  };
  const receive = async event => {
    let id = null;
    try {
      const request = JSON.parse(event.data);
      id = request.id;
      if (!Object.hasOwn(commands, request.method)) throw new Error('Unknown command');
      const result = await commands[request.method](...(request.args ?? []));
      reply({ id, result: result ?? null });
    } catch (error) {
      reply({ id, error: error instanceof Error ? error.message : String(error) });
    }
  };
  const detach = () => {
    socket.removeEventListener('message', receive);
    socket.removeEventListener('close', detach);
    controller.dispose();
  };
  socket.addEventListener('message', receive);
  socket.addEventListener('close', detach);
  return detach;
}
```

Example requests from the other process:

```json
{"id":1,"method":"observe","args":[{"snapshot":true}]}
{"id":2,"method":"tap","args":[{"x":180,"y":72}]}
{"id":3,"method":"scroll","args":[{"x":180,"y":350,"deltaY":240}]}
{"id":4,"method":"type","args":["hello"]}
{"id":5,"method":"screenshot"}
```

Replies carry the same `id` and either `result` or `error`. Await each input reply
before another gesture; change waits can remain outstanding while commands
arrive. Use a prior observation's revision with `waitForChange` to wait for a
paint after input. An input reply means dispatch completed, not that a future
React update has painted.

This adapter uses JSON RGBA arrays for simplicity. For frequent captures, send
`shot.data.buffer` as a binary frame with separate metadata, or request a PNG
`blob` through your transport. ImageBitmap and borrowed canvases are local image
objects, not JSON payloads. The application owns connection setup, access,
reconnection, and teardown.

## Input and coordinates

All points and snapshot bounds use **surface logical pixels**: `(0, 0)` is the
top-left; positive x is right and positive y is down. Scroll offsets and native
transforms are already accounted for. Do not multiply input by devicePixelRatio.

| Method | Behavior |
| --- | --- |
| `tap({ x, y })` | Pointer down/up through normal hit testing and dispatch. |
| `pointerDown/Move/Up({ x, y })`, `pointerCancel()` | Control one captured pointer. |
| `drag({ from, to, duration?, steps?, signal? })` | Interpolated movement; default duration 200 ms. |
| `scroll({ x, y, deltaY, deltaX? })` | Wheel input with logical pixel deltas. |
| `type(text)` | Insert into this surface's focused input. |
| `key(key, modifiers?)` | Keyboard input and supported editing defaults. |
| `normalizePoint(point)`, `denormalizePoint(point)` | Convert logical coordinates to/from viewport fractions. |
| `toClientPoint(point)`, `fromClientPoint(point)` | Convert to/from browser client CSS coordinates. |

Pointer input shares the existing PointerPipeline, including transformed hits,
disabled state, press retention, nested scrolling, and momentum. Down/wheel
synchronize pending layout. A gesture starts inside the viewport; captured
movement/up may leave it. Do not interleave controllers or real pointers during
a gesture. Wheel uses the deepest enabled scroll region and does not chain to
an ancestor at its boundary. Drag uses real time; `duration: 0` dispatches
synchronously and usually does not generate momentum. Abort/disposal cancels it.

Typing uses the existing input state machine and, in a browser, the focused
input's selection and `beforeinput`/`input` events. `type` inserts a string as one
input event. `key` supports printable characters, Enter, Backspace/Delete,
Home/End, arrows, and Ctrl/Meta+A. IME, clipboard, Tab navigation, trusted events,
and other native shortcuts need host input support. Coordinates intercepted by
DOM portals are rejected; interact with that content through the host.

Client conversion supports placement, scrolling, and positive axis-aligned CSS
stretching. Arbitrary host CSS rotation/skew/perspective needs host geometry.

## Observation

```ts
const metadata = await controller.observe();
const state = await controller.observe({ snapshot: true });
const snapshot = controller.snapshot(); // synchronous; engine must be ready
```

Observation returns `viewport`, `revision`, paint `timestamp`, `focusedNode`, and
live input/portal `overlays`. `snapshot: true` adds `nodes` and `scrollRegions`.
It flushes committed pending work, not future React updates. Metadata-only
observation does not traverse the tree.

Snapshots are immutable and cached by revision. Nodes expose host and parent
ids, types, application labels/roles/testIDs, transformed/clipped bounds,
visibility, opacity, input state, and canvas/DOM rendering type. Canvas text
includes grapheme fragments with bounds, clipping, and approximation flags.
Truncated text is omitted and secure text stays masked. Use fragment
`visibleBounds` to locate visible text; node text can be offscreen. DOM glyphs
are omitted. Rounded clips, masks, and uncertain occlusion are approximate. A
bounding rectangle's center may miss a rotated or partially obscured node.
Inputs also expose `value` independently of painted glyphs, plus `placeholder`,
`editable`, `secure`, and `inputPurpose`. Secure values are omitted, including
while focused. Accessibility labels and roles remain application metadata.
`controller.inputElement()` returns the focused DOM input owned by this surface,
or null when another surface owns focus or the host is browserless. Host tooling
can use it to validate browser focus before dispatching physical keyboard input.
`controller.hitTest({ x, y })` returns node IDs on the existing pointer pipeline's
topmost hit path. Drivers can check a candidate node before dispatching input.

Scroll regions expose axis, offsets, content/viewport extents, enabled state,
limits, clipped bounds, and parent scroll id. Snapshots contain no React Fibers,
Yoga objects, or owned WASM resources.

## Screenshots

```ts
const shot = await controller.screenshot({ format: 'blob' });
const state = await controller.observe({ screenshot: { format: 'pixels' } });
controller.releaseCapture(); // stop maintaining the browser capture buffer
```

| Format | Result |
| --- | --- |
| `bitmap` (default) | Owned ImageBitmap; caller must close it. Browser only. |
| `canvas` | Borrowed reusable canvas; changes on the next paint. Browser only. |
| `pixels` | Owned tightly packed unpremultiplied sRGB RGBA8 array. |
| `blob` | Owned PNG Blob; encoding occurs only when requested. |
| `display` | Blob from an application-supplied display capture provider. |

Each capture includes actual image `width`/`height`, logical/backing viewport
dimensions, revision, paint timestamp, and `scope`. Map image points to logical
coordinates using `viewport.width / shot.width` and `viewport.height / shot.height`.

Surface capture reads CanvasKit pixels directly. The browser buffer is allocated
on first capture and copied after paint before WebGL discards its backbuffer.
Subsequent static captures reuse it. Only controllers requesting screenshots pay
for buffer copies; `releaseCapture()` stops them. Headless capture supports
pixels and PNG. Host CSS backgrounds/effects are outside the canvas image.

Focused inputs and portals are DOM overlays. Surface capture throws
`DisplayCaptureRequiredError` while present because canvas pixels omit them.
Applications needing complete display capture can supply their own mechanism:

```ts
const controller = createAutomationController(root, {
  captureDisplay: async ({ root }) => {
    return hostCapture.captureSurface(root.canvas);
    // Promise<{ data: Blob, width: number, height: number }>
  },
});
const shot = await controller.screenshot({ format: 'display' });
```

The provider reports actual dimensions including host scaling. If the surface
changes or renderer work is pending when it completes, capture rejects with
`StaleCaptureError`. External DOM/media changes are not engine revisions.

## Frame synchronization

```ts
const before = controller.revision;
controller.tap({ x: 180, y: 72 });
await controller.waitForChange(before, { timeout: 1000 });
await controller.waitForStable({ frames: 2, timeout: 1000 });
```

Revisions start at zero per controller and advance after dirty/animated paints
and overlay synchronization. Idle forced paints do not increment them. Dirty
paints can produce identical pixels: revision is an invalidation counter, not a
pixel hash. Revisions are not comparable across controllers or reloads.

`waitForChange` resolves if the revision already advanced, or subscribes to the
next paint. `waitForStable` samples frames until the requested number are
unchanged with no renderer work pending. These synchronize commands; they do not
decide whether an application action succeeded. Stability does not cover future
React commits, network activity, DOM video, or browser carets. Continuous
animation can time out; background-tab throttling affects timing.

Waits default to 1000 ms and accept an `AbortSignal`. Timeouts reject with
`AutomationTimeoutError`; disposal with `AutomationDisposedError`; abort with
the signal's reason. Disposal removes subscriptions, cancels waits and gestures,
and releases capture buffers.
