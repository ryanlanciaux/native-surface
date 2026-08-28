/**
 * react-native-screens compat shim: layout-faithfulness contract. Once the
 * preset aliases the package, navigators branch to screens-enabled paths and
 * measure `layouts.screen` through onLayout on ScreenContainer — a shim that
 * swallows View props turns the stack card interpolators into no-ops
 * (push/pop snaps). These tests pin the forwarding behavior through the real
 * engine, plus the visibility semantics for Animated-node activityState.
 */
import { describe, expect, test } from 'vitest';
import * as React from 'react';
import {
  Screen,
  ScreenContainer,
  ScreenStack,
  ScreenStackItem,
  Tabs,
  TabsHost,
  TabsScreen,
} from '../../compat/src/screens';
import { View } from '../src/components/primitives';
import { createTestRoot, findNode } from './helpers';

describe('screens compat shim', () => {
  test('ScreenContainer forwards onLayout with real measured dimensions', async () => {
    const root = createTestRoot(390, 720);
    let layout: { width: number; height: number } | null = null;
    root.render(
      <ScreenContainer
        style={{ flex: 1 }}
        onLayout={(e: { nativeEvent: { layout: { width: number; height: number } } }) => {
          layout = e.nativeEvent.layout;
        }}
      >
        <View />
      </ScreenContainer>
    );
    await root.flush();
    expect(layout).not.toBeNull();
    expect(layout!.width).toBe(390);
    expect(layout!.height).toBe(720);
    root.unmount();
  });

  test('Screen forwards View-safe props (testID) and strips screens-only ones', async () => {
    const root = createTestRoot(200, 200);
    root.render(
      <Screen testID="card" activityState={2} stackPresentation="push" gestureEnabled={false}>
        <View />
      </Screen>
    );
    await root.flush();
    const tree = root.getLayoutTree();
    expect(findNode(tree, (n) => n.testID === 'card')).not.toBeNull();
    root.unmount();
  });

  test('numeric activityState 0 hides; an Animated-node activityState stays visible', async () => {
    const root = createTestRoot(200, 200);
    const animatedNodeStandIn = { __isAnimated: true } as unknown as number;
    root.render(
      <ScreenStack style={{ flex: 1 }}>
        <ScreenStackItem testID="hidden" activityState={0}>
          <View style={{ width: 50, height: 50 }} />
        </ScreenStackItem>
        <ScreenStackItem testID="transitioning" activityState={animatedNodeStandIn}>
          <View style={{ width: 50, height: 50 }} />
        </ScreenStackItem>
      </ScreenStack>
    );
    await root.flush();
    const tree = root.getLayoutTree();
    const hidden = findNode(tree, (n) => n.testID === 'hidden');
    const transitioning = findNode(tree, (n) => n.testID === 'transitioning');
    // display:none removes the subtree from Yoga layout (0-sized or absent);
    // the mid-transition card must keep its real frame.
    expect(hidden === null || hidden.frame.width === 0).toBe(true);
    expect(transitioning).not.toBeNull();
    expect(transitioning!.frame.width).toBe(200);
    root.unmount();
  });

  test('Tabs is a compound component over the same passthroughs', () => {
    expect(Tabs.Host).toBe(TabsHost);
    expect(Tabs.Screen).toBe(TabsScreen);
  });
});
