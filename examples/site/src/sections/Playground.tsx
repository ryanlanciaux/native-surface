import { useEffect, useState } from 'react';
import { Playground as NativeSurfacePlayground } from '@native-surface/playground/embed';
import type { StoryIndex } from '@native-surface/playground/embed';
import { devices, igniteSources, loadIgniteStories, renderSurface, sheet, urlLabel, usage, writeBack } from '../live/playground';
import { FILLS, ShaderCanvas } from '../shaders';
import './playground.css';

const playgroundUrl = urlLabel('ignite-demo');

/**
 * Section 04: the native-surface playground itself (packages/playground's
 * embeddable UI, the same component `npx native-surface playground` runs),
 * pointed at ignite-demo's real CSF stories.
 */
export function Playground() {
  const [index, setIndex] = useState<StoryIndex | null>(null);
  useEffect(() => {
    let live = true;
    void loadIgniteStories().then((loaded) => live && setIndex(loaded));
    return () => {
      live = false;
    };
  }, []);

  return (
    <section className="pg" id="playground" aria-labelledby="pg-title">
      <div className="pg__header">
        <div className="pg__copy">
          <p className="eyebrow" style={{ color: '#C4B5FD' }}>
            {'04  ·  PLAYGROUND'}
          </p>
          <h2 className="section-title pg__title" id="pg-title">
            Component playground of your real app components.
          </h2>
        </div>
        <p className="pg__body">
          Right here, on this page. Pick any component from your app, change its props, and watch Yoga and Skia,
          running in WebAssembly, lay it out and repaint it.
        </p>
      </div>
      {index ? (
        <NativeSurfacePlayground
          index={index}
          className="pg__ide"
          sources={igniteSources}
          devices={devices}
          defaultStory="components-episode-card--favorited"
          gutter={24}
          sheet={sheet}
          writeBack={writeBack}
          usage={usage}
          urlLabel={playgroundUrl}
          appName="ignite-demo"
          renderSurface={renderSurface}
          canvasBackground={<ShaderCanvas className="shader-fill" {...FILLS.playground} still />}
        />
      ) : (
        <div className="nsp pg__ide pg__ide--loading" />
      )}
    </section>
  );
}
