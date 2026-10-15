# Collaborating on Projection Mapper

This repository contains the integrated Studio, Electron video sources, Vercel AI SDK agent, and Kinect helper source. It is a local application: GitHub shares the code, not a hosted version of the running studio.

Private repository: **[adknate05/projection-mapper](https://github.com/adknate05/projection-mapper)**. The shared integration branch is `main`.

## First setup

Accept the repository invitation, then clone the private repository using GitHub Desktop or Git. Use your own clone rather than a shared Dropbox/iCloud project folder. Install Node.js 22.12+ and Git.

- **Windows:** double-click `Setup Windows.cmd`, then `Check Windows.cmd` and `Launch Preview.cmd`.
- **Mac:** run `npm ci`, `npm --prefix agent ci`, `npm --prefix agent run build`, `npm --prefix sensor-helper ci`, `npm --prefix sensor-helper run build`, and `npm run build`. Then use `Launch Preview.command`.
- Run `npm run collaboration:setup` in each clone to enable the repository checks and fast-forward-only pulls. Hooks are local Git settings; cloning alone does not install them.
- Copy `agent/.env.example` to `agent/.env` and enter an API key locally. Exchange a shared key separately if needed. Never commit it, even to this private repository. Manual canvas editing works without a key.

Saved room layouts, imported videos, recordings, browser sign-in sessions, dependencies, and old handoff packages stay on each computer. They are not included in GitHub. Each computer needs its own projection calibration. See [Windows setup](WINDOWS_SETUP.md) and [sensor setup](sensor-helper/README.md) for the hardware pieces.

## Daily work

Start from current code using `npm run repo:sync` while your checkout is clean and nobody else is editing it. Use a separate branch such as `codex/video-controls` for work that should be reviewed before integration. Push the new branch with `git push -u origin <branch>` once; subsequent syncs follow that same branch. Open a pull request into `main` when ready. Separate clones/worktrees let collaborators work independently; don't switch the shared local checkout's branch underneath another active task.

Codex is instructed to commit and push completed, tested changes in its own scope. It reviews the exact changed files, keeps other tasks' unfinished changes out, and runs the credential guard. Ordinary edits in other editors still need a deliberate commit. This does not continuously publish partially written files.

The periodic Codex sync, once enabled on the owner's Mac, runs `npm run repo:sync` when the checkout's other tasks are idle. It does not install itself on your co-founder's computer. They can use the same command or request the same Codex automation in their clone.

The sync command:

- Pushes existing local commits when the remote has not moved ahead.
- Pulls updates only as a fast-forward into a clean checkout.
- Leaves local edits, staged work, untracked files, in-progress Git operations and diverged histories untouched.
- Scans outgoing commits and incoming files for known secret formats and private paths. It prints only filenames and categories, never matching values. This is a guard, not a guarantee against every possible secret format.
- Never creates commits, force-pushes, rebases, stashes, resets, deletes branches or resolves conflicts.

If both people changed the same branch, sync stops with `diverged`; reconcile the changes deliberately through a merge or pull request. A `local-edits` result means finish/commit the work first. A `busy` result means another Git operation is underway; an interrupted sync may leave `.git/projection-sync.lock`, which should only be removed after confirming no sync is running.

## Checks and updates

Before publishing, run the checks appropriate to the changes:

```sh
npm test
npm run build
npm --prefix agent run check
npm --prefix sensor-helper run check
```

These checks do not require a real API key. Real network playback and Kinect/projector qualification are separate from the offline tests. Native Windows Kinect acquisition remains hardware-dependent.

After pulling dependency changes, run `npm ci` in the changed package(s). After pulling source updates, rebuild the app/agent/helper as appropriate and restart the local studio to load native or agent changes. Git sync deliberately does not restart live playback or overwrite anyone's local configuration.
