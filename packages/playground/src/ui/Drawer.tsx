import { useEffect, useRef } from 'react';
import type { ReactElement } from 'react';
import type { SourceFile } from '../sources';
import type { Tok } from '../usage';
import { Audit } from './Audit';
import type { AuditEntry } from './Audit';
import { Code, Muted, UsageCode } from './Code';

export type DrawerTab = 'Usage' | 'Source' | 'Console' | 'Audit';

export interface LogLine {
  n: number;
  kind: 'mount' | 'render' | 'event' | 'env' | 'error';
  text: string;
}

interface DrawerProps {
  tab: DrawerTab;
  open: boolean;
  onTab: (tab: DrawerTab) => void;
  /** Shown while folded. */
  itemName: string;
  usage: Tok[][];
  componentSource: SourceFile | null | undefined;
  storySource: SourceFile | null | undefined;
  log: LogLine[];
  onClearLog: () => void;
  /** null: no audit endpoint (the tab is hidden). */
  audit: AuditEntry[] | null;
}

/** Usage | Source | Console (| Audit) under the canvas. Every pane is read-only text. */
export function Drawer(props: DrawerProps): ReactElement {
  const { tab, open, onTab, itemName, usage, componentSource, storySource, log, onClearLog, audit } = props;
  const tabs: DrawerTab[] = audit ? ['Usage', 'Source', 'Console', 'Audit'] : ['Usage', 'Source', 'Console'];
  const events = log.filter((l) => l.kind === 'event').length;
  const source = componentSource ?? storySource;
  return (
    <div className="nsp__drawer">
      <div className="nsp__drawer-bar" role="tablist" aria-label="Drawer">
        {tabs.map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            className={tab === t && open ? 'is-on' : ''}
            onClick={() => onTab(t)}
          >
            {t}
            {t === 'Console' && events > 0 && <span className="nsp__badge">{events}</span>}
            {t === 'Audit' && audit && audit.length > 0 && <span className="nsp__badge nsp__badge--warn">{audit.length}</span>}
          </button>
        ))}
        <span className="nsp__spacer" />
        {!open && <span className="nsp__filepath">{`${itemName} · tap a tab to open`}</span>}
        {open && tab === 'Source' && source && <span className="nsp__filepath">{source.file}</span>}
        {open && tab === 'Console' && log.length > 0 && (
          <button type="button" className="nsp__drawer-action" onClick={onClearLog}>
            clear
          </button>
        )}
      </div>
      <div className="nsp__code" data-tab={tab} hidden={!open}>
        {tab === 'Usage' && <UsageCode lines={usage} />}
        {tab === 'Source' &&
          (source ? <Code text={source.text} /> : <Muted>{source === undefined ? 'loading…' : 'No source file found for this entry.'}</Muted>)}
        {tab === 'Console' && <ConsoleLines log={log} />}
        {tab === 'Audit' && audit && <Audit entries={audit} />}
      </div>
    </div>
  );
}

function ConsoleLines({ log }: { log: LogLine[] }): ReactElement {
  const end = useRef<HTMLSpanElement>(null);
  // Scroll the drawer, never the page.
  useEffect(() => {
    const box = end.current?.closest<HTMLElement>('.nsp__code');
    if (box) box.scrollTop = box.scrollHeight;
  }, [log]);
  if (!log.length) return <Muted>Renders, events and environment changes show up here.</Muted>;
  return (
    <pre className="nsp-code nsp-console">
      <code>
        {log.map((l) => (
          <span key={l.n} className="nsp-code__line">
            <span className="nsp-code__n">›</span>
            <span className={`nsp-log--${l.kind}`}>{l.text}</span>
          </span>
        ))}
        <span ref={end} />
      </code>
    </pre>
  );
}
