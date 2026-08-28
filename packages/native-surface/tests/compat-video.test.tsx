// @vitest-environment jsdom
/**
 * The video compat pack over the DOM-portal seam. Runs under jsdom so real
 * <video> elements are created; the env seam is mocked to the Node loaders
 * (jsdom has a window, so the real module would take the browser wasm path and
 * try to fetch), and the canvas host is faked through the same root-hooks seam
 * the TextInput overlay uses — identical setup to portal-host.test.tsx.
 *
 * jsdom implements no media pipeline: play/pause/load raise "not implemented",
 * canPlayType always answers '' (so the HLS-unsupported path is the default
 * here, which is exactly the path worth testing), and metadata properties read
 * 0/NaN. Playback is therefore observed through prototype spies and metadata is
 * defined per element before the matching event is dispatched.
 */
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/env/index', async () => {
  const { createRequire } = await import('node:module');
  const fs = await import('node:fs');
  const path = await import('node:path');
  const pkgDir = [process.cwd(), path.join(process.cwd(), 'packages/native-surface')].find((d) =>
    fs.existsSync(path.join(d, 'assets/fonts'))
  )!;
  const req = createRequire(path.join(pkgDir, 'package.json'));
  return {
    isNode: true,
    loadCanvasKit: async () => {
      const CanvasKitInit = req('canvaskit-wasm/bin/canvaskit.js') as (opts: {
        wasmBinary: Uint8Array;
      }) => Promise<unknown>;
      const buf = fs.readFileSync(
        req.resolve('canvaskit-wasm/bin/canvaskit.js').replace(/canvaskit\.js$/, 'canvaskit.wasm')
      );
      return CanvasKitInit({ wasmBinary: new Uint8Array(buf) });
    },
    loadDefaultFonts: async () => {
      const entries: Array<[string, number]> = [
        ['Inter-Regular.otf', 400],
        ['Inter-Medium.otf', 500],
        ['Inter-SemiBold.otf', 600],
        ['Inter-Bold.otf', 700],
      ];
      return entries.map(([file, weight]) => {
        const buf = fs.readFileSync(path.join(pkgDir, 'assets/fonts', file));
        return { family: 'Inter', data: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), weight };
      });
    },
    scheduleFrame: (cb: () => void) => {
      const id = setTimeout(cb, 0);
      return () => clearTimeout(id);
    },
    now: () => Date.now(),
  };
});

import { View } from '../src/components/primitives';
import {
  clearVideoCacheAsync,
  createLoopingVideoView,
  createNativeVideoView,
  createPortalVideoView,
  createVideoModule,
  createVideoPlayer,
  getActivePortalVideo,
  getCurrentVideoCacheSize,
  getRegisteredVideos,
  isPictureInPictureSupported,
  setHlsLoader,
  setVideoCacheSizeAsync,
  toObjectFit,
  useVideoPlayer,
  VideoAirPlayButton,
  VideoView,
} from '../../compat/src/video';
import type {
  HlsAttachContext,
  LoopingVideoViewHandle,
  LoopingVideoViewProps,
  NativeVideoViewHandle,
  NativeVideoViewProps,
  PortalVideoErrorEvent,
  PortalVideoHandle,
  PortalVideoLoadEvent,
  PortalVideoProgressEvent,
  PortalVideoStatus,
  StatusChangeEventPayload,
  TimeUpdateEventPayload,
  VideoPlayer,
} from '../../compat/src/video';
import type { NativeRoot } from '../src/types';
import { asImpl, createTestRoot } from './helpers';

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Point the root's overlay host at a jsdom canvas with a real screen box. */
function withDomHost(root: NativeRoot, width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.getBoundingClientRect = () =>
    ({ x: 0, y: 0, left: 0, top: 0, right: width, bottom: height, width, height, toJSON: () => ({}) }) as DOMRect;
  (asImpl(root) as any).getInputHost = () => ({ canvas, cssWidth: width, cssHeight: height });
  return canvas;
}

const playCalls: HTMLVideoElement[] = [];
const pauseCalls: HTMLVideoElement[] = [];

/** Media metadata jsdom never produces; define it before dispatching its event. */
function defineMedia(el: HTMLVideoElement, values: Record<string, unknown>): void {
  for (const [name, value] of Object.entries(values)) {
    Object.defineProperty(el, name, { value, configurable: true });
  }
}

