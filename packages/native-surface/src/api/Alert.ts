/**
 * Alert — RN's modal dialog API, mapped onto the browser's own dialogs.
 *
 * Be clear about what this is: `Alert.alert()` here opens BROWSER-NATIVE chrome
 * (window.alert / window.confirm / window.prompt), not an RN dialog painted on
 * the canvas. It therefore looks like the browser, is centered on the WINDOW
 * rather than on the surface, and blocks the JS thread while it is open. What
 * it does preserve exactly is the part apps depend on: which button's onPress
 * runs, and when.
 *
 * The mapping, and its one real lossy edge:
 *   - 0 or 1 button  → window.alert; the single button's onPress ALWAYS runs
 *                      when it closes (RN: a one-button alert can only be
 *                      dismissed by pressing it).
 *   - 2+ buttons     → window.confirm. OK runs the last non-'cancel' button,
 *                      Cancel runs the 'cancel'-styled button (and options
 *                      .onDismiss). A browser confirm offers exactly two
 *                      choices, so a 3-button alert loses its middle buttons —
 *                      warned once, never silently.
 *
 * With no `window` at all (SSR, a Node test run) there is nothing to show: the
 * call warns once and takes the dismissal path — the cancel-styled button if
 * there is one, else the first button — so a flow that waits on a button's
 * onPress still completes instead of hanging forever.
 */

export type AlertButtonStyle = 'default' | 'cancel' | 'destructive';

export interface AlertButton {
  text?: string;
  /** Receives the entered text for prompt(); nothing for alert(). */
  onPress?: (value?: string) => void;
  style?: AlertButtonStyle;
  isPreferred?: boolean;
}

export interface AlertOptions {
  cancelable?: boolean;
  /** Android-style dismissal callback; here it runs on the Cancel path. */
  onDismiss?: () => void;
  userInterfaceStyle?: 'unspecified' | 'light' | 'dark';
}

export type AlertPromptType = 'default' | 'plain-text' | 'secure-text' | 'login-password';

const warned = new Set<string>();
function warnOnce(key: string, message: string): void {
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(message);
}

interface DialogWindow {
  alert?: (message?: string) => void;
  confirm?: (message?: string) => boolean;
  prompt?: (message?: string, defaultValue?: string) => string | null;
}

function hostWindow(): DialogWindow | null {
  const w = (globalThis as { window?: DialogWindow }).window;
  return w ?? null;
}

/** RN stacks title and message; either may be absent. */
function dialogText(title?: string | null, message?: string | null): string {
  return [title, message].filter((part): part is string => !!part).join('\n\n');
}

function cancelButton(buttons: AlertButton[]): AlertButton | undefined {
  return buttons.find((b) => b.style === 'cancel');
}

/**
 * The button OK stands for: the LAST non-'cancel' button, which is where both
 * iOS ([Cancel, OK]) and Android ([Cancel, Confirm]) put the affirmative
 * action. Falls back to the last button when every button is 'cancel'-styled.
 */
function confirmButton(buttons: AlertButton[]): AlertButton | undefined {
  const affirmative = buttons.filter((b) => b.style !== 'cancel');
  return affirmative[affirmative.length - 1] ?? buttons[buttons.length - 1];
}

function dispatch(button: AlertButton | undefined, value?: string): void {
  button?.onPress?.(value);
}

/**
 * Shared "no dialog available" path for alert() and prompt(): behave as a
 * dismissal so callers are not left waiting on a callback that can never come.
 */
function dismissWithoutWindow(buttons: AlertButton[], options: AlertOptions | undefined, api: string): void {
  warnOnce(
    `no-window:${api}`,
    `native-surface: Alert.${api}() needs a browser window to show a dialog; with none (SSR / Node) the cancel button is invoked and nothing is displayed.`
  );
  dispatch(cancelButton(buttons) ?? buttons[0]);
  options?.onDismiss?.();
}

export const Alert = {
  /**
   * RN's signature exactly. `buttons` defaults to a single OK, and the
   * button-array semantics ('default' | 'cancel' | 'destructive') are the
   * contract callers actually rely on, so they are preserved literally.
   */
  alert(
    title: string,
    message?: string | null,
    buttons?: AlertButton[] | null,
    options?: AlertOptions
  ): void {
    const list = buttons ?? [];
    const text = dialogText(title, message);
    const w = hostWindow();

    if (list.length < 2) {
      if (typeof w?.alert !== 'function') {
        dismissWithoutWindow(list, options, 'alert');
        return;
      }
      w.alert(text);
      // A one-button alert has no dismissal that isn't a press of that button.
      dispatch(list[0]);
      return;
    }

    if (typeof w?.confirm !== 'function') {
      dismissWithoutWindow(list, options, 'alert');
      return;
    }
    if (list.length > 2) {
      warnOnce(
        'confirm-arity',
        `native-surface: Alert.alert() with ${list.length} buttons maps onto a browser confirm(), which offers only OK and Cancel — the other buttons are unreachable.`
      );
    }
    if (w.confirm(text)) {
      dispatch(confirmButton(list));
    } else {
      dispatch(cancelButton(list));
      options?.onDismiss?.();
    }
  },

  /**
   * RN's iOS-only prompt. Both callback forms are supported: a bare function
   * (called with the entered text) and a button array (the affirmative
   * button's onPress receives the text).
   *
   * `type` is accepted for API compatibility and cannot be honored — a browser
   * prompt() is always a single plain-text field, so 'secure-text' is NOT
   * masked and 'login-password' collects only the login. Don't collect
   * passwords through it.
   */
  prompt(
    title: string,
    message?: string | null,
    callbackOrButtons?: ((text: string) => void) | AlertButton[] | null,
    type?: AlertPromptType,
    defaultValue?: string,
    _keyboardType?: string
  ): void {
    const isCallback = typeof callbackOrButtons === 'function';
    const list = isCallback ? [] : (callbackOrButtons ?? []);
    if (type === 'secure-text' || type === 'login-password') {
      warnOnce(
        'prompt-secure',
        `native-surface: Alert.prompt(type: '${type}') cannot mask input — a browser prompt() shows the typed text.`
      );
    }

    const w = hostWindow();
    if (typeof w?.prompt !== 'function') {
      if (isCallback) {
        warnOnce(
          'no-window:prompt',
          'native-surface: Alert.prompt() needs a browser window to show a dialog; with none (SSR / Node) nothing is displayed and the callback is not invoked.'
        );
        return;
      }
      dismissWithoutWindow(list, undefined, 'prompt');
      return;
    }

    const value = w.prompt(dialogText(title, message), defaultValue ?? '');
    if (value === null) {
      // Cancelled: no text was entered, so the callback form gets nothing.
      if (!isCallback) dispatch(cancelButton(list));
      return;
    }
    if (isCallback) callbackOrButtons(value);
    else dispatch(confirmButton(list), value);
  },
};
