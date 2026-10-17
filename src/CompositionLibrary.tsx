import { useEffect, useState } from 'react';
import { executeStudio, listCompositions, subscribeCompositions } from './studioRuntime';
import type { CompositionSummary, StudioOperation } from './shared/studio';
import './studio-tools.css';

export function CompositionLibrary() {
  const [items, setItems] = useState<CompositionSummary[]>([]), [name, setName] = useState(''), [message, setMessage] = useState(''), [busy, setBusy] = useState(false);
  useEffect(() => { let active = true; const update = () => { void listCompositions().then(items => { if (active) setItems(items); }).catch(() => { if (active) setMessage('The saved compositions could not be read.'); }); }; update(); const unsubscribe = subscribeCompositions(update); return () => { active = false; unsubscribe(); }; }, []);
  const run = async (operation: StudioOperation) => { setBusy(true); const result = await executeStudio(operation, 'user'); setMessage(result.message); if (result.ok && operation.type === 'composition.save') setName(''); setBusy(false); };
  return <details className="studio-tools composition-library"><summary>Saved compositions <small>{items.length} on this device</small></summary>
    <p className="hint">Save the current assets, placement and lighting. Recall replaces content across surfaces, keeps your calibration, and pauses media with sound muted.</p>
    <form onSubmit={e => { e.preventDefault(); void run({ type: 'composition.save', name }); }}><label className="field"><span>Composition name</span><input value={name} maxLength={80} onChange={e => setName(e.target.value)} placeholder="Movie night" /></label><button className="secondary" disabled={busy || !name.trim()}>Save composition</button></form>
    <ul className="tool-list">{items.map(item => <li key={item.id}><strong>{item.name}</strong><small>{item.assets} assets</small><div className="tool-actions"><button disabled={busy} onClick={() => void run({ type: 'composition.recall', id: item.id })}>Recall</button><button disabled={busy} onClick={() => void run({ type: 'composition.remove', id: item.id })}>Remove saved copy</button></div></li>)}</ul>
    {message && <p role="status" className="hint">{message}</p>}
  </details>;
}
