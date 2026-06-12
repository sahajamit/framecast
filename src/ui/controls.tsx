import type { ReactNode } from 'react';
import { useId } from 'react';

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="label-mono">{label}</span>
      {children}
    </div>
  );
}

export function SelectField({
  value,
  onChange,
  options,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  disabled?: boolean;
}) {
  return (
    <select
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      className="w-full bg-panel-2 border border-line rounded-lg px-2.5 py-2 text-[13px] text-ink
        outline-none focus:border-line-strong disabled:opacity-40 cursor-pointer"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value} className="bg-panel">
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <label
      htmlFor={id}
      className={`flex items-center justify-between gap-3 cursor-pointer select-none ${
        disabled ? 'opacity-40 pointer-events-none' : ''
      }`}
    >
      <span className="text-[13px] text-ink/90">{label}</span>
      <span
        className={`relative inline-flex h-[18px] w-[32px] shrink-0 items-center rounded-full border transition-colors ${
          checked ? 'bg-rec/80 border-rec' : 'bg-panel-2 border-line-strong'
        }`}
      >
        <input
          id={id}
          type="checkbox"
          className="sr-only"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span
          className={`absolute h-[12px] w-[12px] rounded-full bg-ink transition-transform ${
            checked ? 'translate-x-[16px]' : 'translate-x-[3px]'
          }`}
        />
      </span>
    </label>
  );
}

export function SliderField({
  label,
  value,
  min,
  max,
  step,
  onChange,
  format,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  format?: (value: number) => string;
}) {
  const fill = ((value - min) / (max - min)) * 100;
  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-baseline justify-between">
        <span className="label-mono">{label}</span>
        <span className="font-mono text-[11px] text-ink/80">
          {format ? format(value) : value.toFixed(2)}
        </span>
      </div>
      <input
        type="range"
        className="fader"
        style={{ ['--fill' as string]: `${fill}%` }}
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  );
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  disabled,
}: {
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: string }[];
  disabled?: boolean;
}) {
  return (
    <div
      className={`grid auto-cols-fr grid-flow-col gap-px bg-line rounded-lg p-px border border-line ${
        disabled ? 'opacity-40 pointer-events-none' : ''
      }`}
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={`font-mono text-[10.5px] tracking-[0.08em] uppercase rounded-[7px] px-2 py-2 transition-colors cursor-pointer ${
            o.value === value ? 'bg-panel-2 text-ink' : 'bg-panel text-mute hover:text-ink'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

const METER_SEGMENTS = 16;

/** Segmented LED level meter, green → amber → red. */
export function Meter({ level }: { level: number }) {
  const lit = Math.round(level * METER_SEGMENTS);
  return (
    <div className="flex items-center gap-[3px] h-[10px]">
      {Array.from({ length: METER_SEGMENTS }, (_, i) => {
        const on = i < lit;
        const frac = i / METER_SEGMENTS;
        const color =
          frac < 0.62 ? 'var(--color-ok)' : frac < 0.85 ? 'var(--color-amber)' : 'var(--color-rec)';
        return (
          <span
            key={i}
            className="flex-1 rounded-[1.5px] transition-opacity duration-75"
            style={{
              height: '100%',
              background: on ? color : 'rgba(235,240,255,0.09)',
              boxShadow: on ? `0 0 6px ${color}44` : 'none',
            }}
          />
        );
      })}
    </div>
  );
}

export function ProgressBar({ fraction }: { fraction: number }) {
  return (
    <div className="h-[4px] w-full rounded-full bg-white/10 overflow-hidden">
      <div
        className="h-full rounded-full bg-rec transition-[width] duration-200"
        style={{ width: `${Math.round(Math.min(1, Math.max(0, fraction)) * 100)}%` }}
      />
    </div>
  );
}

/** The brand mark: a tally-light dot in a ring. */
export function TallyDot({ live = false, size = 14 }: { live?: boolean; size?: number }) {
  return (
    <span
      className={`inline-block rounded-full border-2 ${live ? 'border-rec tally-live' : 'border-line-strong'}`}
      style={{ width: size, height: size, padding: 2 }}
    >
      <span
        className={`block h-full w-full rounded-full ${live ? 'bg-rec' : 'bg-mute'}`}
      />
    </span>
  );
}
