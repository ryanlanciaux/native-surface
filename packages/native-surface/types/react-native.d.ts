/**
 * Ambient module mapping: makes `import { View } from 'react-native'` typecheck
 * against native-surface's types, mirroring what the Vite preset does at
 * bundle time.
 *
 * Enable it with one line in your app tsconfig (the project that includes your
 * sources — `tsconfig.app.json` in the Vite React template):
 *
 *   { "compilerOptions": { "types": ["native-surface/react-native-types"] } }
 *
 * or, if you prefer not to set the `types` array, one line in any global .d.ts
 * that is part of your project (e.g. `src/vite-env.d.ts`):
 *
 *   /// <reference types="native-surface/react-native-types" />
 *
 * This file must stay a global script (no top-level import/export): that is
 * what makes `declare module` an ambient module *declaration*, which TypeScript
 * consults before node_modules resolution — so it wins even when the real
 * react-native package is also installed (npm pulls it in to satisfy
 * @react-navigation/* peer dependencies).
 */
declare module 'react-native' {
  export * from 'native-surface';
}
