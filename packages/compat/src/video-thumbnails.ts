/**
 * expo-video-thumbnails compat — a separate alias target for a one-function
 * package, backed by the frame grabber in ./video.
 *
 * The mechanism is a detached `<video>` seeked to the requested time and drawn
 * into a `<canvas>`; the result is an object URL, which `Image`/`expo-image`
 * accept as a source like any other uri. Ceilings live with the implementation
 * in ./video (grabVideoFrame): the source must be CORS-readable or the canvas
 * is tainted and export throws, and an HLS source needs the media-source player
 * installed with setHlsLoader().
 */
export { getThumbnailAsync, grabVideoFrame } from './video';
export type { VideoThumbnailsOptions, VideoThumbnailsResult } from './video';
