import { useEffect, useMemo, useRef, useState } from 'react';
import { bridge } from './bridge';
import type { Snapshot } from './shared/bridge';
import { patternLabel, patternSequence, type CalibrationPattern } from './shared/calibrationPatterns';
import { capturePatterns, type CaptureProgress } from './shared/calibrationCapture';
import { canAppendFrame, copyFrame, decodeSensorSession, SENSOR_LIMITS, sessionBytes, type SensorFrame, type SensorSession } from './shared/sensor';
import { delay, SensorInbox } from './shared/sensorStream';
import { demoSensor, localSensor, type LocalSensorMode, type SensorSource } from './sensorSources';
import { PatternOutputClient, paintPattern } from './patternOutput';
import { deleteSensorSession, downloadSensorSession, listSensorSessions, loadSensorSession, saveSensorSession, type SessionSummary } from './sensorSessions';
import './hardware.css';
import { registerHardware } from './studioRuntime';

type SourceMode = 'demo' | 'live' | 'replay';
type Recording = { session: SensorSession; endAt: number; nextAt: number; lastSequence: number };
const describeError = (error: unknown) => error instanceof Error ? error.message : String(error);
const sizeLabel = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;
function sessionName(prefix: string) { return `${prefix} ${new Date().toLocaleString()}`; }

