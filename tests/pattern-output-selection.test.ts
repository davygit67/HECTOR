import test from 'node:test';import assert from 'node:assert/strict';
import{choosePatternOutput,type PatternOutputStatus}from'../src/patternOutput.js';
const output=(id:string,fullscreen:boolean):PatternOutputStatus=>({outputId:id,visible:true,fullscreen,atMs:Date.now(),width:1920,height:1080,devicePixelRatio:1,activeOwner:null,patternId:null});
test('calibration chooses the full-screen projector rather than an earlier preview announcement',()=>{
 const small=output('preview',false),full=output('projector',true);assert.equal(choosePatternOutput([small,full],true).outputId,'projector');
 assert.throws(()=>choosePatternOutput([small],true),/full screen/);assert.throws(()=>choosePatternOutput([full,output('other',true)],true),/only/);
 assert.throws(()=>choosePatternOutput([{...full,atMs:Date.now()-4000}],true));assert.equal(choosePatternOutput([small]).outputId,'preview');
});
