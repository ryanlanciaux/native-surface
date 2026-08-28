/**
 * Modal — RN's modal, PAINTED BY THE ENGINE.
 *
 * On RN this is a separate native window that floats above the whole app. Here
 * it is a canvas node like everything else: an absolutely-positioned, surface-
 * filling View with a very high zIndex, so the engine's paint order
 * (node.paintOrderedChildren) puts it over its siblings and the same z-sorted
 * hit path (engine/events.ts) gives it the touches first — a visible modal
 * swallows presses aimed at the content behind it, which is the behavior that
 * actually matters.
 *
 * THE CEILING, stated plainly: zIndex orders SIBLINGS. A Modal rendered deep
 * inside the tree paints above its own siblings, not above an uncle with a
 * higher zIndex, and its absolute fill covers its PARENT, not the surface,
 * unless the parent itself fills the surface. RN's modal cannot be contained by
 * its parent; this one can. Render Modal near the root — where apps normally
 * put it — and the two agree. (The only way past that on this host is a DOM
 * portal, which composites above the canvas and so cannot have RN children.)
 *
 * `transparent` follows RN exactly: false (the default) paints an opaque
 * backdrop over everything behind it, true paints nothing and lets the app show
 * through so the app can draw its own scrim. There is no system background
 * color on a canvas host, so the opaque backdrop follows the color scheme —
 * white in light, black in dark — the way iOS's system background does.
 */
import * as React from 'react';
import { Animated, Easing, useAnimatedValue } from '../api/Animated';
import { useWindowDimensions } from '../api/Dimensions';
import { useColorScheme } from '../api/extras';
import type { StyleProp, ViewStyle } from '../types';

/** Above app content by a margin no real layout uses; siblings only (see doc). */
const MODAL_Z_INDEX = 9999;
/** RN's modal presentation duration. */
const ANIMATION_MS = 300;

export interface ModalProps {
  /** Nothing is rendered at all while false. */
  visible?: boolean;
  /** True: no backdrop, the app shows through. False (default): opaque. */
  transparent?: boolean;
  /** 'none' (RN's default) shows instantly; 'fade' and 'slide' are animated by
   *  the engine's own Animated, so they are painted frames, not CSS. */
  animationType?: 'none' | 'slide' | 'fade';
  /**
   * ACCEPTED BUT NEVER CALLED BY THIS HOST: it is RN's hook for the Android
   * back button and iOS swipe-to-dismiss, and a canvas surface has neither
   * (BackHandler is inert here too). Give the modal its own close control and
   * drive `visible` from it.
   */
  onRequestClose?: () => void;
  /** After the modal is on screen (after the show animation, if any). */
  onShow?: () => void;
  /** After the modal is fully gone (after the hide animation, if any). */
  onDismiss?: () => void;
  /** Android status-bar behavior. Inert: no status bar on a canvas surface. */
  statusBarTranslucent?: boolean;
  /** Android window flag. Inert: the surface is already GPU-composited. */
  hardwareAccelerated?: boolean;
  /** iOS sheet presentation. Inert: every modal here fills its parent, so
   *  pageSheet/formSheet do not inset. Wrap children to inset them yourself. */
  presentationStyle?: 'fullScreen' | 'pageSheet' | 'formSheet' | 'overFullScreen';
  /** iOS orientation locks. Inert: a surface is sized by its embedder. */
  supportedOrientations?: ReadonlyArray<string>;
  /** Never fires (see supportedOrientations). */
  onOrientationChange?: (event: unknown) => void;
  /** Deprecated RN prop; `animationType` wins when both are given. */
  animated?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
  children?: React.ReactNode;
}

export function Modal(props: ModalProps): React.JSX.Element | null {
  const {
    visible = false,
    transparent = false,
    animationType = 'none',
    onShow,
    onDismiss,
    style,
    testID,
    children,
  } = props;

  const scheme = useColorScheme();
  const { height } = useWindowDimensions();
  // 0 = fully hidden, 1 = fully presented. An un-animated modal starts fully
  // presented so its first painted frame is already correct; an animated one
  // starts at 0 even when it mounts visible, because RN animates that in too.
  const progress = useAnimatedValue(visible && animationType === 'none' ? 1 : 0);
  const [mounted, setMounted] = React.useState(visible);
  /** Whether the modal has ever been presented: an initially-hidden modal must
   *  not report a dismissal it never had. */
  const presented = React.useRef(visible);
  // Read from the effect without making it re-run when a parent re-renders
  // with a new inline callback.
  const callbacks = React.useRef({ onShow, onDismiss });
  callbacks.current = { onShow, onDismiss };

  React.useEffect(() => {
    if (visible) {
      presented.current = true;
      setMounted(true);
      if (animationType === 'none') {
        progress.setValue(1);
        callbacks.current.onShow?.();
        return;
      }
      const animation = Animated.timing(progress, {
        toValue: 1,
        duration: ANIMATION_MS,
        easing: Easing.out(Easing.ease),
        useNativeDriver: false,
      });
      animation.start(({ finished }) => {
        if (finished) callbacks.current.onShow?.();
      });
      return () => animation.stop();
    }

    if (!presented.current) return; // hidden since mount: nothing to dismiss
    presented.current = false;
    if (animationType === 'none') {
      progress.setValue(0);
      setMounted(false);
      callbacks.current.onDismiss?.();
      return;
    }
    const animation = Animated.timing(progress, {
      toValue: 0,
      duration: ANIMATION_MS,
      easing: Easing.in(Easing.ease),
      useNativeDriver: false,
    });
    animation.start(({ finished }) => {
      if (!finished) return;
      setMounted(false);
      callbacks.current.onDismiss?.();
    });
    return () => animation.stop();
  }, [visible, animationType, progress]);

  if (!mounted) return null;

  const backdrop = transparent ? null : { backgroundColor: scheme === 'dark' ? '#000000' : '#ffffff' };
  const motion =
    animationType === 'fade'
      ? { opacity: progress }
      : animationType === 'slide'
        ? { transform: [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [height, 0] }) }] }
        : null;

  return (
    <Animated.View
      testID={testID}
      style={[
        { position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, zIndex: MODAL_Z_INDEX },
        backdrop,
        motion,
        style,
      ]}
    >
      {children}
    </Animated.View>
  );
}
