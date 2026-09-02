---
name: native-surface
description: >
  Write native-surface playground stories for UI components and add app screens
  to the design plane. Use when the user asks to make stories, add screens to
  the plane, set up native-surface playground, or says "component playground".
---

# native-surface playground

Goal utterance: *“Make stories for all components and add my screens to the design plane.”*

Do that. Do not wrap screens in the real navigator.

## 0. Install (if missing)

Dev deps in the **app** (not this skill):

```sh
npm i -D native-surface@alpha @native-surface/playground@alpha
```

Config at app root, Ignite uses `app/` not `src/`:

```js
// .native-surface/playground.config.mjs
export default {
  stories: ['app/**/*.stories.tsx', 'src/**/*.stories.tsx'],
  port: 5170,
};
```

Run: `npx native-surface playground` → stories at `/`, plane at `/plane`.

## 1. Stories — components only

Colocate `ComponentName.stories.tsx` next to the component.

**Include:** presentational UI (Button, Card, ListItem, Text, Icon, TextField).
**Skip:** navigators, services, stores, theme, i18n, `app.tsx`, hooks, utils, API clients, screen files (screens go on the plane).

CSF3, no extra types package needed:

```tsx
import { Button } from './Button';

export const meta = {
  title: 'Button',
  component: Button,
  args: { text: 'Save', onPress: () => {} },
};

export const Primary = {};
export const Filled = { args: { preset: 'filled' } };
export const Disabled = { args: { disabled: true } };
```

Rules:

- Read the component’s props. Args must be real prop names.
- One file per component. `title` = component name (so Inspect → Show component can match).
- Variants = meaningful visual states (disabled, empty, sizes, presets). Not every boolean combo.
- Functions (`onPress`) belong in `args`; the playground logs them as actions.
- `argTypes: { foo: { options: ['a', 'b'] } }` for enums.
- No `play`, `loaders`, `globals`.
- If a native module is unbridged, leave the story; the playground shows “Not bridged yet” instead of crashing.

## 2. Design plane — screens

Files:

```
.native-surface/plane.tsx
.native-surface/wrapper.tsx
```

`plane.tsx` — **screens**, grouped by screen, variants in one row:

```tsx
import { WelcomeScreen } from '../app/screens/WelcomeScreen';
import { LoginScreen } from '../app/screens/LoginScreen';

export const routes = [
  { id: 'welcome', title: 'Default', group: 'Welcome', component: WelcomeScreen },
  { id: 'login', title: 'Default', group: 'Login', component: LoginScreen },
  { id: 'login-error', title: 'Error', group: 'Login', component: LoginScreen, props: { /* seeded error */ } },
];
```

Rules:

- One frame = one screen instance. No `NavigationContainer`, no tabs/stack around it.
- `group` = screen name. `title` = variant (Default, No data, Error, Loading) when those states exist in props or a small wrapper.
- If empty/error/loading is not a prop, a tiny wrapper in `plane.tsx` that hardcodes the fixture is fine. Do not edit production screen APIs just for the plane.
- `id` is unique. Put the same string as `testID` on in-screen nav targets if shift-click jump should work.
- Prefer the app’s main tabs/stack screens (3–8). Skip debug/demo screens unless asked.
- Ignite: `app/screens/*Screen.tsx`. Expo Router: route files under `app/` that render a screen component.

`wrapper.tsx` — fake the world:

```tsx
export function Wrapper({ children, route }) {
  return children;
}
```

Replace `children` with the app’s providers (theme, safe area, i18n) using **mocked** auth/query values. Seed logged-in vs logged-out via `route.id`. Do not call production APIs.

## 3. Done

- Stories render at `/`.
- `/plane` shows screen groups; off-screen frames stay unmounted.
- Inspect a Button on a screen → **Show Button** jumps to `/#/story/button--…` when a Button story exists.

If something has no web bridge, say so and point at the Audit panel. Do not stub a fake DOM Button.