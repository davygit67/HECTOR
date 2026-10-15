import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { syncRepository } from '../host/git-sync.mjs';
import { repositoryProblems, checkRepository } from '../host/repository-safety.mjs';

const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore','pipe','pipe'] }).trim();
function fixture(t: any) {
  const dir = mkdtempSync(join(tmpdir(), 'projection git sync ')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const remote=join(dir,'remote.git'), a=join(dir,'alice'), b=join(dir,'bob');
  mkdirSync(remote); git(remote,'init','--bare','--initial-branch=main');
  git(dir,'clone',remote,a);
  git(a,'config','user.name','Test author');git(a,'config','user.email','test@example.invalid');
  writeFileSync(join(a,'.gitignore'),'.env\n');writeFileSync(join(a,'app.txt'),'initial\n');
  git(a,'add','--','.gitignore','app.txt');git(a,'commit','-m','Initial');git(a,'push','-u','origin','main');
  git(dir,'clone',remote,b);git(b,'config','user.name','Test author');git(b,'config','user.email','test@example.invalid');
  return {remote,a,b};
}
const commit = (cwd: string, file: string, value: string) => {writeFileSync(join(cwd,file),value);git(cwd,'add','--',file);git(cwd,'commit','-m','Update fixture');};

test('sync pushes completed commits and fast-forwards a clean peer', t => {
  const {remote,a,b}=fixture(t);commit(a,'app.txt','updated\n');
  assert.equal(syncRepository({cwd:a,expectedRemote:remote}).status,'pushed');
  assert.equal(syncRepository({cwd:b,expectedRemote:remote}).status,'pulled');
  assert.equal(readFileSync(join(b,'app.txt'),'utf8'),'updated\n');
  assert.equal(syncRepository({cwd:b}).status,'up-to-date');
});
test('sync leaves unfinished edits, untracked files and diverged history untouched', t => {
  const {a,b}=fixture(t);commit(a,'app.txt','remote\n');git(a,'push');
  writeFileSync(join(b,'scratch.txt'),'unfinished');
  assert.equal(syncRepository({cwd:b}).status,'local-edits');
  assert.equal(readFileSync(join(b,'app.txt'),'utf8'),'initial\n');
  rmSync(join(b,'scratch.txt'));commit(b,'different.txt','local commit');const head=git(b,'rev-parse','HEAD');
  assert.equal(syncRepository({cwd:b}).status,'diverged');assert.equal(git(b,'rev-parse','HEAD'),head);
  assert.equal(git(b,'status','--porcelain'),'');
});
test('sync does not change an unexpected remote or a branch without upstream', t => {
  const {a}=fixture(t);assert.equal(syncRepository({cwd:a,expectedRemote:'https://github.com/wrong/repo.git'}).status,'wrong-remote');
  git(a,'switch','-c','codex/test');assert.equal(syncRepository({cwd:a}).status,'no-matching-upstream');
});
test('publication scanner blocks a secret even if a later commit deletes it', t => {
  const {a}=fixture(t);commit(a,'oops.txt','sk-'+'z'.repeat(32));git(a,'rm','--','oops.txt');git(a,'commit','-m','Remove fixture secret');
  const result=checkRepository({cwd:a,history:true});assert.ok(result.problems.some(p=>p.path==='oops.txt'));
  assert.equal(syncRepository({cwd:a}).status,'publication-blocked');
});
test('incoming credentials cannot overwrite a local ignored API configuration', t => {
  const {a,b}=fixture(t);writeFileSync(join(b,'.env'),'local settings');
  writeFileSync(join(a,'.env'),'bad shared settings');git(a,'add','-f','--','.env');git(a,'commit','-m','Bad fixture');git(a,'push');
  assert.equal(syncRepository({cwd:b}).status,'publication-blocked');
  assert.equal(readFileSync(join(b,'.env'),'utf8'),'local settings');
});
test('repository safety allows placeholders, rejects runtime data and never prints values', () => {
  assert.deepEqual(repositoryProblems('agent/.env.example',Buffer.from('OPENAI_API_KEY=replace-me')),[]);
  assert.ok(repositoryProblems('agent/.env',Buffer.from('placeholder')).length);
  assert.ok(repositoryProblems('.local-data/scene.json',Buffer.from('{}')).length);
  const secret='ghp_'+'X'.repeat(30), problems=repositoryProblems('config.ts',Buffer.from(secret));
  assert.deepEqual(problems,['GitHub token']);assert.equal(JSON.stringify(problems).includes(secret),false);
});
