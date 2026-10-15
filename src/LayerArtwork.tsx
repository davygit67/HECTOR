import { useEffect, useMemo, useRef } from 'react';
import type { ContentInstance } from './shared/content';
import type { Scene } from './shared/domain';
import { paintContent } from './contentPainter';
import { mediaRevision } from './nativeMedia';
import { localMediaSource } from './localMedia';
import { renderWidth } from './shared/layers';

/** Existing content painters, split into compositable layers; no second renderer. */
export function LayerArtwork({ content, scene, output, active }: { content: ContentInstance; scene: Scene; output: boolean; active: boolean }) {
  const signature = useMemo(() => JSON.stringify(content), [content]);
  const canvas = useRef<HTMLCanvasElement>(null), latest = useRef({ content, active, signature }); latest.current = { content, active, signature };
  const width = renderWidth(scene, output), height = width * 9 / 16;
  useEffect(() => {
    let frame = 0, last = '';
    const render = () => {
      const { content, active, signature } = latest.current;
      const presentation = document.querySelector('.projection-presentation:not([hidden])');
      if (active && !document.hidden && (!presentation || presentation.contains(canvas.current))) {
        const stamp = signature + (content.kind === 'youtube' ? mediaRevision(content.id) : content.kind === 'media' ? localMediaSource(content.id)?.revision : '');
        if (stamp !== last) {
          const ctx = canvas.current?.getContext('2d');
          if (ctx) { ctx.clearRect(0, 0, width, height); paintContent(ctx, content, width, height, Date.now()); last = stamp; }
        }
      }
      frame = requestAnimationFrame(render);
    };
    render(); return () => cancelAnimationFrame(frame);
  }, [width, height]);
  return <canvas ref={canvas} width={width} height={height} className="layer-artwork" aria-hidden="true" />;
}
