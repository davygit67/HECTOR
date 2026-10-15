import { execFileSync } from 'node:child_process';
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
let existing = '';
try { existing = git('config', '--get', 'core.hooksPath'); } catch {}
if (existing && existing !== '.githooks') throw new Error('Existing Git hooks are configured. Integrate the repository checks there before changing hooksPath.');
git('config', '--local', 'core.hooksPath', '.githooks');
git('config', '--local', 'pull.ff', 'only');
git('config', '--local', 'fetch.prune', 'true');
console.log('Repository checks enabled. Pulls require a fast-forward; unfinished changes are never auto-committed.');
