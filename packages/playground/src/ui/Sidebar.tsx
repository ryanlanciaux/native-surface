import { useEffect, useRef } from 'react';
import type { ReactElement, ReactNode } from 'react';
import type { PlaygroundItem } from '../items';
import { BoxIcon, PhoneIcon, SearchIcon, XIcon } from './icons';

interface SidebarProps {
  components: PlaygroundItem[];
  screens: PlaygroundItem[];
  totals: { components: number; screens: number };
  selected: PlaygroundItem;
  query: string;
  onQuery: (query: string) => void;
  onSelect: (item: PlaygroundItem) => void;
}

/** ⌘K / Ctrl+K focuses the filter while the playground is on screen. */
function useShortcutFocus(): React.RefObject<HTMLInputElement | null> {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'k' || !ref.current) return;
      const rect = ref.current.closest('.nsp')?.getBoundingClientRect();
      if (!rect || rect.bottom < 0 || rect.top > window.innerHeight) return;
      event.preventDefault();
      ref.current.focus();
      ref.current.select();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return ref;
}

export function Sidebar(props: SidebarProps): ReactElement {
  const { components, screens, totals, selected, query, onQuery, onSelect } = props;
  const searchRef = useShortcutFocus();
  const listRef = useRef<HTMLDivElement>(null);

  // Keep the selection in view (keyboard nav, hash links) without scrolling the page.
  useEffect(() => {
    const list = listRef.current;
    const node = list?.querySelector<HTMLElement>(`[data-item-id="${CSS.escape(selected.id)}"]`);
    if (!list || !node) return;
    const top = node.offsetTop - list.offsetTop;
    if (top < list.scrollTop) list.scrollTop = top;
    else if (top + node.offsetHeight > list.scrollTop + list.clientHeight) list.scrollTop = top + node.offsetHeight - list.clientHeight;
  }, [selected.id]);

  return (
    <aside className="nsp__sidebar" aria-label="Components">
      <label className="nsp__search">
        <SearchIcon />
        <input
          ref={searchRef}
          type="search"
          data-filter-input=""
          value={query}
          placeholder="Filter components"
          aria-label="Filter components"
          spellCheck={false}
          onChange={(event) => onQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') onQuery('');
            if (event.key === 'Enter') {
              const first = components[0] ?? screens[0];
              if (first) onSelect(first);
            }
          }}
        />
        {query ? (
          <button type="button" className="nsp__clear" aria-label="Clear filter" onClick={() => onQuery('')}>
            <XIcon size={12} />
          </button>
        ) : (
          <kbd>⌘K</kbd>
        )}
      </label>
      <div className="nsp__lists" ref={listRef}>
        {totals.components > 0 && (
          <div className="nsp__group">
            <p className="nsp__heading">{`COMPONENTS · ${totals.components}`}</p>
            {components.map((item) => (
              <SidebarItem key={item.id} item={item} selected={item === selected} onSelect={onSelect} icon={<BoxIcon />} />
            ))}
          </div>
        )}
        {totals.screens > 0 && (
          <div className="nsp__group">
            <p className="nsp__heading">{`SCREENS · ${totals.screens}`}</p>
            {screens.map((item) => (
              <SidebarItem key={item.id} item={item} selected={item === selected} onSelect={onSelect} icon={<PhoneIcon />} />
            ))}
          </div>
        )}
        {components.length + screens.length === 0 && <p className="nsp__empty">{`Nothing matches “${query}”`}</p>}
      </div>
    </aside>
  );
}

function SidebarItem(props: {
  item: PlaygroundItem;
  selected: boolean;
  icon: ReactNode;
  onSelect: (item: PlaygroundItem) => void;
}): ReactElement {
  const { item, selected, icon, onSelect } = props;
  return (
    <button
      type="button"
      data-item-id={item.id}
      className={`nsp__item${selected ? ' is-selected' : ''}`}
      aria-current={selected ? 'true' : undefined}
      title={item.group.title}
      onClick={() => onSelect(item)}
    >
      {icon}
      <span>{item.name}</span>
    </button>
  );
}
