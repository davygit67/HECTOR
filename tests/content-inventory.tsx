import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ContentInventory } from '../src/ContentInventory';
import { initialScene, reduceScene, type Command } from '../src/shared/domain';
import { defaultSpec } from '../src/shared/content';
import '../src/styles.css';
import '../src/spatial.css';

// Isolated in-memory scene: no bridge, storage, YouTube player or media worker.
function sampleScene() {
  let scene = initialScene();
  const commands: Command[] = [
    { type: 'timer.create', id: 'timer', surfaceId: 'tabletop', title: 'Tea timer', durationMs: 120000 },
    { type: 'content.create', id: 'youtube', surfaceId: 'wall', title: 'YouTube video', spec: { kind: 'youtube', config: { videoId: 'M7lc1UVf-VE', startSeconds: 0, backlight: true } } },
    { type: 'content.create', id: 'game', surfaceId: 'wall', title: 'Target game', spec: defaultSpec('game') },
    { type: 'layer.configure', id: 'game', settings: { visible: false } },
    { type: 'content.create', id: 'note', surfaceId: 'tabletop', title: 'A longer note title that wraps in the compact inventory', spec: defaultSpec('note') },
    { type: 'layer.configure', id: 'note', settings: { opacity: 0, locked: true } },
    { type: 'content.create', id: 'recipe', surfaceId: 'tabletop', title: 'Lemon pasta', spec: defaultSpec('recipe') },
    { type: 'content.create', id: 'art', surfaceId: 'wall', title: 'Evening aurora', spec: defaultSpec('art') },
    { type: 'content.select', id: 'youtube' },
  ];
  for (const command of commands) scene = reduceScene(scene, command);
  return scene;
}
function Fixture() {
  const [scene, setScene] = useState(sampleScene);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [commands, setCommands] = useState<string[]>([]);
  const [error, setError] = useState('');
  const send = (command: Command) => {
    if (command.type === 'content.select' || command.type === 'timer.select') setExpandedId(command.id);
    try {
      setScene(reduceScene(scene, command)); setError('');
      setCommands(list => [...list, command.type]);
    } catch (e) { setError(String(e)); }
  };
  return <main style={{ padding: 24 }}>
    <h1>Content inventory check</h1><p>Silent local fixture. No scene is saved and no video is loaded.</p>
    <button onClick={() => { setScene(sampleScene()); setExpandedId(null); setCommands([]); }}>Reset fixture</button>
    <button onClick={() => { setScene(initialScene()); setExpandedId(null); }}>Empty scene</button>
    <p id="fixture-state">Selected surface: {scene.selectedSurfaceId} · Content: {scene.selectedContentId ?? 'none'} · Timer: {scene.selectedTimerId ?? 'none'}</p>
    <p id="fixture-commands">Commands: {commands.join(', ') || 'none'}</p>
    {error && <p role="alert">{error}</p>}
    <aside className="inspector spatial-inspector" style={{ width: 300, maxWidth: '100%', position: 'static', maxHeight: 'none', marginTop: 20 }}>
      <div className="inspector-title"><span className="eyebrow">SCENE INSPECTOR · CONTENT</span></div>
      <ContentInventory scene={scene} now={Date.now()} expandedId={expandedId} onExpand={setExpandedId} send={send} onPlay={() => setError('Unexpected player action')} />
    </aside>
  </main>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
