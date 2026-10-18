import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { MAX_SCAN_BYTES, RTABMAP_VERSION, type RoomScan } from './shared/roomScan';

export function RoomScanPanel() {
  const [scan, setScan] = useState<RoomScan | null>(null), [name, setName] = useState(''), [message, setMessage] = useState(''), [busy, setBusy] = useState(false);
  const job = useRef<Worker | null>(null), timeout = useRef<ReturnType<typeof setTimeout> | null>(null), host = useRef<HTMLDivElement>(null);
  const mounted = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; job.current?.terminate(); if (timeout.current) clearTimeout(timeout.current); }; }, []);
  async function load(file?: File) {
    if (!file || job.current) return;
    setMessage('');
    if (file.size > MAX_SCAN_BYTES) { setMessage('Export a smaller point cloud (32 MB maximum).'); return; }
    setBusy(true);
    try {
      const bytes = await file.arrayBuffer();
      if (!mounted.current) return;
      const worker = new Worker(new URL('./roomScan.worker.ts', import.meta.url), { type: 'module' }); job.current = worker;
      const finish = () => { worker.terminate(); job.current = null; if (timeout.current) clearTimeout(timeout.current); setBusy(false); };
      timeout.current = setTimeout(() => { finish(); setMessage('The cloud took too long to read. Try a smaller export.'); }, 20000);
      worker.onmessage = ({ data }) => { finish(); if (data.error) setMessage(data.error); else { setScan(data.scan); setName(file.name); setMessage('Room scan loaded for inspection. It has not changed your projection alignment.'); } };
      worker.onerror = () => { finish(); setMessage('The cloud could not be read. Export an assembled PLY point cloud.'); };
      worker.postMessage(bytes, [bytes]);
    } catch (error) { setBusy(false); setMessage(error instanceof Error ? error.message : String(error)); }
  }
  useEffect(() => {
    if (!scan || !host.current) return;
    const node = host.current;
    let renderer: THREE.WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: false }); } catch { setMessage('3D preview is unavailable on this device.'); return; }
    renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5)); node.append(renderer.domElement);
    const scene = new THREE.Scene(); scene.background = new THREE.Color('#101b17');
    const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.BufferAttribute(scan.positions, 3)); geometry.setAttribute('color', new THREE.BufferAttribute(scan.colors, 3));
    const span = Math.max(...scan.bounds.max.map((n, i) => n - scan.bounds.min[i]));
    const material = new THREE.PointsMaterial({ size: Math.max(.004, span / 600), vertexColors: true });
    scene.add(new THREE.Points(geometry, material));
    const camera = new THREE.PerspectiveCamera(45, 1, .001, Math.max(100, span * 20)); camera.up.set(0, 0, 1);
    const center = new THREE.Vector3(...scan.bounds.min.map((n, i) => (n + scan.bounds.max[i]) / 2) as [number, number, number]);
    camera.position.copy(center).add(new THREE.Vector3(span * 1.5, -span * 1.5, span));
    const controls = new OrbitControls(camera, renderer.domElement); controls.target.copy(center); controls.update();
    // Render on demand: room reconstruction must not compete with live projection.
    const render = () => renderer.render(scene, camera);
    controls.addEventListener('change', render);
    const resize = new ResizeObserver(() => { const w = node.clientWidth, h = node.clientHeight; if (!w || !h) return; renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix(); render(); }); resize.observe(node);
    return () => { resize.disconnect(); controls.dispose(); geometry.dispose(); material.dispose(); renderer.dispose(); renderer.domElement.remove(); };
  }, [scan]);
  return <section className="hardware-card room-scan-panel">
    <div className="hardware-card-title"><div><span className="eyebrow">OPTIONAL / ROOM RECONSTRUCTION</span><h3>Room scan · RTAB-Map</h3></div></div>
    <p>Use RTAB-Map {RTABMAP_VERSION} to combine camera views into a room point cloud. Import its PLY export here to inspect the real geometry. The tabletop mapping above works without a room scan.</p>
    <div className="hardware-actions"><label className="secondary">{busy ? 'Reading scan…' : 'Import room scan (.ply)'}<input aria-label="Import RTAB-Map room scan" type="file" accept=".ply" disabled={busy} onChange={e => { void load(e.target.files?.[0]); e.target.value = ''; }} /></label>
      <a href="https://github.com/introlab/rtabmap/releases/tag/0.23.8" target="_blank" rel="noreferrer">Get RTAB-Map ↗</a>{scan && <button className="secondary" onClick={() => { setScan(null); setName(''); setMessage('Room scan cleared.'); }}>Clear scan</button>}</div>
    {scan && <><div className="room-scan-view" ref={host} role="img" aria-label="Imported room point cloud; drag to orbit" /><p><strong>{name}</strong> · {scan.inputPoints.toLocaleString()} points · {Array.from(scan.bounds.max, (n, i) => (n - scan.bounds.min[i]).toFixed(2)).join(' × ')} m. Drag to orbit; scroll to zoom.</p></>}
    {message && <p role="status">{message}</p>}
    <p className="hint">Local inspection only; kept for this Hardware session. Coordinates remain in RTAB-Map’s frame. Room-to-projector registration, object recognition and moving-object tracking are not supplied by this import.</p>
  </section>;
}
