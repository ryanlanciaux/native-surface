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
  onClear: () => void;
}

export function Actions(props: ActionsProps): React.JSX.Element {
  const { records, onClear } = props;
  return (
    <section className="panel actions">
      <header className="panel-head">
        <h2>Actions</h2>
        <button type="button" className="ghost" onClick={onClear} disabled={records.length === 0}>
          Clear
        </button>
      </header>
      <div className="panel-body action-list">
        {records.length === 0 ? (
          <p className="empty">Interact with the canvas — handler calls land here.</p>
        ) : (
          records.map((record) => (
            <div className="action" key={record.key}>
              <div className="action-head">
                <span className={`tag ${record.source}`}>{record.source}</span>
                <span className="action-name">{record.name}</span>
                {record.count > 1 ? <span className="repeat">×{record.count}</span> : null}
                <span className="action-time">{record.time}</span>
              </div>
              {record.payload ? <pre className="action-payload">{record.payload}</pre> : null}
            </div>
          ))
        )}
      </div>
    </section>
  );
}
