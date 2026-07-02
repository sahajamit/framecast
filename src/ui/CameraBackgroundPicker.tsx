import { useEffect, useRef } from 'react';
import type { CameraBackgroundId } from '../types';
import { CAMERA_BACKGROUNDS, paintCameraBackgroundFill, type CameraBg } from '../compositor/cameraBackgrounds';

const SW = 72;
const SH = 54;

/**
 * Chooser for the built-in camera backgrounds. Photo scenes render as a real
 * thumbnail of the bundled image; the mid-tone monochromes paint themselves
 * with the same fill used in the recording, so a chip previews the output.
 */
export function CameraBackgroundPicker({
  value,
  onChange,
}: {
  value: CameraBackgroundId;
  onChange: (id: CameraBackgroundId) => void;
}) {
  return (
    <div className="scene-swatches" role="group" aria-label="Camera backdrop">
      {CAMERA_BACKGROUNDS.map((b) => (
        <Swatch key={b.id} bg={b} selected={b.id === value} onSelect={() => onChange(b.id)} />
      ))}
    </div>
  );
}

function Swatch({
  bg,
  selected,
  onSelect,
}: {
  bg: CameraBg;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      className={`swatch ${selected ? 'on' : ''}`}
      aria-pressed={selected}
      aria-label={bg.label}
      title={bg.label}
      onClick={onSelect}
    >
      {bg.kind === 'image' ? (
        <img src={bg.url} alt="" width={SW} height={SH} loading="lazy" />
      ) : (
        <SolidSwatch id={bg.id} />
      )}
      <span className="swatch-cap">{bg.label}</span>
    </button>
  );
}

function SolidSwatch({ id }: { id: CameraBackgroundId }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const ctx = ref.current?.getContext('2d');
    if (!ctx) return; // jsdom in component tests
    paintCameraBackgroundFill(ctx, { x: 0, y: 0, w: SW, h: SH }, id);
  }, [id]);
  return <canvas ref={ref} width={SW} height={SH} />;
}
