import { useEffect, useRef, useState } from 'react';
import type { MediaContent } from './shared/content';
import type { Command } from './shared/domain';
import { mediaTime, type MediaConfig } from './shared/mediaContent';
import { enableMediaAudio, importMedia, localMediaSource, removeMediaAsset, subscribeLocalMedia } from './localMedia';

export function MediaControls({ content, send }: { content: MediaContent; send: (command: Command) => unknown }) {
  const [, refresh] = useState(0), [error, setError] = useState(''), [importing, setImporting] = useState(false);
  const file = useRef<HTMLInputElement>(null), c = content.config, video = c.mediaType === 'video';
  useEffect(() => subscribeLocalMedia(() => refresh(n => n + 1)), []);
  useEffect(() => { const timer = setInterval(() => refresh(n => n + 1), 250); return () => clearInterval(timer); }, []);
  const patch = (settings: Partial<MediaConfig>) => send({ type: 'content.update', id: content.id, spec: { kind: 'media', config: { ...c, ...settings } } });
  const source = localMediaSource(content.id);
  const ended = !c.loop && mediaTime(c, content.state.clock, Date.now()) >= c.duration;
  return <div className="media-controls">
    <p className="hint">{c.fileName} · {c.width} × {c.height}{video ? ` · ${Math.round(c.duration)} sec` : ''}</p>
    <p className="hint">Stored locally in this browser/app. Use Replace file when moving a scene to another computer.</p>
    <input ref={file} type="file" hidden accept="video/*,image/*,.mp4,.webm,.mov,.mkv" onChange={async event => {
      const selected = event.target.files?.[0]; event.target.value = ''; if (!selected) return;
      setImporting(true); setError('');
      let assetId: string | undefined;
      try {
        const config = await importMedia(selected); assetId = config.assetId;
        const result = await send({ type: 'content.update', id: content.id, spec: { kind: 'media', config } }) as { ok?: boolean; error?: string } | undefined;
        if (result?.ok === false) throw new Error(result.error ?? 'Could not replace media.');
      } catch (e) { if (assetId) void removeMediaAsset(assetId); setError(String((e as Error).message)); }
      finally { setImporting(false); }
    }} />
    <button className="secondary full-width" disabled={importing} onClick={() => file.current?.click()}>{importing ? 'Importing…' : 'Replace file'}</button>
    {(error || source?.error) && <p role="alert" className="media-error">{error || source?.error}</p>}
    {!source?.ready && !source?.error && <p role="status">Loading local media…</p>}
    {video && <>
      <div className="content-actions"><button className="primary" disabled={!source?.ready} onClick={() => send({ type: 'content.action', id: content.id, action: content.state.clock.running && !source?.error && !ended ? 'pause' : 'start' })}>{ended ? 'Replay video' : content.state.clock.running && !source?.error ? 'Pause video' : 'Play video'}</button><button className="secondary" onClick={() => send({ type: 'content.action', id: content.id, action: 'reset' })}>Reset</button></div>
      <label className="field">Position · {mediaTime(c, content.state.clock, Date.now()).toFixed(1)} sec<input type="range" aria-label="Local video position" min={0} max={c.duration} step={.1} value={mediaTime(c, content.state.clock, Date.now())} onChange={event => send({ type: 'media.seek', id: content.id, seconds: Number(event.target.value) })} /></label>
      <label className="field">Playback speed<select aria-label="Playback speed" value={c.playbackRate} onChange={e => patch({ playbackRate: Number(e.target.value) })}>{[.25, .5, 1, 1.5, 2, 4].map(rate => <option value={rate} key={rate}>{rate}×</option>)}</select></label>
      <label><input type="checkbox" checked={c.loop} onChange={e => patch({ loop: e.target.checked })} /> Loop video</label>
      <div className="content-actions"><button className="secondary" onClick={() => { if (c.muted || !source?.audioEnabled) { enableMediaAudio(content.id); patch({ muted: false }); } else patch({ muted: true }); }}>{c.muted || !source?.audioEnabled ? 'Unmute' : 'Mute'}</button><label>Volume<input type="range" aria-label="Local video volume" min={0} max={100} value={c.volume * 100} onChange={e => patch({ volume: Number(e.target.value) / 100 })} /></label></div>
    </>}
    <label className="field">Image fit<select aria-label="Media fit" value={c.fit} onChange={e => patch({ fit: e.target.value as MediaConfig['fit'] })}><option value="contain">Fit entire image</option><option value="cover">Fill and crop</option><option value="stretch">Stretch to bounds</option></select></label>
    <label className="field">Rotation<select aria-label="Media rotation" value={c.rotation} onChange={e => patch({ rotation: Number(e.target.value) as MediaConfig['rotation'] })}>{[0, 90, 180, 270].map(deg => <option value={deg} key={deg}>{deg}°</option>)}</select></label>
    <div className="content-actions"><label><input type="checkbox" checked={c.flipX} onChange={e => patch({ flipX: e.target.checked })} /> Flip horizontal</label><label><input type="checkbox" checked={c.flipY} onChange={e => patch({ flipY: e.target.checked })} /> Flip vertical</label></div>
    {(['brightness', 'contrast', 'saturation'] as const).map(key => <label className="field" key={key}>{key[0].toUpperCase() + key.slice(1)} · {Math.round(c[key] * 100)}%<input type="range" aria-label={'Media ' + key} min={0} max={key === 'saturation' ? 300 : 200} value={Math.round(c[key] * 100)} onChange={e => patch({ [key]: Number(e.target.value) / 100 })} /></label>)}
    <button className="text-button" onClick={() => patch({ brightness: 1, contrast: 1, saturation: 1, rotation: 0, flipX: false, flipY: false, fit: 'contain' })}>Reset image settings</button>
  </div>;
}
