/**
 * @react-navigation/native-stack compat adapter — the boundary-general
 * adapter from docs/compat-strategy.md: native-stack's API mapped onto the
 * proven JS stack (@react-navigation/stack), because native screen primitives
 * do not exist on a canvas host. Transitions/headers degrade to the JS
 * stack's iOS-faithful implementations.
 *
 * Option mapping (documented native-stack props → stack equivalents):
 *   headerShown/title/headerTitle/headerBackTitle/headerTintColor/
 *   headerStyle/headerTitleStyle → pass through (same names in stack)
 *   contentStyle → cardStyle
 *   animation: 'none' → animationEnabled:false; 'fade' → forFadeFromCenter;
 *              default/others → stack default slide
 *   presentation: 'modal'|'formSheet'|'containedModal' → stack modal preset
 *   gestureEnabled → pass through
 *   Android/native-only options (navigationBarColor, statusBar*, orientation,
 *   autoHideHomeIndicator, freezeOnBlur, ...) → accepted and dropped.
 */
import * as React from 'react';
import {
  createStackNavigator,
  CardStyleInterpolators,
  TransitionPresets,
} from '@react-navigation/stack';
import type { StackNavigationOptions } from '@react-navigation/stack';

type NativeStackOptions = Record<string, unknown>;

const DROPPED_OPTIONS = new Set([
  'navigationBarColor',
  'navigationBarHidden',
  'statusBarStyle',
  'statusBarColor',
  'statusBarHidden',
  'statusBarTranslucent',
  'statusBarAnimation',
  'orientation',
  'autoHideHomeIndicator',
  'freezeOnBlur',
  'fullScreenGestureEnabled',
  'customAnimationOnGesture',
  'animationTypeForReplace',
  'headerLargeTitle',
  'headerLargeTitleStyle',
  'headerLargeStyle',
  'headerTransparent',
  'headerBlurEffect',
]);

function mapOptions(options: NativeStackOptions | undefined): StackNavigationOptions | undefined {
  if (!options) return options as undefined;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(options)) {
    if (DROPPED_OPTIONS.has(k)) continue;
    if (k === 'contentStyle') out.cardStyle = v;
    else if (k === 'animation') {
      if (v === 'none') out.animationEnabled = false;
      else if (v === 'fade')
        out.cardStyleInterpolator = CardStyleInterpolators.forFadeFromBottomAndroid;
      // default/slide_from_right → stack default (iOS slide)
    } else if (k === 'presentation') {
      if (v === 'modal' || v === 'containedModal' || v === 'formSheet') {
        Object.assign(out, TransitionPresets.ModalSlideFromBottomIOS, { presentation: 'modal' });
      }
    } else out[k] = v;
  }
  return out as StackNavigationOptions;
}

type OptionsProp =
  | NativeStackOptions
  | ((ctx: { route: unknown; navigation: unknown; theme: unknown }) => NativeStackOptions);

function mapOptionsProp(options: OptionsProp | undefined): unknown {
  if (typeof options === 'function') {
    return (ctx: { route: unknown; navigation: unknown; theme: unknown }) => mapOptions(options(ctx));
  }
  return mapOptions(options);
}

export function createNativeStackNavigator<ParamList extends Record<string, object | undefined>>(): ReturnType<
  typeof createStackNavigator<ParamList>
> {
  const Stack = createStackNavigator<ParamList>();

  // The navigator validates children by component identity, so Screen/Group
  // must be the REAL Stack.Screen/Group; per-screen `options` are mapped by
  // cloning the elements inside the Navigator wrapper.
  const mapChildren = (children: React.ReactNode): React.ReactNode =>
    React.Children.map(children, (child) => {
      if (!React.isValidElement(child)) return child;
      if (child.type === React.Fragment || child.type === Stack.Group) {
        const props = child.props as { children?: React.ReactNode; screenOptions?: OptionsProp };
        return React.cloneElement(child as React.ReactElement<Record<string, unknown>>, {
          ...(child.type === Stack.Group && props.screenOptions
            ? { screenOptions: mapOptionsProp(props.screenOptions) }
            : {}),
          children: mapChildren(props.children),
        });
      }
      if (child.type === Stack.Screen) {
        const props = child.props as { options?: OptionsProp };
        return React.cloneElement(child as React.ReactElement<Record<string, unknown>>, {
          options: mapOptionsProp(props.options),
        });
      }
      return child;
    });

  const Navigator: typeof Stack.Navigator = ((props: Record<string, unknown>) => {
    const { screenOptions, children, ...rest } = props;
    return React.createElement(
      Stack.Navigator,
      { ...rest, screenOptions: mapOptionsProp(screenOptions as OptionsProp) } as never,
      mapChildren(children as React.ReactNode)
    );
  }) as never;

  return { ...Stack, Navigator };
}

/** Types consumers import; structurally compatible enough for app code. */
export type NativeStackNavigationOptions = StackNavigationOptions & Record<string, unknown>;
export type { StackNavigationProp as NativeStackNavigationProp } from '@react-navigation/stack';
export type NativeStackScreenProps<
  ParamList extends Record<string, object | undefined>,
  RouteName extends keyof ParamList = keyof ParamList,
> = {
  navigation: unknown;
  route: { key: string; name: RouteName; params: ParamList[RouteName] };
};
