import type { Command } from '../../src/shared/domain.js';

/** Transport allowlist only; the canonical canvas reducer validates payloads. */
export const AGENT_COMMAND_TYPES = Object.freeze([
  'timer.create', 'timer.action', 'timer.attach', 'timer.remove',
  'content.create', 'content.update', 'content.action', 'content.attach', 'content.remove',
  'youtube.backlight', 'youtube.backlight.configure',
  'grid.set', 'timer.select', 'timer.update', 'timer.move', 'content.select', 'content.move',
  'layer.configure', 'layer.reorder', 'display.configure', 'media.seek', 'calibration.set', 'calibration.reset',
  'manual.target', 'output.view', 'surface.select', 'surface.fill', 'surface.move', 'surface.demo-exclusion', 'projector.update', 'viewer.update',
] as const satisfies readonly Command['type'][]);
