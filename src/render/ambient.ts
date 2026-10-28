// Ambient backlight for mapped surfaces. Colour analysis, smoothing and the light field are adknate05's implementation
// (src/ambient), run in a worker; this module feeds it real frames from the GPU and composites the result.
import { SAMPLE_HEIGHT, SAMPLE_WIDTH } from '../ambient/backlight';
import { fade } from '../ambient/field';
import { AmbientProcessor, type AmbientRequest, type AmbientResult, type FieldGeometry } from '../ambient/processor';
import type { Scene, Surface } from '../core/model';
import type { AmbientProbe } from '../core/bridge';
const vertex = `attribute vec2 position; varying vec2 screenUV; void main(){screenUV=position;gl_Position=vec4(position.x*2.-1.,1.-position.y*2.,0.,1.);}`;
// Linear-light screen composition, as in the original compositor. Glows are drawn before any surface, so they only
// light the surrounding wall and never cover projected content.
const fragment = `precision highp float;
varying vec2 screenUV; uniform mat3 inverseMap; uniform sampler2D light; uniform vec3 field; uniform float alpha, side;
vec3 linear(vec3 c){return mix(c/12.92,pow((c+.055)/1.055,vec3(2.4)),step(vec3(.04045),c));}
vec3 srgb(vec3 c){return mix(c*12.92,1.055*pow(max(c,vec3(0.)),vec3(1./2.4))-.055,step(vec3(.0031308),c));}
void main(){
 vec3 q=inverseMap*vec3(screenUV,1.); if(q.z*side<=0.)discard;
 vec2 at=(q.xy/q.z*field.xy+field.z)/(field.xy+2.*field.z);
 if(at.x<0.||at.y<0.||at.x>1.||at.y>1.)discard;
 gl_FragColor=vec4(srgb(linear(texture2D(light,at).rgb)*alpha),1.);
}`;
/** About 15 samples per second: enough for smoothing, small enough to stay cheap. */
const sampleInterval = 66;
const identity = new Float32Array([1,0,0, 0,1,0, 0,0,1]), unitSquare: Surface['corners'] = [[0,0],[1,0],[1,1],[0,1]];
interface Slot {
  key: string; lastSample: number; sampledAt: number; samples: number; analysisMs: number; fieldMs: number; dark: boolean; settling: boolean;
  /** A request for this surface is in the worker; the next sample waits for it, so work never queues up. */
  busy: boolean; requested: string; texture: WebGLTexture | null; size: FieldGeometry; staticKey: string;
}
/** Draws `surface`'s source into the bound framebuffer over the unit square. Returns false when it has no frame. */
export type DrawSample = (surface: Surface, inverseMap: Float32Array, corners: Surface['corners']) => boolean;
export class AmbientEngine {
  private program: WebGLProgram; private target: WebGLFramebuffer; private targetTexture: WebGLTexture;
  private slots = new Map<string, Slot>(); private pending: { buffer: WebGLBuffer; sync: WebGLSync; surface: Surface; key: string; geometry: [FieldGeometry, string] } | null = null;
  private pixels = new Uint8Array(SAMPLE_WIDTH * SAMPLE_HEIGHT * 4); private uniforms = new Map<string, WebGLUniformLocation | null>();
  private worker: Worker | null = null; private post: (request: AmbientRequest, transfer?: Transferable[]) => void; private disposed = false;
  constructor(private gl: WebGLRenderingContext, private gl2: WebGL2RenderingContext | null, private restore: WebGLProgram) {
    const compile = (type: number, code: string) => { const shader = gl.createShader(type)!; gl.shaderSource(shader, code); gl.compileShader(shader); if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) ?? 'Ambient shader failed'); return shader; };
    this.program = gl.createProgram()!; const vs = compile(gl.VERTEX_SHADER, vertex), fs = compile(gl.FRAGMENT_SHADER, fragment);
    gl.attachShader(this.program, vs); gl.attachShader(this.program, fs); gl.bindAttribLocation(this.program, 0, 'position'); gl.linkProgram(this.program); gl.deleteShader(vs); gl.deleteShader(fs);
    if (!gl.getProgramParameter(this.program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(this.program) ?? 'Ambient shader link failed');
    this.targetTexture = this.texture(); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, SAMPLE_WIDTH, SAMPLE_HEIGHT, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    this.target = gl.createFramebuffer()!; gl.bindFramebuffer(gl.FRAMEBUFFER, this.target);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.targetTexture, 0); gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    try {
      const worker = this.worker = new Worker(new URL('../ambient/worker.ts', import.meta.url), { type: 'module' });
      worker.onmessage = (event: MessageEvent<AmbientResult>) => this.receive(event.data);
      this.post = (request, transfer = []) => worker.postMessage(request, transfer);
    } catch {
      // Same code on the render thread if workers are unavailable; results still arrive asynchronously.
      const processor = new AmbientProcessor();
      this.post = request => setTimeout(() => { const result = processor.handle(request); if (result) this.receive(result); });
    }
  }
  private texture() {
    const gl = this.gl, texture = gl.createTexture()!; gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE); return texture;
  }
  private uniform(name: string) { if (!this.uniforms.has(name)) this.uniforms.set(name, this.gl.getUniformLocation(this.program, name)); return this.uniforms.get(name)!; }
  /** Slots follow the surface and its source; a new source never inherits the previous one's light. */
  private slot(surface: Surface) {
    const key = surface.sourceId ?? '';
    let slot = this.slots.get(surface.id);
    if (slot?.key !== key) {
      if (slot?.texture) this.gl.deleteTexture(slot.texture);
      slot = { key, lastSample: -Infinity, sampledAt: -Infinity, samples: 0, analysisMs: 0, fieldMs: 0, dark: false, settling: false, busy: false, requested: '', texture: null, size: [1, 1, 1], staticKey: '' };
      this.slots.set(surface.id, slot);
    }
    return slot;
  }
  /** Forget surfaces that are gone or no longer lit, releasing their textures and analysis state. */
  reconcile(scene: Scene) {
    const lit = new Set(scene.surfaces.filter(s => s.ambient?.enabled).map(s => s.id));
    for (const [id, slot] of this.slots) if (!lit.has(id)) { if (slot.texture) this.gl.deleteTexture(slot.texture); this.slots.delete(id); this.post({ type: 'forget', id }); }
  }
  /** The lit area in output pixels; the light field is rendered in this unwarped space around the surface. */
  private geometry(surface: Surface, scene: Scene): [FieldGeometry, string] {
    const [a, b, c, d] = surface.corners, px = (p: number[], q: number[]) => Math.hypot((p[0]-q[0]) * scene.width, (p[1]-q[1]) * scene.height);
    const geometry: FieldGeometry = [Math.max(8, Math.round((px(a, b) + px(d, c)) / 2)), Math.max(8, Math.round((px(a, d) + px(b, c)) / 2)), Math.max(1, Math.round(surface.ambient!.spread * Math.min(scene.width, scene.height)))];
    return [geometry, JSON.stringify([geometry, surface.ambient])];
  }
  private receive(result: AmbientResult) {
    const slot = this.slots.get(result.id); if (this.disposed || !slot || slot.key !== result.key) return;
    slot.busy = false;
    if (result.sampledAt !== undefined) {
      slot.sampledAt = Math.max(slot.sampledAt, result.sampledAt); slot.samples++; slot.dark = !!result.dark; slot.settling = !!result.settling;
      slot.analysisMs = slot.analysisMs ? slot.analysisMs * .8 + result.analysisMs! * .2 : result.analysisMs!;
    }
    if (!result.field) return;
    const gl = this.gl, field = result.field; slot.texture ??= this.texture(); gl.bindTexture(gl.TEXTURE_2D, slot.texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, field.width, field.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(field.data.buffer, field.data.byteOffset, field.data.byteLength));
    slot.size = field.size; slot.fieldMs = slot.fieldMs ? slot.fieldMs * .8 + field.ms * .2 : field.ms;
  }
  /** Draw every lit surface's glow. Call after clearing and before drawing surfaces. */
  drawGlows(scene: Scene, maps: Map<string, Float32Array>, now: number) {
    const gl = this.gl; let used = false;
    for (const surface of scene.surfaces) {
      const ambient = surface.ambient, slot = this.slots.get(surface.id);
      if (!ambient?.enabled || !surface.visible || !slot?.texture) continue;
      const alpha = fade(slot.sampledAt, now), map = maps.get(surface.id); if (!alpha || !map) continue;
      // A moved or restyled still surface gets a new field without waiting for a new sample.
      const [geometry, fieldKey] = this.geometry(surface, scene);
      if (slot.requested !== fieldKey && !slot.busy) { slot.busy = true; slot.requested = fieldKey; this.post({ type: 'field', id: surface.id, key: slot.key, geometry, settings: ambient, fieldKey }); }
      if (!used) { used = true; gl.useProgram(this.program); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_COLOR); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0,0, 1,0, 1,1, 0,0, 1,1, 0,1]), gl.DYNAMIC_DRAW); }
      const cx = surface.corners.reduce((a, p) => a + p[0], 0) / 4, cy = surface.corners.reduce((a, p) => a + p[1], 0) / 4;
      gl.bindTexture(gl.TEXTURE_2D, slot.texture);
      gl.uniformMatrix3fv(this.uniform('inverseMap'), false, map); gl.uniform1f(this.uniform('side'), Math.sign(map[2]*cx + map[5]*cy + map[8]) || 1);
      gl.uniform3fv(this.uniform('field'), slot.size); gl.uniform1f(this.uniform('alpha'), alpha * ambient.opacity * surface.opacity);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }
    if (used) { gl.useProgram(this.restore); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); }
  }
  /** Sample at most one surface per frame: render what it shows into a 96×54 target and read it back without stalling. */
  sample(scene: Scene, now: number, draw: DrawSample, staticKey: (surface: Surface) => string | null) {
    this.collect(now);
    if (this.pending) return;
    let due: Surface | null = null, slot: Slot | null = null;
    for (const surface of scene.surfaces) {
      if (!surface.ambient?.enabled || !surface.visible || !surface.sourceId) continue;
      const candidate = this.slot(surface), still = staticKey(surface);
      // A still image is sampled until its letterbox has settled, then only again when it or its look changes.
      if (still !== null && candidate.staticKey === still && candidate.samples >= 3 && !candidate.settling) { candidate.sampledAt = now; continue; }
      if (candidate.busy || now - candidate.lastSample < sampleInterval || (slot && candidate.lastSample >= slot.lastSample)) continue;
      due = surface; slot = candidate;
    }
    if (!due || !slot) return;
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.target); gl.viewport(0, 0, SAMPLE_WIDTH, SAMPLE_HEIGHT);
    gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT); gl.disable(gl.BLEND);
    // Effects (crop, brightness, saturation) apply, so the light matches what the surface shows; opacity and masks do not.
    const drawn = draw({ ...due, opacity: 1, mask: 'none' }, identity, unitSquare);
    gl.enable(gl.BLEND);
    slot.lastSample = now;
    if (drawn) {
      slot.staticKey = staticKey(due) ?? '';
      const pending = { surface: due, key: slot.key, geometry: this.geometry(due, scene) };
      if (this.gl2) {
        const gl2 = this.gl2, buffer = gl2.createBuffer()!;
        gl2.bindBuffer(gl2.PIXEL_PACK_BUFFER, buffer); gl2.bufferData(gl2.PIXEL_PACK_BUFFER, this.pixels.byteLength, gl2.STREAM_READ);
        gl2.readPixels(0, 0, SAMPLE_WIDTH, SAMPLE_HEIGHT, gl2.RGBA, gl2.UNSIGNED_BYTE, 0); gl2.bindBuffer(gl2.PIXEL_PACK_BUFFER, null);
        this.pending = { ...pending, buffer, sync: gl2.fenceSync(gl2.SYNC_GPU_COMMANDS_COMPLETE, 0)! }; gl2.flush();
      } else { gl.readPixels(0, 0, SAMPLE_WIDTH, SAMPLE_HEIGHT, gl.RGBA, gl.UNSIGNED_BYTE, this.pixels); this.send(pending, now); }
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }
  private collect(now: number) {
    const gl2 = this.gl2, pending = this.pending; if (!gl2 || !pending) return;
    const status = gl2.clientWaitSync(pending.sync, 0, 0);
    if (status !== gl2.ALREADY_SIGNALED && status !== gl2.CONDITION_SATISFIED) return;
    gl2.bindBuffer(gl2.PIXEL_PACK_BUFFER, pending.buffer); gl2.getBufferSubData(gl2.PIXEL_PACK_BUFFER, 0, this.pixels); gl2.bindBuffer(gl2.PIXEL_PACK_BUFFER, null);
    gl2.deleteSync(pending.sync); gl2.deleteBuffer(pending.buffer); this.pending = null;
    this.send(pending, now);
  }
  private send({ surface, key, geometry: [geometry, fieldKey] }: { surface: Surface; key: string; geometry: [FieldGeometry, string] }, now: number) {
    const slot = this.slots.get(surface.id); if (!slot || slot.key !== key || !surface.ambient) return;
    // GL rows run bottom-up; the analysis expects the source's top row first.
    const data = new Uint8ClampedArray(this.pixels.length), row = SAMPLE_WIDTH * 4;
    for (let y = 0; y < SAMPLE_HEIGHT; y++) data.set(this.pixels.subarray((SAMPLE_HEIGHT - 1 - y) * row, (SAMPLE_HEIGHT - y) * row), y * row);
    slot.busy = true; slot.requested = fieldKey;
    this.post({ type: 'sample', id: surface.id, key, width: SAMPLE_WIDTH, height: SAMPLE_HEIGHT, data, now, smoothingMs: surface.ambient.smoothingMs, geometry, settings: surface.ambient, fieldKey }, [data.buffer]);
  }
  probe(now: number): AmbientProbe[] {
    return [...this.slots].map(([surfaceId, s]) => ({ surfaceId, samples: s.samples, analysisMs: s.analysisMs, fieldMs: s.fieldMs, dark: s.dark,
      sampleAgeMs: Number.isFinite(s.lastSample) ? now - s.lastSample : null, alpha: s.texture ? fade(s.sampledAt, now) : 0, asyncReadback: !!this.gl2, worker: !!this.worker }));
  }
  dispose() {
    const gl = this.gl; this.disposed = true; this.worker?.terminate();
    if (this.pending && this.gl2) { this.gl2.deleteSync(this.pending.sync); this.gl2.deleteBuffer(this.pending.buffer); }
    this.slots.forEach(s => s.texture && gl.deleteTexture(s.texture)); this.slots.clear();
    gl.deleteFramebuffer(this.target); gl.deleteTexture(this.targetTexture); gl.deleteProgram(this.program);
  }
}
