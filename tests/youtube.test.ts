import { describe, expect, it } from 'vitest';
import { parseYouTubeLink, playerError, playerKey } from '../src/core/youtube';
const id = 'M7lc1UVf-VE';
describe('YouTube link parsing', () => {
  it.each([
    [`https://www.youtube.com/watch?v=${id}`, 0],
    [`https://youtube.com/watch?feature=share&v=${id}&t=90`, 90],
    [`http://m.youtube.com/watch?v=${id}&t=1m30s`, 90],
    [`https://music.youtube.com/watch?v=${id}&list=RD123`, 0],
    [`https://youtu.be/${id}`, 0],
    [`https://youtu.be/${id}?si=abc&t=1h2m3s`, 3723],
    [`youtu.be/${id}`, 0],
    [`www.youtube.com/watch?v=${id}`, 0],
    [`https://www.youtube.com/embed/${id}?start=42`, 42],
    [`https://www.youtube-nocookie.com/embed/${id}`, 0],
    [`https://www.youtube.com/shorts/${id}`, 0],
    [`https://www.youtube.com/live/${id}?feature=share`, 0],
    [`https://www.youtube.com/v/${id}`, 0],
    [`  ${id}  `, 0],
    [`https://www.youtube.com/watch?v=${id}&t=nonsense`, 0],
    [`https://www.youtube.com/watch?v=${id}&t=999999`, 86400]
  ])('accepts %s', (link, start) => expect(parseYouTubeLink(link)).toEqual({ ok: true, videoId: id, start }));
  it.each([
    ['', /Paste a YouTube video link/],
    ['   ', /Paste a YouTube video link/],
    ['https://vimeo.com/123456', /Only YouTube video links/],
    ['https://youtube.com.evil.example/watch?v=' + id, /Only YouTube video links/],
    ['https://notyoutube.com/watch?v=' + id, /Only YouTube video links/],
    ['javascript:alert(1)', /not a valid link|Only http/],
    ['ftp://youtube.com/watch?v=' + id, /Only http and https/],
    ['https://www.youtube.com/playlist?list=PL123', /Playlists are not supported/],
    ['https://www.youtube.com/watch?list=PL123', /Playlists are not supported/],
    ['https://www.youtube.com/@GoogleDevelopers', /channel link/],
    ['https://www.youtube.com/channel/UC_x5XG1OV2P6uZZ5FSM9Ttw', /channel link/],
    ['https://www.youtube.com/watch?v=short', /valid YouTube video ID/],
    ['https://youtu.be/', /does not point to a video/],
    ['https://www.youtube.com/', /does not point to a video/],
    ['https://www.youtube.com/watch?v=' + id + '"><script>', /valid YouTube video ID/],
    ['x'.repeat(3000), /too long/]
  ])('rejects %j', (link, error) => {
    const result = parseYouTubeLink(link);
    expect(result.ok).toBe(false); if (!result.ok) expect(result.error).toMatch(error);
  });
});
describe('YouTube player errors and identity', () => {
  it('explains IFrame API and player failures in plain language', () => {
    expect(playerError(150)).toMatch(/disabled embedding/);
    expect(playerError(101)).toBe(playerError(150));
    expect(playerError(100)).toMatch(/not found/);
    expect(playerError(2)).toMatch(/rejected/);
    expect(playerError(5)).toMatch(/HTML5/);
    expect(playerError('network')).toMatch(/network connection/);
    expect(playerError('timeout')).toMatch(/did not respond/);
    expect(playerError(999)).toMatch(/error 999/);
  });
  it('gives each source/video/start pairing its own player key', () => {
    expect(playerKey({ id: 'a', videoId: id })).toBe(`a:${id}:0`);
    expect(playerKey({ id: 'a', videoId: id, start: 5 })).not.toBe(playerKey({ id: 'a', videoId: id }));
  });
});
