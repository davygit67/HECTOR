import { measuredMaskPath } from './shared/measured';
import { layerOpacity, layerVisible, renderWidth, surfaceLayers } from './shared/layers';
import { localMediaSource } from './localMedia';
import { paintTimer } from './timerPainter';
import { artworkSceneKey } from './shared/renderKeys';
import { mediaRevision } from './nativeMedia';
import { backlightRevision, readBacklight } from './backlightField';
import { surfaceFrameKey } from './shared/renderActivity';
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { formatTime, remaining, type Scene } from './shared/domain';
import { coverageWeights, surfacePoint, type CameraPose, type Surface } from './shared/spatial';
import { paintArt, paintContent, paintSceneBacklight } from './contentPainter';

const MASK = 128;
function renderVisible(element: Element | null) {
  if (!element || document.hidden) return false;
  const presentation = document.querySelector('.projection-presentation:not([hidden])');
  return !presentation || presentation.contains(element);
}
function domainPath(ctx: CanvasRenderingContext2D, s: Surface, w: number, h: number) {
  ctx.beginPath();
  for (const polygon of [s.boundary, ...s.holes]) { polygon.forEach((p, i) => i ? ctx.lineTo(p.x * w, p.y * h) : ctx.moveTo(p.x * w, p.y * h)); ctx.closePath(); }
}
interface Artwork { canvas: HTMLCanvasElement; texture: THREE.CanvasTexture; stamp: string }
const artwork = new Map<string, Artwork>();
const masks = new Map<string, { stamp: number; texture: THREE.DataTexture }>();

/** Shared procedural state is evaluated from room position and one persisted time origin. */
export function getArtwork(scene: Scene, surface: Surface, now: number, withTimers = true, liveVideos = false, TEX_W = 768, backgroundOnly = false) {
  const TEX_H = TEX_W * 9 / 16;
  const key = `${surface.id}:${withTimers}:${liveVideos}:${scene.showGrid}:${TEX_W}:${backgroundOnly}`;
  let record = artwork.get(key);
  if (!record) {
    const canvas = document.createElement('canvas'); canvas.width = TEX_W; canvas.height = TEX_H;
    const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace; texture.minFilter = THREE.LinearFilter; texture.generateMipmaps = false;
    record = { canvas, texture, stamp: '' }; artwork.set(key, record);
  }
  const content = scene.contents.filter(c => c.surfaceId === surface.id);
  const art = content.find(c => c.kind === 'art' && layerVisible(c));
  const activity = surfaceFrameKey(scene, surface.id, now, withTimers, backgroundOnly, {
    media: mediaRevision, local: id => localMediaSource(id)?.revision ?? 0,
    light: id => ({ revision: backlightRevision(id), alpha: readBacklight(id, now)?.alpha ?? 0 }),
  });
  const stamp = `${artworkSceneKey(scene, withTimers)}:${activity}`;
  if (record.stamp === stamp) return record;
  record.stamp = stamp;
  const ctx = record.canvas.getContext('2d')!;
  ctx.clearRect(0, 0, TEX_W, TEX_H); ctx.save(); domainPath(ctx, surface, TEX_W, TEX_H); ctx.clip('evenodd');
  if (surface.measurement) ctx.clip(new Path2D(measuredMaskPath(surface.measurement.mask, TEX_W, TEX_H)));
  ctx.fillStyle = surface.fill ?? '#000000'; ctx.fillRect(0, 0, TEX_W, TEX_H);
  if (!surface.fill && art?.kind === 'art') { ctx.save(); ctx.globalAlpha = layerOpacity(art); paintArt(ctx, art, surface, TEX_W, TEX_H, now); ctx.restore(); }
  paintSceneBacklight(ctx, scene, surface, TEX_W, TEX_H, now);
  if (scene.showGrid) {
    ctx.strokeStyle = '#cff7cf99'; ctx.lineWidth = 1;
    for (let i = 0; i <= 10; i++) { ctx.beginPath(); ctx.moveTo(i / 10 * TEX_W, 0); ctx.lineTo(i / 10 * TEX_W, TEX_H); ctx.moveTo(0, i / 10 * TEX_H); ctx.lineTo(TEX_W, i / 10 * TEX_H); ctx.stroke(); }
  }
  if (!backgroundOnly) for (const entry of surfaceLayers(scene, surface.id)) {
    if (!layerVisible(entry) || ('kind' in entry && entry.kind === 'art')) continue;
    ctx.save(); ctx.globalAlpha = layerOpacity(entry);
    if ('kind' in entry) { if (!(liveVideos && !window.projectionMedia && entry.kind === 'youtube')) paintContent(ctx, entry, TEX_W, TEX_H, now); }
    else if (withTimers) paintTimer(ctx, entry, TEX_W, TEX_H, now);
    ctx.restore();
  }
  ctx.restore(); record.texture.needsUpdate = true; return record;
}

