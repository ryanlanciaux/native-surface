import type { SemanticNode, ViewportSize } from 'e2e/engine';
import type { BridgeObservation, Rect, SurfaceNode } from './protocol.js';

export function clientRect(rect: Rect, observation: BridgeObservation): Rect {
  const { host, viewport } = observation;
  return { x: host.x + rect.x * host.width / viewport.width,
    y: host.y + rect.y * host.height / viewport.height,
    width: rect.width * host.width / viewport.width, height: rect.height * host.height / viewport.height };
}

export function semanticTree(observation: BridgeObservation, surfaceId: string, viewport: ViewportSize,
  maxNodes: number, bounded = false): { root: SemanticNode; truncated: boolean } {
  const children = new Map<number, SemanticNode[]>();
  const roots: SemanticNode[] = [];
  const mapped = new Map<number, SemanticNode>();
  const included = observation.nodes.slice(0, maxNodes);
  for (const node of included) {
    const input = node.type === 'textinput';
    const rect = clientRect(node.visibleBounds ?? node.bounds, observation);
    const hidden = !node.visible || rect.width <= 0 || rect.height <= 0 || rect.x >= viewport.width ||
      rect.y >= viewport.height || rect.x + rect.width <= 0 || rect.y + rect.height <= 0;
    const role = node.role === 'image' ? 'img' : node.role === 'header' ? 'heading' : node.role ??
      (input ? 'textbox' : node.type === 'pressable' ? 'button' : node.type === 'image' ? 'img' : undefined);
    const value = node.secure ? undefined : node.value;
    const semantic: SemanticNode = {
      ref: { id: `${observation.epoch}:${node.id}`, revision: '' }, role,
      name: bounded ? node.label?.slice(0, 256) : node.label, text: node.secure ? undefined : bounded ? node.text?.slice(0, 512) : node.text,
      value, testId: node.testID, inputPurpose: node.inputPurpose,
      states: { hidden, disabled: node.disabled, focused: node.focused, secure: !!node.secure,
        checked: node.checked, selected: node.selected, expanded: node.expanded },
      attributes: { ...(node.placeholder === undefined ? {} : { placeholder: node.placeholder }),
        ...(node.editable === undefined ? {} : { editable: String(node.editable) }) },
      rect, children: [],
    };
    mapped.set(node.id, semantic);
    children.set(node.id, semantic.children as SemanticNode[]);
  }
  for (const node of included) {
    const parent = node.parentId === null ? undefined : children.get(node.parentId);
    (parent ?? roots).push(mapped.get(node.id)!);
  }
  const nameButtons = (node: SemanticNode): string => {
    const text = [node.text, ...(node.children ?? []).map(nameButtons)].filter(Boolean).join('');
    if (!node.name && node.role === 'button') (node as { name?: string }).name = bounded ? text.slice(0, 256) : text;
    return text;
  };
  roots.forEach(nameButtons);
  return { root: { ref: { id: `surface:${surfaceId}`, revision: '' }, role: 'window',
    rect: observation.host, children: roots },
    // DOM portals have no complete semantic tree in the canvas snapshot.
    truncated: included.length < observation.nodes.length || observation.overlays.some(o => o.kind === 'portal') };
}

export function nodeForRef(observation: BridgeObservation, id: string): SurfaceNode | undefined {
  return observation.nodes.find(node => `${observation.epoch}:${node.id}` === id);
}
