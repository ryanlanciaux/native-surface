import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import type { ReactElement } from 'react';
import { buildGroup, buildIndex, composeStory, titleFromPath } from '../src/csf';
import type { StoryEntry } from '../src/csf';
import type { Args, Decorator, StoryContext } from '../src/story-types';

const Button = (props: { label?: string }): ReactElement => createElement('button', null, props.label);

const context = (entry: StoryEntry, args: Args = {}): StoryContext => ({
  id: entry.id,
  title: entry.title,
  name: entry.name,
  args,
  theme: 'ios',
});

function group(mod: Record<string, unknown>, path = 'src/Button.stories.tsx') {
  const result = buildGroup(path, mod);
  if (!result) throw new Error('expected a group');
  return result;
}

describe('CSF forms', () => {
  it('renders `<meta.component {...args}/>` for plain args stories', () => {
    const g = group({ default: { title: 'Button', component: Button }, Primary: { args: { label: 'hi' } } });
    const entry = g.stories[0]!;
    const element = composeStory(entry, entry.args, context(entry));
    expect(element.type).toBe(Button);
    expect((element.props as { label: string }).label).toBe('hi');
  });

  it('treats a function export as the story (function = render)', () => {
    const fn = (args: Args): ReactElement => createElement(Button, { label: String(args.label) });
    const g = group({ default: { title: 'Button' }, Primary: fn });
    const entry = g.stories[0]!;
    const element = composeStory(entry, { label: 'fn' }, context(entry));
    expect(element.type).toBe(Button);
    expect((element.props as { label: string }).label).toBe('fn');
  });

  it('falls back to meta.render when the story has no render source', () => {
    const metaRender = (args: Args): ReactElement => createElement(Button, { label: `meta:${String(args.label)}` });
    const g = group({ default: { title: 'Button', render: metaRender }, Primary: { args: { label: 'x' } } });
    const entry = g.stories[0]!;
    const element = composeStory(entry, entry.args, context(entry));
    expect((element.props as { label: string }).label).toBe('meta:x');
  });

  it('story.render wins over meta.render', () => {
    const g = group({
      default: { title: 'Button', render: () => createElement(Button, { label: 'meta' }) },
      Primary: { render: () => createElement(Button, { label: 'story' }) },
    });
    const entry = g.stories[0]!;
    expect((composeStory(entry, {}, context(entry)).props as { label: string }).label).toBe('story');
  });

  it('honors name overrides: story.name on objects, storyName on functions', () => {
    const fn = Object.assign((): ReactElement => createElement(Button, null), { storyName: 'Fancy Fn' });
    const g = group({
      default: { title: 'Button', component: Button },
      LongExportName: { args: {}, name: 'Renamed' },
      FnStory: fn,
    });
    const names = Object.fromEntries(g.stories.map((s) => [s.exportName, s.name]));
    expect(names.LongExportName).toBe('Renamed');
    expect(names.FnStory).toBe('Fancy Fn');
  });

  it('humanizes export names when no override is given', () => {
    const g = group({ default: { title: 'Button', component: Button }, LongPressState: { args: {} } });
    expect(g.stories[0]!.name).toBe('Long Press State');
  });

  it('composes decorators story-first (innermost), then meta', () => {
    const order: string[] = [];
    const deco =
      (label: string): Decorator =>
      (Story, ctx) => {
        order.push(label);
        return createElement('div', { 'data-deco': label }, Story());
      };
    const g = group({
      default: { title: 'Button', component: Button, decorators: [deco('meta')] },
      Primary: { args: {}, decorators: [deco('story')] },
    });
    const entry = g.stories[0]!;
    const element = composeStory(entry, {}, context(entry));
    // Outermost wrapper runs first: meta, then story, then the base render.
    expect(order).toEqual(['meta', 'story']);
    expect((element.props as { 'data-deco': string })['data-deco']).toBe('meta');
  });

  it('merges parameters (story over meta) and ignores unknown keys', () => {
    const g = group({
      default: { title: 'Button', component: Button, parameters: { a: 1, b: 1, mystery: true } },
      Primary: { args: {}, parameters: { b: 2 } },
    });
    expect(g.stories[0]!.parameters).toEqual({ a: 1, b: 2, mystery: true });
  });

  it('derives the title from the file name when meta has none', () => {
    const g = group({ Primary: () => createElement(Button, null) }, 'src/widgets/FancyCard.play.tsx');
    expect(g.title).toBe('FancyCard');
    expect(titleFromPath('a/b/Thing.stories.ts')).toBe('Thing');
  });

  it('skips exports with no render source and non-story values', () => {
    const g = group({
      default: { title: 'Button' },
      notAStory: 42,
      alsoNot: { args: {} }, // no component/render anywhere
      Real: { render: () => createElement(Button, null) },
    });
    expect(g.stories.map((s) => s.exportName)).toEqual(['Real']);
  });

  it('sorts by meta.order first, then alphabetically', () => {
    const g = group({
      default: { title: 'Button', component: Button, order: ['Zed', 'Alpha'] },
      Alpha: { args: {} },
      Mid: { args: {} },
      Zed: { args: {} },
    });
    expect(g.stories.map((s) => s.exportName)).toEqual(['Zed', 'Alpha', 'Mid']);
  });
});

describe('buildIndex', () => {
  it('turns module load failures into error entries whose render rethrows', () => {
    const boom = new Error('react-native-firebase-fake has no web bridge yet (native-surface)');
    const index = buildIndex(
      new Map([['src/Ok.stories.tsx', { default: { title: 'Ok', component: Button }, One: { args: {} } }]]),
      new Map([['src/Broken.stories.tsx', boom]]),
      'host'
    );
    expect(index.groups.map((g) => g.title)).toEqual(['Broken', 'Ok']);
    const errorEntry = index.allStories.find((s) => s.exportName === 'load-error')!;
    expect(() => composeStory(errorEntry, {}, context(errorEntry))).toThrow(boom.message);
    expect(index.source).toBe('host');
  });
});
