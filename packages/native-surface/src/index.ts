// Engine lifecycle
export { initEngine } from './engine/init';
// Raw-pixel image registration (compat placeholders: blurhash/thumbhash)
export { putImagePixels, hasImage } from './engine/init';
export { createNativeRoot, snapshotPNG } from './engine/renderer';

// Embed component
export { NativeSurface } from './api/NativeSurface';
export type { NativeSurfaceProps } from './api/NativeSurface';

// Components
export {
  View,
  Text,
  Image,
  Pressable,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  SafeAreaView,
} from './components/primitives';
export { Switch } from './components/Switch';
export type { SwitchProps } from './components/Switch';

// Auxiliary RN surface for third-party libraries (see api/extras.tsx policy)
export {
  Keyboard,
  StatusBar,
  findNodeHandle,
  TouchableWithoutFeedback,
  TouchableHighlight,
  TextInput,
  FlatList,
  SectionList,
  VirtualizedList,
  RefreshControl,
  I18nManager,
  AccessibilityInfo,
  InteractionManager,
  TurboModuleRegistry,
  NativeEventEmitter,
  LogBox,
  UIManager,
  BackHandler,
  Linking,
  PlatformColor,
  NativeModules,
  useColorScheme,
  KeyboardAvoidingView,
  LayoutAnimation,
} from './api/extras';
export type {
  FlatListProps,
  SectionListProps,
  SectionListData,
  SectionListRenderItemInfo,
  ListRenderItem,
  ListRenderItemInfo,
  TextInputProps,
  TextInputRef,
} from './api/extras';

// APIs
export { StyleSheet } from './api/StyleSheet';
export { Platform, setPlatformOS } from './api/Platform';
export { Dimensions, useWindowDimensions, PixelRatio } from './api/Dimensions';
export { Animated, Easing, useAnimatedValue, AnimatedValue } from './api/Animated';
export { Appearance } from './api/Appearance';
export type { ColorSchemeName, AppearancePreferences } from './api/Appearance';
export { processColor } from './engine/colors';

// Types
export type {
  ColorValue,
  DimensionValue,
  FlexStyle,
  ViewStyle,
  TextStyle,
  ImageStyle,
  StyleProp,
  TransformStyle,
  LayoutRectangle,
  LayoutChangeEvent,
  PressEvent,
  ScrollEvent,
  Insets,
  ViewProps,
  TextProps,
  ImageProps,
  ImageSource,
  PressableProps,
  PressableStateCallbackType,
  TouchableOpacityProps,
  ScrollViewProps,
  FontSpec,
  InitOptions,
  RootOptions,
  LayoutNode,
  NativeRoot,
  PointerEventType,
  SyntheticPointer,
} from './types';
