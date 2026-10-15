export interface PixelFrame { width: number; height: number; data: ArrayLike<number>; order?: 'rgba' | 'bgra' }
/** Source-video coordinates, before any placement or projector transform. */
export interface ActivePicture { left: number; top: number; right: number; bottom: number }
export const FULL_PICTURE: Readonly<ActivePicture> = { left: 0, top: 0, right: 1, bottom: 1 };
export const samePicture = (a: ActivePicture, b: ActivePicture) => a.left === b.left && a.top === b.top && a.right === b.right && a.bottom === b.bottom;

export function validPicture(value?: ActivePicture): ActivePicture {
  if (!value || ![value.left, value.top, value.right, value.bottom].every(Number.isFinite) || value.left < 0 || value.top < 0 || value.right > 1 || value.bottom > 1 || value.right - value.left < .1 || value.bottom - value.top < .1) return FULL_PICTURE;
  return value;
}

function litFraction(frame: PixelFrame, rect: ActivePicture) {
  const { width, height, data } = frame;
  let lit = 0, count = 0;
  const w = Math.max(1, Math.min(64, Math.ceil((rect.right - rect.left) * width))), h = Math.max(1, Math.min(36, Math.ceil((rect.bottom - rect.top) * height)));
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const sx = Math.min(width - 1, Math.floor((rect.left + (x + .5) / w * (rect.right - rect.left)) * width));
    const sy = Math.min(height - 1, Math.floor((rect.top + (y + .5) / h * (rect.bottom - rect.top)) * height)), i = (sy * width + sx) * 4;
    if (Math.max(data[i], data[i + 1], data[i + 2]) > 32) lit++;
    count++;
  }
  return lit / count;
}

/** Paired, neutral, near-black edge strips with a lit interior. The scan keeps
 * full source-pixel precision while sampling at most 96 points per row/column.
 * This is a rectangular matte detector, never a black-pixel transparency key. */
export function detectActivePicture(frame: PixelFrame): ActivePicture {
  const { width: w, height: h, data } = frame;
  if (w < 4 || h < 4 || data.length !== w * h * 4) return FULL_PICTURE;
  const darkLine = (row: boolean, at: number) => {
    const size = row ? w : h, count = Math.min(96, size); let dark = 0;
    for (let j = 0; j < count; j++) {
      const along = Math.min(size - 1, Math.floor((j + .5) * size / count)), i = (row ? at * w + along : along * w + at) * 4;
      const max = Math.max(data[i], data[i + 1], data[i + 2]), min = Math.min(data[i], data[i + 1], data[i + 2]);
      if (max <= 18 && max - min <= 6) dark++;
    }
    return dark / count >= .97;
  };
  let top = 0, bottom = 0, left = 0, right = 0;
  while (top < h * .44 && darkLine(true, top)) top++;
  while (bottom < h * .44 && darkLine(true, h - 1 - bottom)) bottom++;
  while (left < w * .44 && darkLine(false, left)) left++;
  while (right < w * .44 && darkLine(false, w - 1 - right)) right++;
  const paired = (a: number, b: number, size: number) => a >= 2 && b >= 2 && a < size * .44 && b < size * .44 && Math.abs(a - b) <= Math.max(2, size * .015);
  const vertical = paired(top, bottom, h), horizontal = paired(left, right, w);
  const picture = { left: horizontal ? left / w : 0, right: horizontal ? 1 - right / w : 1, top: vertical ? top / h : 0, bottom: vertical ? 1 - bottom / h : 1 };
  return litFraction(frame, picture) >= .06 ? picture : FULL_PICTURE;
}

/** Inward changes must persist; fades hold the last known boundary. Expansion
 * needs new image across the old matte, so a small caption does not open it. */
export function createPictureTracker() {
  let active: ActivePicture = FULL_PICTURE, candidate: ActivePicture = FULL_PICTURE, since = 0, settling = false;
  return {
    picture: () => active,
    settling: () => settling,
    update(frame: PixelFrame, now: number): ActivePicture {
      if (litFraction(frame, FULL_PICTURE) < .03) { settling = false; return active; }
      const next = detectActivePicture(frame);
      const strips: ActivePicture[] = [];
      if (next.top < active.top) strips.push({ ...active, top: next.top, bottom: active.top });
      if (next.bottom > active.bottom) strips.push({ ...active, top: active.bottom, bottom: next.bottom });
      if (next.left < active.left) strips.push({ ...active, left: next.left, right: active.left });
      if (next.right > active.right) strips.push({ ...active, left: active.right, right: next.right });
      if (strips.some(strip => litFraction(frame, strip) < .12)) { settling = false; return active; }
      if (!settling || !samePicture(candidate, next)) { candidate = next; since = now; }
      settling = !samePicture(active, next);
      if (settling && now - since >= (strips.length ? 120 : 600)) { active = next; settling = false; }
      return active;
    },
  };
}
