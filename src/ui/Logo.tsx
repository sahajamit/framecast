/**
 * The framecast mark: a hardware badge — bevelled module, engraved screen
 * frame, LED lens at bottom-right. The lens is the camera bubble; it glows
 * LED green at rest and flips red while on air (the badge doubles as the
 * tally light). Geometry comes from the Console brand sheet.
 */
export function LogoMark({ live = false, size = 38 }: { live?: boolean; size?: number }) {
  return (
    <span
      className={`fcmark ${live ? 'air' : ''}`}
      role="img"
      aria-label={live ? 'framecast, on air' : 'framecast'}
      style={{ ['--mw' as string]: `${size}px`, width: size, height: size, display: 'inline-block' }}
    />
  );
}

export function LogoLockup({ live = false }: { live?: boolean }) {
  return (
    <span className="flex items-center" style={{ gap: 14 }}>
      <LogoMark live={live} />
      <span>
        <span className="wordmark block">Framecast</span>
        <span className="tagline block">Local recording studio</span>
      </span>
    </span>
  );
}
