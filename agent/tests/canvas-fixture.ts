import { initialScene, reduceScene, type Command, type Scene } from '../../src/shared/domain.js';
import type { CommandReceipt, Snapshot } from '../../src/shared/bridge.js';
import type { CanvasPort } from '../src/canvas.js';
import { AGENT_COMMAND_TYPES } from '../src/commands.js';

/** Test support only: uses the actual canvas reducer, never a substitute simulator. */
export function canvasFixture(reject?: (command: Command) => string | undefined, startingScene?: Scene) {
  let scene = startingScene ? structuredClone(startingScene) : initialScene(1000);
  const commands: Command[] = [];
  const port: CanvasPort = {
    async getSnapshot(): Promise<Snapshot> {
      return { scene: structuredClone(scene), saveStatus: 'saving', saveError: null, storage: 'browser', displays: [],
        output: { open: false, fullscreen: false, displayId: null } };
    },
    async dispatch(command): Promise<CommandReceipt> {
      if (!(AGENT_COMMAND_TYPES as readonly string[]).includes(command.type)) {
        throw new Error('Agent emitted a command outside its transport allowlist.');
      }
      commands.push(command);
      const error = reject?.(command);
      if (error) return { ok: false, error };
      try {
        scene = reduceScene(scene, command, 1000);
        return { ok: true, scene: structuredClone(scene) };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : 'Canvas rejected command.' };
      }
    },
  };
  return { port, commands, scene: () => structuredClone(scene) };
}
