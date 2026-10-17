import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import type { ReactElement } from 'react';
import { buildIndex } from '../src/csf';
import { applyStory, bindActions, buildFields, flip, matchStory, schemeArg, schemeOfStory } from '../src/fields';
import { filterItems, toItems } from '../src/items';
import { componentNames, pickComponentPath } from '../src/sources';
import { usageLines } from '../src/usage';
import { DEFAULT_VIEWPORT, IPHONES } from '../src/viewports';
// @ts-expect-error untyped internal module
import { findDeclaringFile, pickComponentPath as serverPick, sourcePlugin } from '../src/server/plugins.mjs';

const Card = (props: { title?: string }): ReactElement => createElement('div', null, props.title);
const Screen = (): ReactElement => createElement('div');

const episode = { guid: 'lfr-314', title: 'LFR 314', pubDate: '2023-07-13', duration: '47:02', enclosure: { url: 'x' } };

function index() {
  const modules = new Map<string, Record<string, unknown>>([
    [
      'src/stories/EpisodeCard.stories.tsx',
      {
        default: { title: 'Components/EpisodeCard', component: Card, args: { episode, isFavorite: false, onPressFavorite: () => {} }, argTypes: { episode: { control: 'json' } }, order: ['Default', 'Favorited', 'Pressed', 'Dark'] },
        Default: {},
        Favorited: { args: { isFavorite: true } },
        Pressed: { args: { pressed: true } },
        Dark: { parameters: { colorScheme: 'dark' } },
      },
    ],
    ['src/stories/Welcome.stories.tsx', { default: { title: 'Screens/WelcomeScreen', component: Screen, args: { theme: 'light' } }, Default: {} }],
  ]);
  return toItems(buildIndex(modules, new Map(), 'host'));
}

describe('items', () => {
  it('splits components and screens, with layouts and paths', () => {
    const items = index();
    expect(items.components.map((i) => i.name)).toEqual(['EpisodeCard']);
    expect(items.screens.map((i) => i.name)).toEqual(['WelcomeScreen']);
    expect(items.screens[0]!.parameters.layout).toBe('fullscreen');
    expect(items.components[0]!.parameters.layout).toBe('padded');
    expect(items.components[0]!.path).toBe('src/stories/EpisodeCard.stories.tsx');
    expect(filterItems(items.all, 'welc').map((i) => i.name)).toEqual(['WelcomeScreen']);
    expect(filterItems(items.all, 'favorited').map((i) => i.name)).toEqual(['EpisodeCard']);
  });
});

describe('fields + chips', () => {
  const item = index().components[0]!;
  it('expands a record arg into dotted fields, skipping identity, callbacks and chip-only args', () => {
    const story = item.group.stories.find((s) => s.name === 'Pressed')!;
    const keys = buildFields(item, story, story.args).map((f) => `${f.key}:${f.kind}`);
    expect(keys).toEqual(['episode.title:text', 'episode.pubDate:date', 'episode.duration:text', 'isFavorite:boolean']);
  });
  it('a data chip keeps edits to args it does not own; matchStory tracks the chip', () => {
    const favorited = item.group.stories.find((s) => s.name === 'Favorited')!;
    const edited = { ...item.group.stories[0]!.args, episode: { ...episode, title: 'Edited' } };
    const next = applyStory(item, edited, favorited);
    expect((next.episode as { title: string }).title).toBe('Edited');
    expect(next.isFavorite).toBe(true);
    expect(matchStory(item, next, favorited.id)).toBe(favorited.id);
    expect(matchStory(item, { ...next, isFavorite: false }, favorited.id)).not.toBe(favorited.id);
  });
  it('callbacks log and write back', () => {
    const events: string[] = [];
    let args = item.group.stories[0]!.args;
    const bound = bindActions(item, args, { onPressFavorite: flip('isFavorite') }, (event, apply) => {
      events.push(`${event.name}(${event.payload})`);
      if (apply) args = apply(args);
    });
    (bound.onPressFavorite as () => void)();
    expect(events).toEqual(["onPressFavorite({ guid: 'lfr-314' })"]);
    expect(args.isFavorite).toBe(true);
  });
  it('finds the scheme: a theme arg, or a dark chip', () => {
    expect(schemeArg({ theme: 'dark' })).toBe('theme');
    expect(schemeArg({ theme: 'ocean' })).toBeNull();
    expect(schemeOfStory(item.group.stories.find((s) => s.name === 'Dark')!)).toBe('dark');
    expect(schemeOfStory(item.group.stories[0]!)).toBeNull();
  });
});

