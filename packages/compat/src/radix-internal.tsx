/**
 * radix-ui/internal canvas stub.
 *
 * FocusScope / DismissableLayer / FocusGuards expect a DOM Node and call
 * MutationObserver.observe; the canvas host has a document but no Node for
 * the tree. Pass-through children only — no focus trapping.
 */
import type { ReactNode } from 'react';

function PassThrough({ children }: { children?: ReactNode; [key: string]: unknown }): ReactNode {
  return children ?? null;
}

export function useFocusGuards(): void {}

export const FocusGuards = { useFocusGuards, FocusGuards: PassThrough, Root: PassThrough };
export const FocusScope = { FocusScope: PassThrough, Root: PassThrough };
export const DismissableLayer = {
  DismissableLayer: PassThrough,
  DismissableLayerBranch: PassThrough,
  Root: PassThrough,
  Branch: PassThrough,
};
