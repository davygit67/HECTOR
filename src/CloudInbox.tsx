import { useEffect, useRef, useState } from 'react';
import type { ChatBridge } from './shared/chat';
import type { CloudRelayAction, CloudRelayState } from './shared/cloudRelay';

export function CloudInbox({ relay }: Pick<ChatBridge, 'relay'>) {
  const [state, setState] = useState<CloudRelayState | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const sequence = useRef(0), working = useRef(false);
  useEffect(() => {
    if (!relay) return;
    let mounted = true;
    const refresh = async () => {
      if (working.current) return;
      const current = ++sequence.current;
      try { const value = await relay('state'); if (mounted && current === sequence.current) { setState(value); setError(''); } }
      catch { if (mounted && current === sequence.current) setError('Reconnect Studio to check cloud delivery.'); }
    };
    void refresh(); const timer = setInterval(() => void refresh(), 5000);
    return () => { mounted = false; clearInterval(timer); sequence.current++; };
  }, [relay]);
  async function change(action: CloudRelayAction) {
    if (!relay || working.current) return;
    working.current = true; setBusy(true); setError(''); const current = ++sequence.current;
    try { const value = await relay(action); if (sequence.current === current) setState(value); }
    catch (e) { if (sequence.current === current) setError(e instanceof Error ? e.message : 'Cloud delivery could not be changed.'); }
    finally { working.current = false; setBusy(false); }
  }
  return <details className="cloud-inbox"><summary>Cloud updates <span>{state?.receiving ? 'Receiving here' : state?.claimedElsewhere ? 'Another Studio' : 'Paused'}</span></summary>
    <p>Let your connected cloud tools send task updates or creative requests to this canvas agent.</p>
    <p role="status">{state?.message ?? (relay ? 'Checking local connection…' : 'Cloud delivery requires the updated local Studio.')}</p>
    {error && <p role="alert" className="cloud-inbox-error">{error}</p>}
    <div className="cloud-inbox-actions">
      {state?.configured && !state.receiving && <button type="button" className="primary" disabled={busy || state.claimedElsewhere || state.busy} onClick={() => void change('receive')}>{state.ownsTarget ? 'Resume here' : 'Receive here'}</button>}
      {state?.receiving && <button type="button" className="secondary" disabled={busy} onClick={() => void change('pause')}>Pause cloud updates</button>}
      {state?.ownsTarget && <button type="button" className="secondary" disabled={busy} onClick={() => void change('release')}>Release this Studio</button>}
      {!state?.configured && <button type="button" className="secondary" disabled={busy || !relay} onClick={() => void change('state')}>Check setup</button>}
    </div>
    <small>Cloud requests can change the canvas. Only one Studio receives them. Reloading releases this choice. Pausing stops a cloud request; changes already applied remain. Checking the inbox itself does not call the AI.</small>
    {state?.lastReceipt && <details className="cloud-inbox-receipt"><summary>Last cloud request · {state.lastReceipt.status}</summary><p>{state.lastReceipt.text}</p><small>An agent completion receipt does not confirm physical projection.</small></details>}
  </details>;
}
