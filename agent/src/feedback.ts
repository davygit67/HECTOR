import type { CommandReceipt } from '../../src/shared/bridge.js';
import type { Command, Scene } from '../../src/shared/domain.js';
import { ART_PRESETS } from '../../src/shared/content.js';
import { BACKLIGHT_DEFAULTS, BACKLIGHT_TONE_LABELS } from '../../src/shared/backlight.js';
import { videoUrl, type YouTubeSearchResult } from './youtube-search.js';
import { presentationContext } from './presentation.js';

/** Describe accepted changes from canvas state, never from a model-authored title. */
export function createCanvasFeedback(initial: Scene) {
  let scene = initial;
  const changes = new Map<string, Command>();
  const failures = new Set<string>();
  let searchResults: readonly YouTubeSearchResult[] = [];
  const name = (surfaceId: string) => scene.surfaces.find(surface => surface.id === surfaceId)?.name ?? surfaceId;

  function describeChange(command: Command): string {
    if ('id' in command && (command.type.startsWith('content.') || command.type.startsWith('youtube.backlight'))) {
      const content = scene.contents.find(item => item.id === command.id);
      if (!content) return 'Removed the requested content.';
      const surface = name(content.surfaceId);
      if (content.kind === 'youtube') {
        const source = content.config.backlight ? ' A connected native video source needs no screen sharing. Only the browser iframe fallback uses “Enable live colors” to share this studio tab. Check the player’s source status.' : '';
        if (command.type === 'youtube.backlight.configure') {
          const settings = { ...BACKLIGHT_DEFAULTS, ...content.config.backlightSettings };
          return `Dynamic backlight configured on ${surface}: ${content.config.backlight ? 'enabled' : 'disabled'}, brightness ${Math.round(settings.intensity * 100)}%, spread ${Math.round(settings.spread * 100)}%, smoothing ${settings.smoothingMs} ms, ${BACKLIGHT_TONE_LABELS[settings.toneProfile ?? 'cinema']} tone profile, opacity ${Math.round((settings.opacity ?? 1) * 100)}%, vibrance ${Math.round((settings.vibrance ?? 1) * 100)}%, room fill ${Math.round((settings.roomFill ?? 0) * 100)}%${(settings.roomFill ?? 0) === 0 ? ' (normal backlight)' : ' with timers and foreground panels protected'}.${source}`;
        }
        if (command.type === 'youtube.backlight') return `YouTube backlight on ${surface}: ${content.config.backlight ? 'enabled' : 'disabled'}.${source}`;
        const action = command.type === 'content.update' ? 'updated' : command.type === 'content.attach' ? 'moved' : 'placed';
        return `YouTube player ${action} on ${surface}; dynamic backlight ${content.config.backlight ? 'enabled' : 'disabled'}. Video: ${JSON.stringify(content.title)} — ${videoUrl(content.config.videoId)}. New video sources default to paused and muted; use the player controls when ready.${source}`;
      }
      if (content.kind === 'art') {
        // title is only a label. It cannot turn contours into fish or generated video.
        return `Artwork on ${surface}: ${ART_PRESETS[content.config.preset].label} (${content.config.palette}, ${content.state.clock.running ? 'playing' : 'paused'}).`;
      }
      if (content.kind === 'note') return `Updated note on ${surface}: ${JSON.stringify(content.config.text)}`;
      if (content.kind === 'recipe') return `Updated recipe ${JSON.stringify(content.title)} on ${surface}; ${content.state.stepIndex < 0 ? 'showing ingredients' : `step ${content.state.stepIndex + 1} of ${content.config.steps.length}`}.`;
      if (content.kind === 'game') return `Updated pointer reaction game on ${surface}: ${content.state.status}, ${content.config.rounds} rounds, score ${content.state.score}.`;
      if (content.kind === 'media') {
        const action = command.type === 'content.attach' ? 'moved' : command.type === 'content.action'
          ? command.action === 'start' ? 'playback requested' : command.action === 'reset' ? 'reset and paused in the scene' : 'paused in the scene'
          : 'updated';
        return `Uploaded ${content.config.mediaType} ${JSON.stringify(content.title)} on ${surface}: ${action}. Local file availability and visible output have not been verified.`;
      }
      const unsupported: never = content;
      throw new Error(`Unsupported content feedback: ${String(unsupported)}`);
    }
    if ('id' in command && command.type.startsWith('timer.')) {
      const timer = scene.timers.find(item => item.id === command.id);
      if (!timer) return 'Removed the requested timer.';
      return `Timer ${JSON.stringify(timer.title)} on ${name(timer.surfaceId)}: ${timer.status}; set for ${timer.durationMs / 1000} seconds.`;
    }
    if (command.type === 'effect.set') return 'The built-in matrix/ripple demo is retired and cannot be enabled.';
    if (command.type === 'grid.set') return `Test grid ${scene.showGrid ? 'shown' : 'hidden'}.`;
    return 'The canvas accepted an edit.';
  }

  function describe(command: Command): string {
    const text = describeChange(command);
    if (!('id' in command)) return text;
    const item = [...scene.contents, ...scene.timers].find(entry => entry.id === command.id);
    if (!item) return text;
    const { hiddenBy } = presentationContext(scene, item);
    return hiddenBy.length ? `${text} Visibility is disabled by ${hiddenBy.join(' and ')}.` : text;
  }

  return {
    recordYouTubeSearch(results: readonly YouTubeSearchResult[]) { searchResults = results; },
    recordFailure(error: string) { failures.add(error); },
    record(command: Command, receipt: CommandReceipt) {
      if (!receipt.ok) { failures.add(receipt.error); return; }
      scene = receipt.scene;
      // Compound create/start and successive edits report the final accepted state.
      const key = 'id' in command ? `${command.type.startsWith('youtube.backlight') ? 'content' : command.type.split('.')[0]}:${command.id}` : command.type;
      changes.set(key, command);
    },
    formatReply({ text, toolNames }: { text: string; toolNames: readonly string[] }) {
      if (!changes.size && !failures.size) {
        if (searchResults.length) return 'Found YouTube videos; none have been placed yet:\n' + searchResults.map(result =>
          `${result.title}${result.channel ? ` — ${result.channel}` : ''}${result.metadataVerified ? '' : ' — title/channel metadata unavailable; playback unverified'}\n${result.url}`).join('\n\n');
        return toolNames.some(toolName => !['inspect_room', 'search_youtube'].includes(toolName))
          ? 'No canvas changes were confirmed. The requested action could not be applied.' : text;
      }
      const lines = [...changes.values()].map(describe);
      for (const error of failures) lines.push(`Could not apply an action: ${error}`);
      return lines.join('\n');
    },
  };
}
