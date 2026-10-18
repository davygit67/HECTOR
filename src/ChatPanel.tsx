import { useEffect, useRef, useState } from 'react';
import { chatBridge } from './chatBridge';
import { AssistantMemory } from './AssistantMemory';
import { CHAT_MESSAGE_LIMIT, type ChatState } from './shared/chat';

const DRAFT_KEY = 'projection-mapper.chat-draft';
function savedDraft() { try { return sessionStorage.getItem(DRAFT_KEY) ?? ''; } catch { return ''; } }
const initial: ChatState = { ready: false, busy: false, configurationError: null, progress: null, messages: [] };
export function ChatPanel() {
  const [state, setState] = useState(initial), [draft, setDraft] = useState(savedDraft), [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false), messages = useRef<HTMLDivElement>(null);
  const [reconnecting, setReconnecting] = useState(false);
  const busy = state.busy || sending;
  const reconnect = async () => {
    if (reconnecting || busy) return;
    setReconnecting(true); setError(null);
    try {
      const value = await (chatBridge.reconnect ? chatBridge.reconnect() : chatBridge.getState());
      if (value) setState(value);
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not reconnect.'); }
    finally { setReconnecting(false); }
  };
  useEffect(() => { try { if (draft) sessionStorage.setItem(DRAFT_KEY, draft); else sessionStorage.removeItem(DRAFT_KEY); } catch { /* Drafts remain editable if session storage is unavailable. */ } }, [draft]);
  useEffect(() => {
    let active = true, received = false;
    const unsub = chatBridge.subscribe(value => { received = true; if (active) { setState(value); if (value.ready) setError(null); } });
    chatBridge.getState().then(value => { if (active && !received) setState(value); }).catch(e => { if (active) setError(e.message); });
    return () => { active = false; unsub(); };
  }, []);
  useEffect(() => { if (messages.current) messages.current.scrollTop = messages.current.scrollHeight; }, [state.messages.length, state.progress]);
  const send = async () => {
    if (busy || !draft.trim()) return;
    const prompt = draft.trim(); setSending(true); setError(null); setDraft('');
    try { await chatBridge.send(prompt); }
    catch (e) { setError(e instanceof Error ? e.message : 'The request could not be sent.'); setDraft(prompt); }
    finally { setSending(false); }
  };
  return <section className="chat-panel" aria-label="Canvas assistant">
    <div className="chat-heading"><div><span className="eyebrow">CREATE WITH A CONVERSATION</span><h3>What belongs here?</h3></div><span className={'chat-status ' + (state.ready ? 'ready' : '')}>{busy ? 'Working' : state.ready ? 'Connected' : state.configurationError || error ? 'Unavailable' : 'Connecting'}</span></div>
    <p className="hint">Describe an original animation or interactive game. The assistant writes and tests it, then places it in your room. You can also ask for notes, recipes, videos and timers.</p>
    {(state.configurationError || error) && <div className="chat-error" role="alert"><p>{error ?? state.configurationError}</p><button className="secondary" onClick={reconnect} disabled={busy || reconnecting}>{reconnecting ? 'Reconnecting…' : 'Reconnect'}</button></div>}
    <div ref={messages} className="chat-messages" role="log" aria-label="Assistant conversation" aria-live="polite">
      {!state.messages.length && <div className="chat-welcome"><span>✦</span><p>Start with an idea. Then refine it together.</p>
        {['Put a rain sounds YouTube video on the wall with backlight.', 'Put a lemon pasta recipe on the wall.', 'Invent a glowing constellation game on the table where I connect stars by clicking them.'].map(prompt => <button key={prompt} disabled={busy} onClick={() => setDraft(prompt)}>{prompt}<span>↗</span></button>)}
      </div>}
      {state.messages.map(message => <article className={'chat-message ' + message.role} key={message.id}><span className="chat-speaker">{message.role === 'user' ? 'YOU' : message.role === 'error' ? 'REQUEST UPDATE' : 'ASSISTANT'}</span><p>{message.text || 'The request ended without a text reply. Check the canvas for changes.'}</p>{message.status === 'incomplete' && <small>Request incomplete · applied changes remain on the canvas</small>}</article>)}
      {busy && <div className="chat-progress" role="status"><i />{state.progress ?? 'Sending…'}</div>}
    </div>
    <form className="chat-compose" onSubmit={e => { e.preventDefault(); void send(); }}>
      <label htmlFor="canvas-prompt">Tell the canvas what to create</label>
      <textarea id="canvas-prompt" aria-label="Message the canvas assistant" value={draft} maxLength={CHAT_MESSAGE_LIMIT} rows={3} placeholder="A recipe on the wall, a timer on the table…" onChange={e => setDraft(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(); } }} />
      <div className="chat-actions"><button type="button" className="chat-clear" disabled={busy || !state.messages.length} onClick={() => chatBridge.clear().catch(e => setError(e.message))}>Clear conversation</button>
        {busy ? <button type="button" className="secondary" onClick={() => chatBridge.cancel().catch(e => setError(e.message))}>Stop request</button> : <button className="primary" type="submit" disabled={!state.ready || !draft.trim()}>Send ↗</button>}
      </div>
    </form>
    <p className="chat-footnote">Edits appear live. Clear conversation keeps your canvas. Room geometry is simulated.</p>
    <AssistantMemory />
  </section>;
}
