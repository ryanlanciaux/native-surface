import { describe, expect, it } from 'vitest';
import * as React from 'react';
import { View } from '../src/components/primitives';
import { Animated, AnimatedValue, Easing } from '../src/api/Animated';
import { asImpl, createTestRoot, sleep } from './helpers';

describe('Animated', () => {
  it('value listeners fire on setValue and stopAnimation reports the current value', () => {
    const v = new AnimatedValue(0);
    const seen: number[] = [];
    const id = v.addListener(({ value }) => seen.push(value));
    v.setValue(5);
    v.setValue(9);
    v.removeListener(id);
    v.setValue(11);
    expect(seen).toEqual([5, 9]);
    let stopAt = -1;
    v.stopAnimation((value) => (stopAt = value));
    expect(stopAt).toBe(11);
  });

  it('timing reaches the target through intermediate values', async () => {
    const v = new AnimatedValue(0);
    const seen: number[] = [];
    v.addListener(({ value }) => seen.push(value));
    await new Promise<void>((resolve) =>
      Animated.timing(v, { toValue: 100, duration: 120, easing: Easing.linear, useNativeDriver: false }).start(
        ({ finished }) => {
          expect(finished).toBe(true);
          resolve();
        }
      )
    );
    expect(v.__getValue()).toBe(100);
    const intermediates = seen.filter((x) => x > 5 && x < 95);
    expect(intermediates.length).toBeGreaterThanOrEqual(3);
    // monotonic under linear easing
    for (let i = 1; i < seen.length; i++) expect(seen[i]!).toBeGreaterThanOrEqual(seen[i - 1]!);
  });

  it('spring matches RN device behavior at the stack navigator spec (regression guard)', async () => {
    // Exactly @react-navigation/stack's TransitionIOSSpec, over a full-screen
    // pixel distance — the config whose true-overdamped physics made the first
    // integrator crawl for seconds. RN clamps zeta>=1 to the critically-damped
    // closed form (SpringAnimation.js), ~97% complete at 200ms.
    const v = new AnimatedValue(390);
    const seen: number[] = [];
    const t0 = Date.now();
    v.addListener(({ value }) => seen.push(value));
    await new Promise<void>((resolve) =>
      Animated.spring(v, {
        toValue: 0,
        stiffness: 1000,
        damping: 500,
        mass: 3,
        overshootClamping: true,
        restDisplacementThreshold: 10,
        restSpeedThreshold: 10,
        useNativeDriver: false,
      }).start(({ finished }) => {
        expect(finished).toBe(true);
        resolve();
      })
    );
    const elapsed = Date.now() - t0;
    expect(v.__getValue()).toBe(0);
    // Device-like pace: settles fast, but with a real multi-frame glide.
    expect(elapsed).toBeLessThan(700);
    expect(seen.length).toBeGreaterThanOrEqual(10);
    // Smooth monotonic progression, no overshoot, no teleport.
    for (let i = 1; i < seen.length; i++) expect(seen[i]!).toBeLessThanOrEqual(seen[i - 1]! + 1e-6);
    for (const x of seen) {
      expect(x).toBeLessThanOrEqual(390 + 1e-6);
      expect(x).toBeGreaterThanOrEqual(-1e-6);
    }
    // Mid-flight must include genuinely intermediate positions.
    expect(seen.some((x) => x > 100 && x < 350)).toBe(true);
  });

  it('matches @react-navigation/stack forHorizontalIOS geometry numerically', async () => {
    // The REAL interpolator from the installed stack package (pure function),
    // evaluated against OUR Animated.Value/interpolate implementation.
    // Routed through vitest's resolver (see vitest.config.ts alias) so the
    // interpolator's own 'react-native' import hits the engine, not RN.
    const { forHorizontalIOS } = (await import(
      // @ts-expect-error test-only alias, untyped
      '@rn-stack/CardStyleInterpolators'
    )) as { forHorizontalIOS: (spec: Record<string, unknown>) => unknown };
    const width = 390;
    const layouts = { screen: { width, height: 720 } };
    const insets = { top: 0, left: 0, right: 0, bottom: 0 };
    const mk = (n: number) => new AnimatedValue(n);
    const evalNode = (node: unknown): number =>
      Number((node as { __getValue(): number | string }).__getValue());

    for (const p of [0, 0.25, 0.5, 1]) {
      const current = { progress: mk(p) };
      const res = forHorizontalIOS({ current, next: undefined, index: 0, closing: mk(0), swiping: mk(0), inverted: mk(1), layouts, insets }) as {
        cardStyle: { transform: Array<Record<string, unknown>> };
        shadowStyle?: Record<string, unknown>;
        overlayStyle?: Record<string, unknown>;
      };
      // The interpolator stacks focused + unfocused translateX entries; the
      // rendered offset is their sum.
      const translateX = res.cardStyle.transform
        .map((t) => t.translateX)
        .filter((x) => x !== undefined)
        .reduce((sum: number, node) => sum + (typeof node === 'number' ? node : evalNode(node)), 0);
      // Incoming card: full width -> 0, linear in progress (inverted=1).
      expect(translateX).toBeCloseTo((1 - p) * width, 3);
      // The interpolator emits a shadow/overlay treatment our engine renders.
      expect(res.shadowStyle ?? res.overlayStyle).toBeTruthy();
    }

    // Outgoing card parallax: progress of the NEXT screen drives this card to -30%.
    for (const p of [0, 0.5, 1]) {
      const res = forHorizontalIOS({ current: { progress: mk(1) }, next: { progress: mk(p) }, index: 0, closing: mk(0), swiping: mk(0), inverted: mk(1), layouts, insets }) as {
        cardStyle: { transform: Array<Record<string, unknown>> };
      };
      const translateX = res.cardStyle.transform
        .map((t) => t.translateX)
        .filter((x) => x !== undefined)
        .reduce((sum: number, node) => sum + (typeof node === 'number' ? node : evalNode(node)), 0);
      expect(translateX).toBeCloseTo(p * width * -0.3, 3);
    }
  });

  it('interpolate: ranges, clamp, multi-segment, string units', () => {
    const v = new AnimatedValue(0);
    const basic = v.interpolate({ inputRange: [0, 1], outputRange: [0, 100] });
    v.setValue(0.25);
    expect(basic.__getValue()).toBeCloseTo(25);
    v.setValue(2);
    expect(basic.__getValue()).toBeCloseTo(200); // extend by default
    const clamped = v.interpolate({ inputRange: [0, 1], outputRange: [0, 100], extrapolate: 'clamp' });
    expect(clamped.__getValue()).toBeCloseTo(100);
    const multi = v.interpolate({ inputRange: [0, 1, 2, 3], outputRange: [0, 10, 110, 1110] });
    v.setValue(2.5);
    expect(multi.__getValue()).toBeCloseTo(610);
    const deg = v.interpolate({ inputRange: [0, 5], outputRange: ['0deg', '90deg'] });
    expect(deg.__getValue()).toBe('45deg');
  });

  it('composition nodes: add and multiply track their inputs', () => {
    const a = new AnimatedValue(3);
    const b = new AnimatedValue(4);
    const sum = Animated.add(a, b);
    const product = Animated.multiply(a, b);
    expect(sum.__getValue()).toBe(7);
    expect(product.__getValue()).toBe(12);
    let notified = 0;
    product.__subscribe(() => notified++);
    a.setValue(5);
    expect(product.__getValue()).toBe(20);
    expect(notified).toBe(1);
  });

  it('Animated.event maps nativeEvent paths into values and calls the listener', () => {
    const x = new AnimatedValue(0);
    let heard: unknown = null;
    const handler = Animated.event([{ nativeEvent: { contentOffset: { x } } }], {
      useNativeDriver: false,
      listener: (e: unknown) => (heard = e),
    });
    handler({ nativeEvent: { contentOffset: { x: 42 } } });
    expect(x.__getValue()).toBe(42);
    expect(heard).not.toBeNull();
  });

  it('an animated transform visibly moves a painted node across flushes', async () => {
    const root = createTestRoot(200, 100);
    const impl = asImpl(root);
    const tx = new AnimatedValue(0);
    root.render(
      <View style={{ flex: 1, backgroundColor: '#ffffff' }}>
        <Animated.View
          style={{
            position: 'absolute',
            left: 0,
            top: 40,
            width: 20,
            height: 20,
            backgroundColor: '#ff0000',
            transform: [{ translateX: tx }],
          }}
        />
      </View>
    );
    await root.flush();
    expect(impl.readPixel(10, 50).r).toBeGreaterThan(200); // red at origin
    expect(impl.readPixel(170, 50).r).toBeGreaterThan(200); // white background is also r-high…
    expect(impl.readPixel(170, 50).g).toBeGreaterThan(200); // …so distinguish via g

    await new Promise<void>((resolve) =>
      Animated.timing(tx, { toValue: 160, duration: 80, easing: Easing.linear, useNativeDriver: true }).start(() =>
        resolve()
      )
    );
    await sleep(30);
    await root.flush();
    const moved = impl.readPixel(170, 50);
    expect(moved.r).toBeGreaterThan(200);
    expect(moved.g).toBeLessThan(80); // red box now here
    const origin = impl.readPixel(10, 50);
    expect(origin.g).toBeGreaterThan(200); // origin back to white
    root.unmount();
  });

  it('setValue stops an in-flight animation', async () => {
    const v = new AnimatedValue(0);
    let finished: boolean | null = null;
    Animated.timing(v, { toValue: 100, duration: 500, useNativeDriver: false }).start((r) => (finished = r.finished));
    await sleep(40);
    v.setValue(7);
    await sleep(40);
    expect(finished).toBe(false);
    expect(v.__getValue()).toBe(7);
  });
});

