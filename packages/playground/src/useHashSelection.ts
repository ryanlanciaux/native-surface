import { useCallback, useEffect, useState } from 'react';

const PREFIX = '#/story/';

function readHash(): string | null {
  const hash = window.location.hash;
  if (!hash.startsWith(PREFIX)) return null;
  const id = decodeURIComponent(hash.slice(PREFIX.length));
  return id.length > 0 ? id : null;
}

/**
 * Selection lives in the URL hash so a reload — or a shared link — reopens the
 * same story. Disabled (an embed on a page with its own anchors), it is plain
 * state and the hash is never read or written.
 */
export function useHashSelection(fallbackId: string | null, enabled = true): [string | null, (id: string) => void] {
  const [selected, setSelected] = useState<string | null>(() => (enabled ? readHash() : null) ?? fallbackId);

  useEffect(() => {
    if (!enabled) return;
    const onHashChange = (): void => {
      const id = readHash();
      if (id) setSelected(id);
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, [enabled]);

  useEffect(() => {
    if (enabled && selected && readHash() !== selected) {
      window.history.replaceState(null, '', `${PREFIX}${encodeURIComponent(selected)}`);
    }
  }, [selected, enabled]);

  const select = useCallback(
    (id: string) => {
      setSelected(id);
      if (enabled && readHash() !== id) {
        window.location.hash = `${PREFIX.slice(1)}${encodeURIComponent(id)}`;
      }
    },
    [enabled]
  );

  return [selected, select];
}
