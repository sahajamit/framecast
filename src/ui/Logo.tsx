import { useId } from 'react';

/**
 * The framecast mark: a screen outline with the camera bubble overlapping its
 * corner; the lens intersection glows coral. While recording, the bubble turns
 * coral and pulses — the logo doubles as the tally light.
 */
export function LogoMark({ live = false, size = 26 }: { live?: boolean; size?: number }) {
  const clipId = useId();
  return (
    <svg
      width={size}
      height={size * 0.78}
      viewBox="0 0 100 78"
      fill="none"
      role="img"
      aria-label={live ? 'framecast, recording' : 'framecast'}
    >
      <defs>
        <clipPath id={clipId}>
          <rect x="10" y="6" width="62" height="46" rx="9" />
        </clipPath>
      </defs>
      {/* screen */}
      <rect
        x="10"
        y="6"
        width="62"
        height="46"
        rx="9"
        stroke="var(--fc-ink)"
        strokeWidth="7"
      />
      {/* camera bubble on the screen corner */}
      <circle cx="72" cy="52" r="16" fill={live ? 'var(--color-rec)' : 'var(--fc-accent)'} />
      {/* lens overlap: the slice inside the screen glows coral */}
      <circle cx="72" cy="52" r="16" fill="var(--color-rec)" clipPath={`url(#${clipId})`} />
      {live && (
        <circle
          className="logo-ring"
          cx="72"
          cy="52"
          r="16"
          stroke="var(--color-rec)"
          strokeWidth="3"
        />
      )}
    </svg>
  );
}

export function LogoLockup({ live = false }: { live?: boolean }) {
  return (
    <span className="flex items-center gap-2.5">
      <LogoMark live={live} />
      <span className="font-display font-bold text-[17px] tracking-tight">framecast</span>
    </span>
  );
}
