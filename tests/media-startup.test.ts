import test from 'node:test';
import assert from 'node:assert/strict';
import { mediaWorkerEnvironment } from '../host/media-worker-client';
import { sourceStartupProblem, validateMediaCommand } from '../src/shared/media';

test('Windows worker defaults to software frames and removes incompatible inherited Node options', () => {
  const original = {PATH:'keep',ELECTRON_RUN_AS_NODE:'1',NODE_OPTIONS:'--inspect',PM_MEDIA_DATA:'local'};
  const win = mediaWorkerEnvironment(original,'win32');
  assert.equal(win.PM_MEDIA_SOFTWARE,'1'); assert.equal(win.PATH,'keep'); assert.equal(win.PM_MEDIA_DATA,'local');
  assert.equal(win.ELECTRON_RUN_AS_NODE,undefined); assert.equal(win.NODE_OPTIONS,undefined);
  assert.equal(original.ELECTRON_RUN_AS_NODE,'1');
  assert.equal(mediaWorkerEnvironment({},'darwin').PM_MEDIA_SOFTWARE,'0');
  assert.equal(mediaWorkerEnvironment({PM_MEDIA_SOFTWARE:'0'},'win32').PM_MEDIA_SOFTWARE,'0');
});
test('startup watchdog distinguishes no wrapper, stalled renderer and missing image', () => {
  const source={openedAt:1000,lastReport:0,readyAt:0,ready:false,hasFrame:false};
  assert.equal(sourceStartupProblem(source,30000),null);
  assert.match(sourceStartupProblem(source,37000)!,/did not start/);
  assert.match(sourceStartupProblem({...source,ready:true,lastReport:2000,readyAt:2000},12000)!,/stopped responding/);
  assert.match(sourceStartupProblem({...source,ready:true,lastReport:15000,readyAt:2000},15000)!,/no image/);
  assert.equal(sourceStartupProblem({...source,ready:true,lastReport:15000,readyAt:2000,hasFrame:true},15000),null);
  assert.doesNotThrow(()=>validateMediaCommand({contentId:'v',action:'restart-renderer'}));
});
