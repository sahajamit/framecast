import type { ReactNode } from 'react';

/** Channel-strip module card. */
export function Module({
  title,
  no,
  val,
  children,
  className = '',
}: {
  title: string;
  no?: string;
  val?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`module ${className}`}>
      <div className="mod-label">
        <b>{title}</b>
        {no && <span className="no">{no}</span>}
        {val !== undefined && <span className="val">{val}</span>}
      </div>
      {children}
    </section>
  );
}

export function SelectField({
  value,
  onChange,
  options,
  disabled,
  mono = false,
  ariaLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  disabled?: boolean;
  mono?: boolean;
  ariaLabel?: string;
}) {
  return (
    <div className="select-wrap">
      <select
        className={`select ${mono ? 'mono-read' : ''}`}
        value={value}
        disabled={disabled}
        aria-label={ariaLabel}
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

/**
 * Physical throw switch. Vertical (channel-strip style) by default,
 * horizontal for inline settings rows.
 */
export function Switch({
  checked,
  onChange,
  label,
  horizontal = false,
  disabled,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  horizontal?: boolean;
  disabled?: boolean;
}) {
  const button = (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`tog ${horizontal ? 'h' : ''} ${checked ? 'on' : ''}`}
    />
  );
  if (horizontal) return button;
  return (
    <span className="sw-item">
      {button}
      <span className="sw-cap">{label}</span>
    </span>
  );
}

export function Fader({
  label,
  value,
  min,
  max,
  step,
  onChange,
  format,
  disabled,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  format?: (value: number) => string;
  disabled?: boolean;
}) {
  const fill = ((value - min) / (max - min)) * 100;
  return (
    <div>
      <div className="ctl-row">
        <span className="ctl-name">{label}</span>
        <span className="ctl-val">{format ? format(value) : value.toFixed(2)}</span>
      </div>
      <input
        type="range"
        className="fader"
        aria-label={label}
        style={{ ['--fill' as string]: `${fill}%` }}
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
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
  ariaLabel,
}: {
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: string }[];
  disabled?: boolean;
  ariaLabel?: string;
}) {
  return (
    <div className="seg" role="group" aria-label={ariaLabel}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          disabled={disabled}
          onClick={() => onChange(o.value)}
          className={o.value === value ? 'on' : ''}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

const VU_SEGMENTS = 16;

/** Segmented LED level meter: green ramp, amber shoulder, red clip. */
export function VuMeter({ level, muted = false }: { level: number; muted?: boolean }) {
  const lit = Math.round(level * VU_SEGMENTS);
  return (
    <div className={`vu ${muted ? 'muted' : ''}`} aria-hidden="true">
      {Array.from({ length: VU_SEGMENTS }, (_, i) => {
        const frac = i / VU_SEGMENTS;
        const cls = i >= lit ? '' : frac < 0.62 ? 'g' : frac < 0.85 ? 'a' : 'r';
        return <i key={i} className={cls} />;
      })}
    </div>
  );
}

export function ProgressBar({ fraction }: { fraction: number }) {
  const pct = Math.round(Math.min(1, Math.max(0, fraction)) * 100);
  return (
    <div className="progress">
      <div className="track">
        <div className="bar" style={{ width: `${pct}%` }} />
      </div>
      <span className="pct">{pct}%</span>
    </div>
  );
}

export function Lamp({
  kind = 'ok',
  pulse = false,
  size,
}: {
  kind?: 'ok' | 'rec' | 'warn' | 'off';
  pulse?: boolean;
  size?: number;
}) {
  return (
    <span
      className={`lamp ${kind === 'ok' ? '' : kind} ${pulse ? 'pulse' : ''}`}
      style={size ? { width: size, height: size } : undefined}
    />
  );
}

/** Timecode readout chip. */
export function Timecode({
  children,
  live = false,
  paused = false,
  className = '',
}: {
  children: ReactNode;
  live?: boolean;
  paused?: boolean;
  className?: string;
}) {
  return (
    <span className={`tc ${live ? 'live' : ''} ${paused ? 'paused' : ''} ${className}`}>
      {live && <span className="rec-dot">● </span>}
      {children}
    </span>
  );
}
