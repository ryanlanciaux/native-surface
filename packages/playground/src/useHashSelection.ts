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
 * same story.
 */
export function useHashSelection(fallbackId: string | null): [string | null, (id: string) => void] {
  const [selected, setSelected] = useState<string | null>(() => readHash() ?? fallbackId);

  useEffect(() => {
    const onHashChange = (): void => {
      const id = readHash();
      if (id) setSelected(id);
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  useEffect(() => {
    if (selected && readHash() !== selected) {
      window.history.replaceState(null, '', `${PREFIX}${encodeURIComponent(selected)}`);
    }
  }, [selected]);

  const select = useCallback((id: string) => {
    setSelected(id);
    if (readHash() !== id) {
      window.location.hash = `${PREFIX.slice(1)}${encodeURIComponent(id)}`;
    }
  }, []);

  return [selected, select];
}
