/**
 * AppRegistry + requireNativeComponent: the two "entry point" APIs whose whole
 * job here is to keep a real app's index.js and its native-view imports from
 * blowing up, while being honest that <NativeSurface> is what actually mounts.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as React from 'react';
import { Text, View } from '../src/components/primitives';
import { AppRegistry } from '../src/api/AppRegistry';
import { requireNativeComponent } from '../src/api/extras';
import { createTestRoot, findNode } from './helpers';

afterEach(() => {
  AppRegistry.setWrapperComponentProvider(null);
  vi.restoreAllMocks();
});

describe('AppRegistry', () => {
  it('round-trips a registered component through getApplication', () => {
    function App(): React.JSX.Element {
      return <Text>app</Text>;
    }
    expect(AppRegistry.registerComponent('RoundTrip', () => App)).toBe('RoundTrip');
    expect(AppRegistry.getAppKeys()).toContain('RoundTrip');

    const { element, getStyleElement } = AppRegistry.getApplication('RoundTrip', {
      initialProps: { greeting: 'hi' },
    });
    expect(element.type).toBe(App);
    expect(element.props).toEqual({ greeting: 'hi' });
    expect(getStyleElement()).toBeNull();
  });

  it('renders a registered app through the real engine', async () => {
    const root = createTestRoot(120, 60);
    function App(props: { name?: string }): React.JSX.Element {
      return <Text>{`hello ${props.name ?? ''}`}</Text>;
    }
    AppRegistry.registerComponent('Rendered', () => App);
    const { element } = AppRegistry.getApplication('Rendered', { initialProps: { name: 'surface' } });

    root.render(<View style={{ flex: 1, backgroundColor: '#ffffff' }}>{element}</View>);
    await root.flush();
    expect(findNode(root.getLayoutTree(), (n) => n.type === 'Text')?.text).toBe('hello surface');
    root.unmount();
  });

  it('applies the wrapper component provider', () => {
    function App(): React.JSX.Element {
      return <Text>app</Text>;
    }
    function Wrapper(props: { children?: React.ReactNode }): React.JSX.Element {
      return <View>{props.children}</View>;
    }
    AppRegistry.registerComponent('Wrapped', () => App);
    AppRegistry.setWrapperComponentProvider(() => Wrapper);

    const { element } = AppRegistry.getApplication('Wrapped');
    expect(element.type).toBe(Wrapper);
    expect((element.props as { children: React.ReactElement }).children.type).toBe(App);
  });

  it('registers runnables and keeps section keys separate', () => {
    const run = vi.fn();
    AppRegistry.registerRunnable('Task', run);
    AppRegistry.registerSection('Section', () => () => null);
    AppRegistry.getRunnable('Task')?.run({ rootTag: 1 });
    expect(run).toHaveBeenCalledWith({ rootTag: 1 });
    expect(AppRegistry.getSectionKeys()).toEqual(['Section']);
    expect(AppRegistry.getRunnable('Section')).toBeUndefined();
  });

  it('registerConfig accepts RN app configs', () => {
    const run = vi.fn();
    function App(): null {
      return null;
    }
    AppRegistry.registerConfig([{ appKey: 'Configured', component: () => App, run }]);
    expect(AppRegistry.getApplication('Configured').element.type).toBe(App);
    expect(AppRegistry.getRunnable('Configured')).toBeDefined();
  });

  it('runApplication warns once and mounts nothing', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    AppRegistry.registerComponent('NoOp', () => () => null);
    AppRegistry.runApplication('NoOp', { rootTag: 1 });
    AppRegistry.runApplication('NoOp', { rootTag: 2 });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toContain('<NativeSurface>');
    // Inert by design, and it must not throw either.
    AppRegistry.unmountApplicationComponentAtRootTag(1);
    AppRegistry.setComponentProviderInstrumentationHook(() => {});
  });

  it('throws for an unregistered key rather than rendering nothing', () => {
    expect(() => AppRegistry.getApplication('NeverRegistered')).toThrow('NeverRegistered');
  });
});

describe('requireNativeComponent', () => {
  it('renders children in an empty View and warns once, naming the component', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const root = createTestRoot(200, 100);
    const NativeMap = requireNativeComponent<{
      style?: { width: number; height: number };
      testID?: string;
      accessibilityLabel?: string;
      region?: unknown;
      children?: React.ReactNode;
    }>('RCTMapView');

    root.render(
      <View style={{ flex: 1, backgroundColor: '#ffffff' }}>
        <NativeMap
          testID="map"
          accessibilityLabel="Map"
          style={{ width: 80, height: 40 }}
          region={{ latitude: 1, longitude: 2 }}
        >
          <Text>pin</Text>
        </NativeMap>
      </View>
    );
    await root.flush();

    const node = findNode(root.getLayoutTree(), (n) => n.testID === 'map');
    expect(node?.frame).toMatchObject({ width: 80, height: 40 });
    expect(node?.label).toBe('Map'); // accessibility props survive the filter
    expect(findNode(root.getLayoutTree(), (n) => n.text === 'pin')).not.toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toContain('RCTMapView');

    // Re-rendering the same component does not warn again.
    root.render(
      <View style={{ flex: 1, backgroundColor: '#ffffff' }}>
        <NativeMap testID="map" style={{ width: 80, height: 40 }} />
      </View>
    );
    await root.flush();
    expect(warn).toHaveBeenCalledTimes(1);
    root.unmount();
  });
});
