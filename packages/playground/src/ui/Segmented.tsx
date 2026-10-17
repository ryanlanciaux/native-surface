import type { ReactElement } from 'react';

interface SegmentedProps<T extends string> {
  value: T;
  options: readonly T[];
  labels?: Partial<Record<T, string>>;
  disabled?: readonly T[];
  titles?: Partial<Record<T, string>>;
  onChange: (value: T) => void;
  className: string;
  label: string;
}

/** Radio-group pill: Preview|Code, state chips, light|dark. */
export function Segmented<T extends string>(props: SegmentedProps<T>): ReactElement {
  const { value, options, labels, disabled, titles, onChange, className, label } = props;
  return (
    <div className={`nsp-seg ${className}`} role="radiogroup" aria-label={label}>
      {options.map((option) => (
        <button
          key={option}
          type="button"
          role="radio"
          aria-checked={value === option}
          className={value === option ? 'is-on' : ''}
          disabled={disabled?.includes(option)}
          title={titles?.[option]}
          onClick={() => onChange(option)}
        >
          {labels?.[option] ?? option}
        </button>
      ))}
    </div>
  );
}
