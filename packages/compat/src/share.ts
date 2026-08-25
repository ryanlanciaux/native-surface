/**
 * react-native-share compat shim — Web Share API-backed.
 *
 * Boundary-general (docs/compat-strategy.md): implements the documented
 * default Share object {open, shareSingle, isPackageInstalled} plus the
 * Social constants (stubs — the browser cannot target a specific app, so
 * shareSingle warns once and falls through to the generic sheet, and
 * isPackageInstalled honestly reports {isInstalled: false}).
 *
 * open() maps {title, message → text, url | urls[0]} onto navigator.share.
 * The two failure modes keep upstream's documented shapes: user dismissal
 * (AbortError) rejects with the documented "User did not share" error, and a
 * host without navigator.share (insecure context, desktop Firefox, node)
 * rejects with a clear not-available error — apps already handle open()
 * rejection because iOS cancel takes that path.
 *
 * NOTE: React Native core's own Share API (import { Share } from
 * 'react-native') is provided by the engine, not this file.
 */

export const Social = {
  FACEBOOK: 'facebook',
  FACEBOOK_STORIES: 'facebook-stories',
  TWITTER: 'twitter',
  WHATSAPP: 'whatsapp',
  WHATSAPP_BUSINESS: 'whatsappbusiness',
  INSTAGRAM: 'instagram',
  INSTAGRAM_STORIES: 'instagram-stories',
  MESSENGER: 'messenger',
  TELEGRAM: 'telegram',
  SNAPCHAT: 'snapchat',
  LINKEDIN: 'linkedin',
  PINTEREST: 'pinterest',
  EMAIL: 'email',
  SMS: 'sms',
  VIBER: 'viber',
  DISCORD: 'discord',
} as const;
export type Social = (typeof Social)[keyof typeof Social];

export interface ShareOptions {
  title?: string;
  message?: string;
  url?: string;
  urls?: string[];
  subject?: string;
  social?: Social | string;
  [key: string]: unknown;
}

export interface ShareOpenResult {
  success: boolean;
  message: string;
}

let warnedShareSingle = false;

async function open(options: ShareOptions = {}): Promise<ShareOpenResult> {
  if (typeof navigator === 'undefined' || typeof navigator.share !== 'function') {
    throw new Error(
      'react-native-share compat: navigator.share is not available in this environment (requires a secure context and a supporting browser).'
    );
  }
  const data: { title?: string; text?: string; url?: string } = {};
  if (options.title) data.title = options.title;
  if (options.message) data.text = options.message;
  const url = options.url ?? options.urls?.[0];
  if (url) data.url = url;
  if (!data.title && !data.text && !data.url) {
    throw new Error('react-native-share compat: nothing to share — provide message, url, or title.');
  }
  try {
    await navigator.share(data);
    return { success: true, message: 'OK' };
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') {
      // Upstream's documented user-cancel rejection shape.
      throw new Error('User did not share');
    }
    throw e;
  }
}

async function shareSingle(options: ShareOptions): Promise<ShareOpenResult> {
  if (!warnedShareSingle) {
    warnedShareSingle = true;
    console.warn(
      `compat share: shareSingle cannot target ${String(options.social ?? 'an app')} in a browser; using the generic share sheet.`
    );
  }
  return open(options);
}

async function isPackageInstalled(_packageName: string): Promise<{ isInstalled: boolean; message: string }> {
  return { isInstalled: false, message: 'package detection is not available on the canvas host' };
}

const Share = { open, shareSingle, isPackageInstalled, Social };
export default Share;
