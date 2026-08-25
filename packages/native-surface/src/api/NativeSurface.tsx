import * as React from 'react';
import { createElement, useEffect, useRef } from 'react';
import { createNativeRoot } from '../engine/renderer';
import type { NativeRoot, RootOptions } from '../types';

export interface NativeSurfaceProps {
  width: number;
  height: number;
  dpr?: number;
  theme?: 'ios' | 'android';
  className?: string;
  style?: React.CSSProperties;
  onAction?: RootOptions['onAction'];
  /** Fires ONCE, after the engine has loaded and the first children render
   *  has been committed and painted — the earliest moment a capture of the
   *  canvas shows real UI rather than a blank surface. */
  onReady?: () => void;
  children: React.ReactElement;
}

/**
 * Embeds a React Native component tree into any React DOM app, rendered on a
 * `<canvas>` through Yoga (WASM) + Skia (CanvasKit). The children are a
 * SEPARATE React tree owned by canvas-native's own reconciler.
 */
export function NativeSurface(props: NativeSurfaceProps): React.JSX.Element {
  const { width, height, dpr, theme, className, style, onAction, onReady, children } = props;
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rootRef = useRef<NativeRoot | null>(null);
  const sizeRef = useRef({ width, height, dpr });
  const onReadyRef = useRef(onReady);
  const readyFiredRef = useRef(false);
  useEffect(() => {
    onReadyRef.current = onReady;
  }, [onReady]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const root = createNativeRoot(canvas, {
      width: sizeRef.current.width,
      height: sizeRef.current.height,
      dpr: sizeRef.current.dpr,
      theme,
      onAction,
    });
    rootRef.current = root;
    // QA/tooling hook: expose live roots for layout inspection (browser only).
    // __canvasNativeRoots is the deprecated pre-rename alias — same Set, so
    // existing drivers keep working; delete through either name covers both.
    const g = globalThis as unknown as {
      __nativeSurfaceRoots?: Set<NativeRoot>;
      __canvasNativeRoots?: Set<NativeRoot>;
    };
    const roots = (g.__nativeSurfaceRoots ??= g.__canvasNativeRoots ?? new Set());
    g.__canvasNativeRoots ??= roots;
    roots.add(root);
    return () => {
      rootRef.current = null;
      roots.delete(root);
      root.unmount();
    };
    // create exactly once per canvas; resize + rerender handled below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    sizeRef.current = { width, height, dpr };
    rootRef.current?.resize(width, height, dpr);
  }, [width, height, dpr]);

  // theme + onAction are live (no remount): the root repaints / swaps the
  // callback in place. Declared after the create effect so mount order works.
  useEffect(() => {
    rootRef.current?.setTheme(theme ?? 'ios');
  }, [theme]);
  useEffect(() => {
    rootRef.current?.setOnAction(onAction);
  }, [onAction]);

  // re-render the embedded tree on every commit; the inner reconciler diffs
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    root.render(children);
    if (!readyFiredRef.current) {
      readyFiredRef.current = true;
      void root.flush().then(() => {
        // Guard against the surface unmounting/remounting before ready.
        if (rootRef.current === root) onReadyRef.current?.();
      });
    }
  });

  return createElement('canvas', {
    ref: canvasRef,
    className,
    style: { display: 'block', width, height, ...style },
  });
}
