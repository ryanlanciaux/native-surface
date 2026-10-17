import type { ReactElement } from 'react';

export interface ActionRecord {
  key: number;
  source: 'arg' | 'surface';
  name: string;
  payload: string;
  time: string;
  /** Consecutive identical calls collapse into one row with a count. */
  count: number;
}

interface ActionsProps {
  records: ActionRecord[];
  /** Callback named while nothing has fired yet (the story's first function arg). */
  waitingFor: string | null;
  onClear: () => void;
}

const SHOWN = 6;

/** The props panel's event log: newest call highlighted, older ones below it. */
export function Actions({ records, waitingFor, onClear }: ActionsProps): ReactElement | null {
  if (records.length === 0) {
    if (!waitingFor) return null;
    return (
      <div className="nsp__event" aria-live="polite">
        <span className="nsp__event-name">
          {`${waitingFor}()  `}
          <span className="nsp__event-state">waiting</span>
        </span>
        <span>tap the preview</span>
      </div>
    );
  }
  const [head, ...rest] = records;
  return (
    <div className="nsp__events" aria-live="polite">
      <div className="nsp__event is-fired">
        <span className="nsp__event-name">
          {`${head!.name}()  `}
          <span className="nsp__event-state">{head!.count > 1 ? `fired ×${head!.count}` : 'fired'}</span>
          {head!.source === 'surface' && <span className="nsp__event-tag">surface</span>}
        </span>
        <span>{head!.payload || 'no arguments'}</span>
      </div>
      {rest.slice(0, SHOWN - 1).map((record) => (
        <div className="nsp__event-row" key={record.key}>
          <span className="nsp__event-row-name">{`${record.name}()${record.count > 1 ? ` ×${record.count}` : ''}`}</span>
          <span className="nsp__event-row-time">{record.time}</span>
        </div>
      ))}
      <button type="button" className="nsp__drawer-action nsp__events-clear" onClick={onClear}>
        clear log
      </button>
    </div>
  );
}
