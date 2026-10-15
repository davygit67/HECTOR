import type { Scene, Timer } from '../../src/shared/domain.js';
import type { ContentInstance } from '../../src/shared/content.js';
import { DISPLAY_DEFAULTS, layerOpacity, layerVisible } from '../../src/shared/layers.js';

/** Settings describe eligibility for output, never proof that pixels reached the projector. */
export function presentationContext(scene: Scene, item: ContentInstance | Timer) {
  const display = { ...DISPLAY_DEFAULTS, ...scene.display };
  const layer = { visible: layerVisible(item), opacity: layerOpacity(item), locked: item.layer?.locked ?? false };
  const hiddenBy = [
    ...(display.blackout ? ['output blackout'] : []),
    ...(display.brightness === 0 ? ['zero output brightness'] : []),
    ...(!layer.visible ? ['hidden layer'] : []),
    ...(layer.opacity === 0 ? ['zero layer opacity'] : []),
  ];
  return { layer, display, hiddenBy, outputVerified: false as const };
}
