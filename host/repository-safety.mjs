import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';

const patterns = [
  ['private key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ['OpenAI-style secret', /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{24,}/],
  ['GitHub token', /\b(?:gh[pousr]_[A-Za-z0-9]{24,}|github_pat_[A-Za-z0-9_]{30,})/],
  ['AWS access key', /\bAKIA[A-Z0-9]{16}\b/],
];
export function repositoryProblems(path, bytes) {
  const problems = [];
  if (/(^|\/)\.env(?:\.|$)/.test(path) && !/(^|\/)\.env\.example$/.test(path)) problems.push('local environment file');
  if (/(^|\/)(?:node_modules|\.local-data|handoff|runtime)(\/|$)/.test(path)) problems.push('private or generated local data');
  if (/\.(?:pem|key|p12|pfx)$/.test(path) || /(^|\/)\.npmrc$/.test(path)) problems.push('credential-bearing file');
  for (const [label, pattern] of patterns) if (pattern.test(bytes.toString('utf8'))) problems.push(label);
  return problems;
}
export function checkRepository({ cwd = process.cwd(), history = false, staged = false, heads = ['HEAD'], remote = 'origin' } = {}) {
  const git = (...args) => execFileSync('git', args, { cwd, maxBuffer: 32 * 1024 * 1024 });
  const refs = history ? [...new Set(heads.flatMap(head => git('rev-list', head, ...(remote ? ['--not', '--remotes=' + remote] : [])).toString().trim().split('\n').filter(Boolean)))] : [staged ? ':' : heads[0]];
  const problems = [], seen = new Set();
  for (const ref of refs) {
    const paths = (staged ? git('diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z') : history ? git('diff-tree', '--root', '--no-commit-id', '--name-only', '-r', '-m', '--diff-filter=ACMR', '-z', ref) : git('ls-tree', '-r', '--name-only', '-z', ref)).toString().split('\0').filter(Boolean);
    for (const path of paths) {
      const object = ref === ':' ? ':' + path : ref + ':' + path;
      const hash = git('rev-parse', object).toString().trim(), key = path + ':' + hash;
      if (seen.has(key)) continue;
      seen.add(key);
      for (const reason of repositoryProblems(path, git('cat-file', 'blob', hash))) problems.push({ path, reason });
    }
  }
  return { checked: seen.size, problems };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const push = process.argv.indexOf('--push');
    const heads = push < 0 ? ['HEAD'] : readFileSync(0, 'utf8').trim().split('\n').filter(Boolean).map(line => line.split(' ')[1]).filter(sha => !/^0+$/.test(sha));
    if (push >= 0 && heads.some(sha => !/^[a-f0-9]{40,64}$/.test(sha))) throw new Error('Invalid push input.');
    const suppliedRemote = push < 0 ? 'origin' : process.argv[push + 1];
    const remote = suppliedRemote && /^[\w./-]+$/.test(suppliedRemote) ? suppliedRemote : '';
    const result = checkRepository({ staged: process.argv.includes('--staged'), history: push >= 0 || process.argv.includes('--history'), heads, remote });
    if (result.problems.length) {
      // Only paths and categories are printed. Never print matching secret text.
      console.error('Publication stopped:\n' + result.problems.map(p => `${p.path}: ${p.reason}`).join('\n'));
      process.exitCode = 1;
    } else console.log(`Repository check passed (${result.checked} file versions).`);
  } catch { console.error('Repository check could not finish; nothing was published.'); process.exitCode = 1; }
}
