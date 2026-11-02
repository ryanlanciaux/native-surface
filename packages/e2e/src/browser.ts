import { BRIDGE_KEY, BRIDGE_VERSION, type BridgeRegistry, type BrowserBridge,
  type SurfaceController, type SurfaceNode } from './protocol.js';
export type { SurfaceController, SurfaceObservation, SurfaceNode, BrowserBridge } from './protocol.js';

export interface AttachSurfaceOptions {
  /** Identifies this surface in the e2e target. */
  id?: string;
  controller: SurfaceController;
  canvas: HTMLCanvasElement;
  /** For forks whose controller does not yet expose inputElement(). */
  getInputElement?: () => HTMLInputElement | HTMLTextAreaElement | null;
}

/** Explicit, test-host-only attachment. Importing this module installs nothing. */
export function attachSurface({ id = 'app', controller, canvas, getInputElement }: AttachSurfaceOptions): () => void {
  const win = canvas.ownerDocument.defaultView;
  if (!win) throw new Error('Surface bridge requires a browser window');
  if (!id) throw new Error('Surface bridge id must be nonempty');
  const host = win as unknown as Record<string, unknown>;
  const registry = (host[BRIDGE_KEY] ??= Object.create(null)) as BridgeRegistry;
  if (registry[id]) throw new Error(`Surface bridge ${id} is already attached`);
  const epoch = typeof win.crypto.randomUUID === 'function' ? win.crypto.randomUUID()
    : Array.from(win.crypto.getRandomValues(new Uint32Array(4)), n => n.toString(16)).join('-');
  const element = () => getInputElement ? getInputElement() : controller.inputElement?.() ?? null;
  let disposed = false;
  const active = () => {
    if (disposed || !canvas.isConnected) throw new Error('Surface bridge was detached');
  };
  const bridge: BrowserBridge = {
    version: BRIDGE_VERSION,
    async observe() {
      active();
      for (let host: HTMLElement | null = canvas; host; host = host.parentElement) {
        const style = win.getComputedStyle(host);
        if (style.perspective && style.perspective !== 'none' || style.rotate && style.rotate !== 'none') {
          throw new Error('Surface bridge does not support host rotation or perspective');
        }
        if (style.transform && style.transform !== 'none') {
          const matrix = new DOMMatrixReadOnly(style.transform);
          if (!matrix.is2D || matrix.a <= 0 || matrix.d <= 0 || matrix.b !== 0 || matrix.c !== 0) {
            throw new Error('Surface bridge requires positive axis-aligned host transforms');
          }
        }
        if (style.scale && style.scale !== 'none' && style.scale.split(/\s+/).some(scale => parseFloat(scale) <= 0)) {
          throw new Error('Surface bridge requires positive host scale');
        }
      }
      const observation = await controller.observe({ snapshot: true });
      active();
      const r = canvas.getBoundingClientRect();
      const input = element();
      const nodes = (observation.nodes ?? []).map((node): SurfaceNode => {
        if (node.type !== 'textinput') return node;
        // Older forks may not report secure metadata. Treat unknown fields as
        // secure until the fork supplies it, so observations cannot leak values.
        const focusedInput = observation.focusedNode === node.id ? input : null;
        const secure = node.secure === true || focusedInput?.type === 'password' ||
          (node.secure === undefined && !focusedInput);
        return { ...node, secure,
          value: secure ? undefined : focusedInput?.value ?? node.value,
          text: secure ? undefined : node.text,
          placeholder: node.placeholder ?? focusedInput?.placeholder,
          editable: node.editable ?? !node.disabled,
        };
      });
      return { ...observation, epoch, nodes, host: { x: r.x, y: r.y, width: r.width, height: r.height } };
    },
    async focus() {
      active();
      const observation = await controller.observe({ snapshot: false });
      active();
      const input = element();
      const nodeId = observation.focusedNode;
      if (!input || canvas.ownerDocument.activeElement !== input || !input.isConnected ||
        input.disabled || input.readOnly || nodeId === null ||
        !observation.overlays.some(o => o.kind === 'input' && o.id === nodeId)) return null;
      return { id: nodeId, epoch, multiline: input.tagName === 'TEXTAREA' };
    },
    async receives(point, nodeId, kind = 'pointer') {
      active();
      const hit = canvas.ownerDocument.elementFromPoint(point.x, point.y);
      if (hit === canvas) return nodeId === undefined || !controller.hitTest ||
        controller.hitTest(controller.fromClientPoint(point)).includes(nodeId);
      if (kind === 'wheel') return false;
      const focused = await bridge.focus();
      return !!focused && (nodeId === undefined || focused.id === nodeId) && hit === element();
    },
    scroll(point, delta) {
      active();
      const logical = controller.fromClientPoint(point);
      const origin = controller.fromClientPoint({ x: point.x + delta.x, y: point.y + delta.y });
      controller.scroll({ ...logical, deltaX: origin.x - logical.x, deltaY: origin.y - logical.y });
    },
  };
  registry[id] = bridge;
  return () => {
    disposed = true;
    if (registry[id] === bridge) delete registry[id];
    if (Object.keys(registry).length === 0 && host[BRIDGE_KEY] === registry) delete host[BRIDGE_KEY];
  };
}
