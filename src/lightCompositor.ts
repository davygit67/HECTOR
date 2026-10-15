import { addLight, type LightField } from './shared/lightField';
import { toLinear, toSRGB, type Vec3 } from './shared/lightColor';

// One small compositing pass in the existing surface painter, not another scene.
// Float linear-light screen composition avoids encoded-sRGB whitening and never
// dims existing art. Canvas clipping remains owned by the surface painter.
let pipeline: ReturnType<typeof createPipeline> | undefined;
function createPipeline() {
  const canvas=document.createElement('canvas'),gl=canvas.getContext('webgl',{alpha:false,premultipliedAlpha:false,preserveDrawingBuffer:true});
  if(!gl)return null;
  const shader=(type:number,source:string)=>{const s=gl.createShader(type)!;gl.shaderSource(s,source);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(s)??'Light shader failed');return s;};
  const vs=shader(gl.VERTEX_SHADER,'attribute vec2 p; varying vec2 uv; void main(){uv=vec2((p.x+1.0)*.5,(1.0-p.y)*.5);gl_Position=vec4(p,0.,1.);}');
  const fs=shader(gl.FRAGMENT_SHADER,`precision highp float;
    varying vec2 uv; uniform sampler2D background;uniform sampler2D light;uniform vec4 rect;uniform float opacity;
    vec3 linear(vec3 c){return mix(c/12.92,pow((c+.055)/1.055,vec3(2.4)),step(vec3(.04045),c));}
    vec3 srgb(vec3 c){return mix(c*12.92,1.055*pow(max(c,vec3(0.)),vec3(1./2.4))-.055,step(vec3(.0031308),c));}
    void main(){vec3 bg=texture2D(background,uv).rgb;vec2 at=(uv-rect.xy)/rect.zw;
      if(at.x<0.||at.y<0.||at.x>1.||at.y>1.){gl_FragColor=vec4(bg,1.);return;}
      vec3 glow=linear(texture2D(light,at).rgb)*opacity;
      gl_FragColor=vec4(srgb(1.-(1.-linear(bg))*(1.-glow)),1.);
    }`);
  const program=gl.createProgram()!;gl.attachShader(program,vs);gl.attachShader(program,fs);gl.linkProgram(program);
  if(!gl.getProgramParameter(program,gl.LINK_STATUS))return null;
  gl.useProgram(program);const buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,1,1]),gl.STATIC_DRAW);
  const at=gl.getAttribLocation(program,'p');gl.enableVertexAttribArray(at);gl.vertexAttribPointer(at,2,gl.FLOAT,false,0,0);
  const textures=[gl.createTexture(),gl.createTexture()];
  textures.forEach((texture,index)=>{gl.activeTexture(gl.TEXTURE0+index);gl.bindTexture(gl.TEXTURE_2D,texture);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);gl.uniform1i(gl.getUniformLocation(program,index?'light':'background'),index);});
  return {canvas,gl,program};
}
export function compositeLight(ctx:CanvasRenderingContext2D,field:LightField,x:number,y:number,alpha:number) {
  if(pipeline===undefined){try{pipeline=createPipeline()}catch{pipeline=null}}
  const width=field.videoWidth+field.padding*2,height=field.videoHeight+field.padding*2;
  if(pipeline&&!pipeline.gl.isContextLost()){
    const {canvas,gl,program}=pipeline,w=ctx.canvas.width,h=ctx.canvas.height;
    if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h;gl.viewport(0,0,w,h)}
    gl.activeTexture(gl.TEXTURE0);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,ctx.canvas);
    gl.activeTexture(gl.TEXTURE1);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,field.width,field.height,0,gl.RGBA,gl.UNSIGNED_BYTE,field.data);
    gl.uniform4f(gl.getUniformLocation(program,'rect'),x/w,y/h,width/w,height/h);gl.uniform1f(gl.getUniformLocation(program,'opacity'),alpha);
    gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
    ctx.save();ctx.globalCompositeOperation='copy';ctx.drawImage(canvas,0,0);ctx.restore();return;
  }
  // Same math if WebGL is unavailable. Limited to the light rectangle.
  const left=Math.max(0,Math.floor(x)),top=Math.max(0,Math.floor(y)),right=Math.min(ctx.canvas.width,Math.ceil(x+width)),bottom=Math.min(ctx.canvas.height,Math.ceil(y+height));
  if(right<=left||bottom<=top)return;
  const image=ctx.getImageData(left,top,right-left,bottom-top),data=image.data;
  for(let py=0;py<image.height;py++)for(let px=0;px<image.width;px++){
    const sx=Math.max(0,Math.min(field.width-1,Math.floor((left+px-x)/width*field.width))),sy=Math.max(0,Math.min(field.height-1,Math.floor((top+py-y)/height*field.height)));
    const i=(py*image.width+px)*4,j=(sy*field.width+sx)*4;
    const bg=toLinear([data[i],data[i+1],data[i+2]]),light=toLinear([field.data[j],field.data[j+1],field.data[j+2]]).map(c=>c*alpha) as Vec3;
    data.set(toSRGB(addLight(bg,light)),i);
  }
  // putImageData ignores clip, so transfer through a small canvas first.
  const layer=document.createElement('canvas');layer.width=image.width;layer.height=image.height;layer.getContext('2d')!.putImageData(image,0,0);ctx.drawImage(layer,left,top);
}
