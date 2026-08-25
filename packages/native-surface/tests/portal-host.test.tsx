// @vitest-environment jsdom
/**
 * DOM-portal seam (engine/portalHost) + the react-native-webview shim built on
 * it. Runs under jsdom so real elements are created; the env seam is mocked to
 * the Node loaders (jsdom has a window, so the real module would pick the
 * browser wasm path and try to fetch). The canvas host is faked through the
 * same root-hooks seam the TextInput overlay uses: getInputHost returns a
 * jsdom canvas with a stubbed bounding rect.
 */
import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/env/index', async () => {
  const { createRequire } = await import('node:module');
  const fs = await import('node:fs');
  const path = await import('node:path');
  // import.meta.url is unreliable under the jsdom environment — anchor on the
  // package dir instead (vitest runs with the package as cwd; the workspace
  // root is the fallback).
  const pkgDir = [process.cwd(), path.join(process.cwd(), 'packages/native-surface')].find((d) =>
    fs.existsSync(path.join(d, 'assets/fonts'))
  )!;
  const req = createRequire(path.join(pkgDir, 'package.json'));
  return {
    isNode: true,
    loadCanvasKit: async () => {
      const CanvasKitInit = req('canvaskit-wasm/bin/canvaskit.js') as (opts: {
        wasmBinary: Uint8Array;
      }) => Promise<unknown>;
      const buf = fs.readFileSync(req.resolve('canvaskit-wasm/bin/canvaskit.js').replace(/canvaskit\.js$/, 'canvaskit.wasm'));
      return CanvasKitInit({ wasmBinary: new Uint8Array(buf) });
    },
    loadDefaultFonts: async () => {
      const entries: Array<[string, number]> = [
        ['Inter-Regular.otf', 400],
        ['Inter-Medium.otf', 500],
        ['Inter-SemiBold.otf', 600],
        ['Inter-Bold.otf', 700],
      ];
      return entries.map(([file, weight]) => {
        const buf = fs.readFileSync(path.join(pkgDir, 'assets/fonts', file));
        return { family: 'Inter', data: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), weight };
      });
    },
    scheduleFrame: (cb: () => void) => {
      const id = setTimeout(cb, 0);
      return () => clearTimeout(id);
    },
    now: () => Date.now(),
  };
});

import { Text, View } from '../src/components/primitives';
import WebView, { type WebViewHandle } from '../../compat/src/webview';
import type { NativeRoot } from '../src/types';
import { asImpl, createTestRoot, findNode } from './helpers';

/* eslint-disable @typescript-eslint/no-explicit-any */
const PortalView = View as unknown as React.FC<Record<string, unknown>>;

/** Point the root's overlay host at a jsdom canvas with a real screen box. */
function withDomHost(root: NativeRoot, width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.getBoundingClientRect = () =>
    ({ x: 0, y: 0, left: 0, top: 0, right: width, bottom: height, width, height, toJSON: () => ({}) }) as DOMRect;
  (asImpl(root) as any).getInputHost = () => ({ canvas, cssWidth: width, cssHeight: height });
  return canvas;
}

let root: NativeRoot | null = null;

