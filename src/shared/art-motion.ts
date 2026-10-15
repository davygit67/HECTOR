import { clockMs, randomUnit, type ArtContent } from './content.js';

export interface SwimmingFish {
  x: number; y: number; size: number; direction: 1 | -1;
  tilt: number; tail: number; shade: number;
}
const fraction = (value: number) => ((value % 1) + 1) % 1;

/** Analytic animation: every output samples the same saved clock, without per-view simulation. */
export function swimmingFish(art: ArtContent, now: number): SwimmingFish[] {
  const seconds = clockMs(art.state.clock, now) / 1000 * art.config.speed;
  const seed = art.config.seed;
  return Array.from({ length: 16 }, (_, index) => {
    const phase = randomUnit(seed, index + 100) * Math.PI * 2;
    const direction = randomUnit(seed, index + 200) > .4 ? 1 : -1;
    const progress = fraction(index / 16 + randomUnit(seed, index + 300) * .1 + seconds / (25 + randomUnit(seed, index + 400) * 30));
    const sway = seconds * .45 + phase;
    return {
      x: -.2 + (direction === 1 ? progress : 1 - progress) * 1.4,
      y: .13 + randomUnit(seed, index + 500) * .72 + Math.sin(sway) * .055,
      size: .035 + randomUnit(seed, index + 600) * .045,
      direction, tilt: Math.cos(sway) * .11 * direction,
      tail: Math.sin(seconds * (5 + randomUnit(seed, index + 700) * 3) + phase),
      shade: index % 3,
    };
  });
}
