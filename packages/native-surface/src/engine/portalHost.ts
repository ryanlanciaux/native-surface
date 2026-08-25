/**
 * Generic DOM-portal seam — the TextInput overlay pattern generalized. A node
 * carrying `props.__portal` gets a real DOM element (iframe, video, div, …)
 * positioned over the canvas at the node's absolute frame, tracked through
 * flushes/scrolls exactly when the input overlay is, and removed when the node
 * unmounts or drops the prop. Compat shims (webview, video) build on this to
 * host content the canvas cannot paint.
 *
 * Stacking is the documented ceiling of the seam: portal elements composite
 * ABOVE all canvas content (they are real DOM over the <canvas>), so canvas
 * pixels can never paint over a portal. Multiple portals stack among
 * themselves in tree order. The focused-TextInput overlay stays above portals.
 *
 * Like textInputOverlay, this module is Node-import-safe: no top-level DOM
 * access, and every entry point no-ops when `document` is undefined.
 */
import type { CNode } from './node';

/** Declarative portal request, carried on a host node as `props.__portal`. */
export interface PortalSpec {
  /** Element to create: 'iframe' | 'video' | 'div' | any tag name. */
  tag: string;
  /** Attributes applied (and diffed) onto the element. `true` → present, `false` → removed. */
  attrs?: Record<string, string | number | boolean>;
  /** Extra CSS applied over the host's base positioning style. */
  style?: Record<string, string>;
  /** Identity: a key change tears the element down and recreates it. */
  key?: string;
}

/** Imperative escape hatch: `props.__portalRef` receives the live element. */
export type PortalRef = (el: HTMLElement | null) => void;

interface PortalHost {
  canvas: HTMLCanvasElement | null;
  cssWidth: number;
  cssHeight: number;
}

/** Same host the input overlay positions against (RootHooks.getInputHost). */
function hostOf(node: CNode): PortalHost | null {
  const hooks = node.rootHooks as { getInputHost?: () => PortalHost } | null;
  const host = hooks?.getInputHost?.();
  return host && host.canvas ? host : null;
}

function specOf(node: CNode): PortalSpec | null {
  const spec = node.props.__portal as PortalSpec | undefined;
  return spec && typeof spec.tag === 'string' ? spec : null;
}

/** Portals sit above the canvas but below the focused-TextInput overlay (9999). */
const PORTAL_Z_BASE = 9000;

interface PortalInstance {
  el: HTMLElement;
  /** Root this portal belongs to — the sweep must never cross roots. */
  root: CNode;
  tag: string;
  key: string | undefined;
  /** Last-applied attrs, for diffing (re-setting iframe `src` would reload it). */
  attrs: Record<string, string>;
  /** Keys of the last-applied spec.style, so dropped keys get cleared. */
  styleKeys: string[];
  detach(): void;
}

const instances = new Map<CNode, PortalInstance>();

/**
 * True when the node would paint: no ancestor (or self) is hidden or
 * display:none, and the frame has area. Scroll-ancestor clipping is NOT
 * modeled — a portal scrolled out of its ScrollView tracks the (off-screen)
 * frame rather than being CSS-clipped. Documented seam limitation.
 */
function nodeVisible(node: CNode): boolean {
  if (node.frame.width <= 0 || node.frame.height <= 0) return false;
  for (let n: CNode | null = node; n; n = n.parent) {
    if (n.hidden || n.flatStyle.display === 'none') return false;
  }
  return true;
}

/**
 * Fixed-position geometry of a node over its (possibly CSS-stretched) canvas —
 * the same math textInputOverlay.reposition uses. Returns null while the
 * canvas has no on-screen box.
 */
export function portalGeometry(
  node: CNode,
  host: PortalHost
): { left: number; top: number; width: number; height: number; sx: number; sy: number } | null {
  if (!host.canvas) return null;
  const rect = host.canvas.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return null;
  const sx = rect.width / host.cssWidth;
  const sy = rect.height / host.cssHeight;
  const abs = node.absoluteRect();
  return {
    left: rect.left + abs.x * sx,
    top: rect.top + abs.y * sy,
    width: abs.w * sx,
    height: abs.h * sy,
    sx,
    sy,
  };
}

function reposition(node: CNode, inst: PortalInstance): void {
  const host = hostOf(node);
  const geo = host ? portalGeometry(node, host) : null;
  const s = inst.el.style;
  if (!geo || !nodeVisible(node)) {
    s.visibility = 'hidden';
    return;
  }
  s.visibility = '';
  s.left = `${geo.left}px`;
  s.top = `${geo.top}px`;
  s.width = `${geo.width}px`;
  s.height = `${geo.height}px`;
  const r = node.paint.radii;
  s.borderRadius =
    r.tl || r.tr || r.br || r.bl
      ? `${r.tl * geo.sx}px ${r.tr * geo.sx}px ${r.br * geo.sx}px ${r.bl * geo.sx}px`
      : '';
}