export function HardwareWorkspace({ snapshot }: { snapshot: Snapshot }) {
  const inbox = useMemo(() => new SensorInbox(), []);
  const source = useRef<SensorSource | null>(null), activePattern = useRef<CalibrationPattern | null>(null), output = useRef<PatternOutputClient | null>(null);
  const controller = useRef<AbortController | null>(null), recording = useRef<Recording | null>(null), mounted = useRef(false);
  const finishRef = useRef<(message?: string) => void>(() => {});
  const [sourceMode, setSourceMode] = useState<SourceMode>('demo'), [connection, setConnection] = useState('disconnected'), [connectionMessage, setConnectionMessage] = useState('Choose a source to begin.');
  const [bridgeMode, setBridgeMode] = useState<LocalSensorMode | null>(null);
  const [address, setAddress] = useState('ws://127.0.0.1:5174'), [liveFrame, setLiveFrame] = useState<SensorFrame | null>(null), [receivedAt, setReceivedAt] = useState(0);
  const [clock, setClock] = useState(Date.now()), [duration, setDuration] = useState(10), [recordCount, setRecordCount] = useState(0), [isRecording, setIsRecording] = useState(false);
  const [sessions, setSessions] = useState<SessionSummary[]>([]), [selected, setSelected] = useState<SensorSession | null>(null), [saving, setSaving] = useState(false), [storageNote, setStorageNote] = useState('Recordings save on this device.');
  const [replayIndex, setReplayIndex] = useState(0), [replayPlaying, setReplayPlaying] = useState(false), [replayRate, setReplayRate] = useState(1);
  const [resolution, setResolution] = useState('1920x1080'), [sequenceKind, setSequenceKind] = useState<'gray' | 'checks'>('checks'), [settleMs, setSettleMs] = useState(300);
  const [outputTarget, setOutputTarget] = useState('demo'), [, refreshOutputs] = useState(0), [pattern, setPattern] = useState<CalibrationPattern | null>(null);
  const [capturing, setCapturing] = useState(false), [progress, setProgress] = useState<CaptureProgress | null>(null), [resultNote, setResultNote] = useState('Capture a short check sequence first, then the coded stripes.');
  const [presentingManual, setPresentingManual] = useState(false);
  const [loadingSession, setLoadingSession] = useState(false);
  const sessionOperation = useRef(false);
  const [error, setError] = useState('');
  const previewAt = useRef(0);
  const importInput = useRef<HTMLInputElement>(null);
  const busy = capturing || isRecording || saving || presentingManual || loadingSession;
  const [width, height] = resolution.split('x').map(Number), patterns = useMemo(() => patternSequence(width, height, sequenceKind), [width, height, sequenceKind]);
  const outputs = [...(output.current?.outputs.values() ?? [])];
  const frame = sourceMode === 'replay' ? selected?.frames[replayIndex] ?? null : liveFrame;
  const replayCapture = sourceMode === 'replay' ? selected?.captures.find(c => c.frameIndex === replayIndex) : null;
  const shownPattern = sourceMode === 'replay' ? replayCapture?.pattern ?? null : pattern;
  const connected = connection === 'connected' && !!liveFrame && (bridgeMode === 'replay' || clock - receivedAt < 5000);
  const connectionOpen = ['connecting', 'connected', 'waiting'].includes(connection);
  const canAcquire = connected && (sourceMode === 'demo' || sourceMode === 'live' && bridgeMode === 'live');

  async function retain(session: SensorSession) {
    if (!mounted.current) return;
    if (!session.frames.length) { setStorageNote('No frames captured; nothing was saved.'); return; }
    setSelected(session); setReplayIndex(0); setSaving(true); setStorageNote('Saving recording…');
    try { await saveSensorSession(session); if (mounted.current) { setSessions(await listSensorSessions()); setStorageNote('Saved on this device. Download a copy to move it elsewhere.'); } }
    catch (e) { if (mounted.current) { setStorageNote('Not saved locally. Use Download to keep this recording.'); setError(describeError(e)); } }
    finally { if (mounted.current) setSaving(false); }
  }
  function finishRecording(message = '') {
    const current = recording.current; if (!current) return;
    recording.current = null; setIsRecording(false);
    if (message) { current.session.message = message; current.session.status = 'failed'; setError(message); }
    void retain(current.session);
  }
  finishRef.current = finishRecording;
  useEffect(() => {
    mounted.current = true;
    output.current = new PatternOutputClient(() => refreshOutputs(n => n + 1));
    void listSensorSessions().then(value => { if (mounted.current) setSessions(value); }).catch(e => { if (mounted.current) setStorageNote(describeError(e)); });
    const unsubscribe = inbox.subscribe(({ frame: next, receivedAtMs }) => {
      if (receivedAtMs - previewAt.current >= 90) { previewAt.current = receivedAtMs; setLiveFrame(next); setReceivedAt(receivedAtMs); }
      const current = recording.current;
      if (current && receivedAtMs >= current.nextAt && next.sequence !== current.lastSequence) {
        if (!canAppendFrame(current.session.frames, next)) { finishRef.current('Recording stopped at its memory limit. Captured frames were retained.'); return; }
        current.session.frames.push(copyFrame(next)); current.nextAt = receivedAtMs + 200; current.lastSequence = next.sequence;
        setRecordCount(current.session.frames.length);
      }
    });
    const timer = setInterval(() => {
      const now = Date.now(); setClock(now);
      if (recording.current && now >= recording.current.endAt) finishRef.current();
      else if (recording.current && (!inbox.latest || now - inbox.latest.receivedAtMs > 5000)) finishRef.current('Sensor frames stopped. Partial recording retained.');
    }, 200);
    const warn = (event: BeforeUnloadEvent) => { if (recording.current || controller.current) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', warn);
    return () => {
      mounted.current = false; controller.current?.abort(); source.current?.stop(); source.current = null; recording.current = null;
      output.current?.dispose(); output.current = null; clearInterval(timer); unsubscribe(); window.removeEventListener('beforeunload', warn);
    };
  }, [inbox]);
  useEffect(() => {
    if (!replayPlaying || sourceMode !== 'replay' || !selected) return;
    if (replayIndex >= selected.frames.length - 1) { setReplayPlaying(false); return; }
    const wait = Math.max(1, (selected.frames[replayIndex + 1].capturedAtMs - selected.frames[replayIndex].capturedAtMs) / replayRate);
    const timer = setTimeout(() => setReplayIndex(i => i + 1), wait); return () => clearTimeout(timer);
  }, [replayPlaying, replayIndex, replayRate, sourceMode, selected]);

  function clearPattern() { activePattern.current = null; setPattern(null); output.current?.clear(); }
  function disconnect() {
    source.current?.stop(); source.current = null; inbox.reset(); clearPattern();
    setLiveFrame(null); setBridgeMode(null); setConnection('disconnected'); setConnectionMessage('Source disconnected.');
  }
  function changeSource(mode: SourceMode) { disconnect(); setReplayPlaying(false); setSourceMode(mode); setError(''); if (mode === 'live') setOutputTarget('output'); }
  function connect(mode = sourceMode) {
    setError(''); disconnect();
    if (mode === 'demo') {
      source.current = demoSensor(inbox, () => activePattern.current); setConnection('connected'); setConnectionMessage('Generated RGB and depth · no physical sensor');
    } else if (mode === 'live') {
      try { source.current = localSensor(inbox, address, (status, message, mode) => {
        setConnection(status); setConnectionMessage(message); setBridgeMode(mode);
        if (status !== 'connected') { setLiveFrame(null); setReceivedAt(0); if (recording.current) finishRef.current(message || 'Sensor connection changed. Partial recording retained.'); }
        if (status === 'error') setError(message);
      }); }
      catch (e) { setConnection('error'); setConnectionMessage(describeError(e)); }
    }
  }
  function startRecording(seconds = duration) {
    if (!canAcquire || busy) return;
    setError(''); setRecordCount(0); setIsRecording(true);
    recording.current = { endAt: Date.now() + seconds * 1000, nextAt: 0, lastSequence: -1, session: { version: 1, id: crypto.randomUUID(), name: sessionName(sourceMode === 'demo' ? 'Demo recording' : 'Sensor recording'),
      createdAtMs: Date.now(), kind: 'recording', provenance: sourceMode === 'demo' ? 'synthetic' : 'sensor', status: 'complete', message: '', frames: [], captures: [], plannedPatterns: [] } };
  }
  async function present(next: CalibrationPattern, signal: AbortSignal) {
    activePattern.current = next; setPattern(next);
    if (outputTarget === 'demo') {
      if (sourceMode !== 'demo') throw new Error('Use a projection output window when capturing real sensor data.');
      await delay(20, signal);
      return { patternId: next.id, presentedAtMs: Date.now(), outputId: 'virtual-projector', mode: 'synthetic' as const, viewport: { width: next.width, height: next.height, devicePixelRatio: 1 }, rasterRect: { x: 0, y: 0, width: next.width, height: next.height } };
    }
    const target = outputs.find(item => item.visible);
    if (!target || !output.current) throw new Error('Open the projection output, move it to your projector, and keep it visible.');
    return output.current.present(next, target.outputId, signal);
  }
  async function capture() {
    if (!canAcquire || busy) return;
    const abort = new AbortController(); controller.current = abort; setCapturing(true); setError(''); setResultNote('');
    const session = await capturePatterns({ id: crypto.randomUUID(), name: sessionName(sourceMode === 'demo' ? 'Demo pattern capture' : 'Pattern capture'), patterns, settleMs,
      provenance: sourceMode === 'demo' ? 'synthetic' : 'sensor', inbox, signal: abort.signal, present, clear: clearPattern,
      verify: value => output.current?.verify(value), progress: value => { if (mounted.current) setProgress(value); } });
    controller.current = null;
    if (!mounted.current) return;
    setCapturing(false); setResultNote(session.status === 'complete' ? `${session.frames.length} of ${patterns.length} patterns captured. Observations are ready for replay; geometry has not been solved.` : session.message);
    if (session.status === 'failed') setError(session.message);
    await retain(session);
  }
  async function manualPattern(kind: 'white' | 'black' | 'grid') {
    if (busy) return false;
    setError(''); setPresentingManual(true); const abort = new AbortController(); controller.current = abort;
    try { await present({ id: `manual-${kind}`, kind, width, height }, abort.signal); }
    catch (e) { setError(describeError(e)); clearPattern(); return false; }
    finally { controller.current = null; setPresentingManual(false); }
    return true;
  }
  async function openSession(id: string) {
    if (busy || sessionOperation.current) return;
    sessionOperation.current = true; setLoadingSession(true);
    try { const value = await loadSensorSession(id); if (mounted.current) { changeSource('replay'); setSelected(value); setReplayIndex(0); setError(''); } }
    catch (e) { if (mounted.current) setError(describeError(e)); }
    finally { sessionOperation.current = false; if (mounted.current) setLoadingSession(false); }
  }
  async function importSession(file: File | undefined) {
    if (!file || busy || sessionOperation.current) return;
    sessionOperation.current = true; setLoadingSession(true); setError('');
    try {
      if (file.size > SENSOR_LIMITS.maxSessionBytes + 4 * SENSOR_LIMITS.maxHeaderBytes) throw new Error('This recording is too large. The maximum session size is 384 MB plus metadata.');
      const value = decodeSensorSession(new Uint8Array(await file.arrayBuffer())); value.id = crypto.randomUUID();
      if (!mounted.current) return;
      changeSource('replay'); setSelected(value); setReplayIndex(0); await retain(value);
    } catch (e) { if (mounted.current) setError(describeError(e)); }
    finally { sessionOperation.current = false; if (mounted.current) setLoadingSession(false); }
  }
  const actualOutput = outputs.find(item => item.visible);
  useEffect(() => registerHardware({
    status: () => ({ initialized: true, mode: sourceMode, connection, message: error || connectionMessage,
      provenance: sourceMode === 'demo' || bridgeMode === 'demo' ? 'synthetic' : sourceMode === 'replay' || bridgeMode === 'replay' ? 'replay' : bridgeMode === 'live' ? 'sensor' : 'unknown',
      busy, canAcquire, frames: recordCount, recording: isRecording, capturing,
      sessions: sessions.map(({ id, name, provenance, frames }) => ({ id, name, provenance, frames })), geometrySolved: false,
      settings: { address, resolution: resolution as '1920x1080', sequence: sequenceKind, settleMs: settleMs as 300, outputTarget: outputTarget as 'demo' | 'output', replayRate: replayRate as 1, replayIndex } }),
    execute: async command => {
      if (!command || typeof command !== 'object') throw new Error('Choose a hardware action.');
      if (command.action === 'cancel-capture') { controller.current?.abort(); return 'Capture cancellation requested. Existing captured frames are retained.'; }
      if (command.action === 'stop-recording') { finishRecording(); return 'Recording stopped. Inspect storage status before claiming it is saved.'; }
      if (busy) throw new Error('Finish the active hardware operation first.');
      switch (command.action) {
        case 'configure': {
          const s = command.settings;
          if (!s || Object.keys(s).some(k => !['address','resolution','sequence','settleMs','outputTarget','replayRate','replayIndex'].includes(k))) throw new Error('Unknown hardware setting.');
          if (s.address !== undefined) { const url = new URL(s.address); if (connectionOpen || !['ws:', 'wss:'].includes(url.protocol) || !['127.0.0.1','localhost','[::1]'].includes(url.hostname) || url.username || url.password) throw new Error('Disconnect before changing the local sensor address. Use a loopback WebSocket address.'); }
          if (s.resolution !== undefined && !['1920x1080','1280x720','640x480'].includes(s.resolution) || s.sequence !== undefined && !['gray','checks'].includes(s.sequence)
            || s.settleMs !== undefined && ![150,300,750,1500].includes(s.settleMs) || s.outputTarget !== undefined && !['demo','output'].includes(s.outputTarget)
            || s.replayRate !== undefined && ![.25,1,2].includes(s.replayRate) || s.replayIndex !== undefined && (!selected || !Number.isInteger(s.replayIndex) || s.replayIndex < 0 || s.replayIndex >= selected.frames.length)) throw new Error('Choose values supported by the hardware controls.');
          if (s.address !== undefined) setAddress(s.address); if (s.resolution !== undefined) { clearPattern(); setResolution(s.resolution); }
          if (s.sequence !== undefined) setSequenceKind(s.sequence); if (s.settleMs !== undefined) setSettleMs(s.settleMs); if (s.outputTarget !== undefined) { clearPattern(); setOutputTarget(s.outputTarget); }
          if (s.replayRate !== undefined) setReplayRate(s.replayRate); if (s.replayIndex !== undefined) { setReplayPlaying(false); setReplayIndex(s.replayIndex); }
          return 'Hardware settings updated.';
        }
        case 'import-session': importInput.current?.click(); return 'Choose a recording in the file picker.';
        case 'download-session': if (!selected) throw new Error('Open a recording first.'); downloadSensorSession(selected); return 'Recording download requested.';
        case 'remove-session': if (!sessions.some(s => s.id === command.id)) throw new Error('Recording not found.'); await deleteSensorSession(command.id); setSessions(await listSensorSessions()); if (selected?.id === command.id) { setSelected(null); setReplayPlaying(false); } return 'Recording deleted from this device.';
        case 'connect-demo': case 'connect-live': { const mode = command.action === 'connect-demo' ? 'demo' : 'live'; setSourceMode(mode); setReplayPlaying(false); if (mode === 'live') setOutputTarget('output'); connect(mode); return 'Sensor connection requested. Inspect readiness and provenance before capture.'; }
        case 'disconnect': disconnect(); return 'Sensor disconnected.';
        case 'record': { const seconds = command.seconds ?? duration; if (!Number.isFinite(seconds) || seconds < 1 || seconds > 30) throw new Error('Choose a recording duration of 1–30 seconds.'); if (!canAcquire) throw new Error('A fresh live or in-app demo sensor is required.'); setDuration(seconds); startRecording(seconds); return 'Recording started.'; }
        case 'open-session': if (!sessions.some(s => s.id === command.id)) throw new Error('Recording not found.'); await openSession(command.id); return 'Recording load requested. Inspect replay status.';
        case 'play-replay': if (sourceMode !== 'replay' || !selected) throw new Error('Open a recorded session first.'); setReplayPlaying(true); return 'Replay started; these are recorded observations.';
        case 'pause-replay': setReplayPlaying(false); return 'Replay paused.';
        case 'clear-pattern': clearPattern(); return 'Projection content restored.';
        case 'pattern': if (sourceMode === 'replay' || !['white', 'black', 'grid'].includes(command.pattern)) throw new Error('Choose a supported live/demo pattern.'); if (!await manualPattern(command.pattern)) throw new Error('Pattern could not be presented. Check the hardware panel.'); return 'Pattern presentation acknowledged; physical exposure is unverified.';
        case 'capture': if (!canAcquire || outputTarget === 'output' && !actualOutput) throw new Error('Connect a fresh sensor and open a visible projection output first.'); void capture(); return 'Capture started. Inspect progress; no measured geometry has been solved.';
        default: throw new Error('Unknown hardware action.');
      }
    },
  }));
  return <main className="hardware-workspace" id="hardware-workspace">
    <div className="hardware-heading"><div><span className="eyebrow">PREPARE THE PHYSICAL ROOM</span><h2>Hardware setup</h2><p>See the sensor, record a session, and capture projection patterns.</p></div><span className="hardware-badge">{sourceMode === 'demo' ? 'Demo data' : sourceMode === 'replay' ? 'Recorded data' : bridgeMode === 'demo' ? 'Helper demo · view only' : bridgeMode === 'replay' ? 'Helper replay · view only' : 'Local sensor'}</span></div>
    <div className="hardware-intro"><strong>Your scene stays intact.</strong> Patterns temporarily replace the output image. They do not change your content, surfaces or manual alignment. Automatic geometry solving comes next.</div>
    {error && <div className="hardware-alert" role="alert"><span>{error}</span><button aria-label="Dismiss hardware message" onClick={() => setError('')}>×</button></div>}
    <div className="hardware-columns">
      <section className="hardware-card sensor-card"><div className="hardware-card-title"><div><span className="eyebrow">01 / SENSOR INPUT</span><h3>What the camera sees</h3></div><span className={'sensor-status ' + (connected ? 'ready' : '')}>{sourceMode === 'replay' ? 'Replay' : connected ? 'Receiving frames' : connection === 'connecting' ? 'Connecting…' : connection === 'waiting' ? 'Waiting for sensor' : connection === 'ended' ? 'Replay finished' : 'Not connected'}</span></div>
        <div className="hardware-controls"><label className="field"><span>Source</span><select aria-label="Sensor source" value={sourceMode} disabled={busy} onChange={e => changeSource(e.target.value as SourceMode)}><option value="demo">Demo sensor</option><option value="live">Local Kinect / RGB-depth bridge</option><option value="replay">Recorded session</option></select></label>
          {sourceMode !== 'replay' && <button className="primary" disabled={busy} onClick={() => connectionOpen ? disconnect() : connect()}>{connectionOpen ? 'Disconnect' : sourceMode === 'demo' ? 'Start demo sensor' : connection === 'error' || connection === 'ended' ? 'Reconnect sensor' : 'Connect sensor'}</button>}
        </div>
        {sourceMode === 'live' && <div className="hardware-source-note"><p>Start the sensor helper on this computer, then connect. The native Kinect helper targets Windows; physical capture still needs hardware verification. The helper’s demo and replay modes also work on Mac for testing the connection.</p>{bridgeMode && bridgeMode !== 'live' && <p>This is {bridgeMode === 'demo' ? 'generated data' : 'a recorded stream'}, not a live measurement. Recording and calibration capture are disabled. Use the in-app Demo sensor for simulated pattern captures.</p>}<label className="field"><span>Local bridge address</span><input aria-label="Local sensor bridge address" value={address} disabled={busy || connectionOpen} onChange={e => setAddress(e.target.value)} /></label></div>}
        <div className="sensor-previews"><SensorPreview frame={frame} kind="color" /><SensorPreview frame={frame} kind="depth" /></div>
        <p className="hardware-caption">{sourceMode === 'replay' ? selected ? `${selected.provenance === 'synthetic' ? 'Synthetic' : 'Sensor'} recording · original capture timing retained` : 'Choose or import a recording from the library.' : connectionMessage}</p>
        {frame && <div className="sensor-details"><span>Frame <strong>{frame.sequence}</strong></span><span>Color <strong>{frame.device.color.width} × {frame.device.color.height}</strong></span><span>Depth <strong>{frame.device.depth.width} × {frame.device.depth.height}</strong></span><span>Depth unit <strong>{frame.device.depthScaleMeters * 1000} mm</strong></span><span>Camera calibration <strong>{frame.device.colorIntrinsics && frame.device.depthIntrinsics ? 'Included' : 'Not supplied'}</strong></span></div>}
        {sourceMode !== 'replay' ? <div className="recording-controls"><label className="field"><span>Record for</span><select aria-label="Recording duration" disabled={busy} value={duration} onChange={e => setDuration(Number(e.target.value))}>{![5,10,30].includes(duration) && <option value={duration}>{duration} seconds</option>}<option value={5}>5 seconds</option><option value={10}>10 seconds</option><option value={30}>30 seconds</option></select></label><button className={isRecording ? 'secondary' : 'primary'} disabled={!isRecording && (!canAcquire || busy)} onClick={() => isRecording ? finishRecording() : startRecording()}>{isRecording ? 'Stop & save recording' : 'Record session'}</button><span>{isRecording ? `${recordCount} frames · ${Math.max(0, Math.ceil(((recording.current?.endAt ?? clock) - clock) / 1000))}s left` : 'Up to 5 frames / second'}</span></div> : selected && <div className="replay-controls"><div><button className="primary" onClick={() => { if (replayIndex === selected.frames.length - 1) setReplayIndex(0); setReplayPlaying(p => !p); }}>{replayPlaying ? 'Pause replay' : 'Play replay'}</button><label className="field"><span>Speed</span><select aria-label="Replay speed" value={replayRate} onChange={e => setReplayRate(Number(e.target.value))}><option value={.25}>¼×</option><option value={1}>1×</option><option value={2}>2×</option></select></label><span>Frame {replayIndex + 1} of {selected.frames.length}</span></div><input aria-label="Replay frame" type="range" min={0} max={selected.frames.length - 1} value={replayIndex} onChange={e => { setReplayPlaying(false); setReplayIndex(Number(e.target.value)); }} /></div>}
      </section>
      <section className="hardware-card library-card"><div className="hardware-card-title"><div><span className="eyebrow">KEEP THE EVIDENCE</span><h3>Recordings</h3></div><label className={'hardware-file-button secondary ' + (busy ? 'disabled' : '')}>Import<input ref={importInput} type="file" accept=".pmsession" aria-label="Import sensor recording" disabled={busy} onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; void importSession(file); }} /></label></div>
        <p className="hardware-caption">{storageNote}</p>
        <div className="session-list">{sessions.length ? sessions.map(item => <button key={item.id} disabled={busy} aria-pressed={selected?.id === item.id} className={selected?.id === item.id ? 'selected' : ''} onClick={() => void openSession(item.id)}><strong>{item.name}</strong><span>{item.provenance === 'synthetic' ? 'Demo' : 'Sensor'} · {item.frames} frames · {sizeLabel(item.bytes)}</span><small>{item.kind === 'pattern-capture' ? 'Pattern capture' : 'Recording'} · {item.status}</small></button>) : <div className="session-empty">Your first recording will appear here.<br />Start the demo sensor to try it now.</div>}</div>
        {selected && <div className="selected-session"><strong>{selected.name}</strong><p>{selected.frames.length} frames · {sizeLabel(sessionBytes(selected))}{selected.captures.length ? ` · ${selected.captures.length}/${selected.plannedPatterns.length} patterns` : ''}</p>{selected.message && <p>{selected.message}</p>}<div className="hardware-actions"><button className="secondary" disabled={busy} onClick={() => { changeSource('replay'); setReplayIndex(0); }}>Review</button><button className="secondary" disabled={saving} onClick={() => { try { downloadSensorSession(selected); } catch (e) { setError(describeError(e)); } }}>Download</button><button className="hardware-text-button" disabled={busy} onClick={async () => { try { await deleteSensorSession(selected.id); setSessions(await listSensorSessions()); setSelected(null); setReplayPlaying(false); } catch (e) { setError(describeError(e)); } }}>Delete</button></div></div>}
      </section>
    </div>
    <section className="hardware-card pattern-card"><div className="hardware-card-title"><div><span className="eyebrow">02 / PATTERN CAPTURE</span><h3>Connect pixels to observations</h3></div><span className="hardware-badge">Capture only · no geometry changes</span></div>
      <div className="pattern-columns"><div><PatternPreview pattern={shownPattern} /><p className="hardware-caption">{shownPattern ? patternLabel(shownPattern) : 'Choose a test pattern or start a sequence.'}</p>{replayCapture && <p className="hardware-caption">Captured after {replayCapture.settleMs} ms settling · {replayCapture.presentation.mode === 'synthetic' ? 'Virtual projector' : 'Output window'} · source clock ±{frame?.clockUncertaintyMs} ms</p>}</div>
        <div className="pattern-settings"><div className="hardware-controls"><label className="field"><span>Output</span><select aria-label="Pattern output target" value={outputTarget} disabled={busy || sourceMode === 'replay'} onChange={e => { clearPattern(); setOutputTarget(e.target.value); }}><option value="demo" disabled={sourceMode !== 'demo'}>In-app demo projector</option><option value="output">Projection output window</option></select></label><button className="secondary" disabled={busy} onClick={() => { void bridge.output({ action: 'open' }).catch(e => setError(describeError(e))); setOutputTarget('output'); }}>Open output ↗</button></div>
          {outputTarget === 'output' && <><p className="hardware-caption">{actualOutput ? `Output visible · ${actualOutput.width} × ${actualOutput.height} window pixels · ${actualOutput.devicePixelRatio}× display scale` : 'Waiting for a visible output window.'} Move it to the projector and make it full screen before capture.</p>{snapshot.storage === 'disk' && <div className="hardware-controls"><label className="field"><span>Display</span><select aria-label="Calibration output display" disabled={busy} value={snapshot.output.displayId ?? snapshot.displays[0]?.id ?? ''} onChange={e => void bridge.output({ action: 'open', displayId: e.target.value }).catch(err => setError(describeError(err)))}>{snapshot.displays.map(d => <option key={d.id} value={d.id}>{d.label}</option>)}</select></label><button className="secondary" disabled={busy} onClick={() => void bridge.output({ action: snapshot.output.fullscreen ? 'windowed' : 'fullscreen' }).catch(e => setError(describeError(e)))}>{snapshot.output.fullscreen ? 'Exit full screen' : 'Full screen'}</button></div>}</>}
          <div className="hardware-controls"><label className="field"><span>Pattern resolution</span><select aria-label="Pattern resolution" value={resolution} disabled={busy || sourceMode === 'replay'} onChange={e => { clearPattern(); setResolution(e.target.value); }}><option value="1920x1080">1920 × 1080</option><option value="1280x720">1280 × 720</option><option value="640x480">640 × 480</option></select></label><label className="field"><span>Settle before capture</span><select aria-label="Pattern settling time" value={settleMs} disabled={busy || sourceMode === 'replay'} onChange={e => setSettleMs(Number(e.target.value))}><option value={150}>150 ms</option><option value={300}>300 ms</option><option value={750}>750 ms</option><option value={1500}>1.5 seconds</option></select></label></div>
          <div className="hardware-actions pattern-checks">{(['grid', 'white', 'black'] as const).map(kind => <button key={kind} className="secondary" disabled={busy || sourceMode === 'replay'} onClick={() => void manualPattern(kind)}>{kind === 'grid' ? 'Test grid' : kind === 'white' ? 'White' : 'Black'}</button>)}<button className="hardware-text-button" disabled={capturing || presentingManual} onClick={clearPattern}>Restore content</button></div>
          <label className="field"><span>Capture sequence</span><select aria-label="Capture sequence" disabled={busy || sourceMode === 'replay'} value={sequenceKind} onChange={e => setSequenceKind(e.target.value as 'gray' | 'checks')}><option value="checks">Quick check · 3 patterns</option><option value="gray">Gray code · {patternSequence(width, height).length} patterns</option></select></label>
          <div className="hardware-actions"><button className="primary" disabled={!canAcquire || busy || outputTarget === 'output' && !actualOutput} onClick={() => void capture()}>{selected?.kind === 'pattern-capture' && selected.status !== 'complete' ? 'Retry sequence' : 'Capture sequence'}</button>{capturing && <button className="secondary" onClick={() => controller.current?.abort()}>Cancel capture</button>}</div>
          {capturing && progress && <div className="capture-progress" role="status"><progress value={progress.index} max={progress.total} /><span>{progress.index} / {progress.total} captured · {progress.phase === 'presenting' ? 'Displaying pattern' : progress.phase === 'settling' ? 'Waiting for the image to settle' : 'Waiting for a fresh camera frame'}</span></div>}
          <p className="hardware-caption" role="status">{resultNote}</p>
        </div>
      </div>
      <div className="hardware-footnote">{sourceMode === 'demo' ? 'Demo captures are generated from a virtual tilted plane. They test the workflow, not your hardware.' : sourceMode === 'replay' ? 'Replay shows original observations. Switch to a live or demo sensor to acquire new ones.' : 'A browser paint acknowledgement is not a physical exposure guarantee. Projector delay, display scaling and camera timing still need measurement.'} Patterns use the raw output raster, without the scene’s manual warp. Stop capture before moving or resizing the output.</div>
    </section>
  </main>;
}

