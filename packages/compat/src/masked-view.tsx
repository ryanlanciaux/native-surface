/**
 * @react-native-masked-view/masked-view compat (canvas host).
 *
 * MaskedView renders maskElement as the FIRST child (wrapped absolute-fill,
 * mirroring the native module's own layout) and flags the host with
 * `__maskedView`; the engine paints the remaining children into a layer and
 * DstIn-composites the first child over it. The mask's ALPHA channel gates
 * content — the native iOS maskView rule — not luminance.
 */
import * as React from 'react';
import { StyleSheet, View } from 'native-surface';
import type { StyleProp, ViewStyle } from 'native-surface';

// The host view takes engine-channel props (__maskedView) that ViewProps doesn't type.
const HostView = View as unknown as React.FC<Record<string, unknown>>;

export interface MaskedViewProps {
  maskElement: React.ReactElement;
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
  [prop: string]: unknown;
}

export function MaskedView(props: MaskedViewProps): React.JSX.Element {
  const { maskElement, children, ...rest } = props;
  return (
    <HostView pointerEvents="box-none" {...rest} __maskedView>
      <View pointerEvents="none" style={StyleSheet.absoluteFill}>
        {maskElement}
      </View>
      {children}
    </HostView>
  );
}

export default MaskedView;
