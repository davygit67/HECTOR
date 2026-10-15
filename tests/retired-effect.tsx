import { createRoot } from 'react-dom/client';
import { SurfaceArtwork } from '../src/SpatialView';
import { initialScene, readScene, reduceScene } from '../src/shared/domain';
import { defaultSpec } from '../src/shared/content';

// No app bridge, persisted state, media or audio. Also bypass migration on purpose:
// renderer safety must hold for scenes already open when the code hot-updates.
const fresh = initialScene();
const stale = { ...fresh, effect: { ...fresh.effect, enabled: true, running: true } };
const migrated = readScene(stale);
const chosenArt = reduceScene(fresh, { type: 'content.create', id: 'chosen-art', surfaceId: 'wall', title: 'User artwork', spec: defaultSpec('art') });
const cases = [fresh, stale, migrated].flatMap((scene, i) => scene.surfaces.map(surface => ({ id: `${['fresh', 'stale', 'migrated'][i]}-${surface.id}`, scene, surface, expectBlack: true })));
cases.push({ id: 'chosen-art', scene: chosenArt, surface: chosenArt.surfaces[1], expectBlack: false });
createRoot(document.getElementById('root')!).render(<main><h1>Retired background check</h1>{cases.map(c => <section key={c.id} data-case={c.id}><h2>{c.id}</h2><div style={{ width: 320, height: 180, position: 'relative' }}><SurfaceArtwork scene={c.scene} surface={c.surface} /></div></section>)}</main>);
await new Promise(resolve => setTimeout(resolve, 700));
const checks = cases.map(c => {
  const canvas = document.querySelector<HTMLCanvasElement>(`[data-case="${c.id}"] canvas`)!;
  const data = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
  let colored = 0, opaque = 0;
  for (let i = 0; i < data.length; i += 4) { if (data[i] || data[i + 1] || data[i + 2]) colored++; if (data[i + 3] === 255) opaque++; }
  return { id: c.id, colored, opaque, passed: opaque === canvas.width * canvas.height && (c.expectBlack ? colored === 0 : colored > 0) };
});
document.getElementById('results')!.textContent = JSON.stringify({ passed: checks.every(c => c.passed), checks }, null, 2);
