import { FULL_PICTURE, validPicture, type ActivePicture } from './activePicture.js';
import { WIDTH, HEIGHT, type Bounds } from './geometry.js';

export const YOUTUBE_LIMITS = { inputLength: 2048, maxStartSeconds: 86400, minPlayerWidth: 200, minPlayerHeight: 200 } as const;
export const YOUTUBE_MIN_BOUNDS = { w: 1 / WIDTH, h: 1 / HEIGHT } as const;
/** The iframe has a fixed source viewport; the calibrated canvas scales its image independently. */
export function youtubePlayerLayout(bounds: Bounds) {
  const width = bounds.w * WIDTH, height = bounds.h * HEIGHT;
  const scale = Math.min(width / WIDTH, height / HEIGHT);
  return { width: WIDTH * scale, height: HEIGHT * scale, left: (width - WIDTH * scale) / 2, top: (height - HEIGHT * scale) / 2, scale };
}
/** Keep the picture in its original position; removing mattes never zooms it. */
export function youtubePictureBounds(bounds: Bounds, picture: ActivePicture = FULL_PICTURE): Bounds {
  const layout = youtubePlayerLayout(bounds), crop = validPicture(picture);
  return { x: bounds.x + (layout.left + layout.width * crop.left) / WIDTH,
    y: bounds.y + (layout.top + layout.height * crop.top) / HEIGHT,
    w: layout.width * (crop.right - crop.left) / WIDTH, h: layout.height * (crop.bottom - crop.top) / HEIGHT };
}
export const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
export interface YouTubeInput { videoId: string; startSeconds: number }

function seconds(value: string | null) {
  if (value === null) return 0;
  const match = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/i.exec(value);
  const result = /^\d+$/.test(value) ? Number(value) : value && match ? Number(match[1] ?? 0) * 3600 + Number(match[2] ?? 0) * 60 + Number(match[3] ?? 0) : NaN;
  if (!Number.isSafeInteger(result) || result < 0 || result > YOUTUBE_LIMITS.maxStartSeconds) throw new Error('YouTube start time must be 0–86400 whole seconds.');
  return result;
}
/** Parse only known YouTube URL forms. Never fetch arbitrary input or infer a video from a title. */
export function parseYouTubeInput(input: string): YouTubeInput {
  if (typeof input !== 'string' || !input.trim() || input.length > YOUTUBE_LIMITS.inputLength) throw new Error('Paste a YouTube video URL or its 11-character video ID.');
  const text = input.trim();
  if (YOUTUBE_ID.test(text)) return { videoId: text, startSeconds: 0 };
  let url: URL;
  try { url = new URL(/^https?:\/\//i.test(text) ? text : 'https://' + text); } catch { throw new Error('Use a valid YouTube video URL.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port) throw new Error('Use a standard YouTube URL without credentials or a custom port.');
  const host = url.hostname.toLowerCase(), segments = url.pathname.split('/').filter(Boolean);
  let videoId: string | null = null;
  if (['youtu.be', 'www.youtu.be'].includes(host) && segments.length === 1) videoId = segments[0];
  else if (['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com'].includes(host)) {
    if (segments.length === 1 && segments[0] === 'watch' && url.searchParams.getAll('v').length === 1) videoId = url.searchParams.get('v');
    else if (segments.length === 2 && ['embed', 'shorts', 'live'].includes(segments[0])) videoId = segments[1];
  } else if (['youtube-nocookie.com', 'www.youtube-nocookie.com'].includes(host) && segments.length === 2 && segments[0] === 'embed') videoId = segments[1];
  if (!videoId || !YOUTUBE_ID.test(videoId)) throw new Error('Use a YouTube video link, not a playlist, search, or another website.');
  if (url.searchParams.getAll('start').length > 1 || url.searchParams.getAll('t').length > 1) throw new Error('Use one YouTube start time.');
  const start = url.searchParams.get('start') ?? url.searchParams.get('t') ?? new URLSearchParams(url.hash.slice(1)).get('t');
  return { videoId, startSeconds: seconds(start) };
}
export function youtubeEmbedUrl(videoId: string, startSeconds: number, origin: string) {
  if (!YOUTUBE_ID.test(videoId)) throw new Error('Invalid YouTube video ID.');
  seconds(String(startSeconds));
  const owner = new URL(origin);
  if (!['http:', 'https:'].includes(owner.protocol) || owner.origin !== origin) throw new Error('YouTube requires an HTTP studio origin.');
  const url = new URL('https://www.youtube.com/embed/' + videoId);
  url.search = new URLSearchParams({ enablejsapi: '1', origin, start: String(startSeconds), playsinline: '1', autoplay: '0', mute: '1', controls: '1', rel: '0' }).toString();
  return url.href;
}
