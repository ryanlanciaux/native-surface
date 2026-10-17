import { useEffect, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { optionValue, selectIndex, selectOptions } from '../fields';
import type { Field } from '../fields';
import { CalendarIcon } from './icons';

interface ControlsProps {
  /** Keyed per item so editors holding drafts reset on a switch. */
  itemId: string;
  fields: Field[];
  isScreen: boolean;
  onChange: (key: string, value: unknown) => void;
}

/** The props panel: one live control per field (args.ts knobs, dotted object fields). */
export function Controls({ itemId, fields, isScreen, onChange }: ControlsProps): ReactElement {
  if (fields.length === 0) {
    return (
      <p className="nsp-prop__key">
        {isScreen ? 'No props: this screen owns its state. Tap around in it.' : 'This story takes no args.'}
      </p>
    );
  }
  return (
    <>
      {fields.map((field) => (
        <PropControl key={`${itemId}:${field.key}`} field={field} onChange={(value) => onChange(field.key, value)} />
      ))}
    </>
  );
}

function PropControl({ field, onChange }: { field: Field; onChange: (value: unknown) => void }): ReactElement {
  const { key, kind, value } = field;
  const id = `nsp-prop-${key}`;
  const description = field.argType?.description;
  if (kind === 'boolean') {
    const on = !!value;
    return (
      <div className="nsp-prop nsp-prop--row" title={description}>
        <span className="nsp-prop__key" id={id}>
          {field.argType?.name ?? key}
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-labelledby={id}
          className={`nsp-switch${on ? ' is-on' : ''}`}
          onClick={() => onChange(!on)}
        >
          <span />
        </button>
      </div>
    );
  }
  if (kind === 'select') {
    const options = selectOptions(field);
    const index = selectIndex(field);
    return (
      <label className="nsp-prop" title={description}>
        <span className="nsp-prop__key">{field.argType?.name ?? key}</span>
        <select
          className="nsp-prop__input nsp-prop__select"
          value={String(index)}
          onChange={(event) => onChange(optionValue(field, Number(event.target.value), event.target.value))}
        >
          {index < 0 && <option value="-1">{value === undefined ? 'none' : String(value)}</option>}
          {options.map((option, i) => (
            <option key={`${option.label}:${i}`} value={String(i)}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
    );
  }
  if (kind === 'json') return <JsonControl field={field} onChange={onChange} />;
  if (kind === 'date') return <DateControl field={field} onChange={onChange} />;
  const isNumber = kind === 'number';
  const at = field.argType;
  return (
    <label className="nsp-prop" title={description}>
      <span className="nsp-prop__key">{at?.name ?? key}</span>
      <input
        className="nsp-prop__input"
        type={isNumber ? 'number' : 'text'}
        min={at?.min}
        max={at?.max}
        step={at?.step}
        value={value === undefined || value === null ? '' : String(value)}
        spellCheck={false}
        onChange={(event) => {
          if (!isNumber) return onChange(event.target.value);
          const num = event.target.valueAsNumber;
          onChange(Number.isNaN(num) ? undefined : num);
        }}
      />
    </label>
  );
}

/**
 * ISO `yyyy-mm-dd`, typed or picked: the text stays exactly what the app
 * stores (a native date input would show the viewer's locale format). Only
 * real dates reach the component; anything else is held as a draft.
 */
function DateControl({ field, onChange }: { field: Field; onChange: (value: unknown) => void }): ReactElement {
  const full = field.value == null ? '' : String(field.value);
  const text = full.slice(0, 10);
  const [draft, setDraft] = useState(text);
  useEffect(() => setDraft(text), [text]);
  const picker = useRef<HTMLInputElement>(null);
  const valid = (v: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));
  // Keeps a timestamp's time part: only the date is edited.
  const commit = (v: string): void => {
    setDraft(v);
    if (valid(v)) onChange(full.length > 10 ? v + full.slice(10) : v);
  };
  return (
    <label className="nsp-prop">
      <span className="nsp-prop__key">{field.argType?.name ?? field.key}</span>
      <span className="nsp-prop__date">
        <input
          className={`nsp-prop__input${draft && !valid(draft) ? ' is-bad' : ''}`}
          value={draft}
          inputMode="numeric"
          placeholder="yyyy-mm-dd"
          spellCheck={false}
          onChange={(event) => commit(event.target.value)}
        />
        <button
          type="button"
          className="nsp-prop__pick"
          aria-label={`Pick ${field.key}`}
          onClick={(event) => {
            event.preventDefault();
            try {
              picker.current?.showPicker();
            } catch {
              picker.current?.focus();
            }
          }}
        >
          <CalendarIcon />
        </button>
        <input
          ref={picker}
          className="nsp-prop__picker"
          type="date"
          tabIndex={-1}
          aria-hidden="true"
          value={valid(draft) ? draft : ''}
          onChange={(event) => event.target.value && commit(event.target.value)}
        />
      </span>
    </label>
  );
}

function JsonControl({ field, onChange }: { field: Field; onChange: (value: unknown) => void }): ReactElement {
  const text = JSON.stringify(field.value) ?? '';
  const [draft, setDraft] = useState(text);
  const [bad, setBad] = useState(false);
  useEffect(() => setDraft(text), [text]);
  return (
    <label className="nsp-prop" title={field.argType?.description}>
      <span className="nsp-prop__key">{field.argType?.name ?? field.key}</span>
      <input
        className={`nsp-prop__input${bad ? ' is-bad' : ''}`}
        value={draft}
        spellCheck={false}
        onChange={(event) => {
          setDraft(event.target.value);
          try {
            onChange(JSON.parse(event.target.value));
            setBad(false);
          } catch {
            setBad(true);
          }
        }}
      />
    </label>
  );
}
