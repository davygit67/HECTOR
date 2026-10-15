import { FULL_PICTURE, samePicture, validPicture, type ActivePicture } from './shared/activePicture';
import { BACKLIGHT_DEFAULTS, smoothColors, type BacklightSample, type ColorRegion } from './shared/backlight';
const fields = new Map<string, { colors: ColorRegion[]; sampledAt: number; picture: ActivePicture; revision: number }>();
let revision = 0;
export function updateBacklight(id: string, sample: BacklightSample, smoothingMs = BACKLIGHT_DEFAULTS.smoothingMs) {
  const previous = fields.get(id), delta = previous ? Math.max(0, Math.min(1000, sample.sampledAt - previous.sampledAt)) : 100;
  const converged=previous?.colors.length===sample.colors.length && sample.colors.every((c,i)=>c.region===previous.colors[i].region&&c.color.every((v,k)=>Math.abs(v-previous.colors[i].color[k])<.12)&&(['slope','curvature','confidence'] as const).every(k=>Math.abs((c.continuation?.[k]??0)-(previous.colors[i].continuation?.[k]??0))<.002));
  const picture=validPicture(sample.picture), boundaryChanged=!samePicture(picture,previous?.picture??FULL_PICTURE);
  const colors=boundaryChanged?sample.colors:converged?previous!.colors:smoothColors(previous?.colors??[],sample.colors,delta,smoothingMs);
  const changed=colors!==previous?.colors||!samePicture(picture,previous?.picture??FULL_PICTURE);
  if(changed)revision++;
  fields.set(id,{sampledAt:Math.max(sample.sampledAt,previous?.sampledAt??sample.sampledAt),colors,picture,revision:changed?revision:previous!.revision});
}
export function clearBacklight(id: string) { if (fields.delete(id)) revision++; }
export function backlightRevision(id?: string) { return id === undefined ? revision : fields.get(id)?.revision ?? 0; }
export function readBacklight(id: string, now: number) {
  const field = fields.get(id); if (!field) return null;
  const alpha = Math.max(0, 1 - Math.max(0, now - field.sampledAt - 350) / 650);
  return alpha ? { colors: field.colors, picture: field.picture, alpha } : null;
}
