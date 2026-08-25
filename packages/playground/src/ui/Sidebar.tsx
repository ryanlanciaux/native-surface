import { useEffect, useRef } from 'react';
import type { StoryGroup } from '../registry';

interface SidebarProps {
  groups: StoryGroup[];
  filter: string;
  onFilterChange: (value: string) => void;
  selectedId: string | null;
  onSelect: (id: string) => void;
  total: number;
}

export function Sidebar(props: SidebarProps): React.JSX.Element {
  const { groups, filter, onFilterChange, selectedId, onSelect, total } = props;
  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!selectedId) return;
    const node = listRef.current?.querySelector(`[data-story-id="${CSS.escape(selectedId)}"]`);
    node?.scrollIntoView({ block: 'nearest' });
  }, [selectedId]);

  const shown = groups.reduce((sum, group) => sum + group.stories.length, 0);

  return (
    <aside className="sidebar">
      <div className="sidebar-head">
        <input
          className="filter"
          data-filter-input=""
          type="search"
          placeholder="Filter stories…"
          value={filter}
          spellCheck={false}
          onChange={(event) => onFilterChange(event.target.value)}
          aria-label="Filter stories"
        />
        <span className="count">
          {shown}/{total}
        </span>
      </div>
      <div className="story-list" ref={listRef}>
        {groups.length === 0 ? (
          <p className="empty">No stories match “{filter}”.</p>
        ) : (
          groups.map((group) => (
            <section key={group.id} className="group">
              <h2 className="group-title">{group.title}</h2>
              {group.stories.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  data-story-id={entry.id}
                  className={entry.id === selectedId ? 'story-item selected' : 'story-item'}
                  aria-current={entry.id === selectedId}
                  onClick={() => onSelect(entry.id)}
                >
                  {entry.name}
                </button>
              ))}
            </section>
          ))
        )}
      </div>
      <p className="hint">↑ ↓ move · / filter</p>
    </aside>
  );
}
