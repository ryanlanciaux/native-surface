/**
 * Clipboard compat shim serving TWO aliased packages over one backend:
 *   - @react-native-clipboard/clipboard → default Clipboard object
 *     (getString/setString/hasString/getStrings/setStrings/hasURL/...)
 *   - expo-clipboard → named exports (getStringAsync/setStringAsync/
 *     setString/hasStringAsync)
 * `import * as Clipboard from 'expo-clipboard'` sees the named exports;
 * the RN-community default import sees the object — both work off this file.
 *
 * Backend is navigator.clipboard, which is unavailable outside secure
 * contexts and rejects reads/writes without permission or user activation.
 * By contract here nothing throws: reads resolve '' (has* resolve false),
 * writes resolve false / are fire-and-forget, and each failure class warns
 * once so the console says why paste came back empty. The browser clipboard
 * holds one string, so getStrings/setStrings collapse to a single entry
 * (setStrings joins with newlines); has-image and image getters report
 * empty — binary clipboard access needs permissions a canvas host cannot
 * assume.
 */

const warned = new Set<string>();
function warnOnce(key: string, message: string): void {
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(message);
}

async function readText(): Promise<string> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.readText) {
      return await navigator.clipboard.readText();
    }
    warnOnce('read-unavailable', 'compat clipboard: navigator.clipboard.readText is unavailable; reads resolve "".');
  } catch {
    warnOnce('read-blocked', 'compat clipboard: clipboard read blocked (permission / no user activation); reads resolve "".');
  }
  return '';
}

async function writeText(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
    warnOnce('write-unavailable', 'compat clipboard: navigator.clipboard.writeText is unavailable; writes are dropped.');
  } catch {
    warnOnce('write-blocked', 'compat clipboard: clipboard write blocked (permission / no user activation); write dropped.');
  }
  return false;
}

const URL_RE = /^[a-z][a-z0-9+.-]*:\/\/\S+/i;
const WEB_URL_RE = /^https?:\/\/\S+/i;

// ---------------------------------------------------------------------------
// @react-native-clipboard/clipboard surface (default export)
// ---------------------------------------------------------------------------

const Clipboard = {
  getString: (): Promise<string> => readText(),
  /** Sync fire-and-forget, matching the RN API's void signature. */
  setString: (content: string): void => {
    void writeText(content);
  },
  hasString: async (): Promise<boolean> => (await readText()).length > 0,
  getStrings: async (): Promise<string[]> => [await readText()],
  setStrings: (strings: string[]): void => {
    void writeText(strings.join('\n'));
  },
  hasURL: async (): Promise<boolean> => URL_RE.test((await readText()).trim()),
  hasWebURL: async (): Promise<boolean> => WEB_URL_RE.test((await readText()).trim()),
  hasNumber: async (): Promise<boolean> => {
    const text = (await readText()).trim();
    return text !== '' && !Number.isNaN(Number(text));
  },
  hasImage: async (): Promise<boolean> => false,
  getImage: async (): Promise<string> => '',
  getImagePNG: async (): Promise<string> => '',
  getImageJPG: async (): Promise<string> => '',
  setImage: (_content: string): void => {
    warnOnce('image-write', 'compat clipboard: setImage is not supported on the canvas host; dropped.');
  },
  addListener: (_callback: () => void): { remove: () => void } => ({ remove: () => {} }),
  removeAllListeners: (): void => {},
};

export default Clipboard;
export { Clipboard };

// ---------------------------------------------------------------------------
// expo-clipboard surface (named exports)
// ---------------------------------------------------------------------------

export async function getStringAsync(_options?: Record<string, unknown>): Promise<string> {
  return readText();
}

export async function setStringAsync(text: string, _options?: Record<string, unknown>): Promise<boolean> {
  return writeText(text);
}

/** Deprecated-but-documented sync form: fire-and-forget. */
export function setString(text: string): void {
  void writeText(text);
}

export async function hasStringAsync(): Promise<boolean> {
  return (await readText()).length > 0;
}
