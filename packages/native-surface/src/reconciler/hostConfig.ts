/**
 * react-reconciler 0.33 host config (mutation mode).
 *
 * NOTE ON TYPES: @types/react-reconciler targets 0.32 and lags the 0.33
 * runtime (priority hooks, view-transition/fragment stubs, HostTransitionContext).
 * The config is therefore typed loosely here — the runtime contract is what
 * matters and is exercised end-to-end by the vitest suite.
 */
import ReconcilerFactory from 'react-reconciler';
import { DefaultEventPriority, DiscreteEventPriority } from 'react-reconciler/constants';
import { createContext } from 'react';
import { CNode, HOST_TYPE_MAP } from '../engine/node';
import { Display } from 'yoga-layout/load';

export interface ContainerHost {
  rootNode: CNode;
  scheduleFlush(): void;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
type AnyFn = (...args: any[]) => any;

let currentUpdatePriority: number = 0;

const HostTransitionContext = createContext<unknown>(null);

function createNode(type: string, props: Record<string, unknown>): CNode {
  const mapped = HOST_TYPE_MAP[type];
  if (!mapped) {
    throw new Error(
      `native-surface: unknown host component <${type}>. Only native-surface primitives (View, Text, Image, Pressable, ScrollView, TextInput) can render inside NativeSurface — DOM elements like <div> cannot.`
    );
  }
  const node = new CNode(mapped, props);
  node.updateProps(props);
  return node;
}

const hostConfig: Record<string, unknown> = {
  rendererVersion: '0.1.0',
  rendererPackageName: 'native-surface',
  extraDevToolsConfig: null,

  supportsMutation: true,
  supportsPersistence: false,
  supportsHydration: false,
  supportsResources: false,
  supportsSingletons: false,
  supportsTestSelectors: false,
  supportsMicrotasks: true,
  // We nest inside react-dom trees (NativeSurface); the primary renderer owns
  // shared React internals (context stacks, useId), so we must be secondary.
  isPrimaryRenderer: false,
  warnsIfNotActing: false,

  getRootHostContext: () => ({}),
  getChildHostContext: (parentCtx: unknown) => parentCtx,
  getPublicInstance: (instance: CNode) => instance,
  prepareForCommit: () => null,
  resetAfterCommit: (container: ContainerHost) => container.scheduleFlush(),
  preparePortalMount: () => {},

  createInstance: (type: string, props: Record<string, unknown>) => createNode(type, props),
  createTextInstance: (text: string) => new CNode('rawtext', { text }),
  shouldSetTextContent: () => false,

  appendInitialChild: (parent: CNode, child: CNode) => parent.appendChild(child),
  finalizeInitialChildren: () => false,
  commitMount: () => {},

  appendChild: (parent: CNode, child: CNode) => parent.appendChild(child),
  appendChildToContainer: (container: ContainerHost, child: CNode) => container.rootNode.appendChild(child),
  insertBefore: (parent: CNode, child: CNode, before: CNode) => parent.insertBefore(child, before),
  insertInContainerBefore: (container: ContainerHost, child: CNode, before: CNode) =>
    container.rootNode.insertBefore(child, before),
  removeChild: (parent: CNode, child: CNode) => {
    parent.removeChild(child);
    child.destroy();
  },
  removeChildFromContainer: (container: ContainerHost, child: CNode) => {
    container.rootNode.removeChild(child);
    child.destroy();
  },
  clearContainer: (container: ContainerHost) => {
    for (const child of [...container.rootNode.children]) {
      container.rootNode.removeChild(child);
      child.destroy();
    }
  },
  detachDeletedInstance: () => {},

  commitUpdate: (instance: CNode, _type: string, _prevProps: unknown, nextProps: Record<string, unknown>) =>
    instance.updateProps(nextProps),
  commitTextUpdate: (instance: CNode, _old: string, next: string) => instance.updateText(next),
  resetTextContent: () => {},

  hideInstance: (instance: CNode) => {
    instance.hidden = true;
    instance.yoga?.setDisplay(Display.None);
    instance.markDirty();
  },
  unhideInstance: (instance: CNode) => {
    instance.hidden = false;
    instance.yoga?.setDisplay(instance.flatStyle.display === 'none' ? Display.None : Display.Flex);
    instance.markDirty();
  },
  hideTextInstance: (instance: CNode) => instance.updateText(''),
  unhideTextInstance: (instance: CNode, text: string) => instance.updateText(text),

  scheduleTimeout: setTimeout,
  cancelTimeout: clearTimeout,
  noTimeout: -1,
  scheduleMicrotask:
    typeof queueMicrotask === 'function' ? queueMicrotask : (cb: AnyFn) => Promise.resolve().then(cb),

  getCurrentUpdatePriority: () => currentUpdatePriority,
  setCurrentUpdatePriority: (priority: number) => {
    currentUpdatePriority = priority;
  },
  resolveUpdatePriority: () => currentUpdatePriority || DefaultEventPriority,
  shouldAttemptEagerTransition: () => false,
  trackSchedulerEvent: () => {},
  resolveEventType: () => null,
  resolveEventTimeStamp: () => -1.1,

  maySuspendCommit: () => false,
  maySuspendCommitOnUpdate: () => false,
  maySuspendCommitInSyncRender: () => false,
  mayResourceSuspendCommit: () => false,
  preloadInstance: () => true,
  preloadResource: () => true,
  startSuspendingCommit: () => {},
  suspendInstance: () => {},
  suspendResource: () => {},
  waitForCommitToBeReady: () => null,

  NotPendingTransition: null,
  HostTransitionContext,
  resetFormInstance: () => {},
  requestPostPaintCallback: () => {},
  bindToConsole: (methodName: string, args: unknown[]) =>
    Function.prototype.bind.apply(
      (console as unknown as Record<string, AnyFn>)[methodName] ?? console.log,
      [console, ...args]
    ),

  // view transitions — never triggered by this renderer
  suspendOnActiveViewTransition: false,
  startViewTransition: () => false,
  startGestureTransition: () => () => {},
  stopViewTransition: () => {},
  createViewTransitionInstance: () => null,
  getCurrentGestureOffset: () => 0,
  cancelRootViewTransitionName: () => {},
  restoreRootViewTransitionName: () => {},
  cancelViewTransitionName: () => {},
  cloneRootViewTransitionContainer: () => null,
  removeRootViewTransitionClone: () => {},
  measureClonedInstance: () => null,

  // fragment instances — unused
  createFragmentInstance: () => null,
  updateFragmentInstanceFiber: () => {},
  commitNewChildToFragmentInstance: () => {},
  deleteChildFromFragmentInstance: () => {},
  getInstanceFromNode: () => null,
  beforeActiveInstanceBlur: () => {},
  afterActiveInstanceBlur: () => {},
  prepareScopeUpdate: () => {},
  getInstanceFromScope: () => null,
  setFocusIfFocusable: () => false,
  isHostHoistableType: () => false,
  isHostSingletonType: () => false,
  isSingletonScope: () => false,
};

export interface ReconcilerApi {
  createContainer: AnyFn;
  updateContainer: AnyFn;
  updateContainerSync: AnyFn;
  flushSyncWork: AnyFn;
  flushPassiveEffects: AnyFn;
  getPublicRootInstance: AnyFn;
  defaultOnUncaughtError: AnyFn;
  defaultOnCaughtError: AnyFn;
  defaultOnRecoverableError: AnyFn;
}

let reconciler: ReconcilerApi | null = null;

export function getReconciler(): ReconcilerApi {
  if (!reconciler) {
    reconciler = (ReconcilerFactory as unknown as (config: Record<string, unknown>) => ReconcilerApi)(hostConfig);
  }
  return reconciler;
}

/**
 * Run a host event callback at discrete priority and synchronously commit the
 * React work it schedules — what react-dom does for discrete DOM events.
 * TextInput's typing path REQUIRES this: a controlled value must round-trip
 * through parent state before the input event returns, or the async flush
 * pushes a stale value into the DOM mid-typing (dropped/reordered keystrokes).
 */
export function runDiscreteEvent<T>(fn: () => T): T {
  const r = getReconciler();
  const prev = currentUpdatePriority;
  currentUpdatePriority = DiscreteEventPriority as unknown as number;
  try {
    return fn();
  } finally {
    currentUpdatePriority = prev;
    r.flushSyncWork();
    r.flushPassiveEffects();
  }
}
