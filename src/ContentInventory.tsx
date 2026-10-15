import { useId } from 'react';
import { ContentControls } from './ContentControls';
import { TimerControls } from './SurfaceEditor';
import { CONTENT_REGISTRY } from './shared/content';
import type { Command, Scene } from './shared/domain';
import { layerOpacity, layerVisible, surfaceLayers, type LayerItem } from './shared/layers';
import './content-inventory.css';

function assetKind(item: LayerItem) {
  if (!('kind' in item)) return { label: 'Timer', symbol: '◷' };
  if (item.kind === 'media') return { label: item.config.mediaType === 'video' ? 'Video' : 'Image', symbol: '↥' };
  return CONTENT_REGISTRY.find(entry => entry.kind === item.kind)!;
}

export function ContentInventory({ scene, now, expandedId, onExpand, send, onPlay }: {
  scene: Scene;
  now: number;
  expandedId: string | null;
  onExpand: (id: string | null) => void;
  send: (command: Command) => unknown;
  onPlay: () => void;
}) {
  const controlsId = useId();
  const items: LayerItem[] = [...scene.contents, ...scene.timers];
  const expanded = items.find(item => item.id === expandedId);
  const hiddenCount = items.filter(item => !layerVisible(item) || layerOpacity(item) === 0).length;
  return <section className="content-inventory" aria-label="All content assets">
    <div className="asset-inventory-heading"><h3>All assets</h3><span>{items.length} {items.length === 1 ? 'asset' : 'assets'}{hiddenCount ? ` · ${hiddenCount} hidden` : ''}</span></div>
    <p className="asset-inventory-help">Across all surfaces. Select an asset to edit.</p>
    {scene.display?.blackout && <p className="asset-inventory-notice">Blackout is on. All projection output is hidden.</p>}
    {scene.surfaces.map(surface => {
      const layers = surfaceLayers(scene, surface.id).reverse();
      return <section key={surface.id} className="asset-surface-group" aria-label={`${surface.name} assets`}>
        <div className="asset-surface-heading"><h4>{surface.name}</h4><span>{layers.length}</span></div>
        {layers.length ? <ul className="asset-inventory-list">{layers.map(item => {
          const kind = assetKind(item), open = expanded?.id === item.id;
          const visible = layerVisible(item), opacity = layerOpacity(item);
          return <li key={item.id} className={'asset-inventory-row' + (open ? ' expanded' : '')} data-asset-id={item.id}>
            <button className="asset-inventory-select" aria-expanded={open} aria-controls={open ? controlsId : undefined} aria-label={`${open ? 'Collapse' : 'Edit'} ${item.title} on ${surface.name}`} onClick={() => {
              if (open) { onExpand(null); return; }
              onExpand(item.id);
              send({ type: 'kind' in item ? 'content.select' : 'timer.select', id: item.id });
            }}>
              <span className={'asset-kind-icon kind-' + ('kind' in item ? item.kind : 'timer')} aria-hidden="true">{kind.symbol}</span>
              <span className="asset-inventory-label"><strong>{item.title}</strong><small>{kind.label}{item.layer?.locked ? ' · Locked' : ''}</small>
                {(!visible || opacity < 1) && <span className="asset-visibility-state">{!visible ? 'Hidden' : `${Math.round(opacity * 100)}% opacity`}</span>}
              </span>
              <svg className="asset-inventory-chevron" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="m4 6 4 4 4-4" /></svg>
            </button>
            <button className="asset-visibility-toggle" aria-label={`${visible ? 'Hide' : 'Show'} ${item.title} on ${surface.name}`} title={visible ? 'Hide asset' : 'Show asset'} aria-pressed={!visible} onClick={() => send({ type: 'layer.configure', id: item.id, settings: { visible: !visible } })}>
              <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" />{!visible && <path d="m3 3 18 18" />}</svg>
            </button>
          </li>;
        })}</ul> : <p className="asset-inventory-empty">No assets on this surface.</p>}
      </section>;
    })}
    {expanded && <section key={expanded.id} id={controlsId} className="asset-expanded-controls" aria-label={`${expanded.title} controls`}>
      <div className="asset-controls-heading"><strong>{expanded.title}</strong><button className="text-button" onClick={() => onExpand(null)}>Collapse controls</button></div>
      {'kind' in expanded ? <ContentControls content={expanded} scene={scene} send={send} onPlay={onPlay} /> : <>
        <label className="field"><span>Attached to</span><select aria-label="Timer surface" value={expanded.surfaceId} onChange={event => send({ type: 'timer.attach', id: expanded.id, surfaceId: event.target.value })}>{scene.surfaces.map(surface => <option key={surface.id} value={surface.id}>{surface.name}</option>)}</select></label>
        <TimerControls timer={expanded} now={now} send={send} />
      </>}
    </section>}
  </section>;
}