afterEach(() => {
  root?.unmount();
  root = null;
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('engine portal host', () => {
  it('creates the element with attrs at the node frame, tracks re-layout, removes on portal unmount', async () => {
    root = createTestRoot(300, 200);
    withDomHost(root, 300, 200);
    const refCalls: Array<HTMLElement | null> = [];
    const app = (marginLeft: number, mounted: boolean) => (
      <View style={{ padding: 20 }}>
        {mounted ? (
          <PortalView
            style={{ width: 120, height: 80, marginLeft, marginTop: 5, borderRadius: 8 }}
            __portal={{ tag: 'div', attrs: { 'data-role': 'portal', 'tabindex': 3, 'hidden': false } }}
            __portalRef={(el: HTMLElement | null) => refCalls.push(el)}
          />
        ) : null}
      </View>
    );

    root.render(app(10, true));
    await root.flush();
    const el = document.querySelector<HTMLElement>('[data-role="portal"]')!;
    expect(el).toBeTruthy();
    expect(el.tagName).toBe('DIV');
    expect(el.getAttribute('tabindex')).toBe('3');
    expect(el.hasAttribute('hidden')).toBe(false);
    expect(refCalls).toEqual([el]);
    expect(el.style.position).toBe('fixed');
    expect(el.style.left).toBe('30px'); // padding 20 + margin 10
    expect(el.style.top).toBe('25px');
    expect(el.style.width).toBe('120px');
    expect(el.style.height).toBe('80px');
    expect(el.style.borderRadius).toContain('8px');
    expect(el.style.visibility).not.toBe('hidden');

    // re-layout moves the element without recreating it
    root.render(app(50, true));
    await root.flush();
    expect(document.querySelector('[data-role="portal"]')).toBe(el);
    expect(el.style.left).toBe('70px');

    // dropping the portaled node removes the element and refs null
    root.render(app(50, false));
    await root.flush();
    expect(document.querySelector('[data-role="portal"]')).toBeNull();
    expect(refCalls).toEqual([el, null]);
  });

  it('root unmount removes portal elements', async () => {
    root = createTestRoot(200, 100);
    withDomHost(root, 200, 100);
    root.render(
      <PortalView style={{ width: 50, height: 50 }} __portal={{ tag: 'div', attrs: { 'data-role': 'gone' } }} />
    );
    await root.flush();
    expect(document.querySelector('[data-role="gone"]')).toBeTruthy();
    root.unmount();
    root = null;
    expect(document.querySelector('[data-role="gone"]')).toBeNull();
  });

  it('portals stack in tree order and hide with display:none nodes', async () => {
    root = createTestRoot(300, 200);
    withDomHost(root, 300, 200);
    const app = (hideFirst: boolean) => (
      <View>
        <PortalView
          style={{ width: 40, height: 40, display: hideFirst ? 'none' : 'flex' }}
          __portal={{ tag: 'div', attrs: { 'data-role': 'a' } }}
        />
        <PortalView style={{ width: 40, height: 40 }} __portal={{ tag: 'div', attrs: { 'data-role': 'b' } }} />
      </View>
    );
    root.render(app(false));
    await root.flush();
    const a = document.querySelector<HTMLElement>('[data-role="a"]')!;
    const b = document.querySelector<HTMLElement>('[data-role="b"]')!;
    expect(Number(a.style.zIndex)).toBeLessThan(Number(b.style.zIndex));
    expect(a.style.visibility).not.toBe('hidden');

    root.render(app(true));
    await root.flush();
    expect(a.style.visibility).toBe('hidden');
    expect(b.style.visibility).not.toBe('hidden');
  });
});

describe('WebView compat shim', () => {
  it('renders an iframe with src, sandbox, and a fill frame', async () => {
    root = createTestRoot(320, 240);
    withDomHost(root, 320, 240);
    root.render(<WebView source={{ uri: 'https://example.com/' }} style={{ width: 320, height: 240 }} />);
    await root.flush();
    const frame = document.querySelector('iframe')!;
    expect(frame).toBeTruthy();
    expect(frame.getAttribute('src')).toBe('https://example.com/');
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts allow-same-origin allow-forms allow-popups');
    expect(frame.style.width).toBe('320px');
    expect(frame.style.height).toBe('240px');
  });

  it('source {html} renders through srcdoc; javaScriptEnabled=false drops allow-scripts', async () => {
    root = createTestRoot(200, 100);
    withDomHost(root, 200, 100);
    root.render(
      <WebView source={{ html: '<h1>hi</h1>' }} javaScriptEnabled={false} style={{ width: 200, height: 100 }} />
    );
    await root.flush();
    const frame = document.querySelector('iframe')!;
    expect(frame.getAttribute('srcdoc')).toBe('<h1>hi</h1>');
    expect(frame.hasAttribute('src')).toBe(false);
    expect(frame.getAttribute('sandbox')).toBe('allow-same-origin allow-forms allow-popups');
  });

  it('startInLoadingState renders the loading element until the frame load event', async () => {
    root = createTestRoot(300, 200);
    withDomHost(root, 300, 200);
    const loads: string[] = [];
    root.render(
      <WebView
        source={{ uri: 'https://example.com/' }}
        startInLoadingState
        renderLoading={() => <Text testID="wv-loading">Loading</Text>}
        onLoad={() => loads.push('load')}
        onLoadEnd={() => loads.push('end')}
        style={{ width: 300, height: 200 }}
      />
    );
    await root.flush();
    const frame = document.querySelector('iframe')!;
    expect(findNode(root.getLayoutTree(), (n) => n.testID === 'wv-loading')).not.toBeNull();
    expect(frame.style.opacity).toBe('0'); // canvas paints under the portal; frame goes transparent

    frame.dispatchEvent(new Event('load'));
    await root.flush();
    expect(findNode(root.getLayoutTree(), (n) => n.testID === 'wv-loading')).toBeNull();
    expect(frame.style.opacity).not.toBe('0');
    expect(loads).toEqual(['load', 'end']);
  });

  it('ref.reload() re-assigns src and fires onLoadStart again', async () => {
    root = createTestRoot(300, 200);
    withDomHost(root, 300, 200);
    const starts: string[] = [];
    const ref = React.createRef<WebViewHandle>();
    root.render(
      <WebView
        ref={ref}
        source={{ uri: 'https://example.com/app' }}
        onLoadStart={(e) => starts.push(e.nativeEvent.url)}
        style={{ width: 300, height: 200 }}
      />
    );
    await root.flush();
    expect(starts).toEqual(['https://example.com/app']);
    const setSrc = vi.spyOn(window.HTMLIFrameElement.prototype, 'src', 'set');
    ref.current!.reload();
    // jsdom never navigates the frame off about:blank → the same-origin path
    // falls back to re-assigning the attribute src (a reload in a browser)
    expect(setSrc).toHaveBeenCalledWith('https://example.com/app');
    expect(starts).toEqual(['https://example.com/app', 'https://example.com/app']);
  });

  it('onMessage receives window messages tagged with this frame key', async () => {
    root = createTestRoot(300, 200);
    withDomHost(root, 300, 200);
    const messages: unknown[] = [];
    root.render(
      <WebView
        source={{ uri: 'https://example.com/' }}
        onMessage={(e) => messages.push(e.nativeEvent.data)}
        style={{ width: 300, height: 200 }}
      />
    );
    await root.flush();
    const frame = document.querySelector('iframe')!;
    const key = frame.getAttribute('data-ns-webview')!;
    expect(key).toBeTruthy();
    window.dispatchEvent(new MessageEvent('message', { data: { __nsWebView: key, data: 'hello' } }));
    expect(messages).toEqual(['hello']);
    // a message tagged for a different instance is ignored
    window.dispatchEvent(new MessageEvent('message', { data: { __nsWebView: 'nswv-other', data: 'nope' } }));
    expect(messages).toEqual(['hello']);
  });
});
