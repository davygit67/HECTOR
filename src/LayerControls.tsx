import type { Command, Scene } from './shared/domain';
import { DISPLAY_DEFAULTS, layerOpacity, layerVisible, surfaceLayers } from './shared/layers';

function LayerIcon({ name }: { name: 'eye' | 'hidden' | 'lock' | 'unlock' | 'up' | 'down' }) {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {name === 'eye' || name === 'hidden' ? <><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" />{name === 'hidden' && <path d="M3 3 21 21" />}</>
      : name === 'lock' || name === 'unlock' ? <><rect x="5" y="10" width="14" height="11" rx="2" /><path d={name === 'lock' ? 'M8 10V7a4 4 0 0 1 8 0v3' : 'M8 10V7a4 4 0 0 1 8 0'} /><path d="M12 14v3" /></>
      : name === 'up' ? <path d="M12 19V5m-5 5 5-5 5 5" /> : <path d="M12 5v14m-5-5 5 5 5-5" />}
  </svg>;
}

export function LayerControls({ scene, send, onSelect }: { scene: Scene; send: (command: Command) => unknown; onSelect?: () => void }) {
  const layers = surfaceLayers(scene, scene.selectedSurfaceId).reverse();
  return <section className="layer-panel" aria-label="Layers">
    <div className="section-heading"><span>FRONT TO BACK</span><span>Select a layer to edit</span></div>
    {layers.length === 0 && <p className="hint">Add media or content to build your stack.</p>}
    {layers.map((item, index) => {
      const content = 'kind' in item, background = content && item.kind === 'art';
      const selected = item.id === scene.selectedContentId || item.id === scene.selectedTimerId;
      return <div className={'layer-row' + (selected ? ' selected' : '')} key={item.id} data-layer-row={item.id}>
        <button className="layer-select" onClick={() => { send({ type: content ? 'content.select' : 'timer.select', id: item.id }); onSelect?.(); }}><strong>{item.title}</strong><small>{background ? 'Background' : content ? item.kind === 'media' ? item.config.mediaType : item.kind : 'timer'}</small></button>
        <button title={layerVisible(item) ? 'Hide layer' : 'Show layer'} aria-label={(layerVisible(item) ? 'Hide ' : 'Show ') + item.title} aria-pressed={!layerVisible(item)} onClick={() => send({ type: 'layer.configure', id: item.id, settings: { visible: !layerVisible(item) } })}><LayerIcon name={layerVisible(item) ? 'eye' : 'hidden'} /></button>
        <button title={item.layer?.locked ? 'Unlock position' : 'Lock position'} aria-label={(item.layer?.locked ? 'Unlock ' : 'Lock ') + item.title} aria-pressed={!!item.layer?.locked} onClick={() => send({ type: 'layer.configure', id: item.id, settings: { locked: !item.layer?.locked } })}><LayerIcon name={item.layer?.locked ? 'lock' : 'unlock'} /></button>
        <button disabled={background || index === 0} title="Bring forward" aria-label={'Move ' + item.title + ' forward'} onClick={() => send({ type: 'layer.reorder', id: item.id, direction: 'up' })}><LayerIcon name="up" /></button>
        <button disabled={background || index === layers.length - 1 || (index === layers.length - 2 && 'kind' in layers[index + 1] && (layers[index + 1] as { kind: string }).kind === 'art')} title="Send backward" aria-label={'Move ' + item.title + ' backward'} onClick={() => send({ type: 'layer.reorder', id: item.id, direction: 'down' })}><LayerIcon name="down" /></button>
        {selected && <label className="layer-opacity"><span>Opacity</span><input type="range" aria-label={item.title + ' opacity'} min={0} max={100} step={1} value={Math.round(layerOpacity(item) * 100)} onChange={e => send({ type: 'layer.configure', id: item.id, settings: { opacity: Number(e.target.value) / 100 } })} /><span>{Math.round(layerOpacity(item) * 100)}%</span></label>}
      </div>;
    })}
  </section>;
}
export function DisplayControls({ scene, send }: { scene: Scene; send: (command: Command) => unknown }) {
  const display = { ...DISPLAY_DEFAULTS, ...scene.display };
  return <details className="display-settings" aria-label="Display settings"><summary>Display settings<span>{display.blackout ? 'Output blacked out' : display.quality === 'fast' ? '720p' : '1080p'}</span></summary><div className="display-controls">
    <label>Render quality<select aria-label="Render quality" value={display.quality} onChange={event => send({ type: 'display.configure', settings: { quality: event.target.value as typeof display.quality } })}>
      <option value="fast">Fast · 720p output</option><option value="balanced">Balanced · 1080p output</option><option value="sharp">Sharp · full detail previews</option>
    </select></label>
    <label>Output brightness · {Math.round(display.brightness * 100)}%<input type="range" aria-label="Output brightness" min={0} max={200} value={Math.round(display.brightness * 100)} onChange={event => send({ type: 'display.configure', settings: { brightness: Number(event.target.value) / 100 } })} /></label>
    <button className={display.blackout ? 'primary' : 'secondary'} aria-pressed={display.blackout} onClick={() => send({ type: 'display.configure', settings: { blackout: !display.blackout } })}>{display.blackout ? 'Resume projection' : 'Blackout output'}</button>
    {display.blackout && <p role="status">Output is blacked out. Playback and the editor keep running.</p>}
  </div></details>;
}
