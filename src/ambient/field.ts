// Ambient backlight, adapted from adknate05's Projection Mapper (HECTOR branch `codex/nate-projection-mapper`,
// commit 912f609, src/backlightField.ts). Reused with the author's permission; see docs/THIRD_PARTY.md.
// HECTOR changes: the module-level store becomes one instance per renderer, keyed by surface, so the studio
// preview and the projector output smooth and fade their own samples independently.
import { FULL_PICTURE, samePicture, validPicture, type ActivePicture } from './activePicture';
import { BACKLIGHT_DEFAULTS, smoothColors, type BacklightSample, type ColorRegion } from './backlight';

export interface FieldReading { colors: ColorRegion[]; picture: ActivePicture; alpha: number }
/** Light holds briefly after the last sample, then fades out: a stalled or missing source never keeps a stale glow. */
export const fade = (sampledAt: number, now: number) => Math.max(0, 1 - Math.max(0, now - sampledAt - 350) / 650);
export class BacklightFields {
  private fields = new Map<string, { colors: ColorRegion[]; sampledAt: number; picture: ActivePicture; revision: number }>();
  private revision = 0;
  update(id: string, sample: BacklightSample, smoothingMs = BACKLIGHT_DEFAULTS.smoothingMs) {
    const previous = this.fields.get(id), delta = previous ? Math.max(0, Math.min(1000, sample.sampledAt - previous.sampledAt)) : 100;
    const converged=previous?.colors.length===sample.colors.length && sample.colors.every((c,i)=>c.region===previous.colors[i].region&&c.color.every((v,k)=>Math.abs(v-previous.colors[i].color[k])<.12)&&(['slope','curvature','confidence'] as const).every(k=>Math.abs((c.continuation?.[k]??0)-(previous.colors[i].continuation?.[k]??0))<.002));
    const picture=validPicture(sample.picture), boundaryChanged=!samePicture(picture,previous?.picture??FULL_PICTURE);
    const colors=boundaryChanged?sample.colors:converged?previous!.colors:smoothColors(previous?.colors??[],sample.colors,delta,smoothingMs);
    const changed=colors!==previous?.colors||!samePicture(picture,previous?.picture??FULL_PICTURE);
    if(changed)this.revision++;
    this.fields.set(id,{sampledAt:Math.max(sample.sampledAt,previous?.sampledAt??sample.sampledAt),colors,picture,revision:changed?this.revision:previous!.revision});
  }
  clear(id: string) { if (this.fields.delete(id)) this.revision++; }
  read(id: string, now: number): FieldReading | null {
    const field = this.fields.get(id); if (!field) return null;
    const alpha = fade(field.sampledAt, now);
    return alpha ? { colors: field.colors, picture: field.picture, alpha } : null;
  }
}
