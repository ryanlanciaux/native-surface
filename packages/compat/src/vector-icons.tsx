/**
 * react-native-vector-icons compat.
 *
 * LIMITATION — subpath imports cannot be bridged. The legacy package is
 * consumed almost exclusively as subpath defaults
 * (`import MaterialIcons from 'react-native-vector-icons/MaterialIcons'`),
 * where each subpath module pairs a glyph map with a bundled .ttf. The preset
 * aliases the whole package — subpaths included — onto this single file, so
 * by the time an import lands here the subpath (which icon set was meant) is
 * gone, and the fonts live in the real package's tarball, which ships raw JSX
 * the bundler can't parse. The DEFAULT export therefore renders nothing but a
 * clear error pointing at @expo/vector-icons, which bundles the very same
 * icon sets and works over the expo-font seam.
 *
 * The named `createIconSet(glyphMap, fontFamily, fontFile?)` export IS
 * functional: apps that build their own icon sets get a working Icon
 * component over the engine's Text plus the expo-font seam (the fontFile is
 * registered through the same loadAsync used by @expo/vector-icons).
 */
import * as React from 'react';
import { Text } from 'native-surface';
import type { StyleProp, TextStyle } from 'native-surface';
import { loadAsync, isLoaded, type FontSource } from './expo';

export const DEFAULT_ICON_SIZE = 12;
export const DEFAULT_ICON_COLOR = 'black';

export type GlyphMap = Record<string, number | string>;

export interface IconProps {
  name?: string;
  size?: number;
  color?: string;
  style?: StyleProp<TextStyle>;
  allowFontScaling?: boolean;
  children?: React.ReactNode;
  testID?: string;
}

export interface IconComponent extends React.FC<IconProps> {
  Button: React.FC<Record<string, unknown>>;
  getImageSource: (name: string, size?: number, color?: string) => Promise<null>;
  getImageSourceSync: (name: string, size?: number, color?: string) => null;
  loadFont: () => Promise<void>;
  hasIcon: (name: string) => boolean;
  getRawGlyphMap: () => GlyphMap;
  getFontFamily: () => string;
}

const warned = new Set<string>();
function warnOnce(key: string, message: string): void {
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(message);
}

// One in-flight registration per family: every mounted icon of a set shares it.
const fontLoads = new Map<string, Promise<void>>();

function ensureFont(family: string, fontFile: FontSource | undefined): Promise<void> {
  if (!fontFile || isLoaded(family)) return Promise.resolve();
  let p = fontLoads.get(family);
  if (!p) {
    p = loadAsync({ [family]: fontFile });
    fontLoads.set(family, p);
  }
  return p;
}

/**
 * v1 contract: a working Icon over engine Text. When `fontFile` is given (a
 * URL string, `{uri}`/`{default}` asset, or ArrayBuffer) it is registered via
 * the expo-font seam on first mount; icons render empty Text until the family
 * is registered, then swap in the glyph — same lifecycle as @expo/vector-icons.
 */
export function createIconSet(glyphMap: GlyphMap, fontFamily: string, fontFile?: FontSource): IconComponent {
  const Icon: React.FC<IconProps> = ({
    name,
    size = DEFAULT_ICON_SIZE,
    color = DEFAULT_ICON_COLOR,
    style,
    allowFontScaling: _afs,
    children,
    ...rest
  }) => {
    const [ready, setReady] = React.useState(() => !fontFile || isLoaded(fontFamily));
    React.useEffect(() => {
      if (ready) return;
      let alive = true;
      ensureFont(fontFamily, fontFile)
        .then(() => alive && setReady(true))
        .catch((e: Error) => console.error(`vector-icons compat: failed to load font "${fontFamily}"`, e));
      return () => {
        alive = false;
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [ready]);
    if (!ready) return <Text />;

    let glyph: string = '';
    if (name) {
      const mapped = glyphMap[name] ?? '?';
      glyph = typeof mapped === 'number' ? String.fromCodePoint(mapped) : mapped;
    }
    // RNVI's style order: defaults, user style, then the font lock-ins.
    const composed: StyleProp<TextStyle> = [
      { fontSize: size, color },
      style,
      { fontFamily, fontWeight: 'normal', fontStyle: 'normal' },
    ];
    return (
      <Text selectable={false} {...rest} style={composed}>
        {glyph}
        {children}
      </Text>
    );
  };

  const Full = Icon as IconComponent;
  Full.Button = (() => {
    warnOnce(
      `button:${fontFamily}`,
      `vector-icons compat: Icon.Button is not implemented on the canvas host (family "${fontFamily}"); rendered nothing. Compose a Pressable + Icon instead.`
    );
    return null;
  }) as IconComponent['Button'];
  Full.getImageSource = async () => {
    warnOnce(
      `getImageSource:${fontFamily}`,
      `vector-icons compat: getImageSource is not implemented on the canvas host (family "${fontFamily}"); resolved null.`
    );
    return null;
  };
  Full.getImageSourceSync = () => {
    warnOnce(
      `getImageSource:${fontFamily}`,
      `vector-icons compat: getImageSourceSync is not implemented on the canvas host (family "${fontFamily}"); returned null.`
    );
    return null;
  };
  Full.loadFont = () => ensureFont(fontFamily, fontFile);
  Full.hasIcon = (name: string) => Object.prototype.hasOwnProperty.call(glyphMap, name);
  Full.getRawGlyphMap = () => glyphMap;
  Full.getFontFamily = () => fontFamily;
  return Full;
}

const SUBPATH_ERROR =
  "react-native-vector-icons subpath imports can't be bridged — the alias reaches one shim file that cannot know which icon set a subpath meant, and the package's bundled fonts aren't loadable here. Use @expo/vector-icons (it bundles the same icon sets: MaterialIcons, Ionicons, FontAwesome, ...) instead.";

function UnbridgeableSubpathIcon(): React.ReactElement {
  throw new Error(SUBPATH_ERROR);
}
// Statics a subpath default is commonly touched for: fail with the same
// guidance rather than an undefined-property error.
UnbridgeableSubpathIcon.Button = UnbridgeableSubpathIcon;
UnbridgeableSubpathIcon.getImageSource = async (): Promise<never> => {
  throw new Error(SUBPATH_ERROR);
};
UnbridgeableSubpathIcon.loadFont = async (): Promise<never> => {
  throw new Error(SUBPATH_ERROR);
};

/**
 * Default export: what `react-native-vector-icons/<AnySet>` resolves to.
 * Importing is harmless; RENDERING it throws the guidance above.
 */
export default UnbridgeableSubpathIcon;
