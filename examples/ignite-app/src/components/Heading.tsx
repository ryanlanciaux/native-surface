import * as React from 'react';
import type { StyleProp, TextStyle } from 'react-native';
import { Text } from './Text';

export interface HeadingProps {
  text?: string;
  style?: StyleProp<TextStyle>;
  numberOfLines?: number;
}

/** Ignite/Heading — `<Text preset="heading" />` (272 wide in the design). */
export function Heading({ text = 'React Native Radio episodes', style, numberOfLines }: HeadingProps) {
  return <Text preset="heading" accessibilityRole="header" text={text} style={style} numberOfLines={numberOfLines} />;
}
