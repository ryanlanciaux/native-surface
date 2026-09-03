import { describe, expect, it } from 'vitest';
import { matchStory, matchStoryFromPath, type StoryRef } from '../src/stories';

const button: StoryRef = { id: 'button--default', group: 'Button', name: 'Default' };
const catalog = [button];

describe('matchStory', () => {
  it('matches a catalog title and ignores unmatched primitives', () => {
    expect(matchStory('Button', catalog)).toEqual(button);
    expect(matchStory('Pressable', catalog)).toBeNull();
  });

  it('matches Pressable only when that story exists', () => {
    const withPressable: StoryRef = { id: 'pressable--default', group: 'Pressable', name: 'Default' };
    expect(matchStory('Pressable', [...catalog, withPressable])).toEqual(withPressable);
  });
});

describe('matchStoryFromPath', () => {
  it('prefers the selected host type so Show Text still wins over Button', () => {
    const text: StoryRef = { id: 'text--default', group: 'Text', name: 'Default' };
    const path = [
      { type: 'View', name: 'Screen' },
      { type: 'View', name: 'Button' },
      { type: 'Text', name: 'Button' },
    ];
    expect(matchStoryFromPath(path, [button, text])?.group).toBe('Text');
    expect(matchStoryFromPath(path.slice(0, 2), [button, text])?.group).toBe('Button');
    expect(matchStoryFromPath(path, catalog)?.group).toBe('Button');
  });
});
