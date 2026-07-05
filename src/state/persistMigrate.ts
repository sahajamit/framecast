import type { Settings } from './store';
import { DEFAULT_CAMERA_BACKGROUND, DEFAULT_FRAME } from '../compositor/layout';
import { DEFAULT_CAMERA_LIGHTING } from '../compositor/lighting';

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
  // v5 added camera lighting; existing installs default to 'off' (no grade).
  if (version < 5 && state.settings && !state.settings.cameraLighting) {
    state.settings = { ...state.settings, cameraLighting: DEFAULT_CAMERA_LIGHTING };
  }
  // v6 added matting quality to the camera background (issue #11).
  if (version < 6 && state.settings?.cameraBackground && !state.settings.cameraBackground.quality) {
    state.settings = {
      ...state.settings,
      cameraBackground: { ...state.settings.cameraBackground, quality: 'auto' },
    };
  }
  return state;
}
