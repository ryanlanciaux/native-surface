/**
 * react-native-edge-to-edge compat shim. SystemBars controls Android status/
 * navigation bar appearance — advisory chrome that does not exist on a canvas
 * host; renders nothing, accepts the documented props.
 */
export interface SystemBarsProps {
  style?: 'auto' | 'light' | 'dark' | { statusBar?: string; navigationBar?: string };
  hidden?: boolean | { statusBar?: boolean; navigationBar?: boolean };
}

export function SystemBars(_props: SystemBarsProps): null {
  return null;
}

export const SystemBarStyle = undefined;
