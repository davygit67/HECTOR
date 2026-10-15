# Projection Mapper collaboration

Two user-owned Codex tasks are actively working in this checkout. Before editing, read `coordination/README.md` and the current task status notes in `coordination/`.

- **Canvas task — Plan projection mapping assistant:** owns `src/`, `electron/`, `host/`, `tests/`, the root package/lock/configuration files, the simulator and projection app.
- **Agent task — Define projection content layer:** owns `agent/`, `CONTENT_ARCHITECTURE.md`, the coordination index and `coordination/agent-status.md`.
- Each task writes only its own status note. The canvas task owns `coordination/canvas-status.md`.
- Request cross-owner changes through the status notes or a task message; do not overwrite another task's active files. Agree the canvas/agent interface before implementing both sides.
- Never run broad cleanup, `git add .`, reset, stash, checkout, or revert operations that could capture or disturb the other task's work. Leave root dependency installation and app build configuration to the canvas owner. Agent dependencies/tests stay under `agent/`.
- All current files are shared live; this convention does not provide filesystem isolation. See the coordination index before using Git or changing ownership.

## Standing Git workflow

The user authorizes automatic commit and push of completed, appropriately tested work. Routine publication within this scope does not require another confirmation. This authorization does not permit committing unfinished work or another active owner's edits.

- Before starting edits, synchronize when the checkout and its editor tasks are idle and clean. Use `npm run repo:sync` for incoming updates: it synchronizes existing commits only and permits fast-forward updates only. If another task is editing, local changes exist, or a Git operation is underway, defer synchronization; do not clean up or commit unfinished edits to make it run.
- After completing work and the appropriate checks, review the changes and stage only explicit, owned file paths. Review the complete staged set so a commit cannot capture another owner's already-staged edits. Never use broad staging such as `git add .` or `git add -A`.
- Before committing, run `node host/repository-safety.mjs --staged` and resolve any findings without exposing secret contents. Never include credentials, local environment files, local runtime/room/recording/media data, private handoff packages or generated dependency/build output. Placeholder `.env.example` files and deliberately reviewed test fixtures are allowed.
- Commit the reviewed changes and push the current agreed branch. Do not switch branches underneath another task. Respect ownership, staged-file coordination and any active publication freeze.
- Never force-push, reset, stash or automatically resolve divergent history. If synchronization reports divergence or another blocking condition, preserve local work and report it for coordination. Periodic synchronization follows the same idle/clean rules and never creates commits from unfinished edits.
- The initial cross-owner baseline is a specific authorized exception to the owned-path rule: the publication task may commit the explicitly reviewed, frozen manifest agreed by the owners. This does not authorize later commits of another active owner's work.

User instructions take precedence. This file coordinates the current work; it does not introduce a user-approval requirement for routine edits within an assigned area.
