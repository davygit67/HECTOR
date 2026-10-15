import { analyzeColors, darkColors, rectifyVideo, type BacklightBridge, type BacklightRequest, type BacklightSample } from './shared/backlight';
import type { Quad } from './shared/geometry';
import { requestTabStream, startSharedVideo } from './tabColorSource';
declare global { interface Window { projectionBacklight?: BacklightBridge } }
type CaptureDevices = MediaDevices & { setCaptureHandleConfig?: (config: { exposeOrigin: boolean; handle: string; permittedOrigins: string[] }) => void };
type CaptureTrack = MediaStreamTrack & { getCaptureHandle?: () => { handle: string; origin?: string } | null };
const handle = crypto.randomUUID();
const consumers = new Set<string>();
let sourceGeneration = 0, pendingSource: Promise<void> | undefined;
let browserSource: { stream: MediaStream; video: HTMLVideoElement } | undefined;
let sourcePhase: 'idle' | 'choosing' | 'starting' | 'active' = 'idle';
const devices = navigator.mediaDevices as CaptureDevices | undefined;
try { devices?.setCaptureHandleConfig?.({ exposeOrigin: true, handle, permittedOrigins: [location.origin] }); } catch { /* Unsupported browser; explain when requested. */ }
export function canCaptureTab() { return !!devices?.getDisplayMedia && !!devices?.setCaptureHandleConfig; }
export function hasColorSource() { return !!window.projectionBacklight || !!browserSource; }
export function colorSourceMessage() { return sourcePhase === 'choosing' ? 'Choose this studio tab in the sharing prompt.' : sourcePhase === 'starting' ? 'Sharing allowed · waiting for video frames…' : 'Enable live colors to share this studio tab, or use the desktop app.'; }
export function stopTabColors() { sourceGeneration++; browserSource?.stream.getTracks().forEach(t => t.stop()); if (browserSource) { browserSource.video.srcObject = null; browserSource.video.remove(); } browserSource = undefined; sourcePhase = 'idle'; }
window.addEventListener('beforeunload', stopTabColors);
// Development refresh must release the previous module's tracks/listeners too.
(import.meta as ImportMeta & { hot?: { dispose(callback: () => void): void } }).hot?.dispose(() => { stopTabColors(); window.removeEventListener('beforeunload', stopTabColors); });
export function startTabColors(): Promise<void> {
  if (pendingSource) return pendingSource;
  const generation = sourceGeneration;
  const pending = selectTabColors(generation);
  pendingSource = pending;
  void pending.finally(() => { if (pendingSource === pending) { pendingSource = undefined; if (!browserSource) sourcePhase = 'idle'; } }).catch(() => undefined);
  return pending;
}
async function selectTabColors(generation: number) {
  if (!canCaptureTab()) throw new Error('Live colors need the desktop app, or a browser with tab sharing and Capture Handle support.');
  if (browserSource) return;
  sourcePhase = 'choosing';
  const stream = await requestTabStream(() => devices!.getDisplayMedia({ video: { displaySurface: 'browser', frameRate: 10 }, audio: false, preferCurrentTab: true, selfBrowserSurface: 'include', surfaceSwitching: 'exclude', monitorTypeSurfaces: 'exclude' } as DisplayMediaStreamOptions));
  if (generation !== sourceGeneration || !consumers.size) { stream.getTracks().forEach(t => t.stop()); throw new Error('Color sharing was cancelled because the player closed.'); }
  const track = stream.getVideoTracks()[0] as CaptureTrack;
  if (track.getSettings().displaySurface !== 'browser' || track.getCaptureHandle?.()?.handle !== handle) {
    stream.getTracks().forEach(t => t.stop()); throw new Error('Choose this studio tab only. Other tabs, windows and screens are not used.');
  }
  const video = document.createElement('video'); video.muted = true; video.playsInline = true; video.srcObject = stream;
  sourcePhase = 'starting';
  const end = () => { if (browserSource?.stream === stream) stopTabColors(); };
  track.addEventListener('ended', end); track.addEventListener('capturehandlechange', () => { if (track.getCaptureHandle?.()?.handle !== handle) end(); });
  try { await startSharedVideo(video);
    if (generation !== sourceGeneration || !consumers.size || track.readyState !== 'live') { stream.getTracks().forEach(t => t.stop()); throw new Error('Color sharing ended before the player was ready.'); }
    browserSource = { video, stream }; sourcePhase = 'active'; } catch (e) { stream.getTracks().forEach(t => t.stop()); video.srcObject = null; throw e; }
}
let queue = Promise.resolve(), lastCapture = 0;
/** One bounded capture at a time per window, shared fairly among visible players. */
export function sampleVideo(request: BacklightRequest): Promise<BacklightSample> {
  const result = queue.then(async () => {
    const delay = Math.max(0, 100 - (performance.now() - lastCapture));
    if (delay) await new Promise(resolve => setTimeout(resolve, delay));
    lastCapture = performance.now();
    if (window.projectionBacklight) return window.projectionBacklight.sample(request);
    const source = browserSource; if (!source || source.video.readyState < 2) throw new Error('Enable live colors and share this studio tab.');
    const started = performance.now(), video = source.video;
    const minX = Math.min(...request.quad.map(p => p.x)), minY = Math.min(...request.quad.map(p => p.y));
    const w = Math.max(...request.quad.map(p => p.x)) - minX, h = Math.max(...request.quad.map(p => p.y)) - minY;
    const scale = Math.min(1, 384 / Math.max(w, h)), canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(w * scale)); canvas.height = Math.max(1, Math.round(h * scale));
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(video, minX / request.viewport.width * video.videoWidth, minY / request.viewport.height * video.videoHeight, w / request.viewport.width * video.videoWidth, h / request.viewport.height * video.videoHeight, 0, 0, canvas.width, canvas.height);
    const quad = request.quad.map(p => ({ x: (p.x - minX) / w * canvas.width, y: (p.y - minY) / h * canvas.height })) as Quad;
    const rectified = rectifyVideo(ctx.getImageData(0, 0, canvas.width, canvas.height), quad), colors = analyzeColors(rectified);
    return { colors, sampledAt: Date.now(), costMs: performance.now() - started, dark: darkColors(colors) };
  });
  queue = result.then(() => undefined, () => undefined); return result;
}

export function useColorSource(id: string) {
  consumers.add(id);
  return () => { consumers.delete(id); if (!consumers.size) stopTabColors(); };
}
