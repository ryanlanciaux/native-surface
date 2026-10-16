import * as React from 'react';
import { Image } from 'react-native';
import type { ImageProps } from 'react-native';

export interface AutoImageProps extends Omit<ImageProps, 'source'> {
  /** Remote or bundled image URL. */
  uri: string;
  /** Box the image is fitted into, keeping its intrinsic aspect ratio. */
  maxWidth?: number;
  maxHeight?: number;
}

/**
 * Ignite's AutoImage: sizes itself from the image's intrinsic dimensions,
 * scaled down to fit maxWidth / maxHeight.
 */
export function AutoImage({ uri, maxWidth, maxHeight, style, ...rest }: AutoImageProps) {
  const [size, setSize] = React.useState<{ width: number; height: number } | null>(null);
  React.useEffect(() => {
    let alive = true;
    Image.getSize(uri, (width, height) => alive && setSize({ width, height }), () => {});
    return () => {
      alive = false;
    };
  }, [uri]);

  let width = size?.width ?? maxWidth ?? 0;
  let height = size?.height ?? maxHeight ?? 0;
  if (size) {
    const scale = Math.min(1, maxWidth ? maxWidth / size.width : 1, maxHeight ? maxHeight / size.height : 1);
    width = size.width * scale;
    height = size.height * scale;
  }
  return <Image {...rest} source={{ uri }} style={[{ width, height }, style]} />;
}
