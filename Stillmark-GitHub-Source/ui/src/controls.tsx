import { ChevronDown, ChevronUp } from 'lucide-react';
import { useId, useState } from 'react';
import { instrumentAudio as audio } from './audio';
import { clamp } from './model';

export function Toggle({ label, checked, onChange, disabled }: {
  label: string; checked: boolean; onChange: (value: boolean) => void; disabled?: boolean;
}) {
  return <button className="switch" type="button" role="switch" aria-label={label}
    aria-checked={checked} disabled={disabled} onClick={() => {
      audio.play('tick');
      onChange(!checked);
    }}><span /></button>;
}

export function Stepper({ label, value, range, onChange, disabled, unit = '分钟', step = 1 }: {
  label: string; value: number; range: [number, number]; onChange: (value: number) => void;
  disabled?: boolean; unit?: string; step?: number;
}) {
  const id = useId();
  const [draft, setDraft] = useState<string | null>(null);
  function select(next: number) {
    const adjusted = clamp(next, range);
    setDraft(null);
    if (adjusted === value) return;
    audio.play('tick');
    onChange(adjusted);
  }
  return <div className="stepper">
    <label className="sr-only" htmlFor={id}>{label}</label>
    <input id={id} type="text" inputMode="numeric" pattern="[0-9]*" maxLength={3}
      disabled={disabled} value={draft ?? value} onFocus={event => event.currentTarget.select()}
      onChange={event => setDraft(event.currentTarget.value.replace(/\D/g, ''))}
      onBlur={() => select(draft !== null && draft !== '' ? Number(draft) : value)}
      onKeyDown={event => {
        if (event.key === 'Enter') event.currentTarget.blur();
        if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
          event.preventDefault();
          select(value + (event.key === 'ArrowUp' ? step : -step));
        }
        if (event.key === 'Escape') setDraft(null);
      }} />
    <span className="step-unit">{unit}</span>
    <div className="step-arrows">
      <button type="button" aria-label={`增加${label}`} onClick={() => select(value + step)} disabled={disabled || value >= range[1]}>
        <ChevronUp />
      </button>
      <button type="button" aria-label={`减少${label}`} onClick={() => select(value - step)} disabled={disabled || value <= range[0]}>
        <ChevronDown />
      </button>
    </div>
  </div>;
}

export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled,
}: {
  label: string;
  value: T;
  options: readonly { value: T; label: string; icon?: React.ReactNode }[];
  onChange: (value: T) => void;
  disabled?: boolean;
}) {
  return (
    <div className="modes segmented" role="group" aria-label={label}>
      {options.map(option => (
        <button
          key={option.value}
          type="button"
          className={value === option.value ? 'selected' : ''}
          aria-pressed={value === option.value}
          disabled={disabled}
          onClick={() => {
            if (option.value !== value) audio.play('tick');
            onChange(option.value);
          }}
        >
          {option.icon}
          {option.label}
        </button>
      ))}
    </div>
  );
}
