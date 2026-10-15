import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { createPortal } from 'react-dom';
import type { YouTubeContent } from './shared/content';
import { videoInputPoint, type MediaCommand, type MediaInput } from './shared/media';
import { youtubePlayerLayout } from './shared/youtube';
import type { Quad } from './shared/geometry';
import { mediaError, readMediaPicture, readMediaState, subscribeMedia } from './nativeMedia';

/** Controls one host-owned source. Every preview/output uses that source's frames. */
export function NativeYouTubePlayer({ content, feedbackHost }: { content: YouTubeContent; feedbackHost: HTMLDivElement | null; visible?: boolean }) {
  const [, refresh] = useState(0), [error, setError] = useState('');
  const [restarting, setRestarting] = useState(false);
  useEffect(() => subscribeMedia(() => refresh(n => n + 1)), []);
  const state = readMediaState(content.id), picture = readMediaPicture(content.id);
  const plane = useRef<HTMLDivElement>(null), layout = youtubePlayerLayout(content.bounds);
  const pointer = (event: PointerEvent, type: MediaInput['type']) => {
    if (!feedbackHost || !state?.ready || !plane.current || (type !== 'mouseMove' && event.button !== 0)) return;
    const corners = Array.from(plane.current.querySelectorAll<HTMLElement>('[data-native-corner]')).map(node => { const rect = node.getBoundingClientRect(); return { x: rect.x, y: rect.y }; }) as Quad;
    const point = videoInputPoint(corners, { x: event.clientX, y: event.clientY });
    if (point) void window.projectionMedia!.input({ contentId: content.id, type, ...point }).catch(e => setError(String(e.message ?? e)));
  };
  const command = (action: MediaCommand['action'], seconds?: number) => {
    setError('');
    if (action === 'restart-renderer') setRestarting(true);
    const request = action === 'seek' ? { contentId: content.id, action, seconds: seconds ?? 0 } as const : { contentId: content.id, action };
    void window.projectionMedia!.command(request).catch(e => setError(String(e.message ?? e))).finally(() => { if (action === 'restart-renderer') setRestarting(false); });
  };
  return <><div className="youtube-panel" aria-label={content.title + ' · video controls'}>
    <div className="youtube-player-plane" ref={plane} style={{left:layout.left,top:layout.top,width:layout.width,height:layout.height,clipPath:`inset(${picture.top*100}% ${(1-picture.right)*100}% ${(1-picture.bottom)*100}% ${picture.left*100}%)`}}
      onPointerMove={event=>pointer(event,'mouseMove')} onPointerDown={event=>pointer(event,'mouseDown')} onPointerUp={event=>pointer(event,'mouseUp')}>
      {[[0,0],[100,0],[100,100],[0,100]].map(([x,y],i)=><i key={i} data-native-corner={i} style={{position:'absolute',left:x+'%',top:y+'%',width:0,height:0,pointerEvents:'none'}} />)}
    </div>
  </div>{feedbackHost && createPortal(<div className="youtube-feedback" aria-label={content.title + ' · playback controls'}>
    <strong>{content.title}</strong>
    <div className="youtube-status"><span role="status">{error || mediaError() || state?.status || 'Opening video source…'}</span>
      <button disabled={!state?.ready} onClick={() => command(state?.playing ? 'pause' : 'play')}>{state?.playing ? 'Pause' : 'Play muted'}</button>
      <button disabled={!state?.ready} onClick={() => command(state?.muted ? 'unmute' : 'mute')}>{state?.muted !== false ? 'Unmute' : 'Mute'}</button>
      <button onClick={() => command('retry')}>Reload video</button>
      {state?.source === 'youtube-watch' && <button onClick={() => command(state.sourceBrowserOpen ? 'close-source' : 'open-source')}>{state.sourceBrowserOpen ? 'Return to projection' : 'Open YouTube window'}</button>}
      <button disabled={restarting} onClick={() => command('restart-renderer')}>{restarting ? 'Restarting…' : 'Restart video renderer'}</button>
    </div>
    {state?.source === 'youtube-watch' && <div className="youtube-status"><span>Normal YouTube playback{state.sourceBrowserOpen ? ' · Finish in the YouTube window, then return to projection. Use the sound control here to unmute.' : ' · Use Open YouTube window for sign-in, consent, or video settings.'}</span></div>}
    {!!state?.duration && <label className="youtube-status">Playback position<input aria-label={'Seek ' + content.title} type="range" min="0" max={Math.min(86400, state.duration)} step="1" value={state.currentTime} onChange={e => command('seek', Number(e.target.value))} /></label>}
    <div className="youtube-status"><span>{content.config.backlight ? 'Backlight uses the video’s own rendered frames · no screen sharing' : 'Backlight off'} · {state?.muted !== false ? 'Sound muted' : 'Sound on'}{picture.left > 0 || picture.top > 0 || picture.right < 1 || picture.bottom < 1 ? ' · Black bars removed' : ''}</span></div>
  </div>, feedbackHost)}</>;
}
