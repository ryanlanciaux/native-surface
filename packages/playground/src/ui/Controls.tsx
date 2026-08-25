import { useState } from 'react';
import { buildKnobs, coerceOption, optionLabel } from '../args';
import type { Knob } from '../args';
import type { Args, ArgType } from '../story-types';
import type { StoryEntry } from '../registry';

interface ControlsProps {
  entry: StoryEntry;
  args: Args;
  overriddenKeys: Set<string>;
  onChange: (name: string, value: unknown) => void;
  onReset: () => void;
}

function SelectControl(props: {
  knob: Knob;
  options: ReadonlyArray<string | number>;
  argType: ArgType | undefined;
  onChange: (value: unknown) => void;
}): React.JSX.Element {
  const { knob, options, argType, onChange } = props;
  return (
    <select value={String(knob.value)} onChange={(event) => onChange(coerceOption(event.target.value, options))}>
      {options.map((option) => (
        <option key={String(option)} value={String(option)}>
          {optionLabel(option, argType)}
        </option>
      ))}
    </select>
  );
}

function JsonControl(props: { value: unknown; onChange: (value: unknown) => void }): React.JSX.Element {
  const { value, onChange } = props;
  const [text, setText] = useState(() => JSON.stringify(value, null, 0));
  const [invalid, setInvalid] = useState(false);
  return (
    <textarea
      className={invalid ? 'json invalid' : 'json'}
      rows={2}
      spellCheck={false}
      value={text}
      onChange={(event) => {
        const next = event.target.value;
        setText(next);
        try {
          onChange(JSON.parse(next));
          setInvalid(false);
        } catch {
          setInvalid(true);
        }
      }}
    />
  );
}

function ControlRow(props: {
  knob: Knob;
  overridden: boolean;
  onChange: (value: unknown) => void;
}): React.JSX.Element | null {
  const { knob, overridden, onChange } = props;
  const options = knob.argType?.options;

  let control: React.JSX.Element;
  if (knob.kind === 'select' && options && options.length > 0) {
    control = <SelectControl knob={knob} options={options} argType={knob.argType} onChange={onChange} />;
  } else if (knob.kind === 'boolean') {
    control = (
      <label className="switch">
        <input type="checkbox" checked={knob.value === true} onChange={(event) => onChange(event.target.checked)} />
        <span>{knob.value === true ? 'true' : 'false'}</span>
      </label>
    );
  } else if (knob.kind === 'number') {
    control = (
      <input
        type="number"
        value={typeof knob.value === 'number' ? knob.value : ''}
        onChange={(event) => {
          const next = Number(event.target.value);
          onChange(Number.isFinite(next) ? next : 0);
        }}
      />
    );
  } else if (knob.kind === 'text') {
    control = (
      <input
        type="text"
        spellCheck={false}
        value={typeof knob.value === 'string' ? knob.value : ''}
        onChange={(event) => onChange(event.target.value)}
      />
    );
  } else if (knob.kind === 'action') {
    control = <span className="static">ƒ logged to actions</span>;
  } else if (knob.kind === 'json') {
    control = <JsonControl value={knob.value} onChange={onChange} />;
  } else if (knob.kind === 'none') {
    return null;
  } else {
    control = <span className="static">unsupported</span>;
  }

  return (
    <div className="control-row">
      <label className="control-label" title={knob.argType?.description}>
        {knob.label}
        {overridden ? <span className="dot" title="Edited" /> : null}
      </label>
      <div className="control-input">{control}</div>
    </div>
  );
}

export function Controls(props: ControlsProps): React.JSX.Element {
  const { entry, args, overriddenKeys, onChange, onReset } = props;
  const knobs = buildKnobs(args, entry.argTypes);

  return (
    <section className="panel controls">
      <header className="panel-head">
        <h2>Controls</h2>
        <button type="button" className="ghost" onClick={onReset} disabled={overriddenKeys.size === 0}>
          Reset
        </button>
      </header>
      <div className="panel-body">
        {knobs.length === 0 ? (
          <p className="empty">This story takes no args.</p>
        ) : (
          knobs.map((knob) => (
            <ControlRow
              key={knob.name}
              knob={knob}
              overridden={overriddenKeys.has(knob.name)}
              onChange={(value) => onChange(knob.name, value)}
            />
          ))
        )}
      </div>
    </section>
  );
}