function SensorPreview({ frame, kind }: { frame: SensorFrame | null; kind: 'color' | 'depth' }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const node = canvas.current; if (!node || !frame) return;
    const { width, height } = kind === 'color' ? frame.device.color : frame.device.depth; node.width = width; node.height = height;
    const ctx = node.getContext('2d'); if (!ctx) return; const image = ctx.createImageData(width, height);
    for (let i = 0; i < width * height; i++) {
      if (kind === 'color') { image.data[i * 4] = frame.color[i * 3]; image.data[i * 4 + 1] = frame.color[i * 3 + 1]; image.data[i * 4 + 2] = frame.color[i * 3 + 2]; }
      else if (frame.depth[i]) {
        const distance = Math.min(1, frame.depth[i] * frame.device.depthScaleMeters / 5);
        image.data[i * 4] = Math.round(220 * (1 - distance)); image.data[i * 4 + 1] = Math.round(160 + 70 * (1 - Math.abs(distance - .5) * 2)); image.data[i * 4 + 2] = Math.round(70 + 170 * distance);
      }
      image.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(image, 0, 0);
  }, [frame, kind]);
  return <figure className="sensor-preview"><div>{frame ? <canvas ref={canvas} aria-label={kind === 'color' ? 'Sensor color preview' : 'Sensor depth preview'} /> : <span>{kind === 'color' ? 'Color camera' : 'Depth camera'}<small>No frames yet</small></span>}</div><figcaption>{kind === 'color' ? 'RGB / color' : 'Depth / distance'}{kind === 'depth' && <small>Near → far · black = invalid</small>}</figcaption></figure>;
}
function PatternPreview({ pattern }: { pattern: CalibrationPattern | null }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => { if (canvas.current && pattern) paintPattern(canvas.current, pattern); }, [pattern]);
  return <div className="pattern-preview">{pattern ? <canvas ref={canvas} aria-label="Pattern preview" /> : <span>Projection patterns<small>Grid · reference frames · coded stripes</small></span>}</div>;
}
