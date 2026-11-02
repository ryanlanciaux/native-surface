import { mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { chromium, firefox, webkit, type Browser, type BrowserContext, type LaunchOptions, type Page } from 'playwright';
import { PNG } from 'pngjs';
import packageInfo from '../package.json';
import { ConfigurationError, defineEngine, EngineError, parseKey, raceAbort, resolveExpression,
  type EngineHandle, type EngineSnapshot, type LocatorAction, type OperationContext,
  type PointerAction, type VideoSegment, type ViewportPoint } from 'e2e/engine';
import { BRIDGE_KEY, BRIDGE_VERSION, type BridgeObservation, type BridgeRegistry,
  type FocusInfo, type Rect, type SurfaceNode } from './protocol.js';
import { clientRect, nodeForRef, semanticTree } from './semantics.js';
export type { SurfaceController, SurfaceObservation, SurfaceNode } from './protocol.js';

export interface SurfaceEngineOptions {
  surfaceId?: string;
  /** A platform label usable by test filters; e.g. custom-renderer. */
  platform?: string;
  browser?: 'chromium' | 'firefox' | 'webkit';
  viewport?: { width: number; height: number };
  launch?: LaunchOptions;
  maxNodes?: number;
}
const failure = (code: ConstructorParameters<typeof EngineError>[0], message: string) =>
  new EngineError(code, message, { retryable: code === 'NODE_STALE' });

const videoFailure = (error: unknown) => new EngineError('ENGINE_FAILURE',
  `Surface video recording failed: ${(error instanceof Error ? error.message : String(error)).split('\n')[0]}`,
  { retryable: false, cause: error });

interface VideoRecording {
  segments: VideoSegment[];
  current?: { page: Page; file: string; startedAt: string; path: string; starting: Promise<void> };
  failure?: unknown;
}

async function budget<T>(context: { signal: AbortSignal; timeoutMs: number }, work: (signal: AbortSignal) => Promise<T>) {
  const signal = AbortSignal.any([context.signal, AbortSignal.timeout(Math.max(1, Math.ceil(context.timeoutMs)))]);
  try { return await raceAbort(() => work(signal), signal, 'surface'); }
  catch (error) {
    if (context.signal.aborted) throw failure('CANCELLED', 'Surface operation cancelled');
    if (signal.aborted) throw failure('OPERATION_TIMEOUT', 'Surface operation timed out');
    throw error;
  }
}

/** A browser-hosted engine for native-surface or any compatible surface bridge. */
export function surface(options: SurfaceEngineOptions = {}): EngineHandle {
  const id = options.surfaceId ?? 'app';
  const maxNodes = options.maxNodes ?? 10000;
  if (!id || !Number.isInteger(maxNodes) || maxNodes < 1) {
    throw new ConfigurationError('INVALID_CONFIG', 'surface needs a nonempty surfaceId and positive integer maxNodes');
  }
  let browser: Browser | undefined;
  let browserContext: BrowserContext | undefined;
  let page: Page | undefined;
  let artifactsDir = '';
  let generation = 0;
  const viewport = options.viewport ?? { width: 800, height: 800 };
  let recording: VideoRecording | undefined;
  let videoCounter = 0;
  let openedPage: Page | undefined;
  const requirePage = () => {
    if (!page || page.isClosed()) throw failure('INVALID_STATE', 'Surface app is not open');
    return page;
  };
  function startSegment(active: VideoRecording, target: Page) {
    const file = `segment-${String(++videoCounter).padStart(3, '0')}.webm`;
    const directory = join(artifactsDir, 'video'), path = join(directory, file);
    const startedAt = new Date().toISOString();
    const starting = (async () => {
      await mkdir(directory, { recursive: true });
      await target.screencast.start({ path, size: viewport });
    })();
    active.current = { page: target, file, startedAt, path, starting };
    return starting;
  }
  async function finishSegment(active: VideoRecording | undefined, signal?: AbortSignal) {
    const current = active?.current;
    if (!active || !current) return;
    active.current = undefined;
    const stop = async () => {
      await current.starting;
      await current.page.screencast.stop();
    };
    try {
      await (signal ? raceAbort(stop, signal, 'surface video') : stop());
      const size = await stat(current.path).then(info => info.size, () => 0);
      if (size > 0) active.segments.push({ path: `video/${current.file}`, startedAt: current.startedAt });
      else await rm(current.path, { force: true });
    } catch (error) { active.failure ??= error; }
  }
  async function cleanup(signal?: AbortSignal) {
    generation++;
    const previous = browserContext;
    const stopping = finishSegment(recording, signal);
    page = undefined; browserContext = undefined; openedPage = undefined;
    await stopping;
    await previous?.close();
  }
  function closeAttempt(context: { signal: AbortSignal; timeoutMs: number }) {
    const closing = cleanup(AbortSignal.any([context.signal, AbortSignal.timeout(Math.max(1, Math.ceil(context.timeoutMs)))]));
    recording = undefined;
    return closing;
  }
  async function newPage(signal?: AbortSignal) {
    if (signal?.aborted) throw failure('CANCELLED', 'Surface attempt cancelled');
    await cleanup(signal);
    if (!browser) throw failure('INVALID_STATE', 'Surface browser is not initialized');
    const token = generation;
    const created = await browser.newContext({ viewport });
    if (token !== generation || signal?.aborted) {
      await created.close(); throw failure('CANCELLED', 'Surface attempt ended during setup');
    }
    browserContext = created;
    const abort = () => { void created.close().catch(() => {}); };
    signal?.addEventListener('abort', abort, { once: true });
    try {
      const tab = await created.newPage();
      if (token !== generation || signal?.aborted) {
        await created.close(); throw failure('CANCELLED', 'Surface attempt ended during setup');
      }
      page = tab;
    } finally { signal?.removeEventListener('abort', abort); }
  }
  async function guard<T>(context: OperationContext, work: (page: Page, checkpoint: () => void) => Promise<T>): Promise<T> {
    if (context.signal.aborted) throw failure('CANCELLED', 'Surface operation cancelled');
    const current = requirePage(), token = generation;
    try {
      return await budget(context, async signal => {
        const checkpoint = () => {
          if (signal.aborted) throw failure(context.signal.aborted ? 'CANCELLED' : 'OPERATION_TIMEOUT', 'Surface operation ended');
          if (generation !== token || current.isClosed()) throw failure('INVALID_STATE', 'Surface attempt ended');
        };
        checkpoint();
        const result = await work(current, checkpoint);
        checkpoint(); return result;
      });
    } catch (error) {
      if (error instanceof EngineError) throw error;
      throw new EngineError('ENGINE_FAILURE', 'Surface browser operation failed', { retryable: false, cause: error });
    }
  }
  async function observeBridge(current: Page): Promise<BridgeObservation> {
    const result = await current.evaluate(async ({ key, id, version }) => {
      const registry = (window as unknown as Record<string, unknown>)[key] as BridgeRegistry | undefined;
      const bridge = registry?.[id];
      if (!bridge || bridge.version !== version) return null;
      return bridge.observe();
    }, { key: BRIDGE_KEY, id, version: BRIDGE_VERSION });
    if (!result) throw failure('INVALID_STATE', `Surface bridge ${id} is not attached or has an incompatible version`);
    if (result.viewport.width <= 0 || result.viewport.height <= 0 || result.host.width <= 0 || result.host.height <= 0) {
      throw failure('NOT_ACTIONABLE', 'Surface has no displayed viewport');
    }
    return result;
  }
  async function focus(current: Page): Promise<FocusInfo> {
    const result = await current.evaluate(async ({ key, id }) => {
      const bridge = ((window as unknown as Record<string, unknown>)[key] as BridgeRegistry | undefined)?.[id];
      return bridge?.focus() ?? null;
    }, { key: BRIDGE_KEY, id });
    if (!result) throw failure('NOT_ACTIONABLE', 'No editable input in this surface has browser focus');
    return result;
  }
  async function typeText(current: Page, text: string, replace: boolean, checkpoint: () => void) {
    const initial = await focus(current);
    checkpoint();
    // Refuse a string that could submit/blur halfway through typing.
    if (!initial.multiline && /[\r\n]/.test(text)) {
      throw failure('UNSUPPORTED_CAPABILITY', 'Single-line keyboard.type cannot contain newlines; use press(Enter) explicitly');
    }
    let dispatched = false;
    const checkFocus = async () => {
      checkpoint();
      let live: FocusInfo;
      try { live = await focus(current); }
      catch (error) {
        if (dispatched) throw new EngineError('ACTION_MAY_HAVE_COMMITTED', 'Input lost focus after keyboard input', { retryable: false, cause: error });
        throw error;
      }
      checkpoint();
      if (live.id !== initial.id || live.epoch !== initial.epoch) {
        throw failure(dispatched ? 'ACTION_MAY_HAVE_COMMITTED' : 'NOT_ACTIONABLE', 'The focused input changed during typing');
      }
    };
    if (replace) {
      dispatched = true;
      await current.keyboard.press('ControlOrMeta+A');
      await checkFocus();
      await current.keyboard.press('Delete');
    }
    // Check ownership between characters; app handlers may blur or move focus.
    for (const character of text.replace(/\r\n/g, '\n')) {
      await checkFocus();
      dispatched = true;
      await current.keyboard.type(character);
    }
    checkpoint();
  }
  async function press(current: Page, key: string, checkpoint: () => void) {
    if (!parseKey(key)) throw failure('UNSUPPORTED_CAPABILITY', 'Unsupported keyboard key');
    if (/(^|\+)Tab$/.test(key)) {
      throw failure('UNSUPPORTED_CAPABILITY', 'Surface canvas focus traversal with Tab is not implemented');
    }
    await focus(current); checkpoint();
    await current.keyboard.press(key);
  }
  async function scroll(current: Page, observation: BridgeObservation, point: ViewportPoint, direction: string, checkpoint: () => void) {
    const amount = Math.max(40, Math.min(observation.host.width, observation.host.height) * 0.6);
    const delta = { x: direction === 'left' ? -amount : direction === 'right' ? amount : 0,
      y: direction === 'up' ? -amount : direction === 'down' ? amount : 0 };
    const receives = await current.evaluate(({ key, id, point }) => {
      const bridge = ((window as unknown as Record<string, unknown>)[key] as BridgeRegistry)[id]!;
      return bridge.receives(point, undefined, 'wheel');
    }, { key: BRIDGE_KEY, id, point });
    if (!receives) throw failure('NOT_ACTIONABLE', 'Surface scroll point is covered by browser content');
    checkpoint();
    await current.mouse.move(point.x, point.y);
    checkpoint(); await current.mouse.wheel(delta.x, delta.y);
  }
  async function pointer(current: Page, observation: BridgeObservation, point: ViewportPoint, action: PointerAction, checkpoint: () => void) {
    const host = observation.host;
    if (point.x < host.x || point.y < host.y || point.x >= host.x + host.width || point.y >= host.y + host.height) {
      throw failure('NOT_ACTIONABLE', 'Pointer starts outside the target surface');
    }
    if (!await current.evaluate(({ key, id, point }) =>
      ((window as unknown as Record<string, unknown>)[key] as BridgeRegistry)[id]!.receives(point),
      { key: BRIDGE_KEY, id, point })) throw failure('NOT_ACTIONABLE', 'Surface point is covered by browser content');
    checkpoint();
    switch (action.kind) {
      case 'tap': return current.mouse.click(point.x, point.y);
      case 'swipe': return scroll(current, observation, point, action.direction, checkpoint);
      case 'dragTo': case 'swipeTo':
        await current.mouse.move(point.x, point.y);
        checkpoint();
        await current.mouse.down();
        try { checkpoint(); await current.mouse.move(action.target.x, action.target.y, { steps: 12 }); }
        finally { if (!current.isClosed()) await current.mouse.up(); }
        return;
      default: throw failure('UNSUPPORTED_CAPABILITY', `Surface does not support ${action.kind}`);
    }
  }
  async function nodePoint(current: Page, observation: BridgeObservation, node: SurfaceNode): Promise<ViewportPoint> {
    if (node.disabled || !node.visible || !node.visibleBounds) throw failure('NOT_ACTIONABLE', 'Surface node is hidden or disabled');
    const box = clientRect(node.visibleBounds, observation);
    const viewport = current.viewportSize()!;
    const x1 = Math.max(0, box.x), y1 = Math.max(0, box.y);
    const x2 = Math.min(viewport.width, box.x + box.width), y2 = Math.min(viewport.height, box.y + box.height);
    if (x2 <= x1 || y2 <= y1) throw failure('NOT_ACTIONABLE', 'Surface node is outside the browser viewport');
    const point = { x: (x1 + x2) / 2, y: (y1 + y2) / 2 };
    // Browser dispatch must not silently hit a host control covering the canvas.
    const hit = await current.evaluate(async ({ key, id, point, nodeId }) => {
      const bridge = ((window as unknown as Record<string, unknown>)[key] as BridgeRegistry)[id]!;
      return bridge.receives(point, nodeId);
    }, { key: BRIDGE_KEY, id, point, nodeId: node.id });
    if (!hit) throw failure('NOT_ACTIONABLE', 'Surface node is covered by browser content');
    return point;
  }
  async function perform(current: Page, refId: string, action: LocatorAction, checkpoint: () => void) {
    const observation = await observeBridge(current);
    if (refId === `surface:${id}` && action.kind === 'swipe') {
      const horizontal = action.direction === 'left' || action.direction === 'right';
      const regions = (observation.scrollRegions ?? []).filter(region => region.enabled && region.visibleBounds &&
        (region.axis === 'both' || region.axis === (horizontal ? 'horizontal' : 'vertical')))
        .map(region => clientRect(region.visibleBounds!, observation))
        .sort((a, b) => b.width * b.height - a.width * a.height);
      for (const box of [...regions, observation.host]) {
        for (const [x, y] of [[0.5, 0.5], [0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]]) {
          const point = { x: box.x + box.width * x!, y: box.y + box.height * y! };
          const receives = await current.evaluate(({ key, id, point }) =>
            ((window as unknown as Record<string, unknown>)[key] as BridgeRegistry)[id]!.receives(point, undefined, 'wheel'),
            { key: BRIDGE_KEY, id, point });
          checkpoint();
          if (receives) return scroll(current, observation, point, action.direction, checkpoint);
        }
      }
      throw failure('NOT_ACTIONABLE', 'Surface has no exposed canvas point for scrolling');
    }
    const node = nodeForRef(observation, refId);
    if (!node) throw failure('NODE_STALE', 'Surface node no longer exists');
    const point = await nodePoint(current, observation, node);
    checkpoint();
    if (['fill', 'clear', 'focus', 'press'].includes(action.kind) && (node.type !== 'textinput' || node.editable === false)) {
      throw failure('NOT_ACTIONABLE', 'Surface node is not an input or is not editable');
    }
    const ensureFocus = async () => {
      const existing = await focus(current).catch(error => {
        if (error instanceof EngineError && error.code === 'NOT_ACTIONABLE') return null;
        throw error;
      });
      checkpoint();
      if (existing?.id === node.id && existing.epoch === observation.epoch) return;
      await current.mouse.click(point.x, point.y);
      const focused = await focus(current);
      if (focused.id !== node.id || focused.epoch !== observation.epoch) {
        throw failure('ACTION_MAY_HAVE_COMMITTED', 'Focus moved to another input after tapping the requested node');
      }
      checkpoint();
    };
    switch (action.kind) {
      case 'tap': return pointer(current, observation, point, action, checkpoint);
      case 'focus':
        return ensureFocus();
      case 'fill': case 'clear': case 'press':
        await ensureFocus();
        if (action.kind === 'press') return press(current, action.key, checkpoint);
        return typeText(current, action.kind === 'fill' ? action.value : '', true, checkpoint);
      case 'swipe': return scroll(current, observation, point, action.direction, checkpoint);
      default: throw failure('UNSUPPORTED_CAPABILITY', `Surface does not support ${action.kind}`);
    }
  }

  async function capture(current: Page): Promise<{ observation: BridgeObservation; data: Buffer; maskedRegionCount: number }> {
    for (let attempt = 0; attempt < 3; attempt++) {
      // Capture every attached surface, so a second canvas cannot expose a secure field.
      const read = () => current.evaluate(async key => {
        const registry = (window as unknown as Record<string, unknown>)[key] as BridgeRegistry | undefined;
        return Promise.all(Object.entries(registry ?? {}).map(async ([id, bridge]) => ({ id, observation: await bridge.observe() })));
      }, BRIDGE_KEY);
      const before = await read();
      const target = before.find(entry => entry.id === id)?.observation;
      if (!target) throw failure('INVALID_STATE', `Surface bridge ${id} is not attached`);
      const passwordRects = await current.locator('input[type=password]').evaluateAll(elements => elements.map(element => {
        const r = element.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height };
      }));
      const screenshot = await current.screenshot({ scale: 'css', caret: 'hide' });
      const after = await read();
      const signature = (entries: typeof before) => JSON.stringify(entries.map(e =>
        [e.id, e.observation.epoch, e.observation.revision, e.observation.host, e.observation.viewport]));
      if (signature(before) !== signature(after)) continue;
      const masks = before.flatMap(entry => entry.observation.nodes.filter(node => node.secure)
        .map(node => clientRect(node.bounds, entry.observation)));
      const png = PNG.sync.read(screenshot);
      for (const rect of [...masks, ...passwordRects]) maskRect(png, rect);
      return { observation: target, data: PNG.sync.write(png), maskedRegionCount: masks.length };
    }
    throw failure('ENGINE_FAILURE', 'Surface kept changing during screenshot capture');
  }
  return defineEngine({
    name: 'native-surface', version: packageInfo.version, spiVersion: 1,
    platform: options.platform ?? 'native-surface',
    validateApp(app, info) {
      if (!app.url || app.bundleId || app.appPath) throw new ConfigurationError('INVALID_CONFIG',
        `target ${info.targetName} needs app.url for a browser-hosted surface`);
    },
    async init(info) {
      recording = undefined;
      await cleanup(); await browser?.close(); browser = undefined;
      const environment = Object.fromEntries(Object.entries(info.env).filter((entry): entry is [string, string] => entry[1] !== undefined));
      browser = await raceAbort(async () => {
        const launched = await ({ chromium, firefox, webkit }[options.browser ?? 'chromium']).launch({
          ...options.launch, headless: options.launch?.headless ?? !info.headed, env: { ...environment, ...options.launch?.env },
        });
        if (info.signal.aborted) { await launched.close(); throw failure('CANCELLED', 'Surface browser launch cancelled'); }
        return launched;
      }, info.signal, 'surface browser launch');
    },
    async startAttempt(context) {
      const stale = recording;
      recording = undefined;
      await finishSegment(stale, context.signal);
      artifactsDir = context.artifactsDir; videoCounter = 0;
      await newPage(context.signal);
    },
    async endAttempt(context) {
      const closing = closeAttempt(context); void closing.catch(() => {});
      await budget(context, () => closing);
    },
    async dispose(context) {
      const previous = browser; browser = undefined;
      const closing = (async () => { await closeAttempt(context); await previous?.close(); })();
      void closing.catch(() => {}); await budget(context, () => closing);
    },
    async observe(context, observeOptions): Promise<EngineSnapshot> {
      return guard(context, async current => {
        const shot = observeOptions?.pixels ? await capture(current) : undefined;
        const observation = shot?.observation ?? await observeBridge(current);
        const viewport = current.viewportSize()!;
        const tree = semanticTree(observation, id, viewport, maxNodes, true);
        if (shot) {
          const png = PNG.sync.read(shot.data);
          return { ...tree, location: current.url(), viewport,
            pixels: { data: shot.data, mediaType: 'image/png', width: png.width, height: png.height, scale: 1 },
            maskedRegionCount: shot.maskedRegionCount };
        }
        return { ...tree, location: current.url(), viewport };
      });
    },
    locate: (expression, context) => guard(context, async current => {
      const tree = semanticTree(await observeBridge(current), id, current.viewportSize()!, Infinity);
      return resolveExpression(expression, tree.root.children ?? []);
    }),
    actions: ['tap', 'focus', 'fill', 'clear', 'press', 'swipe'],
    perform: (ref, action, context) => guard(context, (current, checkpoint) => perform(current, ref.id, action, checkpoint)),
    pointerActions: ['tap', 'swipe', 'dragTo', 'swipeTo'],
    performAt: (point, action, context) => guard(context, async (current, checkpoint) => pointer(current, await observeBridge(current), point, action, checkpoint)),
    keyboard: {
      type: (text, keyboardOptions, context) => guard(context, (current, checkpoint) => typeText(current, text, keyboardOptions.replace, checkpoint)),
      press: (key, context) => guard(context, (current, checkpoint) => press(current, key, checkpoint)),
    },
    session: {
      open: (url, context) => guard(context, async current => {
        await current.goto(url, { waitUntil: 'domcontentloaded', timeout: context.timeoutMs });
        if (current.url() !== 'about:blank') {
          openedPage = current;
          if (recording && !recording.current) {
            const active = recording;
            await startSegment(active, current).catch(error => { active.failure ??= error; });
          }
        }
        await current.waitForFunction(({ key, id, version }) => {
          const bridge = ((window as unknown as Record<string, unknown>)[key] as BridgeRegistry | undefined)?.[id];
          return bridge?.version === version;
        }, { key: BRIDGE_KEY, id, version: BRIDGE_VERSION }, { timeout: context.timeoutMs });
      }),
      back: (context) => guard(context, async current => { await current.goBack({ timeout: context.timeoutMs }); }),
      restart: context => budget(context, async signal => {
        if (!browserContext) throw failure('INVALID_STATE', 'Surface attempt is not active');
        const previous = page, token = generation;
        const tab = await browserContext.newPage();
        if (signal.aborted || token !== generation) { await tab.close(); throw failure('CANCELLED', 'Surface restart ended'); }
        generation++; page = tab;
        await finishSegment(recording, signal);
        await previous?.close();
      }),
      reset: context => budget(context, signal => newPage(signal)),
    },
    artifacts: {
      screenshot: (label, context) => guard(context, async (current, checkpoint) => {
        if (!artifactsDir) throw failure('INVALID_STATE', 'Surface attempt has no artifact directory');
        const attemptDir = artifactsDir;
        const shot = await capture(current);
        checkpoint();
        const filename = `${(label ?? 'surface').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80)}-${randomUUID()}.png`;
        await mkdir(attemptDir, { recursive: true });
        checkpoint();
        const file = join(attemptDir, filename);
        await writeFile(file, shot.data); return filename;
      }),
      startVideo: context => budget(context, async () => {
        if (recording) throw failure('INVALID_STATE', 'Surface video is already recording');
        if (!artifactsDir) throw failure('INVALID_STATE', 'Surface attempt has no artifact directory');
        const active: VideoRecording = { segments: [] };
        recording = active;
        if (!page || page !== openedPage || page.isClosed()) return;
        try { await startSegment(active, page); }
        catch (error) {
          active.current = undefined;
          if (recording === active) recording = undefined;
          throw videoFailure(error);
        }
      }),
      stopVideo: context => budget(context, async signal => {
        const active = recording;
        recording = undefined;
        await finishSegment(active, signal);
        if (active?.failure !== undefined && active.segments.length === 0) throw videoFailure(active.failure);
        return active?.segments ?? [];
      }),
    },
  });
}

export const nativeSurface = surface;

function maskRect(png: PNG, rect: Rect) {
  const x1 = Math.max(0, Math.floor(rect.x)), y1 = Math.max(0, Math.floor(rect.y));
  const x2 = Math.min(png.width, Math.ceil(rect.x + rect.width)), y2 = Math.min(png.height, Math.ceil(rect.y + rect.height));
  for (let y = y1; y < y2; y++) for (let x = x1; x < x2; x++) {
    const offset = (y * png.width + x) * 4;
    png.data[offset] = 0; png.data[offset + 1] = 0; png.data[offset + 2] = 0; png.data[offset + 3] = 255;
  }
}
