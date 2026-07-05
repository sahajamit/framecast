import { describe, expect, it } from 'vitest';
import { migrateSettings } from '../src/state/persistMigrate';
import { DEFAULT_CAMERA_BACKGROUND } from '../src/compositor/layout';
import { DEFAULT_CAMERA_LIGHTING } from '../src/compositor/lighting';
import type { Settings } from '../src/state/store';

// A minimal defaults stand-in; only the fields the migration reads matter.
const DEFAULTS = {
  cameraBackground: DEFAULT_CAMERA_BACKGROUND,
  cameraLighting: DEFAULT_CAMERA_LIGHTING,
} as unknown as Settings;

function settingsOf(result: unknown): Partial<Settings> {
  return (result as { settings?: Partial<Settings> }).settings ?? {};
}

describe('migrateSettings — camera background (v4)', () => {
  it('adds the default camera background to a pre-v4 blob', () => {
    const persisted = { settings: { layout: 'screen+camera' } };
    const migrated = settingsOf(migrateSettings(persisted, 3, DEFAULTS));
    expect(migrated.cameraBackground).toEqual(DEFAULT_CAMERA_BACKGROUND);
    expect(migrated.cameraBackground?.mode).toBe('none');
  });

  it('preserves an existing camera background, only adding the v6 quality field', () => {
    const custom = { mode: 'blur', blur: 30, builtinId: 'ocean' } as const;
    const persisted = { settings: { cameraBackground: custom } };
    const migrated = settingsOf(migrateSettings(persisted, 4, DEFAULTS));
    expect(migrated.cameraBackground).toEqual({ ...custom, quality: 'auto' });
  });

  it('is a no-op on an empty blob (no settings)', () => {
    expect(() => migrateSettings({}, 3, DEFAULTS)).not.toThrow();
    expect(settingsOf(migrateSettings({}, 3, DEFAULTS)).cameraBackground).toBeUndefined();
  });
});

describe('migrateSettings — matting quality (v6)', () => {
  it('adds quality:auto to a pre-v6 camera background', () => {
    const persisted = {
      settings: { cameraBackground: { mode: 'builtin', blur: 18, builtinId: 'studio' } },
    };
    const migrated = settingsOf(migrateSettings(persisted, 5, DEFAULTS));
    expect(migrated.cameraBackground?.quality).toBe('auto');
    expect(migrated.cameraBackground?.builtinId).toBe('studio');
  });

  it('leaves an explicit quality choice untouched', () => {
    const custom = { mode: 'blur', blur: 30, builtinId: 'slate', quality: 'lite' } as const;
    const persisted = { settings: { cameraBackground: custom } };
    const migrated = settingsOf(migrateSettings(persisted, 5, DEFAULTS));
    expect(migrated.cameraBackground).toEqual(custom);
  });
});

describe('migrateSettings — camera lighting (v5)', () => {
  it('adds the default (off) camera lighting to a pre-v5 blob', () => {
    const persisted = { settings: { cameraBackground: DEFAULT_CAMERA_BACKGROUND } };
    const migrated = settingsOf(migrateSettings(persisted, 4, DEFAULTS));
    expect(migrated.cameraLighting).toEqual(DEFAULT_CAMERA_LIGHTING);
    expect(migrated.cameraLighting?.preset).toBe('off');
  });

  it('leaves an existing camera lighting untouched', () => {
    const custom = { preset: 'warm', brightness: 1.2, contrast: 1.1, saturate: 1.08, warmth: 0.4 } as const;
    const persisted = { settings: { cameraLighting: custom } };
    const migrated = settingsOf(migrateSettings(persisted, 5, DEFAULTS));
    expect(migrated.cameraLighting).toEqual(custom);
  });
});
