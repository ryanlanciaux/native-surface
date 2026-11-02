// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { attachSurface } from '../src/browser';
import { BRIDGE_KEY, type BridgeRegistry, type SurfaceController, type SurfaceObservation } from '../src/protocol';

const registry = () => (window as unknown as Record<string, unknown>)[BRIDGE_KEY] as BridgeRegistry | undefined;
const cleanups: (() => void)[] = [];
afterEach(() => { cleanups.splice(0).forEach(cleanup => cleanup()); document.body.replaceChildren(); });
function fixture() {
  const canvas = document.createElement('canvas');
  document.body.appendChild(canvas);
  const observation: SurfaceObservation = { revision: 0, viewport: { width: 100, height: 100 },
    focusedNode: null, overlays: [], nodes: [{ id: 1, parentId: null, type: 'textinput',
      value: 'unclassified-value', visible: true, disabled: false, focused: false, rendering: 'canvas',
      bounds: { x: 0, y: 0, width: 100, height: 40 }, visibleBounds: { x: 0, y: 0, width: 100, height: 40 } }] };
  // A foreign controller implementing only the public structural contract.
  const controller: SurfaceController = { observe: async () => observation,
    scroll: () => {}, toClientPoint: p => p, fromClientPoint: p => p };
  return { canvas, observation, controller };
}

describe('reusable browser bridge', () => {
  it('installs nothing on import, rejects duplicate ids, and detaches cleanly', async () => {
    expect(registry()).toBeUndefined();
    const host = fixture();
    const detach = attachSurface(host); cleanups.push(detach);
    const bridge = registry()!.app!;
    const epoch = (await bridge.observe()).epoch;
    expect(() => attachSurface(host)).toThrow('already attached');
    detach(); expect(registry()).toBeUndefined();
    await expect(bridge.observe()).rejects.toThrow('detached');
    cleanups.push(attachSurface(host));
    expect((await registry()!.app!.observe()).epoch).not.toBe(epoch);
  });
  it('accepts an older controller with an explicit DOM input provider and masks unknown values', async () => {
    const host = fixture();
    const input = document.createElement('input'); document.body.appendChild(input);
    input.value = 'reusable';
    cleanups.push(attachSurface({ ...host, getInputElement: () => input }));
    const bridge = registry()!.app!;
    const unknown = (await bridge.observe()).nodes[0]!;
    expect(unknown.secure).toBe(true); expect(unknown.value).toBeUndefined();
    host.observation.focusedNode = 1;
    host.observation.overlays = [{ id: 1, kind: 'input' }]; input.focus();
    expect(await bridge.focus()).toMatchObject({ id: 1, multiline: false });
    expect((await bridge.observe()).nodes[0]!.value).toBe('reusable');
    input.type = 'password';
    expect((await bridge.observe()).nodes[0]!.value).toBeUndefined();
    input.readOnly = true; expect(await bridge.focus()).toBeNull();
  });
  it('refuses keyboard focus when the controller does not own the input', async () => {
    const host = fixture(); const input = document.createElement('input');
    document.body.appendChild(input); input.focus();
    cleanups.push(attachSurface({ ...host, getInputElement: () => input }));
    expect(await registry()!.app!.focus()).toBeNull();
  });
});
