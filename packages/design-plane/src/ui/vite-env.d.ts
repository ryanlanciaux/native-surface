/// <reference types="vite/client" />

declare module 'virtual:design-plane' {
  import type { ComponentType, ReactNode } from 'react';

  export type PlaneRoute = {
    id: string;
    title: string;
    component: ComponentType<Record<string, unknown>>;
    props?: Record<string, unknown>;
    width?: number;
    height?: number;
  };

  export const routes: PlaneRoute[];
  export function Wrapper(props: { children: ReactNode; route: PlaneRoute }): ReactNode;
}
