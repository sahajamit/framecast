import { useEffect, useRef } from 'react';
import type { BackdropId } from '../types';
import { BACKDROPS, paintBackdrop } from '../compositor/backdrops';

const SW = 96;
const SH = 54;

/**
 * Backdrop chooser: a grid of swatches that each paint themselves with the very
 * same `paintBackdrop` used for the recording, so a chip is an exact preview of
 * the output. Theme-invariant — chips show the backdrop as it will be recorded,
 * not as the app chrome looks.
 */
export function BackdropPicker({
  value,
  onChange,
}: {
  value: BackdropId;
  onChange: (id: BackdropId) => void;
}) {
  return (
    <div className="scene-swatches" role="group" aria-label="Backdrop">
      {BACKDROPS.map((b) => (
        <Swatch
          key={b.id}
          id={b.id}
          label={b.label}
          selected={b.id === value}
          onSelect={() => onChange(b.id)}
        />
      ))}
    </div>
  );
}

function Swatch({
  id,
  label,
  selected,
  onSelect,
}: {
  id: BackdropId;
  label: string;
  selected: boolean;
  onSelect: () => void;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const ctx = ref.current?.getContext('2d');
    if (!ctx) return; // jsdom in component tests
    const sample = id === 'blur' ? makeBlurSample() : null;
    paintBackdrop(ctx, id, SW, SH, sample ? { img: sample, w: sample.width, h: sample.height } : null);
  }, [id]);

  return (
    <button
      type="button"
      className={`swatch ${selected ? 'on' : ''} ${id === 'none' ? 'is-none' : ''}`}
      aria-pressed={selected}
      aria-label={label}
      title={label}
      onClick={onSelect}
    >
      <canvas ref={ref} width={SW} height={SH} />
      <span className="swatch-cap">{label}</span>
    </button>
  );
}

/**
 * A tiny synthetic "screenshot" so the blur swatch renders a representative,
 * colorful blur (the content-aware backdrop has no live screen to sample at
 * rest). Returns null under jsdom.
 */
function makeBlurSample(): HTMLCanvasElement | null {
  const c = document.createElement('canvas');
  c.width = SW;
  c.height = SH;
  const g = c.getContext('2d');
  if (!g) return null;
  g.fillStyle = '#1b3a5b';
  g.fillRect(0, 0, SW, SH);
  g.fillStyle = '#e8a33d';
  g.fillRect(SW * 0.1, SH * 0.22, SW * 0.34, SH * 0.5);
  g.fillStyle = '#d65745';
  g.fillRect(SW * 0.56, SH * 0.16, SW * 0.3, SH * 0.3);
  g.fillStyle = '#7bbf7a';
  g.fillRect(SW * 0.5, SH * 0.56, SW * 0.4, SH * 0.3);
  return c;
}
