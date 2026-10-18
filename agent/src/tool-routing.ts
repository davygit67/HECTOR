import { tool } from 'ai';
import { z } from 'zod';
const groups = {
  timers: ['create_timer', 'control_timer', 'attach_timer', 'edit_scene', 'arrange_panel'],
  content: ['create_note', 'create_recipe', 'create_artwork', 'create_reaction_game', 'update_content', 'control_content', 'attach_content', 'remove_content', 'arrange_panel'],
  layout: ['edit_scene', 'arrange_panel', 'set_grid', 'fill_surface', 'operate_studio', 'inspect_visual'],
  media: ['search_youtube', 'display_youtube', 'set_youtube_backlight', 'configure_video_backlight', 'configure_media', 'update_content', 'control_content', 'attach_content', 'remove_content', 'operate_studio', 'inspect_visual'],
  studio: ['operate_studio', 'inspect_visual', 'edit_scene'],
  memory: ['manage_memory'],
  experiences: ['list_experiences', 'apply_experience', 'operate_studio', 'inspect_visual', 'edit_scene', 'arrange_panel'],
} as const;
type Group = keyof typeof groups;
const names = Object.keys(groups) as [Group, ...Group[]];
/** Routing reduces schema overhead, not capability: the model can enable any group next step. */
export function createToolSelector(prompt: string) {
  const enabled = new Set<Group>(); let all = false;
  if (/timer|countdown|minute|second/i.test(prompt)) enabled.add('timers');
  if (/note|recipe|cook|\bart\b|fish|\bstars?\b|aurora|game|background|create|put|place|add|remove|delete/i.test(prompt)) enabled.add('content');
  if (/move|resize|size|layout|position|align|calibrat|corner|layer|opacity|brightness|grid|projector|viewer|lock|hide|show/i.test(prompt)) enabled.add('layout');
  if (/\b(fill|color|colour|red|green|blue)\b/i.test(prompt)) enabled.add('layout');
  if (/video|youtube|music|movie|backlight|glow|play|sound|source|saturat|volume|room fill|watch|media|image|file|lighting/i.test(prompt)) enabled.add('media');
  if (/window|fullscreen|output|preview|inspect|look|interface|hardware|sensor|record|session|capture|connect|replay|import|composition|save|recall|view/i.test(prompt)) enabled.add('studio');
  if (/remember|forget|memory|prefer|learn/i.test(prompt)) enabled.add('memory');
  if (/experience|cinema|underwater|gallery|transform|cooking station|music room|tabletop target/i.test(prompt)) enabled.add('experiences');
  // Ambiguous follow-ups keep access broad; do not guess which preceding object the user means.
  if (!enabled.size || /\b(it|that|same|those|them)\b/i.test(prompt)) all = true;
  return {
    tools: {
      select_tools: tool({
        description: 'Enable more capabilities for the next step if needed. Categories: timers; content (notes/recipes/art/games); layout (layers/display/alignment); media (YouTube/local files/backlight); studio (UI/output/hardware/saved compositions/visual inspection); memory; experiences. all exposes every implemented tool. This changes available tools, not the room.',
        strict: true, inputSchema: z.strictObject({ categories: z.array(z.enum([...names, 'all'])).min(1).max(8) }),
        execute: async input => {
          for (const category of input.categories) { if (category === 'all') all = true; else enabled.add(category); }
          return { ok: true, enabled: all ? ['all'] : [...enabled], note: 'Requested tools are available on the next step.' };
        },
      }),
    },
    activeTools(available: string[], used: string[]) {
      if (all) return available;
      const selected = new Set(['inspect_room', 'inspect_studio', 'select_tools', 'review_request', ...used, ...[...enabled].flatMap(g => [...groups[g]])]);
      return available.filter(name => selected.has(name));
    },
  };
}
