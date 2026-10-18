import { ProgramControls } from './ProgramControls';
import { BACKLIGHT_DEFAULTS, BACKLIGHT_LIMITS, BACKLIGHT_TONE_PROFILES, BACKLIGHT_TONE_LABELS, type BacklightToneProfile, type BacklightSettings } from './shared/backlight';
import { useEffect, useState } from 'react';
import type { Command, Scene } from './shared/domain';
import { ART_PRESETS, CONTENT_LIMITS, CONTENT_REGISTRY, type ContentInstance, type ContentKind, type ContentSpec } from './shared/content';
import type { Bounds } from './shared/geometry';
import { WIDTH, HEIGHT } from './shared/geometry';
import { YOUTUBE_LIMITS } from './shared/youtube';
import { NumberField } from './SurfaceEditor';
import { MediaControls } from './MediaControls';

export function ContentLibrary({ onCreate, disabled, hasArtwork = false }: { hasArtwork?: boolean; onCreate: (kind: ContentKind | 'timer') => void; disabled: boolean }) {
  return <div className="content-library" aria-label="Add content">
    <button disabled={disabled} onClick={() => onCreate('timer')} title="Add a countdown timer"><span>◷</span><strong>Timer</strong></button>
    {CONTENT_REGISTRY.map(entry => <button key={entry.kind} disabled={disabled && !(entry.kind === 'art' && hasArtwork)} onClick={() => onCreate(entry.kind)} title={entry.description}>
      <span>{entry.symbol}</span><strong>{entry.kind === 'program' ? 'Create with AI' : entry.label}</strong>
    </button>)}
  </div>;
}
export function ContentControls({ content, scene, send, onPlay }: { content: ContentInstance; scene: Scene; send: (c: Command) => unknown; onPlay: () => void }) {
  const [name, setName] = useState(content.title), [spec, setSpec] = useState<ContentSpec>({ kind: content.kind, config: structuredClone(content.config) } as ContentSpec);
  const configKey = JSON.stringify(content.config);
  useEffect(() => { setName(content.title); setSpec({ kind: content.kind, config: structuredClone(content.config) } as ContentSpec); }, [content.id, content.title, configKey]);
  const dirty = name !== content.title || JSON.stringify(spec.config) !== configKey;
  const setConfig = (patch: Record<string, unknown>) => setSpec(s => ({ ...s, config: { ...s.config, ...patch } }) as ContentSpec);
  const entry = CONTENT_REGISTRY.find(e => e.kind === content.kind)!;
  const actions = content.kind === 'media' || content.kind === 'program' ? [] : entry.actions as readonly string[];
  const control = (action: 'start' | 'pause' | 'reset' | 'next' | 'previous') => send({ type: 'content.action', id: content.id, action });
  const move = (key: keyof Bounds, percent: number) => send({ type: 'content.move', id: content.id, bounds: { ...content.bounds, [key]: percent / 100 } });
  return <>
    <div className="section-heading"><span className="eyebrow">{entry.label.toUpperCase()}</span><button className="text-button danger" onClick={() => send({ type: 'content.remove', id: content.id })}>Remove content</button></div>
    <label className="field"><span>Attached to</span><select aria-label="Content surface" value={content.surfaceId} onChange={e => send({ type: 'content.attach', id: content.id, surfaceId: e.target.value })}>{scene.surfaces.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
    <label className="field"><span>Content title</span><input maxLength={CONTENT_LIMITS.titleLength} value={name} onChange={e => setName(e.target.value)} /></label>
    {spec.kind === 'note' && <>
      <label className="field"><span>Note text</span><textarea rows={5} maxLength={CONTENT_LIMITS.noteLength} value={spec.config.text} onChange={e => setConfig({ text: e.target.value })} /></label>
      <label className="field color-field"><span>Accent color</span><input type="color" value={spec.config.accent} onChange={e => setConfig({ accent: e.target.value })} /></label>
    </>}
    {spec.kind === 'recipe' && <>
      <label className="field"><span>Ingredients · one per line</span><textarea rows={4} value={spec.config.ingredients.join('\n')} onChange={e => setConfig({ ingredients: e.target.value.split('\n') })} /></label>
      <label className="field"><span>Recipe steps · one per line</span><textarea rows={5} value={spec.config.steps.join('\n')} onChange={e => setConfig({ steps: e.target.value.split('\n') })} /></label>
      <label className="field"><span>Recipe source / attribution</span><input maxLength={CONTENT_LIMITS.sourceLength} value={spec.config.source} onChange={e => setConfig({ source: e.target.value })} /></label>
      <p className="hint">Up to 12 ingredients and steps. Applying changes returns to the ingredients page.</p>
    </>}
    {spec.kind === 'art' && <>
      <label className="field"><span>Artwork preset</span><select value={spec.config.preset} onChange={e => setConfig({ preset: e.target.value })}>{CONTENT_LIMITS.presets.map(p => <option key={p} value={p}>{ART_PRESETS[p].label}</option>)}</select></label>
      <p className="hint">{ART_PRESETS[spec.config.preset].description}</p>
      <label className="field"><span>Artwork palette</span><select value={spec.config.palette} onChange={e => setConfig({ palette: e.target.value })}>{CONTENT_LIMITS.palettes.map(p => <option key={p} value={p}>{p[0].toUpperCase() + p.slice(1)}</option>)}</select></label>
      <NumberField label="Artwork speed" value={spec.config.speed} min={CONTENT_LIMITS.speed.min} max={CONTENT_LIMITS.speed.max} step={.1} suffix="×" onCommit={n => setConfig({ speed: n })} />
      <NumberField label="Artwork seed" value={spec.config.seed} min={CONTENT_LIMITS.seed.min} max={CONTENT_LIMITS.seed.max} onCommit={n => setConfig({ seed: n })} />
    </>}
    {spec.kind === 'youtube' && <>
      <label className="field"><span>YouTube video ID</span><input value={spec.config.videoId} maxLength={11} onChange={e => setConfig({ videoId: e.target.value })} /></label>
      {content.kind === 'youtube' && <label className="field"><span>Current video link · select to copy</span><input readOnly value={'https://www.youtube.com/watch?v=' + content.config.videoId + (content.config.startSeconds ? '&t=' + content.config.startSeconds + 's' : '')} onFocus={e => e.currentTarget.select()} /></label>}
      <NumberField label="Video start time" value={spec.config.startSeconds} min={0} max={YOUTUBE_LIMITS.maxStartSeconds} suffix="sec" onCommit={n => setConfig({ startSeconds: n })} />
      <p className="hint">{window.projectionMedia ? "Changing the video or start time reloads paused and muted. One source feeds every view and output." : "Changing the video or start time reloads the player. Playback is local to each window."}</p>
    </>}
    {spec.kind === 'game' && <>
      <NumberField label="Game rounds" value={spec.config.rounds} min={CONTENT_LIMITS.rounds.min} max={CONTENT_LIMITS.rounds.max} onCommit={n => setConfig({ rounds: n })} disabled={content.kind === 'game' && content.state.status !== 'idle'} />
      <NumberField label="Game seed" value={spec.config.seed} min={CONTENT_LIMITS.seed.min} max={CONTENT_LIMITS.seed.max} onCommit={n => setConfig({ seed: n })} disabled={content.kind === 'game' && content.state.status !== 'idle'} />
    </>}
    <button className="primary full-width" disabled={!dirty} onClick={() => send({ type: 'content.update', id: content.id, title: name, ...(JSON.stringify(spec.config) !== configKey ? { spec } : {}) })}>{dirty ? 'Apply changes' : 'Changes saved'}</button>
    {content.kind === 'program' && <ProgramControls content={content} send={send} onPlay={onPlay} />}
    {content.kind === 'media' && <><div className="divider" /><MediaControls content={content} send={send} /></>}
    {actions.length > 0 && <><div className="divider" /><span className="eyebrow">PLAYBACK & STATE</span></>}
    {content.kind === 'recipe' && <>
      <div className="content-state">{content.state.stepIndex < 0 ? 'Ingredients' : 'Step ' + (content.state.stepIndex + 1) + ' of ' + content.config.steps.length}</div>
      <div className="content-actions"><button className="secondary" disabled={content.state.stepIndex < 0} onClick={() => control('previous')}>← Back</button><button className="primary" disabled={content.state.stepIndex === content.config.steps.length - 1} onClick={() => control('next')}>Next step →</button></div>
      <button className="text-button reset-content" onClick={() => control('reset')}>Back to ingredients</button>
    </>}
    {content.kind === 'art' && <>
      <div className="content-state">{content.state.clock.running ? 'Animating' : 'Paused'} · native surface background</div>
      <div className="content-actions"><button className="primary" onClick={() => control(content.state.clock.running ? 'pause' : 'start')}>{content.state.clock.running ? 'Pause artwork' : 'Resume artwork'}</button><button className="secondary" onClick={() => control('reset')}>Reset art</button></div>
      <p className="hint">Presets run locally. The surface boundary clips every frame; panels stay above the artwork.</p>
    </>}
    {content.kind === 'youtube' && <>
      <div className="divider" />
      <label className="youtube-backlight"><input type="checkbox" checked={content.config.backlight} disabled={dirty} onChange={e => send({ type: 'youtube.backlight', id: content.id, enabled: e.target.checked })} />Ambient backlight</label>
      <p className="hint">{dirty ? 'Apply your edits before changing the backlight.' : window.projectionMedia ? 'The local renderer uses the video’s own frames. Backlight follows every view and output without screen sharing.' : 'Turning this on configures the effect. To activate it, use the player on the canvas, then choose Enable live colors below the video and share this studio tab. If this browser cannot share tabs, use Chrome or the desktop app.'}</p>
      <label className="field-label">Lighting style<select aria-label="Lighting style" disabled={dirty} value={content.config.backlightSettings?.toneProfile ?? BACKLIGHT_DEFAULTS.toneProfile} onChange={e=>send({type:'youtube.backlight.configure',id:content.id,settings:{toneProfile:e.target.value as BacklightToneProfile}})}>{BACKLIGHT_TONE_PROFILES.map(tone=><option key={tone} value={tone}>{BACKLIGHT_TONE_LABELS[tone]}</option>)}</select></label>
      <label className="field-label">Room fill · {Math.round((content.config.backlightSettings?.roomFill??0)*100)}%<input type="range" aria-label="Room fill" min="0" max="100" step="1" disabled={dirty} value={Math.round((content.config.backlightSettings?.roomFill??0)*100)} onChange={e=>send({type:'youtube.backlight.configure',id:content.id,settings:{roomFill:Number(e.target.value)/100}})} /></label>
      <p className="hint">Room lighting follows the same video across your surfaces. Timers and content panels stay clear. Opacity fades the light; vibrance controls color richness.</p>
      {(['opacity', 'vibrance', 'intensity', 'spread', 'smoothingMs'] as const).map((key, i) => <NumberField key={key} label={['Backlight opacity', 'Backlight vibrance', 'Backlight intensity', 'Backlight spread', 'Backlight smoothing'][i]}
        disabled={dirty} value={({...BACKLIGHT_DEFAULTS,...content.config.backlightSettings})[key]??1} min={BACKLIGHT_LIMITS[key].min} max={BACKLIGHT_LIMITS[key].max} step={key === 'smoothingMs' ? 10 : .02} suffix={key === 'smoothingMs' ? 'ms' : undefined}
        onCommit={value => send({ type: 'youtube.backlight.configure', id: content.id, settings: { [key]: value } as Partial<BacklightSettings> })} />)}
      <button className="secondary full-width play-on-canvas" onClick={onPlay}>Use player on canvas ↗</button>
      <p className="hint">{window.projectionMedia ? 'Play muted starts the shared video source. Use Unmute only when you want sound. The same frames appear in every view and output.' : 'New videos start paused and muted. For automatic backlight without sharing, open Launch Studio.command from the project folder. This browser preview still needs Enable live colors.'}</p>
    </>}
    {content.kind === 'game' && <>
      <div className="game-stats"><div><strong>{content.state.score}</strong><span>score</span></div><div><strong>{content.state.round}/{content.config.rounds}</strong><span>rounds</span></div><div><strong>{content.state.misses}</strong><span>misses</span></div></div>
      <div className="content-actions"><button className="primary" disabled={content.state.status === 'finished'} onClick={() => {
        control(content.state.status === 'running' ? 'pause' : 'start'); if (content.state.status !== 'running') onPlay();
      }}>{content.state.status === 'finished' ? 'Complete' : content.state.status === 'running' ? 'Pause game' : content.state.status === 'paused' ? 'Resume game' : 'Start game'}</button><button className="secondary" onClick={() => control('reset')}>Reset game</button></div>
      <button className="secondary full-width play-on-canvas" onClick={onPlay}>Play on canvas ↗</button>
      <p className="hint">Click the lit target in Play mode. Faster hits score more; misses are counted. Mouse or keyboard input only. Reset before editing rules.</p>
    </>}
    {content.kind !== 'art' && <><div className="divider" /><span className="eyebrow">POSITION & SIZE</span><div className="field-grid">
      {(['x', 'y', 'w', 'h'] as const).map((key, i) => (content.kind === 'youtube' || content.kind === 'media') && i >= 2
        ? <NumberField key={key} label={i === 2 ? 'Video canvas width' : 'Video canvas height'} value={Math.round(content.bounds[key] * (i === 2 ? WIDTH : HEIGHT))} min={1} max={i === 2 ? WIDTH : HEIGHT} suffix="px" onCommit={n => send({ type: 'content.move', id: content.id, bounds: { ...content.bounds, [key]: n / (i === 2 ? WIDTH : HEIGHT) } })} />
        : <NumberField key={key} label={['Content left', 'Content top', 'Content width', 'Content height'][i]} value={Math.round(content.bounds[key] * 1000) / 10} min={i < 2 ? 0 : 18} max={100} step={.5} suffix="%" onCommit={n => move(key, n)} />)}
    </div><p className="hint">{content.kind === 'youtube' ? 'Video fits inside this box on the 1920 × 1080 source canvas. Smaller sizes reduce detail; perspective alignment changes the final pixel footprint. Controls stay below the preview.' : 'Panels can overlap inside the surface boundary. Select covered items from the content list. Each surface holds up to five assets, including timers.'}</p></>}
  </>;
}
