import type { Settings } from './store';
import { DEFAULT_CAMERA_BACKGROUND, DEFAULT_FRAME } from '../compositor/layout';

type PersistedShape = { settings?: Partial<Settings> };

/**
 * Forward-migrates a persisted settings blob to the current schema. Kept pure
 * and window-free (unlike the store singleton) so it is directly unit-testable.
 * Each version bump adds a field with a sane default, so an upgrade is visually
 * a no-op until the user touches the new control.
 */
export function migrateSettings(persisted: unknown, version: number, defaults: Settings): unknown {
  const state = (persisted ?? {}) as PersistedShape;
  if (version < 2 && state.settings) {
    state.settings = { ...defaults, ...state.settings };
  }
  // v3 added scene framing.
  if (version < 3 && state.settings && !state.settings.frame) {
    state.settings = { ...state.settings, frame: DEFAULT_FRAME };
  }
  // v4 added the camera background; existing installs default to 'none'.
  if (version < 4 && state.settings && !state.settings.cameraBackground) {
    state.settings = { ...state.settings, cameraBackground: DEFAULT_CAMERA_BACKGROUND };
  }
  return state;
}
