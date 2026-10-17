/** Only ordinary YouTube playback and its account/consent flow may navigate this
 * source. It never receives the studio preload or an arbitrary URL from a tool. */
export function youtubeWatchUrl(videoId: string, start: number) {
  if (!/^[\w-]{11}$/.test(videoId)) throw new Error('Invalid YouTube video ID.');
  return `https://www.youtube.com/watch?v=${videoId}&t=${Math.max(0, Math.floor(start))}s`;
}
export function allowedWatchNavigation(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && (!url.port || url.port === '443') &&
      ['www.youtube.com', 'youtube.com', 'accounts.google.com', 'consent.youtube.com', 'consent.google.com'].includes(url.hostname);
  } catch { return false; }
}
export function watchVideoId(value: string): string | undefined {
  try {
    const url = new URL(value), id = url.searchParams.get('v');
    if (allowedWatchNavigation(value) && ['www.youtube.com', 'youtube.com'].includes(url.hostname) && url.pathname === '/watch' && id && /^[\w-]{11}$/.test(id)) return id;
  } catch { /* Not a watch page. */ }
}
export interface PlayerRegion { x: number; y: number; width: number; height: number; viewportWidth: number; viewportHeight: number }
export function readPlayerRegion(value: unknown): PlayerRegion | undefined {
  if (!value || typeof value !== 'object') return;
  const r = value as Record<string, unknown>;
  const keys = ['x', 'y', 'width', 'height', 'viewportWidth', 'viewportHeight'] as const;
  if (keys.some(k => typeof r[k] !== 'number' || !Number.isInteger(r[k]) || (r[k] as number) < 0 || (r[k] as number) > 8192)) return;
  const region = r as unknown as PlayerRegion;
  if (region.width < 100 || region.height < 100 || region.x + region.width > region.viewportWidth || region.y + region.height > region.viewportHeight) return;
  return region;
}