function getMask(scene: Scene, surface: Surface) {
  const cached = masks.get(surface.id);
  if (cached?.stamp === scene.geometryRevision) return cached.texture;
  const pixels = new Uint8Array(MASK * MASK * 4);
  for (let y = 0; y < MASK; y++) for (let x = 0; x < MASK; x++) {
    const weights = coverageWeights(scene, surface, { x: x / (MASK - 1), y: y / (MASK - 1) }), index = (y * MASK + x) * 4;
    pixels[index] = Math.round(weights[0] * 255); pixels[index + 1] = Math.round(weights[1] * 255); pixels[index + 3] = 255;
  }
  const texture = cached?.texture ?? new THREE.DataTexture(pixels, MASK, MASK, THREE.RGBAFormat);
  texture.image.data = pixels; texture.minFilter = THREE.NearestFilter; texture.magFilter = THREE.NearestFilter; texture.needsUpdate = true;
  masks.set(surface.id, { stamp: scene.geometryRevision, texture }); return texture;
}

export function SurfaceArtwork({ scene, surface, liveVideos = false, highResolution = false, active = true, backgroundOnly = false }: { scene: Scene; surface: Surface; liveVideos?: boolean; highResolution?: boolean; active?: boolean; backgroundOnly?: boolean }) {
  const TEX_W = renderWidth(scene, highResolution), TEX_H = TEX_W * 9 / 16;
  const canvas = useRef<HTMLCanvasElement>(null), latest = useRef({ scene, surface, liveVideos, active, backgroundOnly }); latest.current = { scene, surface, liveVideos, active, backgroundOnly };
  useEffect(() => {
    let frame = 0, lastStamp = '';
    const render = () => {
      if (!latest.current.active || !renderVisible(canvas.current)) { frame = requestAnimationFrame(render); return; }
      const { scene, surface, liveVideos, backgroundOnly } = latest.current, result = getArtwork(scene, surface, Date.now(), false, liveVideos, TEX_W, backgroundOnly);
      const stamp = `${surface.id}:${scene.showGrid}:${result.stamp}:${liveVideos}`;
      if (lastStamp !== stamp) { const ctx = canvas.current?.getContext('2d'); ctx?.clearRect(0, 0, TEX_W, TEX_H); ctx?.drawImage(result.canvas, 0, 0); lastStamp = stamp; }
      frame = requestAnimationFrame(render);
    }; render(); return () => cancelAnimationFrame(frame);
  }, [TEX_W]);
  return <canvas ref={canvas} width={TEX_W} height={TEX_H} className="surface-artwork" aria-hidden="true" />;
}

function surfaceGeometry(surface: Surface) {
  const shape = new THREE.Shape(); surface.boundary.forEach((p, i) => i ? shape.lineTo(p.x, p.y) : shape.moveTo(p.x, p.y)); shape.closePath();
  for (const hole of surface.holes) { const path = new THREE.Path(); hole.forEach((p, i) => i ? path.lineTo(p.x, p.y) : path.moveTo(p.x, p.y)); path.closePath(); shape.holes.push(path); }
  const geometry = new THREE.ShapeGeometry(shape), positions = geometry.getAttribute('position'), uv = geometry.getAttribute('uv');
  for (let i = 0; i < positions.count; i++) {
    const u = positions.getX(i), v = positions.getY(i), world = surfacePoint(surface, { x: u, y: v });
    positions.setXYZ(i, ...world); uv.setXY(i, u, v);
  }
  geometry.computeVertexNormals(); return geometry;
}