describe('Animated — documented API completeness (compat-strategy)', () => {
  it('ValueXY: setValue, getLayout, getTranslateTransform, listeners', () => {
    const xy = new (Animated.ValueXY as new (v?: { x: number; y: number }) => InstanceType<typeof Animated.ValueXY>)({ x: 1, y: 2 });
    const seen: Array<{ x: number; y: number }> = [];
    const id = xy.addListener((v) => seen.push(v));
    xy.setValue({ x: 10, y: 20 });
    expect(xy.__getValue()).toEqual({ x: 10, y: 20 });
    expect(seen.length).toBeGreaterThan(0);
    xy.removeListener(id);
    const layout = xy.getLayout();
    expect(layout.left.__getValue()).toBe(10);
    expect(layout.top.__getValue()).toBe(20);
    const t = xy.getTranslateTransform();
    expect(t[0]!.translateX!.__getValue()).toBe(10);
    expect(t[1]!.translateY!.__getValue()).toBe(20);
  });

  it('subtract / divide / modulo / diffClamp', () => {
    const a = new AnimatedValue(10);
    const b = new AnimatedValue(4);
    expect(Animated.subtract(a, b).__getValue()).toBe(6);
    expect(Animated.divide(a, b).__getValue()).toBe(2.5);
    expect(Animated.modulo(a, 3).__getValue()).toBe(1);
    const clamped = Animated.diffClamp(a, 0, 5);
    expect(clamped.__getValue()).toBe(5);
    a.setValue(8); // diff -2 -> 3
    expect(clamped.__getValue()).toBe(3);
    a.setValue(20); // diff +12 -> clamp 5
    expect(clamped.__getValue()).toBe(5);
  });

  it('decay: RN closed form slides and stops', async () => {
    const v = new AnimatedValue(0);
    await new Promise<void>((resolve) =>
      Animated.decay(v, { velocity: 2, deceleration: 0.99, useNativeDriver: false }).start(({ finished }) => {
        expect(finished).toBe(true);
        resolve();
      })
    );
    // v0/(1-d) asymptote = 2/0.01 = 200; must land near it, past halfway.
    expect(v.__getValue()).toBeGreaterThan(150);
    expect(v.__getValue()).toBeLessThanOrEqual(200);
  });

  it('interpolate: documented color outputs', () => {
    const v = new AnimatedValue(0.5);
    const c = v.interpolate({ inputRange: [0, 1], outputRange: ['#000000', '#ffffff'] });
    expect(c.__getValue()).toBe('rgba(128, 128, 128, 1.0000)');
    const named = v.interpolate({ inputRange: [0, 1], outputRange: ['red', 'blue'] });
    expect(String(named.__getValue()).startsWith('rgba(128, 0, 128')).toBe(true);
  });

  it('Easing.step0/step1', () => {
    expect(Easing.step0(0)).toBe(0);
    expect(Easing.step0(0.01)).toBe(1);
    expect(Easing.step1(0.99)).toBe(0);
    expect(Easing.step1(1)).toBe(1);
  });
});
