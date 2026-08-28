/**
 * AppRegistry — RN's app entry-point registry.
 *
 * On a device, `AppRegistry.registerComponent('MyApp', () => App)` is how the
 * native side finds the root component, and the OS calls `runApplication` to
 * mount it into a native root view. NEITHER HALF OF THAT EXISTS HERE: a
 * native-surface app is mounted by rendering `<NativeSurface>` from the host
 * page, which owns the canvas, the engine root, and the React root.
 *
 * So the registry half is real — registering a component stores it, and
 * `getApplication` hands it back as an element, wrapper provider applied, so
 * code that round-trips through the registry (index.js entry files, test
 * harnesses, Expo's registerRootComponent) works unchanged. The mounting half
 * is an honest no-op: `runApplication` warns once and returns, because mounting
 * a second React root over the surface is the opposite of what the caller
 * wants. Registering at import time and then rendering `<NativeSurface>` is the
 * supported shape.
 */
import * as React from 'react';

/* eslint-disable @typescript-eslint/no-explicit-any */
export type AppComponent = React.ComponentType<any>;
export type ComponentProvider = () => AppComponent;
export type WrapperComponentProvider = (appParameters: any) => AppComponent | null | undefined;
export type Runnable = (appParameters: any) => void;
/* eslint-enable @typescript-eslint/no-explicit-any */

export interface AppConfig {
  appKey: string;
  component?: ComponentProvider;
  run?: Runnable;
  section?: boolean;
}

export interface AppParameters {
  initialProps?: Record<string, unknown>;
  rootTag?: number;
  [key: string]: unknown;
}

export interface Application {
  element: React.ReactElement;
  /** RN-web SSR hook; there is no stylesheet to collect on a canvas host. */
  getStyleElement(): null;
}

interface Registration {
  componentProvider?: ComponentProvider;
  run?: Runnable;
  section: boolean;
}

const registrations = new Map<string, Registration>();
let wrapperComponentProvider: WrapperComponentProvider | null = null;
let warnedRunApplication = false;

function elementFor(appKey: string, appParameters?: AppParameters): React.ReactElement {
  const registration = registrations.get(appKey);
  if (!registration?.componentProvider) {
    throw new Error(
      `native-surface: AppRegistry has no component registered for "${appKey}" — call AppRegistry.registerComponent('${appKey}', () => App) first.`
    );
  }
  const Component = registration.componentProvider();
  const element = React.createElement(Component, appParameters?.initialProps ?? {});
  const Wrapper = wrapperComponentProvider?.(appParameters);
  return Wrapper ? React.createElement(Wrapper, appParameters?.initialProps ?? {}, element) : element;
}

function update(appKey: string, patch: Partial<Registration>): string {
  const prev = registrations.get(appKey) ?? { section: false };
  registrations.set(appKey, { ...prev, ...patch });
  return appKey;
}

export const AppRegistry = {
  registerComponent(appKey: string, componentProvider: ComponentProvider, section = false): string {
    return update(appKey, { componentProvider, section });
  },

  /** RN's imperative variant: a plain function instead of a component. */
  registerRunnable(appKey: string, run: Runnable): string {
    return update(appKey, { run });
  },

  registerSection(appKey: string, componentProvider: ComponentProvider): void {
    AppRegistry.registerComponent(appKey, componentProvider, true);
  },

  registerConfig(configs: AppConfig[]): void {
    for (const config of configs) {
      if (config.run) AppRegistry.registerRunnable(config.appKey, config.run);
      if (config.component) AppRegistry.registerComponent(config.appKey, config.component, config.section);
    }
  },

  getAppKeys(): string[] {
    return [...registrations.keys()];
  },

  getSectionKeys(): string[] {
    return [...registrations.entries()].filter(([, r]) => r.section).map(([key]) => key);
  },

  getRunnable(appKey: string): { run: Runnable } | undefined {
    const run = registrations.get(appKey)?.run;
    return run ? { run } : undefined;
  },

  /**
   * The registered component as an element, with initialProps applied and the
   * wrapper provider (if any) around it — ready to hand to `<NativeSurface>`.
   * Throws for an unregistered key, exactly as RN does: a typo here silently
   * renders nothing otherwise.
   */
  getApplication(appKey: string, appParameters?: AppParameters): Application {
    const element = elementFor(appKey, appParameters);
    return { element, getStyleElement: () => null };
  },

  /**
   * No-op by design. RN's native side calls this to mount the app into a root
   * view; on this host `<NativeSurface>` is the entry point and already owns
   * the React root, so there is nothing to mount into.
   */
  runApplication(appKey: string, _appParameters?: AppParameters): void {
    if (!warnedRunApplication) {
      warnedRunApplication = true;
      console.warn(
        `native-surface: AppRegistry.runApplication('${appKey}') does nothing here — render <NativeSurface> to mount the app; the registry only stores components.`
      );
    }
  },

  /** Applied by getApplication; RN uses it for app-wide providers. */
  setWrapperComponentProvider(provider: WrapperComponentProvider | null): void {
    wrapperComponentProvider = provider;
  },

  /** RN's perf-instrumentation seam; accepted and unused. */
  setComponentProviderInstrumentationHook(_hook: unknown): void {},

  /**
   * No-op: root tags belong to RN's native view registry. Unmount a surface by
   * unmounting the `<NativeSurface>` element that created it.
   */
  unmountApplicationComponentAtRootTag(_rootTag: number): void {},
};
