---
name: design-plane
description: Mock an app's main routes on the native-surface design plane (pan/zoom canvas, inspect, shift-click jump).
---

# Design plane

Put mocked routes on one pan/zoom canvas. Real RN components, faked world.

Files in the **host app root** (the directory you pass to `native-surface playground`):

```
.native-surface/plane.tsx      # routes
.native-surface/wrapper.tsx    # mocked providers
```

Then open `/plane` on the playground server.

## plane.tsx

Named export `routes`. Each item is a screen, not a story.

```tsx
import { HomeScreen } from '../src/screens/Home';
import { ProfileScreen } from '../src/screens/Profile';

export const routes = [
  { id: 'home', title: 'Home', component: HomeScreen },
  { id: 'profile', title: 'Profile', component: ProfileScreen, props: { userId: 'demo' } },
];
```

- `id` is the jump target. Put that same string as `testID` on the control that should jump there (tab, link, row).
- Optional: `width`, `height` (default 390×720), `props`.
- Do not mount the real navigator. Each route is one screen, isolated.
- Prefer 3–8 main routes. More frames = more canvases.

Shift-click a node whose `testID` matches a route `id` to pan/zoom to that frame. Click (Inspect on) shows type, testID, role, label, text, frame.

## wrapper.tsx

Wraps every frame. Clone the app's provider tree and **fake** the world — same idea as Validity: no backend, no login.

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthContext } from '../src/auth';

const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

export function Wrapper({ children, route }: { children: React.ReactNode; route: { id: string } }) {
  return (
    <QueryClientProvider client={client}>
      <AuthContext.Provider value={{ user: { id: 'demo', name: 'Ada' }, signIn: async () => {}, signOut: async () => {} }}>
        {children}
      </AuthContext.Provider>
    </QueryClientProvider>
  );
}
```

Rules:

- Use React Native views/providers only (this tree is the canvas reconciler, not the DOM).
- Seed auth/session as already-logged-in (or logged-out) via context value, not a real login screen.
- Stub navigation: do not wrap with NavigationContainer unless it is required to not crash; the plane **is** the navigator.
- Network: return fixtures from your data layer (mocked hook, fake client). Do not hit production.
- Per-route fixtures: branch on `route.id`.
- If a provider needs the real module and that module has no web bridge, stub the module in `.native-surface/playground.config.mjs` `aliases`.

## What not to do

- Do not generate stories for every component. Routes only.
- Do not copy Validity's iframe browse UI.
- Do not auto-parse the app. Read the router file and list the screens a user actually tabs between.
