import { clearBacklight, updateBacklight } from './backlightField';
import { colorSourceMessage, hasColorSource, sampleVideo, startTabColors, stopTabColors, useColorSource } from './backlightRuntime';
import { BACKLIGHT_DEFAULTS, type BacklightSample } from './shared/backlight';
import type { Quad } from './shared/geometry';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { YouTubeContent } from './shared/content';
import { youtubeEmbedUrl, youtubePlayerLayout } from './shared/youtube';
import { WIDTH, HEIGHT } from './shared/geometry';
import { startVisiblePlayer } from './youtubeStartup';

import { loadAPI, youtubePlayerError, type Player } from './youtubeAPI';
import { NativeYouTubePlayer } from './NativeYouTubePlayer';

/** Official iframe only. Its clock stays local; scene changes never claim confirmed playback. */
function BrowserYouTubePlayer({ content, feedbackHost, visible = true }: { content: YouTubeContent; feedbackHost: HTMLDivElement | null; visible?: boolean }) {
  const host = useRef<HTMLDivElement>(null), plane = useRef<HTMLDivElement>(null), playerRef = useRef<Player | undefined>(undefined);
  const [muted, setMuted] = useState(true);
  const [sourceError, setSourceError] = useState(''), [sourcePending, setSourcePending] = useState(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const [playerState, setPlayerState] = useState(-1), [lightStatus, setLightStatus] = useState('Live colors need a video source.');
  const current = useRef(content); current.current = content;
  const visibleRef = useRef(visible); visibleRef.current = visible;
  const playback = useRef(playerState); playback.current = playerState;
  const [ready, setReady] = useState(false), [status, setStatus] = useState('Loading YouTube…'), [failed, setFailed] = useState(false), [retry, setRetry] = useState(0);
  const { videoId, startSeconds } = content.config;
  const layout = youtubePlayerLayout(content.bounds);
  useEffect(() => {
    const node = host.current!;
    setStatus('Loading YouTube…'); setFailed(false); setReady(false); setPlayerState(-1); clearBacklight(content.id);
    return startVisiblePlayer({
      loading: reconnecting => { setStatus(reconnecting ? 'Reconnecting to YouTube…' : 'Loading YouTube…'); setFailed(false); setReady(false); },
      waiting: () => setStatus('Waiting for this window to be visible…'),
      failed: text => { setStatus(text); setFailed(true); setReady(false); setPlayerState(-1); clearBacklight(content.id); },
      start: attempt => {
        let player: Player | undefined;
        void loadAPI().then(api => {
          if (!attempt.current()) return;
          const frame = document.createElement('iframe');
          frame.width = String(WIDTH); frame.height = String(HEIGHT);
          frame.loading = 'eager';
          frame.title = 'YouTube video player'; frame.src = youtubeEmbedUrl(videoId, startSeconds, location.origin);
          frame.referrerPolicy = 'strict-origin-when-cross-origin';
          frame.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share';
          frame.allowFullscreen = true;
          node.append(frame);
          player = new api.Player(frame, { events: {
            onReady: () => { if (attempt.current()) { player?.mute(); setMuted(true); attempt.ready(); setReady(true); setFailed(false); setStatus('Ready · muted · press Play'); } },
            onStateChange: event => { if (attempt.current()) { attempt.ready(); setReady(true); setPlayerState(event.data); setFailed(false); setStatus(({ '-1': 'Ready · press Play in the video', 0: 'Video ended', 1: 'Playing · this window', 2: 'Paused · this window', 3: 'Buffering…', 5: 'Ready · press Play in the video' } as Record<number, string>)[event.data] ?? 'Player ready'); } },
            onError: event => attempt.fail(youtubePlayerError(event.data)),
            onAutoplayBlocked: () => { if (attempt.current()) setStatus('Press Play in the video to allow playback.'); },
          } });
          playerRef.current = player;
        }).catch(error => attempt.fail(error instanceof Error ? error.message : 'The YouTube player could not load.'));
        return () => { playerRef.current = undefined; player?.destroy(); node.replaceChildren(); };
      },
    });
    // Deliberately exclude title, backlight and placement: changing these must not re-cue the video.
  }, [videoId, startSeconds, retry]);
  // The sharing session belongs to the opened player, not its selected view/source.
  useEffect(() => useColorSource(content.id), [content.id]);
  useEffect(() => {
    if (!content.config.backlight) { clearBacklight(content.id); return; }
    let cancelled = false, timer: ReturnType<typeof setTimeout> | undefined, previous: BacklightSample | undefined;
    const run = async () => {
      try {
        if (!visibleRef.current) throw new Error(hasColorSource() ? 'Sharing is kept. Show the video in Surface layout or Manual alignment for live colors.' : 'Show the video in Surface layout or Manual alignment to enable live colors.');
        if (document.visibilityState !== 'visible') throw new Error('Show the player window to sample live colors.');
        if (!hasColorSource()) throw new Error(colorSourceMessage());
        if (![1, 2, 3].includes(playback.current)) throw new Error('Press Play to begin live colors.');
        if (playback.current === 2 && previous) {
          setSourceError(''); updateBacklight(content.id, { ...previous, sampledAt: Date.now() }, current.current.config.backlightSettings?.smoothingMs);
          setLightStatus('Colors held · video paused');
        } else {
          const corners = Array.from(plane.current!.querySelectorAll<HTMLElement>('[data-video-corner]')).map(node => { const b = node.getBoundingClientRect(); return { x: b.x, y: b.y }; }) as Quad;
          if (corners.some(p => p.x < 0 || p.y < 0 || p.x > innerWidth || p.y > innerHeight)) throw new Error('Keep the whole player visible for live colors.');
          const sample = await sampleVideo({ contentId: content.id, quad: corners, viewport: { width: innerWidth, height: innerHeight } });
          const after = Array.from(plane.current?.querySelectorAll<HTMLElement>('[data-video-corner]') ?? []).map(node => node.getBoundingClientRect());
          if (!cancelled && after.length === 4 && after.every((p, i) => Math.abs(p.x - corners[i].x) < 1 && Math.abs(p.y - corners[i].y) < 1)) {
            setSourceError(''); previous = sample; updateBacklight(content.id, sample, current.current.config.backlightSettings?.smoothingMs ?? BACKLIGHT_DEFAULTS.smoothingMs);
            setLightStatus(sample.dark ? 'Dark or unavailable pixels · glow dimmed' : 'Live colors · sample ' + Math.round(sample.costMs) + ' ms');
          }
        }
      } catch (error) { if (!cancelled) setLightStatus(error instanceof Error ? error.message : 'Live colors unavailable.'); }
      if (!cancelled) timer = setTimeout(run, 100);
    };
    void run();
    return () => { cancelled = true; clearTimeout(timer); clearBacklight(content.id); };
  }, [content.id, content.config.backlight, videoId, startSeconds]);
  const enableColors = async () => {
    if (sourcePending) return;
    setSourceError(''); setSourcePending(true);
    try { await startTabColors(); if (mounted.current) setLightStatus('Studio tab shared · waiting for video colors.'); } catch (error) { if (mounted.current) setSourceError(error instanceof DOMException && error.name === 'NotAllowedError' ? 'Tab sharing wasn’t allowed. Retry in a supported browser or use the desktop app.' : error instanceof Error ? error.message : 'Tab sharing was not enabled.'); }
    finally { if (mounted.current) setSourcePending(false); }
  };
  return <><div className="youtube-panel" aria-label={content.title + ' · YouTube player'}>
    <div className="youtube-player-plane" ref={plane} style={{ left: layout.left, top: layout.top, width: layout.width, height: layout.height }}>
      <div className="youtube-player-host" ref={host} style={{ width: WIDTH, height: HEIGHT, transform: `scale(${layout.scale})`, transformOrigin: 'top left' }} />
      {[[0, 0], [100, 0], [100, 100], [0, 100]].map(([x, y], index) => <i key={index} data-video-corner={index} style={{ position: 'absolute', left: x + '%', top: y + '%', width: 0, height: 0, pointerEvents: 'none' }} />)}
    </div>
  </div>{feedbackHost && createPortal(<div className="youtube-feedback" aria-label={content.title + ' · playback controls'}>
      <strong>{content.title}</strong>
      <div className={'youtube-status ' + (failed ? 'failed' : '')}><span role="status" title={status}>{status}</span>{failed ? <button onClick={() => setRetry(n => n + 1)}>Retry</button> : <button disabled={!ready} aria-label={(playerState === 1 ? 'Pause ' : 'Play ') + content.title} onClick={() => { if (playerState === 1) playerRef.current?.pauseVideo(); else { playerRef.current?.mute(); setMuted(true); playerRef.current?.playVideo(); } }}>{playerState === 1 ? 'Pause' : 'Play muted'}</button>}<button disabled={!ready} onClick={() => { if (muted) playerRef.current?.unMute(); else playerRef.current?.mute(); setMuted(!muted); }}>{muted ? 'Unmute' : 'Mute'}</button></div>
      <div className="youtube-status"><span role="status" title={sourceError || lightStatus}>{content.config.backlight ? sourceError || lightStatus : hasColorSource() && !window.projectionBacklight ? 'Backlight off · tab sharing active' : 'Backlight off'}</span>
        {(content.config.backlight || hasColorSource()) && !window.projectionBacklight && <button disabled={sourcePending} onClick={() => { if (hasColorSource()) { stopTabColors(); setSourceError(''); setLightStatus('Live colors stopped.'); } else void enableColors(); }}>{sourcePending ? 'Choose this tab…' : hasColorSource() ? 'Stop colors' : 'Enable live colors'}</button>}
      </div>
    </div>, feedbackHost)}</>;
}

export const YouTubePlayer = typeof window !== "undefined" && window.projectionMedia ? NativeYouTubePlayer : BrowserYouTubePlayer;
