/** Float color math. sRGB transfer + Oklab matrices: https://bottosson.github.io/posts/oklab/ */
export type Vec3 = [number, number, number];
export const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
export const srgbToLinear = (v: number) => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4;
export const linearToSrgb = (v: number) => v <= .0031308 ? Math.max(0, v) * 12.92 : 1.055 * v ** (1 / 2.4) - .055;
export const toLinear = (rgb: Vec3): Vec3 => rgb.map(c => srgbToLinear(c / 255)) as Vec3;
export const toSRGB = (rgb: Vec3): Vec3 => rgb.map(c => 255 * linearToSrgb(clamp01(c))) as Vec3;
export const luminance = (rgb: Vec3) => .2126 * rgb[0] + .7152 * rgb[1] + .0722 * rgb[2];
export function linearToLab([r,g,b]: Vec3): Vec3 {
  const l=Math.cbrt(.4122214708*r+.5363325363*g+.0514459929*b), m=Math.cbrt(.2119034982*r+.6806995451*g+.1073969566*b), s=Math.cbrt(.0883024619*r+.2817188376*g+.6299787005*b);
  return [.2104542553*l+.793617785*m-.0040720468*s,1.9779984951*l-2.428592205*m+.4505937099*s,.0259040371*l+.7827717662*m-.808675766*s];
}
export function labToLinear([L,a,b]: Vec3): Vec3 {
  const l=(L+.3963377774*a+.2158037573*b)**3,m=(L-.1055613458*a-.0638541728*b)**3,s=(L-.0894841775*a-1.291485548*b)**3;
  return [4.0767416621*l-3.3077115913*m+.2309699292*s,-1.2684380046*l+2.6097574011*m-.3413193965*s,-.0041960863*l-.7034186147*m+1.707614701*s];
}
/** Reduce chroma at constant perceptual lightness/hue instead of clipping channels. */
export function gamutMap([L,a,b]: Vec3): Vec3 {
  let lo=0,hi=1, rgb=labToLinear([L,a,b]);
  if (rgb.every(c=>c>=-1e-6&&c<=1.000001)) return rgb.map(clamp01) as Vec3;
  for(let i=0;i<10;i++){ const t=(lo+hi)/2; const test=labToLinear([L,a*t,b*t]); if(test.every(c=>c>=0&&c<=1))lo=t;else hi=t; }
  return labToLinear([L,a*lo,b*lo]).map(clamp01) as Vec3;
}
