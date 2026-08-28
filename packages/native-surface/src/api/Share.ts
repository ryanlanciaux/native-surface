/**
 * Share — React Native CORE's share API (`import { Share } from
 * 'react-native'`). The separate react-native-share package is a different
 * module with a different shape; the compat pack shims that one.
 *
 * Backed by the Web Share API. `navigator.share()` opens the OS share sheet on
 * mobile browsers and on desktop Safari/Edge — genuinely the same sheet RN
 * would open — and is simply absent elsewhere (desktop Firefox, any insecure
 * context, SSR).
 *
 * WHY absence resolves instead of rejecting: RN's Share only ever rejects on a
 * malformed call, so real app code writes
 *
 *     const result = await Share.share({ message });
 *     if (result.action === Share.sharedAction) { ... }
 *
 * with no catch. Rejecting when the host has no share sheet would turn a
 * missing browser feature into an unhandled rejection in an app that is
 * written correctly against RN. So every host-side failure — no
 * navigator.share, a user abort, a browser refusal — resolves as
 * `dismissedAction`, which is the outcome RN reports for "the user closed the
 * sheet without sharing" and the branch apps already handle.
 *
 * `activityType` is null on success: RN gives the chosen target's id on iOS,
 * and the Web Share API deliberately never tells the page where the content
 * went.
 */

export interface ShareContent {
  /** iOS: shared as the message body. Web: `text`. */
  message?: string;
  url?: string;
  title?: string;
}

export interface ShareOptions {
  /** Android dialog title. No browser equivalent; accepted and ignored. */
  dialogTitle?: string;
  /** iOS: activity types to hide. The browser sheet is not configurable. */
  excludedActivityTypes?: string[];
  /** iOS: share-sheet tint. Inert here. */
  tintColor?: string;
  /** iOS: mail subject line. Inert here (Web Share has no subject field). */
  subject?: string;
  /** iOS iPad: anchor node tag for the popover. Inert here. */
  anchor?: number;
}

export interface ShareAction {
  action: 'sharedAction' | 'dismissedAction';
  /** Non-null only on iOS in RN; always null here (see module doc). */
  activityType?: string | null;
}

interface ShareCapableNavigator {
  share?: (data: { title?: string; text?: string; url?: string }) => Promise<void>;
}

let warnedUnavailable = false;

function shareFn(): ShareCapableNavigator['share'] | null {
  const nav = (globalThis as { navigator?: ShareCapableNavigator }).navigator;
  return typeof nav?.share === 'function' ? nav.share.bind(nav) : null;
}

// Fresh objects per call: RN hands back a new result each time, and a caller
// that annotates the result must not scribble on the next one's.
const shared = (): ShareAction => ({ action: 'sharedAction', activityType: null });
const dismissed = (): ShareAction => ({ action: 'dismissedAction' });

export const Share = {
  /** RN's result constants; compared against by every caller. */
  sharedAction: 'sharedAction' as const,
  dismissedAction: 'dismissedAction' as const,

  async share(content: ShareContent, options: ShareOptions = {}): Promise<ShareAction> {
    void options; // every option is iOS/Android chrome the browser sheet has no slot for
    if (content == null || typeof content !== 'object') {
      throw new Error('Content to share must be a valid object');
    }
    if (typeof content.url !== 'string' && typeof content.message !== 'string') {
      // RN's own invariant: this is a caller bug, not a host limitation, and
      // failing loudly is what surfaces it.
      throw new Error('At least one of URL and message is required');
    }

    const share = shareFn();
    if (!share) {
      if (!warnedUnavailable) {
        warnedUnavailable = true;
        console.warn(
          'native-surface: Share.share() found no navigator.share (needs a secure context and a supporting browser); resolving as dismissedAction.'
        );
      }
      return dismissed();
    }

    const data: { title?: string; text?: string; url?: string } = {};
    if (content.title) data.title = content.title;
    if (content.message) data.text = content.message;
    if (content.url) data.url = content.url;

    try {
      await share(data);
      return shared();
    } catch {
      // AbortError (user closed the sheet) and NotAllowedError (no user
      // activation, permission denied) are the same thing to a caller: the
      // content did not go anywhere.
      return dismissed();
    }
  },
};
