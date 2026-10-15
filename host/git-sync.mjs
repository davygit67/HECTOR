import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkRepository } from './repository-safety.mjs';

/** Sync existing commits only. Never stages, commits, stashes, rebases, resolves
 * conflicts or force-pushes. Call only while the checkout's editors are idle. */
export function syncRepository({ cwd = process.cwd(), expectedRemote } = {}) {
  const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8', timeout: 60000, maxBuffer: 4 * 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const directory = resolve(cwd, git('rev-parse', '--git-dir')), lock = join(directory, 'projection-sync.lock');
  try { mkdirSync(lock); } catch (e) { if (e.code === 'EEXIST') return { status: 'busy' }; throw e; }
  try {
    if (['index.lock', 'MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'rebase-apply', 'rebase-merge'].some(name => existsSync(join(directory, name)))) return { status: 'busy' };
    const branch = git('symbolic-ref', '--quiet', '--short', 'HEAD');
    if (git('status', '--porcelain', '--untracked-files=all')) return { status: 'local-edits', branch };
    const remote = git('remote', 'get-url', 'origin');
    if (expectedRemote && remote !== expectedRemote) return { status: 'wrong-remote' };
    let upstreamRemote, upstreamRef;
    try { upstreamRemote = git('config', '--get', `branch.${branch}.remote`); upstreamRef = git('config', '--get', `branch.${branch}.merge`); }
    catch { return { status: 'no-matching-upstream', branch }; }
    if (upstreamRemote !== 'origin' || upstreamRef !== `refs/heads/${branch}`) return { status: 'no-matching-upstream', branch };
    git('fetch', '--no-tags', 'origin');
    const local = git('rev-parse', 'HEAD'), incoming = git('rev-parse', `refs/remotes/origin/${branch}`);
    const [behind, ahead] = git('rev-list', '--left-right', '--count', `origin/${branch}...HEAD`).split(/\s+/).map(Number);
    if (behind && ahead) return { status: 'diverged', branch, behind, ahead };
    if (!behind && !ahead) return { status: 'up-to-date', branch };
    // Recheck immediately before changing files or publishing commits. Git also
    // rejects overlapping edits/non-fast-forward races with the remote.
    if (git('status', '--porcelain', '--untracked-files=all') || git('rev-parse', 'HEAD') !== local) return { status: 'local-edits', branch };
    if (behind) {
      const check = checkRepository({ cwd, heads: [incoming] });
      if (check.problems.length) return { status: 'publication-blocked', problems: check.problems };
      git('merge', '--ff-only', '--no-overwrite-ignore', incoming); return { status: 'pulled', branch, commits: behind };
    }
    const check = checkRepository({ cwd, history: true });
    if (check.problems.length) return { status: 'publication-blocked', problems: check.problems };
    if (git('status', '--porcelain', '--untracked-files=all') || git('rev-parse', 'HEAD') !== local) return { status: 'local-edits', branch };
    git('push', 'origin', `${local}:refs/heads/${branch}`);
    return { status: 'pushed', branch, commits: ahead };
  } finally { rmdirSync(lock); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const expectedRemote = process.argv.find(a => a.startsWith('--remote='))?.slice(9);
    const result = syncRepository({ expectedRemote }); console.log(JSON.stringify(result));
    if (['diverged', 'publication-blocked', 'wrong-remote', 'no-matching-upstream'].includes(result.status)) process.exitCode = 1;
  } catch { console.error('Sync could not finish. Check GitHub access, the current branch and Git status. No forced changes were made.'); process.exitCode = 1; }
}
