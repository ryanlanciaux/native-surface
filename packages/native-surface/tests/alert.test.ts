/**
 * Alert contract: which button's onPress runs, for each way a browser dialog
 * can close. Every case loads a FRESH module so the warn-once paths can be
 * asserted more than once across the file.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AlertButton } from '../src/api/Alert';

type AlertModule = typeof import('../src/api/Alert');

interface DialogStubs {
  alert?: (message?: string) => void;
  confirm?: (message?: string) => boolean;
  prompt?: (message?: string, defaultValue?: string) => string | null;
}

/** `window: null` is the SSR / Node host with no dialogs at all. */
async function loadAlert(stubs: DialogStubs | null): Promise<AlertModule> {
  vi.resetModules();
  if (stubs === null) vi.stubGlobal('window', undefined);
  else vi.stubGlobal('window', stubs);
  return import('../src/api/Alert');
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Alert.alert', () => {
  it('OK on a confirm dispatches the non-cancel button', async () => {
    const confirm = vi.fn(() => true);
    const { Alert } = await loadAlert({ confirm });
    const cancel = vi.fn();
    const ok = vi.fn();
    Alert.alert('Delete?', 'This cannot be undone', [
      { text: 'Cancel', style: 'cancel', onPress: cancel },
      { text: 'OK', onPress: ok },
    ]);
    expect(confirm).toHaveBeenCalledWith('Delete?\n\nThis cannot be undone');
    expect(ok).toHaveBeenCalledTimes(1);
    expect(cancel).not.toHaveBeenCalled();
  });

  it('a destructive button is the affirmative one when cancel comes second', async () => {
    const { Alert } = await loadAlert({ confirm: () => true });
    const destroy = vi.fn();
    Alert.alert('Delete?', null, [
      { text: 'Delete', style: 'destructive', onPress: destroy },
      { text: 'Cancel', style: 'cancel' },
    ]);
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it('dismissal dispatches the cancel button and onDismiss', async () => {
    const { Alert } = await loadAlert({ confirm: () => false });
    const cancel = vi.fn();
    const ok = vi.fn();
    const onDismiss = vi.fn();
    Alert.alert(
      'Delete?',
      undefined,
      [
        { text: 'Cancel', style: 'cancel', onPress: cancel },
        { text: 'OK', onPress: ok },
      ],
      { onDismiss }
    );
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(ok).not.toHaveBeenCalled();
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('a single-button alert always runs that button, and a button-less one is safe', async () => {
    const alert = vi.fn();
    const confirm = vi.fn();
    const { Alert } = await loadAlert({ alert, confirm });
    const onPress = vi.fn();
    Alert.alert('Saved', 'Your changes are live', [{ text: 'OK', onPress }]);
    expect(alert).toHaveBeenCalledWith('Saved\n\nYour changes are live');
    expect(confirm).not.toHaveBeenCalled();
    expect(onPress).toHaveBeenCalledTimes(1);

    Alert.alert('Heads up');
    expect(alert).toHaveBeenLastCalledWith('Heads up');
  });

  it('warns once that a browser confirm cannot show three buttons', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { Alert } = await loadAlert({ confirm: () => true });
    const buttons: AlertButton[] = [
      { text: 'Save' },
      { text: 'Discard', style: 'destructive' },
      { text: 'Cancel', style: 'cancel' },
    ];
    Alert.alert('Unsaved changes', null, buttons);
    Alert.alert('Unsaved changes', null, buttons);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toContain('3 buttons');
  });

  it('with no window it warns once and takes the cancel path', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { Alert } = await loadAlert(null);
    const cancel = vi.fn();
    const ok = vi.fn();
    Alert.alert('Delete?', null, [
      { text: 'OK', onPress: ok },
      { text: 'Cancel', style: 'cancel', onPress: cancel },
    ]);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(ok).not.toHaveBeenCalled();

    // Falls back to the first button when nothing is cancel-styled.
    const only = vi.fn();
    Alert.alert('Saved', null, [{ text: 'OK', onPress: only }]);
    expect(only).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

describe('Alert.prompt', () => {
  it('delivers the entered text to the callback form and to the affirmative button', async () => {
    const { Alert } = await loadAlert({ prompt: () => 'hunter2' });
    const callback = vi.fn();
    Alert.prompt('Name', 'What should we call you?', callback);
    expect(callback).toHaveBeenCalledWith('hunter2');

    const ok = vi.fn();
    Alert.prompt('Name', null, [{ text: 'Cancel', style: 'cancel' }, { text: 'OK', onPress: ok }]);
    expect(ok).toHaveBeenCalledWith('hunter2');
  });

  it('cancelling runs the cancel button and never the callback', async () => {
    const { Alert } = await loadAlert({ prompt: () => null });
    const callback = vi.fn();
    Alert.prompt('Name', null, callback);
    expect(callback).not.toHaveBeenCalled();

    const cancel = vi.fn();
    Alert.prompt('Name', null, [{ text: 'Cancel', style: 'cancel', onPress: cancel }, { text: 'OK' }]);
    expect(cancel).toHaveBeenCalledWith(undefined);
  });

  it('warns once that secure-text cannot be masked', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { Alert } = await loadAlert({ prompt: () => 'pw' });
    Alert.prompt('Password', null, vi.fn(), 'secure-text');
    Alert.prompt('Password', null, vi.fn(), 'secure-text');
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
