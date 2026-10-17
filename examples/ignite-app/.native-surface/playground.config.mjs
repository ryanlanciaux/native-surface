// `npx native-surface playground` from examples/ignite-app: the CSF stories
// of the generated Ignite app. `@/` / `@assets/` come from tsconfig paths.
export default {
  stories: ['src/stories/*.stories.tsx'],
  // The Api class's transport: the bundled React Native Radio feed, no network.
  aliases: { apisauce: './src/adapter/apisauce-fixture.ts' },
};
