/**
 * react-native-edge-to-edge compat shim. SystemBars controls Android status/
 * navigation bar appearance — advisory chrome that does not exist on a canvas
 * host; renders nothing, accepts the documented props.
 */
export interface SystemBarsProps {
  style?: 'auto' | 'light' | 'dark' | { statusBar?: string; navigationBar?: string };
  hidden?: boolean | { statusBar?: boolean; navigationBar?: boolean };
}

/**
 * A stack ENTRY, in the real module's shape. It is an opaque handle the caller
 * holds and hands back to `popStackEntry`, so it must be a distinct object per
 * push — returning a shared constant would make two overlapping pushes
 * indistinguishable and pop the wrong one.
 */
export interface SystemBarsEntry {
  style: SystemBarsProps['style'];
  hidden: SystemBarsProps['hidden'];
}

export function SystemBars(_props: SystemBarsProps): null {
  return null;
}

/**
 * The imperative half.
 *
 * `SystemBars` is a component with STATICS hanging off it (upstream declares
 * them through a `namespace` merge), and Bluesky's iOS composer drives them
 * directly — `const entry = SystemBars.pushStackEntry({...})` on mount and
 * `SystemBars.popStackEntry(entry)` on cleanup. A named import of the
 * component alone therefore links fine and then throws
 * "SystemBars.pushStackEntry is not a function" the first time a composer
 * opens.
 *
 * There are no OS bars behind a canvas surface, so these are inert — but the
 * PUSH/POP CONTRACT still has to hold: the entry a caller pops must be the one
 * it pushed. The stack is tracked so the shape is honest and a mismatched pop
 * is a no-op rather than corrupting anything.
 */
const barStack: SystemBarsEntry[] = [];

SystemBars.pushStackEntry = (props: SystemBarsProps): SystemBarsEntry => {
  const entry: SystemBarsEntry = { style: props.style, hidden: props.hidden };
  barStack.push(entry);
  return entry;
};

SystemBars.popStackEntry = (entry: SystemBarsEntry): void => {
  const i = barStack.lastIndexOf(entry);
  if (i >= 0) barStack.splice(i, 1);
};

SystemBars.replaceStackEntry = (entry: SystemBarsEntry, props: SystemBarsProps): SystemBarsEntry => {
  const next: SystemBarsEntry = { style: props.style, hidden: props.hidden };
  const i = barStack.lastIndexOf(entry);
  if (i >= 0) barStack[i] = next;
  else barStack.push(next);
  return next;
};

SystemBars.setStyle = (_style: SystemBarsProps['style']): void => {};
SystemBars.setHidden = (_hidden: SystemBarsProps['hidden']): void => {};

/** Test/diagnostic seam: how many entries are currently pushed. */
export function __systemBarsStackSize(): number {
  return barStack.length;
}

export const SystemBarStyle = undefined;
