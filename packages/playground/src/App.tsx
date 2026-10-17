import { useEffect, useMemo, useState } from 'react';
import type { ReactElement } from 'react';
import { rawSources, sourceEndpoint } from 'virtual:host-stories';
import { storyPadding } from 'virtual:playground-config';
import { loadStoryIndex } from './registry';
import type { StoryIndex } from './registry';
import { publishShootError, publishShootIndex, shootParams } from './shoot-mode';
import { endpointSources, globSources } from './sources';
import { Playground } from './ui/Playground';

/** The standalone tool: loads the host's (or the demo) stories and renders the playground full-window. */
export function App(): ReactElement {
  const [index, setIndex] = useState<StoryIndex | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Read once: shoot mode is a page-load decision (the query string never
  // changes without a full navigation).
  const shoot = useMemo(shootParams, []);
  const sources = useMemo(
    () => (rawSources ? globSources(rawSources) : sourceEndpoint ? endpointSources(sourceEndpoint) : undefined),
    []
  );

  useEffect(() => {
    let live = true;
    loadStoryIndex().then(
      (loaded) => {
        if (live) setIndex(loaded);
        if (shoot.enabled) publishShootIndex(loaded);
      },
      (error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        if (live) setLoadError(message);
        if (shoot.enabled) publishShootError(message);
      }
    );
    return () => {
      live = false;
    };
  }, [shoot]);

  if (loadError) return <div className="app-message">Failed to load stories: {loadError}</div>;
  if (!index) return <div className="app-message">Loading stories…</div>;
  return (
    <Playground
      index={index}
      className="nsp--app"
      sources={sources}
      hash
      keyboard
      devTools
      audit
      gutter={storyPadding}
      planeHref="/plane"
      shoot={shoot}
    />
  );
}