describe('usage', () => {
  it('prints props one per line, callbacks last', () => {
    const text = usageLines('Card', { title: 'Hi', count: 2, onPress: () => {} }).map((l) => l.map((t) => t.t).join(''));
    expect(text).toEqual(['<Card', '  title="Hi"', '  count={2}', '  onPress={handlePress}', '/>']);
  });
});

describe('viewports', () => {
  it('defaults to iPhone 16 Pro at true logical points', () => {
    expect(DEFAULT_VIEWPORT).toMatchObject({ id: 'iphone-16-pro', width: 402, height: 874, insets: { top: 62, bottom: 34 }, radius: 62 });
    expect(IPHONES.map((v) => `${v.width}x${v.height}`)).toEqual(['402x874', '440x956', '393x852', '375x667']);
  });
});

describe('sources', () => {
  const paths = [
    'src/stories/EpisodeCard.stories.tsx',
    'app/screens/DemoPodcastListScreen/EpisodeCard.tsx',
    'app/components/EpisodeCard.tsx',
    'app/screens/WelcomeScreen.tsx',
  ];
  it('picks the component file by name, components/ first, never a story file', () => {
    expect(pickComponentPath(paths, ['EpisodeCard'])).toBe('app/components/EpisodeCard.tsx');
    expect(serverPick(paths, ['EpisodeCard'])).toBe('app/components/EpisodeCard.tsx');
    expect(pickComponentPath(paths, ['Nope', 'WelcomeScreen'])).toBe('app/screens/WelcomeScreen.tsx');
    expect(pickComponentPath(paths, ['Nope'])).toBeNull();
  });
  it('names the item before its wrapped component', () => {
    expect(componentNames(index().screens[0]!)).toEqual(['WelcomeScreen', 'Screen']);
  });
  it('the CLI endpoint serves host source files only', async () => {
    const root = mkdtempSync(join(tmpdir(), 'nsp-src-'));
    mkdirSync(join(root, 'src/components'), { recursive: true });
    writeFileSync(join(root, 'src/components/Card.tsx'), 'export const Card = 1;');
    writeFileSync(join(root, 'src/Card.stories.tsx'), 'export default {};');
    writeFileSync(join(root, 'secret.env'), 'nope');
    let handler: (req: { url: string }, res: unknown) => void = () => {};
    sourcePlugin({ hostRoot: root }).configureServer({
      middlewares: { use: (_path: string, fn: typeof handler) => (handler = fn) },
    });
    const call = (url: string): Record<string, unknown> => {
      let body = '';
      handler({ url }, { setHeader: () => {}, end: (b: string) => (body = b) });
      return JSON.parse(body) as Record<string, unknown>;
    };
    const ok = call('?story=src/Card.stories.tsx&names=Card');
    expect(ok.story).toEqual({ file: 'src/Card.stories.tsx', text: 'export default {};' });
    expect(ok.component).toEqual({ file: 'src/components/Card.tsx', text: 'export const Card = 1;' });
    expect(call('?story=../../etc/passwd&names=').story).toBeNull();
    expect(call('?story=secret.env').story).toBeNull();
    writeFileSync(join(root, 'src/components/List.tsx'), 'export function Row() {}\nconst Item = () => null;');
    expect(findDeclaringFile(root, ['src/Card.stories.tsx', 'src/components/List.tsx'], ['Item'])).toBe('src/components/List.tsx');
    expect(call('?names=Row').component).toEqual({ file: 'src/components/List.tsx', text: expect.any(String) });
  });
});