function applyAttrs(inst: PortalInstance, next: PortalSpec['attrs']): void {
  const applied: Record<string, string> = {};
  for (const [name, value] of Object.entries(next ?? {})) {
    if (value === false) continue;
    applied[name] = value === true ? '' : String(value);
  }
  for (const name of Object.keys(inst.attrs)) {
    if (!(name in applied)) inst.el.removeAttribute(name);
  }
  for (const [name, value] of Object.entries(applied)) {
    // only on change: re-setting an identical iframe `src` reloads the frame
    if (inst.attrs[name] !== value) inst.el.setAttribute(name, value);
  }
  inst.attrs = applied;
}

function applySpecStyle(inst: PortalInstance, next: PortalSpec['style']): void {
  const s = inst.el.style;
  const keys = Object.keys(next ?? {});
  for (const key of inst.styleKeys) {
    if (!keys.includes(key)) s.setProperty(key, '');
  }
  for (const [key, value] of Object.entries(next ?? {})) {
    if (s.getPropertyValue(key) !== value) s.setProperty(key, value);
  }
  inst.styleKeys = keys;
}

function createInstance(node: CNode, spec: PortalSpec, root: CNode): PortalInstance {
  const el = document.createElement(spec.tag);
  const s = el.style;
  s.position = 'fixed';
  s.margin = '0';
  s.padding = '0';
  s.border = 'none';
  s.boxSizing = 'border-box';
  s.overflow = 'hidden';
  s.zIndex = String(PORTAL_Z_BASE);
  s.visibility = 'hidden'; // shown by the first reposition

  const inst: PortalInstance = {
    el,
    root,
    tag: spec.tag,
    key: spec.key,
    attrs: {},
    styleKeys: [],
    detach: () => {},
  };
  applyAttrs(inst, spec.attrs);
  applySpecStyle(inst, spec.style);

  // page scroll/zoom moves the canvas between engine flushes (same listeners
  // the input overlay keeps)
  const onPage = () => reposition(node, inst);
  window.addEventListener('scroll', onPage, true);
  window.addEventListener('resize', onPage);
  inst.detach = () => {
    window.removeEventListener('scroll', onPage, true);
    window.removeEventListener('resize', onPage);
  };

  document.body.appendChild(el);
  instances.set(node, inst);
  (node.props.__portalRef as PortalRef | undefined)?.(el);
  return inst;
}

function destroyInstance(node: CNode, inst: PortalInstance): void {
  (node.props.__portalRef as PortalRef | undefined)?.(null);
  inst.detach();
  inst.el.remove();
  instances.delete(node);
}

/** Tree-order list of this root's nodes that currently request a portal. */
function collectPortalNodes(node: CNode, out: CNode[]): void {
  if (specOf(node)) out.push(node);
  for (const c of node.children) collectPortalNodes(c, out);
}

/**
 * Called by the renderer after every flush (alongside syncFocusedOverlay):
 * creates elements for newly-portaled nodes, diffs attrs/style, tracks
 * geometry, stacks in tree order, and sweeps instances whose node left this
 * root's tree or dropped the prop.
 */
export function syncPortalOverlays(rootNode: CNode): void {
  if (typeof document === 'undefined') return;
  const live: CNode[] = [];
  collectPortalNodes(rootNode, live);

  live.forEach((node, index) => {
    const spec = specOf(node)!;
    let inst = instances.get(node);
    if (inst && (inst.tag !== spec.tag || inst.key !== spec.key)) {
      destroyInstance(node, inst);
      inst = undefined;
    }
    if (!inst) {
      if (!hostOf(node)) return; // headless root (Node/tests without a canvas)
      inst = createInstance(node, spec, rootNode);
    } else {
      applyAttrs(inst, spec.attrs);
      applySpecStyle(inst, spec.style);
    }
    inst.el.style.zIndex = String(PORTAL_Z_BASE + index);
    reposition(node, inst);
  });

  for (const [node, inst] of instances) {
    if (inst.root === rootNode && !live.includes(node)) destroyInstance(node, inst);
  }
}

/** Root teardown (renderer.unmount): remove every portal this root owns. */
export function destroyPortalOverlays(rootNode: CNode): void {
  for (const [node, inst] of instances) {
    if (inst.root === rootNode) destroyInstance(node, inst);
  }
}
