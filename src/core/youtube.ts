import { z } from 'zod';
/** YouTube video IDs are 11 URL-safe base64 characters. */
export const youtubeIdSchema = z.string().regex(/^[A-Za-z0-9_-]{11}$/, 'That link does not contain a valid YouTube video ID.');
export type YouTubeLink = { ok: true; videoId: string; start: number } | { ok: false; error: string };
const videoHosts = new Set(['youtube.com', 'youtu.be', 'youtube-nocookie.com']);
const pathPrefixes = ['embed', 'shorts', 'live', 'v', 'e'];
/** `t`/`start` values YouTube accepts: plain seconds or 1h2m3s parts. Anything else starts at 0, as YouTube does. */
function seconds(value: string | null) {
  if (!value) return 0;
  const match = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?$/.exec(value.trim());
  if (!match || !value.trim()) return 0;
  const total = Number(match[1] ?? 0) * 3600 + Number(match[2] ?? 0) * 60 + Number(match[3] ?? 0);
  return Math.min(86400, total);
}
/** Accepts watch, youtu.be, embed, shorts, live and nocookie links (with optional start time) or a bare video ID. */
export function parseYouTubeLink(input: string): YouTubeLink {
  const text = input.trim();
  if (!text) return { ok: false, error: 'Paste a YouTube video link.' };
  if (text.length > 2048) return { ok: false, error: 'That link is too long.' };
  if (youtubeIdSchema.safeParse(text).success) return { ok: true, videoId: text, start: 0 };
  let url: URL;
  try { url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`); }
  catch { return { ok: false, error: 'That is not a valid link. Paste a youtube.com or youtu.be video link.' }; }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return { ok: false, error: 'Only http and https YouTube links are supported.' };
  const host = url.hostname.toLowerCase().replace(/^(www|m|music)\./, '');
  if (!videoHosts.has(host)) return { ok: false, error: 'Only YouTube video links are supported (youtube.com or youtu.be).' };
  const parts = url.pathname.split('/').filter(Boolean), start = seconds(url.searchParams.get('t') ?? url.searchParams.get('start'));
  let id: string | null | undefined;
  if (host === 'youtu.be') id = parts[0];
  else if (parts[0] === 'watch') id = url.searchParams.get('v');
  else if (pathPrefixes.includes(parts[0])) id = parts[1];
  else if (parts[0] === 'playlist' || (!parts.length && url.searchParams.has('list'))) return { ok: false, error: 'Playlists are not supported. Open one video and paste its link.' };
  else if (parts[0]?.startsWith('@') || ['channel', 'c', 'user'].includes(parts[0])) return { ok: false, error: 'That is a channel link. Paste a link to a single video.' };
  if (!id) return { ok: false, error: url.searchParams.has('list') ? 'Playlists are not supported. Open one video and paste its link.' : 'That YouTube link does not point to a video.' };
  return youtubeIdSchema.safeParse(id).success ? { ok: true, videoId: id, start } : { ok: false, error: 'That link does not contain a valid YouTube video ID.' };
}

export type PlayerState = 'loading' | 'ready' | 'playing' | 'paused' | 'buffering' | 'ended' | 'error' | 'closed' | 'minimized';
/** Status of one official YouTube player window, owned by main. `captureId` is set while the window can be captured. */
export interface PlayerStatus { state: PlayerState; title: string; duration: number; error: string; captureId: string | null }
/** Draft and applied scenes may hold different videos for one source; each pairing gets its own player. */
export const playerKey = (source: { id: string; videoId?: string; start?: number }) => `${source.id}:${source.videoId}:${source.start ?? 0}`;
/** Plain-language meaning of YouTube IFrame API error codes and of HECTOR's own player failures. */
export function playerError(code: number | 'network' | 'timeout' | 'crashed') {
  switch (code) {
    case 2: return 'YouTube rejected this video ID.';
    case 5: return 'The embedded player could not play this video (HTML5 player error).';
    case 100: return 'Video not found: it may be private or removed.';
    // YouTube also answers 150 for unknown or removed videos, so the message names both causes.
    case 101: case 150: return 'Unavailable in embedded players: the owner may have disabled embedding, or the video is private, removed or restricted.';
    case 153: return 'YouTube refused the embedded player request (player identity missing).';
    case 'network': return 'Could not reach YouTube. Check the network connection, then reload the player.';
    case 'timeout': return 'YouTube did not respond in time. Check the network connection, then reload the player.';
    case 'crashed': return 'The YouTube player stopped unexpectedly. Reload the player.';
    default: return `The YouTube player reported error ${code}.`;
  }
}
