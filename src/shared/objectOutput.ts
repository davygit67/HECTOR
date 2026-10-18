/** Output-side watchdog has no dependency on the tracking worker or Studio heartbeat. */
export interface ObjectOutputFrame {type:'object-frame';ownerId:string;outputId:string;sequence:number;expiresAt:number;viewport:{width:number;height:number;devicePixelRatio:number};rasterRect:{x:number;y:number;width:number;height:number};mask:{width:number;height:number;bits:Uint8Array}|null;color:string}
export class ObjectOutputGate {
  active=false; private owner='';private seq=-1;private frame:ObjectOutputFrame|null=null;
  accept(data:unknown,outputId:string){
    const d=data as ObjectOutputFrame;if(!d||d.outputId!==outputId||typeof d.ownerId!=='string'||d.ownerId.length>128||!Number.isSafeInteger(d.sequence))return false;
    if(this.active&&this.owner!==d.ownerId)return false;
    if(this.owner===d.ownerId&&d.sequence<=this.seq)return false;
    if((d.type as string)==='object-clear'){if(this.owner!==d.ownerId)return false;this.active=false;this.frame=null;this.seq=d.sequence;return true;}
    if(d.type!=='object-frame'||!Number.isFinite(d.expiresAt)||d.expiresAt>Date.now()+650||!/^#[\da-f]{6}$/i.test(d.color))return false;
    const r=d.rasterRect,v=d.viewport,m=d.mask;
    if(!r||!v||![r.x,r.y,r.width,r.height,v.width,v.height,v.devicePixelRatio].every(Number.isFinite)||v.width<16||v.height<16||r.x<-.01||r.y<-.01||r.width<=0||r.height<=0||r.x+r.width>v.width+1||r.y+r.height>v.height+1)return false;
    if(m&&(!Number.isInteger(m.width)||!Number.isInteger(m.height)||m.width<1||m.width>480||m.height<1||m.height>480||!(m.bits instanceof Uint8Array)||m.bits.length!==m.width*m.height))return false;
    this.owner=d.ownerId;this.seq=d.sequence;this.frame=d;this.active=true;return true;
  }
  image(now:number,viewport:{width:number;height:number;devicePixelRatio:number},visible:boolean,fullscreen:boolean){const f=this.frame;
    return this.active&&f&&f.mask&&now<f.expiresAt&&visible&&fullscreen&&f.viewport.width===viewport.width&&f.viewport.height===viewport.height&&f.viewport.devicePixelRatio===viewport.devicePixelRatio?f:null;}
  blank(){this.frame=null;}
}