/** jsdom's currentTime is inert; make it a real readable/writable slot. */
function trackCurrentTime(el: HTMLVideoElement): () => number {
  let time = 0;
  Object.defineProperty(el, 'currentTime', {
    get: () => time,
    set: (value: number) => {
      time = value;
    },
    configurable: true,
  });
  return () => time;
}

/** Place a portal element in (or out of) the jsdom viewport for the geometry pick. */
function placeOnScreen(el: HTMLElement, onScreen: boolean): void {
  const top = onScreen ? 0 : window.innerHeight + 500;
  el.getBoundingClientRect = () =>
    ({
      x: 0,
      y: top,
      left: 0,
      top,
      right: 300,
      bottom: top + 200,
      width: 300,
      height: 200,
      toJSON: () => ({}),
    }) as DOMRect;
}

let root: NativeRoot | null = null;

beforeEach(() => {
  playCalls.length = 0;
  pauseCalls.length = 0;
  vi.spyOn(window.HTMLMediaElement.prototype, 'play').mockImplementation(function (this: HTMLMediaElement) {
    playCalls.push(this as HTMLVideoElement);
    return Promise.resolve();
  });
  vi.spyOn(window.HTMLMediaElement.prototype, 'pause').mockImplementation(function (this: HTMLMediaElement) {
    pauseCalls.push(this as HTMLVideoElement);
  });
  vi.spyOn(window.HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
});

afterEach(() => {
  root?.unmount();
  root = null;
  setHlsLoader(null);
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

const MP4 = 'https://cdn.example/clip.mp4';
const HLS = 'https://video.example/did:plc:abc/playlist.m3u8';

describe('portal video primitive', () => {
  it('renders a <video> portal at the node frame with the mapped attributes', async () => {
    root = createTestRoot(320, 180);
    withDomHost(root, 320, 180);
    const Video = createPortalVideoView({ name: 'spec' });
    root.render(
      <Video uri={MP4} poster="https://cdn.example/poster.jpg" muted loop style={{ width: 320, height: 180 }} />
    );
    await root.flush();

    const el = document.querySelector('video')!;
    expect(el).toBeTruthy();
    expect(el.tagName).toBe('VIDEO');
    expect(el.getAttribute('data-ns-video')).toMatch(/^nsv-\d+$/);
    // playsInline is never optional: iOS Safari otherwise takes over the screen
    expect(el.hasAttribute('playsinline')).toBe(true);
    expect(el.playsInline).toBe(true);
    expect(el.getAttribute('poster')).toBe('https://cdn.example/poster.jpg');
    expect(el.hasAttribute('loop')).toBe(true);
    expect(el.hasAttribute('muted')).toBe(true);
    expect(el.muted).toBe(true);
    expect(el.hasAttribute('controls')).toBe(false);
    // src is applied imperatively, not through the portal attrs: that is where
    // the HLS decision lives
    expect(el.getAttribute('src')).toBe(MP4);

    expect(el.style.position).toBe('fixed');
    expect(el.style.left).toBe('0px');
    expect(el.style.width).toBe('320px');
    expect(el.style.height).toBe('180px');
    // no native controls → taps must fall through to the canvas underneath
    expect(el.style.pointerEvents).toBe('none');
  });

  it('native controls make the element interactive', async () => {
    root = createTestRoot(200, 120);
    withDomHost(root, 200, 120);
    const Video = createPortalVideoView({ name: 'controls' });
    root.render(<Video uri={MP4} controls style={{ width: 200, height: 120 }} />);
    await root.flush();

    const el = document.querySelector('video')!;
    expect(el.hasAttribute('controls')).toBe(true);
    expect(el.style.pointerEvents).toBe('auto');
  });

  it('maps contentFit and RN legacy resizeMode names onto object-fit', async () => {
    root = createTestRoot(200, 200);
    withDomHost(root, 200, 200);
    const Video = createPortalVideoView({ name: 'fit' });

    const cases: Array<[Record<string, string>, string]> = [
      [{}, 'contain'],
      [{ contentFit: 'cover' }, 'cover'],
      [{ contentFit: 'contain' }, 'contain'],
      [{ contentFit: 'fill' }, 'fill'],
      [{ contentFit: 'none' }, 'none'],
      [{ contentFit: 'scale-down' }, 'scale-down'],
      // react-native's spellings
      [{ resizeMode: 'stretch' }, 'fill'],
      [{ resizeMode: 'center' }, 'none'],
      [{ resizeMode: 'cover' }, 'cover'],
      [{ resizeMode: 'contain' }, 'contain'],
    ];

    for (const [props, expected] of cases) {
      root.render(<Video uri={MP4} {...props} style={{ width: 200, height: 200 }} />);
      await root.flush();
      expect(document.querySelector('video')!.style.objectFit).toBe(expected);
    }

    // contentFit wins when an app passes both
    root.render(<Video uri={MP4} contentFit="cover" resizeMode="contain" style={{ width: 200, height: 200 }} />);
    await root.flush();
    expect(document.querySelector('video')!.style.objectFit).toBe('cover');

    // and the pure mapper agrees, including the unknown-value fallback
    expect(toObjectFit('stretch')).toBe('fill');
    expect(toObjectFit('center')).toBe('none');
    expect(toObjectFit('nonsense', 'cover')).toBe('cover');
    expect(toObjectFit(undefined)).toBe('contain');
  });

  it('imperative play/pause/seek/volume reach the element', async () => {
    root = createTestRoot(200, 120);
    withDomHost(root, 200, 120);
    const Video = createPortalVideoView({ name: 'imperative' });
    const ref = React.createRef<PortalVideoHandle>();
    root.render(<Video ref={ref} uri={MP4} style={{ width: 200, height: 120 }} />);
    await root.flush();

    const el = document.querySelector('video')!;
    const currentTime = trackCurrentTime(el);
    defineMedia(el, { duration: 42 });
    expect(ref.current!.element).toBe(el);

    await ref.current!.play();
    expect(playCalls).toContain(el);

    ref.current!.pause();
    expect(pauseCalls).toContain(el);

    ref.current!.seekTo(12.5);
    expect(currentTime()).toBe(12.5);
    expect(ref.current!.currentTime).toBe(12.5);

    ref.current!.seekBy(-2.5);
    expect(currentTime()).toBe(10);

    // expo-av's spelling takes MILLISECONDS
    await ref.current!.setPositionAsync(3000);
    expect(currentTime()).toBe(3);

    ref.current!.setVolume(0.25);
    expect(el.volume).toBe(0.25);
    ref.current!.setMuted(true);
    expect(el.muted).toBe(true);
    ref.current!.toggleMuted();
    expect(el.muted).toBe(false);
    expect(ref.current!.duration).toBe(42);
  });

  it('forwards element events to RN-style callbacks, with throttled progress', async () => {
    root = createTestRoot(200, 120);
    withDomHost(root, 200, 120);
    const Video = createPortalVideoView({ name: 'events' });
    const loads: PortalVideoLoadEvent[] = [];
    const progress: PortalVideoProgressEvent[] = [];
    const statuses: PortalVideoStatus[] = [];
    const ends: number[] = [];
    const playing: boolean[] = [];

    root.render(
      <Video
        uri={MP4}
        style={{ width: 200, height: 120 }}
        onLoad={(e) => loads.push(e)}
        onProgress={(e) => progress.push(e)}
        onPlaybackStatusUpdate={(s) => statuses.push(s)}
        onPlayingChange={(e) => playing.push(e.isPlaying)}
        onEnd={() => ends.push(1)}
      />
    );
    await root.flush();

    const el = document.querySelector('video')!;
    const currentTime = trackCurrentTime(el);
    void currentTime;
    defineMedia(el, { videoWidth: 1280, videoHeight: 720, duration: 42 });

    el.dispatchEvent(new Event('loadedmetadata'));
    expect(loads).toHaveLength(1);
    expect(loads[0]!.naturalSize).toEqual({ width: 1280, height: 720, orientation: 'landscape' });
    expect(loads[0]!.duration).toBe(42);
    expect(loads[0]!.uri).toBe(MP4);

    el.dispatchEvent(new Event('canplay'));
    expect(statuses.at(-1)!.status).toBe('readyToPlay');
    expect(statuses.at(-1)!.isLoaded).toBe(true);
    expect(statuses.at(-1)!.durationMillis).toBe(42000);

    el.dispatchEvent(new Event('play'));
    expect(playing).toEqual([true]);

    el.currentTime = 5;
    el.dispatchEvent(new Event('timeupdate'));
    expect(progress).toHaveLength(1);
    expect(progress[0]!.currentTime).toBe(5);
    expect(progress[0]!.seekableDuration).toBe(42);
    // a second tick inside the throttle window is dropped (timeupdate is ~4Hz)
    el.currentTime = 5.25;
    el.dispatchEvent(new Event('timeupdate'));
    expect(progress).toHaveLength(1);

    el.dispatchEvent(new Event('ended'));
    expect(ends).toHaveLength(1);
    expect(playing).toEqual([true, false]);
    expect(statuses.at(-1)!.didJustFinish).toBe(true);

    // a portrait source reports the orientation the RN shape carries
    defineMedia(el, { videoWidth: 720, videoHeight: 1280 });
    el.dispatchEvent(new Event('loadedmetadata'));
    expect(loads.at(-1)!.naturalSize.orientation).toBe('portrait');
  });

  it('reports a media error through onError', async () => {
    root = createTestRoot(200, 120);
    withDomHost(root, 200, 120);
    const Video = createPortalVideoView({ name: 'error' });
    const errors: PortalVideoErrorEvent[] = [];
    root.render(<Video uri={MP4} style={{ width: 200, height: 120 }} onError={(e) => errors.push(e)} />);
    await root.flush();

    const el = document.querySelector('video')!;
    defineMedia(el, { error: { code: 2, message: 'boom' } });
    el.dispatchEvent(new Event('error'));
    expect(errors).toHaveLength(1);
    expect(errors[0]!.error.code).toBe(2);
    expect(errors[0]!.message).toContain('network error');
  });
});

describe('HLS', () => {
  it('reports unsupported HLS through onError instead of failing silently', async () => {
    root = createTestRoot(320, 180);
    withDomHost(root, 320, 180);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const Video = createPortalVideoView({ name: 'hls-unsupported' });
    const errors: PortalVideoErrorEvent[] = [];

    root.render(<Video uri={HLS} style={{ width: 320, height: 180 }} onError={(e) => errors.push(e)} />);
    await root.flush();

    const el = document.querySelector('video')!;
    // jsdom, like Chromium, cannot demux .m3u8
    expect(el.canPlayType('application/vnd.apple.mpegurl')).toBe('');
    // the src is deliberately NOT set: a silent stall is the worst failure
    expect(el.hasAttribute('src')).toBe(false);

    expect(errors).toHaveLength(1);
    expect(errors[0]!.message).toContain('HLS');
    expect(errors[0]!.message).toContain('setHlsLoader');
    expect(errors[0]!.error.code).toBe(4); // MEDIA_ERR_SRC_NOT_SUPPORTED
    expect(warn.mock.calls.some((call) => String(call[0]).includes('setHlsLoader'))).toBe(true);
  });

  it('hands the element to a host-supplied hlsLoader and tears it down', async () => {
    root = createTestRoot(320, 180);
    withDomHost(root, 320, 180);
    const contexts: HlsAttachContext[] = [];
    let detached = 0;
    setHlsLoader((ctx) => {
      contexts.push(ctx);
      ctx.video.setAttribute('data-hls', 'attached');
      return () => {
        detached += 1;
      };
    });

    const Video = createPortalVideoView({ name: 'hls-loader' });
    const errors: PortalVideoErrorEvent[] = [];
    const app = (mounted: boolean) => (
      <View style={{ width: 320, height: 180 }}>
        {mounted ? <Video uri={HLS} autoPlay onError={(e) => errors.push(e)} /> : null}
      </View>
    );

    root.render(app(true));
    await root.flush();
    await Promise.resolve(); // the loader result is adopted on a microtask

    const el = document.querySelector('video')!;
    expect(contexts).toHaveLength(1);
    expect(contexts[0]!.uri).toBe(HLS);
    expect(contexts[0]!.video).toBe(el);
    expect(contexts[0]!.autoPlay).toBe(true);
    expect(el.getAttribute('data-hls')).toBe('attached');
    expect(el.hasAttribute('src')).toBe(false); // the loader owns the buffer
    expect(errors).toHaveLength(0);

    root.render(app(false));
    await root.flush();
    expect(detached).toBe(1);
  });
});

describe('single-active arbitration', () => {
  it('activating a video pauses the others and unmounting deregisters it', async () => {
    root = createTestRoot(300, 400);
    withDomHost(root, 300, 400);
    const A = createPortalVideoView({ name: 'arb-a' });
    const B = createPortalVideoView({ name: 'arb-b' });
    const refA = React.createRef<PortalVideoHandle>();
    const refB = React.createRef<PortalVideoHandle>();
    const activeA: boolean[] = [];
    const activeB: boolean[] = [];

    // The wrapper is sized: the video container is `flex: 1` (RN's own
    // convention for these wrappers), so it measures 0 inside an unsized parent.
    const app = (withB: boolean) => (
      <View style={{ width: 300, height: 400 }}>
        <A ref={refA} uri={MP4} onActiveChange={(e) => activeA.push(e.isActive)} />
        {withB ? (
          <B
            ref={refB}
            uri="https://cdn.example/other.mp4"
            onActiveChange={(e) => activeB.push(e.isActive)}
          />
        ) : null}
      </View>
    );

    root.render(app(true));
    await root.flush();

    const names = () => getRegisteredVideos().map((v) => v.name);
    expect(names()).toContain('arb-a');
    expect(names()).toContain('arb-b');

    const [elA, elB] = [...document.querySelectorAll('video')] as HTMLVideoElement[];
    expect(elA).toBeTruthy();
    expect(elB).toBeTruthy();

    await refA.current!.play();
    expect(getActivePortalVideo()!.name).toBe('arb-a');
    expect(activeA).toEqual([true]);

    pauseCalls.length = 0;
    await refB.current!.play();
    expect(getActivePortalVideo()!.name).toBe('arb-b');
    // activating the second paused the first
    expect(pauseCalls).toContain(elA!);
    expect(activeA).toEqual([true, false]);
    expect(activeB).toEqual([true]);
    expect(playCalls).toContain(elB!);

    // unmounting the active video deregisters it and vacates the slot
    root.render(app(false));
    await root.flush();
    expect(names()).toContain('arb-a');
    expect(names()).not.toContain('arb-b');
    expect(getActivePortalVideo()).toBeNull();

    // and it is never touched again
    pauseCalls.length = 0;
    await refA.current!.play();
    expect(getActivePortalVideo()!.name).toBe('arb-a');
    expect(pauseCalls).not.toContain(elB!);
  });

  it('updateActiveVideoViewAsync hands the slot to the most visible video', async () => {
    root = createTestRoot(300, 400);
    withDomHost(root, 300, 400);
    const A = createPortalVideoView({ name: 'vis-a' });
    const B = createPortalVideoView({ name: 'vis-b' });
    root.render(
      <View style={{ width: 300, height: 400 }}>
        <A uri={MP4} autoPlay />
        <B uri="https://cdn.example/other.mp4" autoPlay />
      </View>
    );
    await root.flush();

    const [elA, elB] = [...document.querySelectorAll('video')] as HTMLVideoElement[];
    placeOnScreen(elA!, false);
    placeOnScreen(elB!, true);

    const module = createVideoModule();
    playCalls.length = 0;
    pauseCalls.length = 0;
    await module.updateActiveVideoViewAsync();

    expect(getActivePortalVideo()!.name).toBe('vis-b');
    expect(playCalls).toContain(elB!);
    expect(pauseCalls).toContain(elA!);

    const current = await module.getCurrentVideoAsync();
    expect(current!.name).toBe('vis-b');
    expect(current!.uri).toBe('https://cdn.example/other.mp4');

    pauseCalls.length = 0;
    await module.pauseAsync();
    expect(pauseCalls).toContain(elB!);

    // nothing on screen → nothing plays
    placeOnScreen(elB!, false);
    await module.updateActiveVideoViewAsync();
    expect(getActivePortalVideo()).toBeNull();
  });
});

describe('named-registry video views', () => {
  const NativeVideo = createNativeVideoView({ name: 'BlueskyVideo' }) as unknown as React.FC<
    NativeVideoViewProps & { ref?: React.Ref<NativeVideoViewHandle> }
  >;

  it('accepts the native player prop shape and exposes its imperative methods', async () => {
    root = createTestRoot(300, 200);
    withDomHost(root, 300, 200);
    const statuses: string[] = [];
    const muted: boolean[] = [];
    const times: number[] = [];
    const errors: string[] = [];
    const ref = React.createRef<NativeVideoViewHandle>();

    root.render(
      <NativeVideo
        ref={ref}
        url={MP4}
        autoplay
        beginMuted
        accessibilityLabel="Video"
        style={{ width: 300, height: 200 }}
        onStatusChange={(e) => statuses.push(e.nativeEvent.status)}
        onMutedChange={(e) => muted.push(e.nativeEvent.isMuted)}
        onTimeRemainingChange={(e) => times.push(e.nativeEvent.timeRemaining)}
        onError={(e) => errors.push(e.nativeEvent.error)}
      />
    );
    await root.flush();

    const el = document.querySelector('video')!;
    expect(el.getAttribute('src')).toBe(MP4);
    expect(el.muted).toBe(true);
    expect(el.getAttribute('aria-label')).toBe('Video');
    expect(el.hasAttribute('controls')).toBe(false);
    // the native players this stands in for loop unconditionally
    expect(el.hasAttribute('loop')).toBe(true);
    // autoplay attempted on attach
    expect(playCalls).toContain(el);

    trackCurrentTime(el);
    defineMedia(el, { duration: 30 });

    el.dispatchEvent(new Event('play'));
    expect(statuses).toEqual(['playing']);
    el.dispatchEvent(new Event('pause'));
    expect(statuses).toEqual(['playing', 'paused']);

    // beginMuted already produced a volumechange; toggling reports the new value
    expect(muted.at(-1)).toBe(true);
    ref.current!.toggleMuted();
    expect(el.muted).toBe(false);
    expect(muted.at(-1)).toBe(false);

    el.currentTime = 12;
    el.dispatchEvent(new Event('timeupdate'));
    expect(times).toEqual([18]);

    pauseCalls.length = 0;
    ref.current!.togglePlayback();
    expect(playCalls.filter((e) => e === el).length).toBeGreaterThan(1);

    defineMedia(el, { error: { code: 3, message: 'bad frame' } });
    el.dispatchEvent(new Event('error'));
    expect(errors[0]).toContain('decode error');
  });

  it('the looping (GIF) view is muted, looping, autoplaying and stays out of arbitration', async () => {
    root = createTestRoot(200, 200);
    withDomHost(root, 200, 200);
    const Looping = createLoopingVideoView({ name: 'ExpoBlueskyGifView' }) as unknown as React.FC<
      LoopingVideoViewProps & { ref?: React.Ref<LoopingVideoViewHandle> }
    >;
    const states: Array<{ isPlaying: boolean; isLoaded: boolean }> = [];

    root.render(
      <Looping
        sources={[
          { src: 'https://cdn.example/gif.webm', type: 'video/webm' },
          { src: 'https://cdn.example/gif.mp4', type: 'video/mp4' },
        ]}
        placeholderSource="https://cdn.example/still.jpg"
        style={{ width: 200, height: 200 }}
        onPlayerStateChange={(e) => states.push(e.nativeEvent)}
      />
    );
    await root.flush();

    const el = document.querySelector('video')!;
    expect(el.hasAttribute('loop')).toBe(true);
    expect(el.muted).toBe(true);
    expect(el.getAttribute('poster')).toBe('https://cdn.example/still.jpg');
    // jsdom's canPlayType answers '' for everything, so the first candidate wins
    expect(el.getAttribute('src')).toBe('https://cdn.example/gif.webm');
    expect(playCalls).toContain(el);

    expect(getRegisteredVideos().find((v) => v.name === 'ExpoBlueskyGifView')).toBeTruthy();

    el.dispatchEvent(new Event('loadeddata'));
    expect(states.at(-1)!.isLoaded).toBe(true);

    // a GIF loop must not be stopped by (or stop) the feed's video
    const Other = createPortalVideoView({ name: 'gif-neighbour' });
    const otherRef = React.createRef<PortalVideoHandle>();
    root.render(
      <View style={{ width: 200, height: 200 }}>
        <Looping sources={[{ src: 'https://cdn.example/gif.webm', type: 'video/webm' }]} />
        <Other ref={otherRef} uri={MP4} />
      </View>
    );
    await root.flush();
    const gifEl = document.querySelectorAll('video')[0] as HTMLVideoElement;
    pauseCalls.length = 0;
    await otherRef.current!.play();
    expect(pauseCalls).not.toContain(gifEl);
  });
});

describe('expo-video shim', () => {
  it('exports the SDK 57 named surface', () => {
    expect(typeof useVideoPlayer).toBe('function');
    expect(typeof createVideoPlayer).toBe('function');
    expect(typeof isPictureInPictureSupported).toBe('function');
    expect(typeof clearVideoCacheAsync).toBe('function');
    expect(typeof setVideoCacheSizeAsync).toBe('function');
    expect(getCurrentVideoCacheSize()).toBe(0);
    expect(typeof VideoAirPlayButton).toBe('function');
    expect(typeof VideoView).toBe('function');
    // jsdom exposes no PiP API, so the capability query answers honestly
    expect(isPictureInPictureSupported()).toBe(false);
  });

  it('a player with no view holds intent, and a mounted VideoView binds it to the element', async () => {
    root = createTestRoot(300, 200);
    withDomHost(root, 300, 200);
    let player: VideoPlayer | null = null;
    const statusEvents: StatusChangeEventPayload[] = [];
    const timeEvents: TimeUpdateEventPayload[] = [];
    const playingEvents: boolean[] = [];

    function Screen(): React.ReactElement {
      const p = useVideoPlayer(MP4, (instance) => {
        instance.loop = true;
        instance.muted = true;
        instance.timeUpdateEventInterval = 0.001;
      });
      player = p;
      React.useEffect(() => {
        const subs = [
          p.addListener('statusChange', (e) => statusEvents.push(e)),
          p.addListener('timeUpdate', (e) => timeEvents.push(e)),
          p.addListener('playingChange', (e) => playingEvents.push(e.isPlaying)),
        ];
        return () => subs.forEach((s) => s.remove());
      }, [p]);
      return <VideoView player={p} nativeControls={false} contentFit="cover" style={{ width: 300, height: 200 }} />;
    }

    root.render(<Screen />);
    await root.flush();

    const el = document.querySelector('video')!;
    expect(el.getAttribute('src')).toBe(MP4);
    expect(el.style.objectFit).toBe('cover');
    // the player's intent was applied to the element it bound to
    expect(el.loop).toBe(true);
    expect(el.muted).toBe(true);

    trackCurrentTime(el);
    defineMedia(el, { duration: 60 });

    player!.play();
    expect(playCalls).toContain(el);
    el.dispatchEvent(new Event('play'));
    expect(playingEvents).toEqual([true]);
    expect(player!.playing).toBe(true);

    el.dispatchEvent(new Event('canplay'));
    expect(player!.status).toBe('readyToPlay');
    expect(statusEvents.at(-1)!.status).toBe('readyToPlay');

    el.dispatchEvent(new Event('durationchange'));
    expect(player!.duration).toBe(60);

    el.currentTime = 7;
    el.dispatchEvent(new Event('timeupdate'));
    expect(timeEvents.at(-1)!.currentTime).toBe(7);

    player!.seekBy(3);
    expect(player!.currentTime).toBe(10);

    // replace() goes back through render so the HLS decision is remade for the
    // new source (two flushes: one for React's scheduled re-render, one to
    // commit and re-sync the portal)
    player!.replace('https://cdn.example/next.mp4');
    expect(player!.source!.uri).toBe('https://cdn.example/next.mp4');
    await root.flush();
    await root.flush();
    expect(document.querySelector('video')!.getAttribute('src')).toBe('https://cdn.example/next.mp4');
  });

  it('createVideoPlayer tolerates an empty source and queues playback intent', () => {
    const player = createVideoPlayer('');
    expect(player.source).toBeNull();
    expect(player.status).toBe('idle');
    expect(player.duration).toBe(0);
    // no view is bound; play() must record intent rather than throw
    player.play();
    expect(player.playing).toBe(false);
    player.loop = true;
    expect(player.loop).toBe(true);
    player.release();
  });
});
