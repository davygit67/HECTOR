import { useEffect, useState } from 'react';
import { chatBridge, readMemoryIssue, subscribeMemoryIssue } from './chatBridge';
import { roomId } from './manualEvents';
import type { MemoryEntry, MemoryRequest, MemoryState } from './shared/studio';
import './studio-tools.css';

export function AssistantMemory() {
  const [state, setState] = useState<MemoryState | null>(null), [error, setError] = useState('');
  const [issue, setIssue] = useState(readMemoryIssue), [busy, setBusy] = useState(false);
  const [text, setText] = useState(''), [editing, setEditing] = useState<MemoryEntry | null>(null);
  useEffect(() => subscribeMemoryIssue(setIssue), []);
  const request = async (operation: MemoryRequest) => {
    setBusy(true); setError('');
    try { if (!chatBridge.memory) throw new Error('Restart the updated local studio to enable memory.'); setState(await chatBridge.memory(operation)); return true; }
    catch (e) { setError(e instanceof Error ? e.message : 'Memory could not be saved.'); return false; }
    finally { setBusy(false); }
  };
  return <div className="studio-tools">
    {issue && <p role="alert" className="tool-error">{issue}</p>}
    <details onToggle={event => { if (event.currentTarget.open && !state && !busy) void request({ action: 'list' }); }}>
      <summary>Assistant memory <small>Review what it learns</small></summary>
      <p className="hint">Completed adjustments are saved locally as examples. Repeated corrections may suggest preferences. Alignment stays specific to your setup.</p>
      {error && <p className="tool-error" role="alert">{error}</p>}
      {state && <>
        <label className="tool-toggle"><input type="checkbox" checked={state.enabled} disabled={busy} onChange={e => void request({ action: 'setEnabled', enabled: e.target.checked })} /> Use and learn from memory</label>
        <p className="hint">{state.events.length} recorded adjustments · {state.entries.length} memories</p>
        <ul className="tool-list">{state.entries.map(entry => <li key={entry.id}>
          <p>{entry.text}</p><small>{entry.kind} · {entry.confidence}{entry.activity ? ' · ' + entry.activity : ''}</small>
          <div className="tool-actions"><button disabled={busy} onClick={() => { setEditing(entry); setText(entry.text); }}>Edit</button><button disabled={busy} onClick={() => void request({ action: 'remove', id: entry.id })}>Forget</button></div>
        </li>)}</ul>
        {!state.entries.length && <p className="hint">No preferences saved yet. Add one below or keep refining your scenes.</p>}
        <form onSubmit={event => { event.preventDefault(); if (!text.trim()) return;
          void request({ action: 'put', entry: { id: editing?.id, kind: editing?.kind ?? 'preference', text: text.trim(), roomId: editing?.roomId ?? roomId(), activity: editing?.activity, surfaceId: editing?.surfaceId } }).then(saved => { if (saved) { setText(''); setEditing(null); } });
        }}>
          <label className="field"><span>{editing ? 'Edit memory' : 'Remember a preference'}</span><textarea aria-label="Assistant memory text" value={text} maxLength={2000} rows={3} onChange={e => setText(e.target.value)} placeholder="For movies, keep the lighting soft and the video centered." /></label>
          <div className="tool-actions"><button className="secondary" disabled={busy || !text.trim()}>{editing ? 'Save memory' : 'Remember'}</button>{editing && <button type="button" onClick={() => { setEditing(null); setText(''); }}>Cancel</button>}</div>
        </form>
        <details><summary>Recent adjustments</summary><ul className="tool-list">{state.events.slice(-8).reverse().map(event => <li key={event.id}><span>{event.operation.replaceAll('.', ' ')}{event.surfaceId ? ' · ' + event.surfaceId : ''}</span><small>{new Date(event.at).toLocaleString()}</small></li>)}</ul></details>
      </>}
      <div className="tool-actions"><button disabled={busy} onClick={() => void request({ action: 'list' })}>Refresh memory</button>{state && <button disabled={busy} onClick={() => { void request({ action: 'clear' }); setEditing(null); setText(''); }}>Forget all memories</button>}</div>
    </details>
  </div>;
}
