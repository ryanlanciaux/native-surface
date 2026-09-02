import type { ReactNode } from 'react';

/** Host apps replace this with mocked providers (auth, query, navigation). */
export function Wrapper(props: { children: ReactNode; route: { id: string } }): ReactNode {
  return props.children;
}
