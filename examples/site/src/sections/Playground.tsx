import { useEffect, useState } from 'react';
import { Playground as NativeSurfacePlayground } from '@native-surface/playground/embed';
import type { StoryIndex } from '@native-surface/playground/embed';
import { devices, igniteSources, loadIgniteStories, renderSurface, sheet, urlLabel, usage, writeBack } from '../live/playground';
import { FILLS, ShaderCanvas } from '../shaders';
import './playground.css';

const playgroundUrl = urlLabel('ignite-demo');
/** The canvas dot grid without its cyan centre glow (a neutral lift instead). */
const CANVAS_UNIFORMS = { ...FILLS.playground.uniforms, u_glow: '#3A4150' };

/**
 * Section 03: the native-surface playground itself (packages/playground's
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
      <header className="pg__header">
        <p className="eyebrow">{'03  ·  PLAYGROUND'}</p>
        <h2 className="section-title pg__title" id="pg-title">
          Now try them yourself.
        </h2>
      </header>
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
          canvasBackground={<ShaderCanvas className="shader-fill" {...FILLS.playground} uniforms={CANVAS_UNIFORMS} still />}
        />
      ) : (
        <div className="nsp pg__ide pg__ide--loading" />
      )}
    </section>
  );
}
