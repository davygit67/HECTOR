import { useEffect, useRef } from 'react';
import { loadAPI, youtubePlayerError, type Player } from './youtubeAPI';
import { youtubeEmbedUrl } from './shared/youtube';
import type { MediaCommand } from './shared/media';

interface SourceReport { ready: boolean; playing: boolean; hasPlayed: boolean; status: string; currentTime: number; duration: number }
declare global { interface Window { projectionSource?: { report(state: SourceReport): void; subscribe(fn: (command: MediaCommand) => void): () => void } } }
/** Trusted local wrapper, isolated from the scene, assistant, filesystem and credentials. */
export function NativeSource() {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let disposed = false, player: Player | undefined;
    let state: SourceReport = { ready: false, playing: false, hasPlayed: false, status: 'Loading YouTube…', currentTime: 0, duration: 0 };
    const report = (patch: Partial<SourceReport> = {}) => { state = { ...state, ...patch }; window.projectionSource!.report(state); };
    const fail = (status: string) => report({ ready: false, playing: false, status });
    const timeout = setTimeout(() => fail('YouTube did not load. Use Reload video to try again.'), 25000);
    const stop = window.projectionSource!.subscribe(command => {
      if (!player || !state.ready) return;
      if (command.action === 'play') { player.mute(); player.playVideo(); }
      else if (command.action === 'pause') player.pauseVideo();
      else if (command.action === 'mute') player.mute();
      else if (command.action === 'unmute') player.unMute();
      else if (command.action === 'seek') player.seekTo(command.seconds, true);
    });
    const query = new URLSearchParams(location.search);
    void loadAPI().then(api => {
      if (disposed) return;
      const frame = document.createElement('iframe');
      frame.src = youtubeEmbedUrl(query.get('video')!, Number(query.get('start')), location.origin);
      frame.title = 'YouTube source'; frame.referrerPolicy = 'strict-origin-when-cross-origin';
      frame.allow = 'autoplay; encrypted-media; picture-in-picture';
      frame.style.cssText = 'width:100%;height:100%;border:0;display:block'; host.current!.append(frame);
      player = new api.Player(frame, { events: {
        onReady: () => { if (disposed) return; clearTimeout(timeout); player?.mute(); report({ ready: true, status: 'Ready · muted · press Play' }); },
        onStateChange: event => {
          if (disposed) return; clearTimeout(timeout);
          report({ ready: true, playing: event.data === 1 || event.data === 3, hasPlayed: state.hasPlayed || event.data === 1,
            status: ({ '-1': 'Ready · press Play', 0: 'Video ended', 1: 'Playing', 2: 'Paused', 3: 'Buffering…', 5: 'Ready · press Play' } as Record<number, string>)[event.data] ?? 'Ready' });
        },
        onError: event => { clearTimeout(timeout); fail(youtubePlayerError(event.data)); },
        onAutoplayBlocked: () => report({ playing: false, status: 'Playback blocked by YouTube. Press Play to retry.' }),
      } });
    }).catch(e => { clearTimeout(timeout); fail(String(e.message ?? e)); });
    const timer = setInterval(() => {
      if (player && state.ready) report({ currentTime: player.getCurrentTime() || 0, duration: player.getDuration() || 0 });
    }, 750);
    return () => { disposed = true; clearTimeout(timeout); clearInterval(timer); stop(); player?.destroy(); host.current?.replaceChildren(); };
  }, []);
  return <div ref={host} style={{ position: 'fixed', inset: 0, background: '#000' }} />;
}
