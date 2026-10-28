import { createRoot } from 'react-dom/client';
import { CloudInbox } from '../src/CloudInbox';
import type { CloudRelayAction, CloudRelayState } from '../src/shared/cloudRelay';
import '../src/styles.css';

// Intentionally imports no app bridge, storage, media or model service.
const root = createRoot(document.getElementById('preview')!);
const blank = (): CloudRelayState => ({ configured: true, ownsTarget: false, claimedElsewhere: false, receiving: false, busy: false, phase: 'stopped', message: 'Cloud delivery is paused. Choose Receive here to use this Studio.' });
let state = blank(), calls: CloudRelayAction[] = [], revision = 0, rejectReceive = false;
const relay = async (action: CloudRelayAction) => {
  calls.push(action);
  if (action === 'receive') {
    if (rejectReceive) throw new Error('The receiver is unavailable.');
    state = { ...state, ownsTarget: true, receiving: true, phase: 'connected', message: 'Listening for cloud requests.' };
  } else if (action === 'pause') state = { ...state, receiving: false, phase: 'stopped', message: 'Cloud delivery is paused.' };
  else if (action === 'release') state = { ...state, ownsTarget: false, receiving: false, phase: 'stopped', message: 'Choose Receive here to use this Studio.' };
  return structuredClone(state);
};
const render = () => root.render(<CloudInbox key={++revision} relay={relay} />);
const next = () => new Promise<void>(r => requestAnimationFrame(() => requestAnimationFrame(() => r())));
const text = () => document.getElementById('preview')!.textContent!;
const button = (label: string) => Array.from(document.querySelectorAll<HTMLButtonElement>('#preview button')).find(b => b.textContent === label);
render();
document.getElementById('run-checks')!.onclick = async () => {
  const control = document.getElementById('run-checks') as HTMLButtonElement; control.disabled = true;
  const output = document.getElementById('results')!; output.textContent = '';
  let count = 0;
  const check = (condition: unknown, label: string) => { if (!condition) throw new Error(label); count++; output.textContent += 'PASS · ' + label + '\n'; };
  try {
    state = blank(); calls = []; rejectReceive = false; render(); await next();
    check(!document.querySelector<HTMLDetailsElement>('.cloud-inbox')!.open, 'Controls start collapsed');
    check(calls.every(action => action === 'state'), 'Mount only checks status; it never opts in');
    document.querySelector<HTMLDetailsElement>('.cloud-inbox')!.open = true;
    button('Receive here')!.click(); await next();
    check(text().includes('Receiving here') && !!button('Pause cloud updates'), 'Explicit receive enables this Studio');
    button('Pause cloud updates')!.click(); await next();
    check(!!button('Resume here') && !!button('Release this Studio'), 'Pause retains ownership and allows resume');
    button('Resume here')!.click(); await next();
    check(!!button('Pause cloud updates'), 'Resume returns to receiving');
    button('Release this Studio')!.click(); await next();
    check(!!button('Receive here') && !button('Release this Studio'), 'Release removes ownership');
    state = { ...blank(), claimedElsewhere: true, message: 'Another Studio owns cloud delivery.' }; render(); await next();
    check(button('Receive here')?.disabled && !button('Pause cloud updates'), 'Other Studio cannot take or pause the receiver');
    state = { ...blank(), configured: false }; render(); await next();
    check(!!button('Check setup') && !button('Receive here'), 'Missing setup offers a check, not activation');
    state = blank(); rejectReceive = true; render(); await next(); button('Receive here')!.click(); await next();
    check(document.querySelector('[role=alert]')?.textContent === 'The receiver is unavailable.', 'Failed receive remains visible without claiming success');
    state = { ...blank(), lastReceipt: { jobId: 'fixture', status: 'incomplete', text: 'The note was added. Movie generation is unavailable.' } }; rejectReceive = false; render(); await next();
    check(text().includes('incomplete') && text().includes('Movie generation is unavailable.'), 'Partial completion preserves the actual outcome');
    check(text().includes('does not confirm physical projection'), 'Receipt does not imply optical verification');
    check(text().includes('does not call the AI'), 'Inbox polling and model execution are distinguished');
    document.querySelector<HTMLDetailsElement>('.cloud-inbox')!.open = true;
    document.querySelector<HTMLDetailsElement>('.cloud-inbox-receipt')!.open = true;
    output.textContent += '\n' + count + ' checks passed.';
  } catch (error) { output.textContent += '\nFAIL · ' + String(error); }
  finally { control.disabled = false; }
};
