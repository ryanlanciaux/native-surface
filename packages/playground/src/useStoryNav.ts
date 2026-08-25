import { useCallback, useEffect } from 'react';

function isFilterBox(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && target.hasAttribute('data-filter-input');
}

function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

/**
 * Up/down move through the flattened visible story list, `/` jumps to the
 * filter box. Arrows keep working while the filter box has focus (type, then
 * arrow into a result) but never steal keys from the controls panel's inputs.
 */
export function useStoryNav(
  visibleIds: string[],
  selectedId: string | null,
  onSelect: (id: string) => void
): void {
  const step = useCallback(
    (delta: number) => {
      if (visibleIds.length === 0) return;
      const current = selectedId ? visibleIds.indexOf(selectedId) : -1;
      const next =
        current === -1
          ? delta > 0
            ? 0
            : visibleIds.length - 1
          : Math.min(visibleIds.length - 1, Math.max(0, current + delta));
      const id = visibleIds[next];
      if (id && id !== selectedId) onSelect(id);
    },
    [visibleIds, selectedId, onSelect]
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const filterFocused = isFilterBox(event.target);

      if (event.key === 'Escape' && filterFocused) {
        (event.target as HTMLInputElement).blur();
        return;
      }
      if (event.key === '/' && !isTextEntry(event.target)) {
        const input = document.querySelector<HTMLInputElement>('[data-filter-input]');
        if (input) {
          event.preventDefault();
          input.focus();
          input.select();
        }
        return;
      }
      if (isTextEntry(event.target) && !filterFocused) return;

      if (event.key === 'ArrowDown') {
        event.preventDefault();
        step(1);
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        step(-1);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [step]);
}