function surfaceMaterial(texture: THREE.Texture, mask: THREE.Texture, mode: number, measured: boolean) {
  return new THREE.ShaderMaterial({
    side: THREE.DoubleSide, uniforms: { art: { value: texture }, coverage: { value: mask }, viewMode: { value: mode }, measured: { value: measured ? 1 : 0 } },
    vertexShader: 'varying vec2 surfaceUv; void main(){surfaceUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
    fragmentShader: `uniform sampler2D art; uniform sampler2D coverage; uniform float viewMode; uniform float measured; varying vec2 surfaceUv;
      void main(){
        vec3 base=texture2D(art,vec2(surfaceUv.x,1.0-surfaceUv.y)).rgb;
        vec2 weights=texture2D(coverage,surfaceUv).rg;
        float total=weights.r+weights.g;
        vec3 color=total>0.0||measured>0.5?base:vec3(0.037,0.048,0.04);
        if(viewMode>0.5 && viewMode<1.5){
          color=vec3(0.03,0.04,0.035);
          if(weights.r>0.0)color=vec3(0.15,0.64,0.46);
          if(weights.g>0.0)color=vec3(0.75,0.42,0.14);
          if(weights.r>0.0 && weights.g>0.0)color=vec3(0.65,0.84,0.66);
          color=mix(color,base,0.12);
        }
        if(viewMode>1.5)color=base*(viewMode<2.5?weights.r:weights.g);
        gl_FragColor=vec4(color,1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}

export type SpatialViewKind = 'orbit' | 'viewer' | 'projector-a' | 'projector-b';
export function SpatialView({ scene, view, coverage = false, resetKey = 0, onSelect, presenting = false }: { scene: Scene; view: SpatialViewKind; coverage?: boolean; resetKey?: number; onSelect?: (id: string) => void; presenting?: boolean }) {
  const host = useRef<HTMLDivElement>(null), current = useRef({ scene, coverage, onSelect, presenting }); current.current = { scene, coverage, onSelect, presenting };
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const element = host.current!; let renderer: THREE.WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false }); }
    catch { setError('3D preview needs WebGL. Surface editing and manual output are still available.'); return; }
    setError(null); renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5)); renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.domElement.setAttribute('aria-label', view === 'orbit' ? 'Interactive 3D room. Drag to orbit; scroll to zoom; click a surface to select it.' : `${view} spatial preview`);
    renderer.domElement.tabIndex = view === 'orbit' ? 0 : -1;
    element.appendChild(renderer.domElement);
    const world = new THREE.Scene(), camera = new THREE.PerspectiveCamera(43, 16 / 9, .05, 40);
    world.background = new THREE.Color(view.startsWith('projector') ? '#000000' : '#141e1b');
    camera.position.set(4.2, 3.4, 4.8); camera.lookAt(0, 1, -.3);
    const controls = view === 'orbit' ? new OrbitControls(camera, renderer.domElement) : null;
    if (controls) { controls.target.set(0, 1, -.3); controls.enableDamping = true; controls.minDistance = 2; controls.maxDistance = 11; controls.maxPolarAngle = Math.PI * .49; controls.listenToKeyEvents(renderer.domElement); controls.saveState(); }
    const geometries: THREE.BufferGeometry[] = [], materials: THREE.Material[] = [], sprites: THREE.Texture[] = [];
    let meshes: { id: string; mesh: THREE.Mesh; material: THREE.ShaderMaterial }[] = [], lastGeometry = -1, lastSelection = '', lastViewer = '', frame = 0;
    const collect = <T extends THREE.BufferGeometry | THREE.Material>(value: T): T => { if (value instanceof THREE.BufferGeometry) geometries.push(value); else materials.push(value); return value; };
    const addBox = (position: number[], size: number[], color: string) => {
      const mesh = new THREE.Mesh(collect(new THREE.BoxGeometry(size[0], size[1], size[2])), collect(new THREE.MeshBasicMaterial({ color })));
      mesh.position.set(position[0], position[1], position[2]); world.add(mesh);
    };
    const addLine = (points: THREE.Vector3[], color: string, opacity = 1) => {
      const line = new THREE.Line(collect(new THREE.BufferGeometry().setFromPoints(points)), collect(new THREE.LineBasicMaterial({ color, transparent: opacity < 1, opacity }))); world.add(line);
    };
    const label = (text: string, pos: THREE.Vector3, color: string) => {
      const canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = 64;
      const ctx = canvas.getContext('2d')!; ctx.font = '500 25px -apple-system, sans-serif'; ctx.textAlign = 'center'; ctx.fillStyle = color; ctx.fillText(text, 128, 40);
      const map = new THREE.CanvasTexture(canvas); map.colorSpace = THREE.SRGBColorSpace; sprites.push(map);
      const sprite = new THREE.Sprite(collect(new THREE.SpriteMaterial({ map, depthTest: false, transparent: true }))); sprite.position.copy(pos); sprite.scale.set(1.1, .275, 1); world.add(sprite);
    };
    function rebuild() {
      world.clear(); geometries.splice(0).forEach(g => g.dispose()); materials.splice(0).forEach(m => m.dispose()); sprites.splice(0).forEach(t => t.dispose()); meshes = [];
      const state = current.current.scene, isOutput = view.startsWith('projector');
      if (!isOutput) {
        const grid = new THREE.GridHelper(7, 28, '#4c5d51', '#293d32'); world.add(grid); geometries.push(grid.geometry); materials.push(...(Array.isArray(grid.material) ? grid.material : [grid.material]));
      }
      const table = state.surfaces.find(s => s.id === 'tabletop')!;
      addBox([table.origin[0] + table.width / 2, table.origin[1] - .055, table.origin[2] + table.height / 2], [table.width + .025, .10, table.height + .025], isOutput ? '#000000' : '#35473b');
      for (const x of [.12, table.width - .12]) for (const z of [.12, table.height - .12]) addBox([table.origin[0] + x, table.origin[1] / 2 - .055, table.origin[2] + z], [.065, Math.max(.04, table.origin[1] - .1), .065], isOutput ? '#000000' : '#344238');
      for (const surface of state.surfaces) {
        const material = surfaceMaterial(getArtwork(state, surface, Date.now()).texture, getMask(state, surface), 0, !!surface.measurement); materials.push(material);
        const mesh = new THREE.Mesh(collect(surfaceGeometry(surface)), material); mesh.userData.surfaceId = surface.id; world.add(mesh); meshes.push({ id: surface.id, mesh, material });
        if (view === 'orbit') {
          for (const poly of [surface.boundary, ...surface.holes]) {
            const points = [...poly, poly[0]].map(p => new THREE.Vector3(...surfacePoint(surface, p)));
            addLine(points, surface.id === state.selectedSurfaceId ? '#e3edb9' : '#719789');
          }
          const center = surfacePoint(surface, { x: .5, y: .5 }); label(surface.name, new THREE.Vector3(center[0], center[1] + .2, center[2]), '#d1e5cd');
        }
      }
      if (view === 'orbit') {
        for (const p of state.projectors) {
          addBox(p.position, [.20, .12, .16], p.enabled ? p.color : '#58635a');
          label(p.name.replace('Projector ', 'P / '), new THREE.Vector3(p.position[0], p.position[1] + .22, p.position[2]), p.enabled ? p.color : '#899489');
          if (p.enabled) {
            const helperCamera = new THREE.PerspectiveCamera(p.fov, p.aspect, .06, 3.6); helperCamera.position.set(...p.position); helperCamera.lookAt(...p.target); helperCamera.updateMatrixWorld();
            const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([x, y]) => new THREE.Vector3(x, y, 1).unproject(helperCamera));
            corners.forEach(point => addLine([new THREE.Vector3(...p.position), point], p.color, .19)); addLine([...corners, corners[0]], p.color, .13);
          }
        }
        const v = state.viewer; addBox(v.position, [.1, .15, .1], '#a4bbed'); label('Viewer', new THREE.Vector3(v.position[0], v.position[1] + .22, v.position[2]), '#bacdef');
      }
      lastGeometry = state.geometryRevision; lastSelection = state.selectedSurfaceId; lastViewer = JSON.stringify(state.viewer.position);
    }
    const size = () => { const r = element.getBoundingClientRect(); renderer.setSize(Math.max(1, r.width), Math.max(1, r.height), false); if (view === 'orbit') { camera.aspect = r.width / Math.max(1, r.height); camera.updateProjectionMatrix(); } };
    const observer = new ResizeObserver(size); observer.observe(element); size();
    let pointerStart: [number, number] = [0, 0];
    const down = (event: globalThis.PointerEvent) => { pointerStart = [event.clientX, event.clientY]; };
    const up = (event: globalThis.PointerEvent) => {
      if (view !== 'orbit' || Math.hypot(event.clientX - pointerStart[0], event.clientY - pointerStart[1]) > 5) return;
      const r = element.getBoundingClientRect(), ray = new THREE.Raycaster(); ray.setFromCamera(new THREE.Vector2((event.clientX - r.left) / r.width * 2 - 1, 1 - (event.clientY - r.top) / r.height * 2), camera);
      const hit = ray.intersectObjects(meshes.map(m => m.mesh))[0]; if (hit) current.current.onSelect?.(hit.object.userData.surfaceId);
    };
    renderer.domElement.addEventListener('pointerdown', down); renderer.domElement.addEventListener('pointerup', up);
    let lastRender = 0, visible = true;
    const visibility = new IntersectionObserver(entries => { visible = entries[0]?.isIntersecting ?? false; }); visibility.observe(element);
    const render = () => {
      const time = performance.now();
      // Throttle small preview cards, never the actual projector presentation.
      const interval = current.current.presenting ? 0 : view === 'orbit' ? 32 : 100;
      if (!visible || !renderVisible(element) || time - lastRender < interval) { frame = requestAnimationFrame(render); return; }
      lastRender = time;
      const state = current.current.scene;
      if (lastGeometry !== state.geometryRevision || lastSelection !== state.selectedSurfaceId || lastViewer !== JSON.stringify(state.viewer.position)) rebuild();
      if (view !== 'orbit') {
        const pose: CameraPose = view === 'viewer' ? state.viewer : state.projectors.find(p => p.id === view)!;
        camera.position.set(...pose.position); camera.lookAt(...pose.target); camera.fov = pose.fov; camera.aspect = pose.aspect; camera.updateProjectionMatrix();
      }
      const mode = view === 'projector-a' ? 2 : view === 'projector-b' ? 3 : current.current.coverage ? 1 : 0;
      const now = Date.now();
      for (const entry of meshes) {
        const surface = state.surfaces.find(s => s.id === entry.id)!;
        entry.material.uniforms.art.value = getArtwork(state, surface, now, true, false, renderWidth(state, view !== 'orbit' && view !== 'viewer')).texture;
        entry.material.uniforms.coverage.value = getMask(state, surface); entry.material.uniforms.viewMode.value = mode;
      }
      controls?.update(); renderer.render(world, camera); frame = requestAnimationFrame(render);
    }; render();
    return () => {
      cancelAnimationFrame(frame); observer.disconnect(); visibility.disconnect(); controls?.dispose();
      renderer.domElement.removeEventListener('pointerdown', down); renderer.domElement.removeEventListener('pointerup', up);
      geometries.forEach(g => g.dispose()); materials.forEach(m => m.dispose()); sprites.forEach(t => t.dispose()); renderer.dispose(); renderer.domElement.remove();
    };
  }, [view, resetKey]);
  return <div className="spatial-render" style={{ filter: `brightness(${scene.display?.brightness ?? 1})` }} ref={host} data-view={view}>{error && <div className="webgl-error" role="alert">{error}</div>}</div>;
}
