import type { Scene } from '../core/model';
import type { RendererProbe, Snapshot, Transport } from '../core/bridge';
import { MediaRegistry } from '../media/registry';
import { inverseQuad } from './geometry';
const vertex = `attribute vec2 position; varying vec2 screenUV; void main(){screenUV=position;gl_Position=vec4(position.x*2.-1.,1.-position.y*2.,0.,1.);}`;
const fragment = `precision highp float;
varying vec2 screenUV; uniform mat3 inverseMap; uniform sampler2D media;
uniform vec4 crop; uniform vec3 color; uniform float opacity,brightness,saturation,time; uniform int kind,mask;
void main(){
 vec3 q=inverseMap*vec3(screenUV,1.); vec2 uv=q.xy/q.z;
 if(uv.x<0.||uv.x>1.||uv.y<0.||uv.y>1.)discard;
 if(mask==1&&length((uv-.5)*2.)>1.)discard;
 uv=crop.xy+uv*(1.-crop.xy-crop.zw);
 vec4 pixel=vec4(0.,0.,0.,1.);
 if(kind==0)pixel=texture2D(media,uv);
 if(kind==1){float wave=.5+.5*sin(uv.x*6.+uv.y*4.+time*.35);pixel.rgb=mix(color,vec3(.04,.72,.68),wave)*(.35+.65*uv.y);}
 if(kind==2){vec2 grid=abs(fract(uv*vec2(16.,9.)+.025)-.5);float line=step(.47,max(grid.x,grid.y));pixel.rgb=mix(vec3(.035),color,line);}
 float luma=dot(pixel.rgb,vec3(.2126,.7152,.0722));pixel.rgb=mix(vec3(luma),pixel.rgb,saturation)*brightness;
 gl_FragColor=vec4(pixel.rgb,pixel.a*opacity);
}`;
export interface Diagnostics { fps: number; slowFrames: number; videoDropped: number; errors: string[] }
export class ProjectionRenderer {
  private gl: WebGLRenderingContext; private program: WebGLProgram; private buffer: WebGLBuffer; private fallback: WebGLTexture;
  private media: MediaRegistry; private textures = new Map<string, { key: string; texture: WebGLTexture }>();
  private scene: Scene | null = null; private transport: Transport = { playing: true, position: 0, anchor: Date.now(), revision: 0 };
  private blackout = false; private frame = 0; private last = 0; private since = 0; private frames = 0; private slow = 0;
  private total = 0; private maxInterval = 0; private intervals: number[] = [];
  private quality: number; private maps = new Map<string, Float32Array>(); private uniforms = new Map<string, WebGLUniformLocation | null>();
  constructor(private canvas: HTMLCanvasElement, output: boolean, private diagnostics: (d: Diagnostics) => void) {
    const gl = canvas.getContext('webgl', { alpha: false, antialias: true, preserveDrawingBuffer: false });
    if (!gl) throw new Error('WebGL is unavailable. Enable GPU acceleration and update the graphics driver.');
    this.gl = gl; this.media = new MediaRegistry(!output); this.quality = output ? 1 : .65;
    const compile = (type: number, code: string) => { const shader = gl.createShader(type)!; gl.shaderSource(shader, code); gl.compileShader(shader); if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) ?? 'Shader compilation failed'); return shader; };
    this.program = gl.createProgram()!; const vs = compile(gl.VERTEX_SHADER, vertex), fs = compile(gl.FRAGMENT_SHADER, fragment);
    gl.attachShader(this.program, vs); gl.attachShader(this.program, fs); gl.linkProgram(this.program); gl.deleteShader(vs); gl.deleteShader(fs);
    if (!gl.getProgramParameter(this.program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(this.program) ?? 'Shader link failed');
    gl.useProgram(this.program); this.buffer = gl.createBuffer()!; gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    const location = gl.getAttribLocation(this.program, 'position'); gl.enableVertexAttribArray(location); gl.vertexAttribPointer(location, 2, gl.FLOAT, false, 0, 0);
    gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    this.fallback = gl.createTexture()!; gl.bindTexture(gl.TEXTURE_2D, this.fallback);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0,0,0,255]));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    this.frame = requestAnimationFrame(this.draw);
  }
  setQuality(quality: number) { this.quality = quality; }
  update(scene: Scene, assets: Snapshot['assets'], transport: Transport, blackout = false) {
    this.scene = scene; this.transport = transport; this.blackout = blackout;
    this.maps.clear(); scene.surfaces.forEach(s => this.maps.set(s.id, inverseQuad(s.corners)));
    this.media.reconcile(scene.sources, assets, transport);
    for (const [id, value] of this.textures) if (this.media.entries.get(id)?.key !== value.key) { this.gl.deleteTexture(value.texture); this.textures.delete(id); }
  }
  private uniform(name: string) { if (!this.uniforms.has(name)) this.uniforms.set(name, this.gl.getUniformLocation(this.program, name)); return this.uniforms.get(name)!; }
  private draw = (now: number) => {
    const gl = this.gl, scene = this.scene;
    this.frame = requestAnimationFrame(this.draw);
    const width = Math.max(1, Math.floor(this.canvas.clientWidth * devicePixelRatio * this.quality));
    const height = Math.max(1, Math.floor(this.canvas.clientHeight * devicePixelRatio * this.quality));
    if (this.canvas.width !== width || this.canvas.height !== height) { this.canvas.width = width; this.canvas.height = height; }
    gl.viewport(0, 0, width, height); gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT);
    const time = this.transport.position + (this.transport.playing ? (Date.now() - this.transport.anchor) / 1000 : 0);
    if (scene && !this.blackout) for (const surface of scene.surfaces) {
      if (!surface.visible || !surface.sourceId) continue;
      const source = scene.sources.find(s => s.id === surface.sourceId); if (!source) continue;
      const sourceKind = source.kind === 'gradient' ? 1 : source.kind === 'grid' ? 2 : 0;
      gl.bindTexture(gl.TEXTURE_2D, this.fallback);
      if (sourceKind === 0) {
        const entry = this.media.entries.get(source.id); if (!entry || entry.error) continue;
        this.media.updateClock(entry, source, time);
        const element = entry.element;
        if (element instanceof HTMLVideoElement && element.readyState < 2) continue;
        if (element instanceof HTMLImageElement && (!element.complete || !element.naturalWidth)) continue;
        let texture = this.textures.get(source.id);
        if (!texture) {
          texture = { key: entry.key, texture: gl.createTexture()! }; this.textures.set(source.id, texture); gl.bindTexture(gl.TEXTURE_2D, texture.texture);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE); entry.dirty = true;
        }
        gl.bindTexture(gl.TEXTURE_2D, texture.texture);
        if (entry.dirty) { try { gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, element); entry.dirty = false; } catch (e) { entry.error = `GPU texture upload failed: ${e instanceof Error ? e.message : String(e)}`; continue; } }
      }
      const corners = surface.corners;
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0,1,2,0,2,3].flatMap(i => corners[i])), gl.DYNAMIC_DRAW);
      gl.uniformMatrix3fv(this.uniform('inverseMap'), false, this.maps.get(surface.id)!);
      gl.uniform4fv(this.uniform('crop'), surface.crop); gl.uniform1f(this.uniform('opacity'), surface.opacity);
      gl.uniform1f(this.uniform('brightness'), surface.brightness); gl.uniform1f(this.uniform('saturation'), surface.saturation);
      gl.uniform1f(this.uniform('time'), time * source.speed); gl.uniform1i(this.uniform('kind'), sourceKind); gl.uniform1i(this.uniform('mask'), surface.mask === 'ellipse' ? 1 : 0);
      gl.uniform3fv(this.uniform('color'), [1,3,5].map(i => parseInt(source.color.slice(i, i+2),16)/255)); gl.drawArrays(gl.TRIANGLES, 0, 6);
    }
    if (this.last) {
      const interval = now - this.last; if (interval > 25) this.slow++;
      this.maxInterval = Math.max(this.maxInterval, interval); this.intervals.push(interval); if (this.intervals.length > 600) this.intervals.shift();
    }
    this.last = now; this.frames++; this.total++;
    if (now - this.since >= 1000) {
      const entries = [...this.media.entries.values()];
      this.diagnostics({ fps: this.frames * 1000 / (now - this.since), slowFrames: this.slow,
        videoDropped: entries.reduce((sum,e) => sum + (e.element instanceof HTMLVideoElement ? e.element.getVideoPlaybackQuality().droppedVideoFrames : 0), 0),
        errors: entries.filter(e => e.error).map(e => e.error) }); this.since = now; this.frames = 0;
    }
  };
  /** Bounded measurements: the last 600 frame intervals, never per-frame IPC. */
  probe(): RendererProbe { return { frames: this.total, slowFrames: this.slow, maxIntervalMs: this.maxInterval, intervals: [...this.intervals], media: this.media.probe() }; }
  dispose() { cancelAnimationFrame(this.frame); this.media.dispose(); this.textures.forEach(t => this.gl.deleteTexture(t.texture)); this.gl.deleteTexture(this.fallback); this.gl.deleteBuffer(this.buffer); this.gl.deleteProgram(this.program); }
}
