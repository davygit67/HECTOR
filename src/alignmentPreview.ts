import { useEffect, useRef, useState } from 'react';
import { isValidProjectionQuad, type Quad } from './shared/geometry';

/** Transient, validated geometry only. Durable state still goes through the existing bridge. */
export function useAlignmentPreview(surfaceId: string, saved: Quad, session?: string) {
  const [remote, setRemote] = useState<Quad | null>(null);
  const channel = useRef<BroadcastChannel | null>(null), expire = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedKey = JSON.stringify(saved);
  useEffect(() => { setRemote(null); }, [savedKey, surfaceId]);
  useEffect(() => {
    if (!session) return;
    const bus = new BroadcastChannel('projection-mapper-alignment-' + session); channel.current = bus;
    bus.onmessage = event => {
      const message = event.data;
      if (!message || message.surfaceId !== surfaceId || !isValidProjectionQuad(message.quad)) return;
      setRemote(message.quad);
      if (expire.current !== null) clearTimeout(expire.current);
      expire.current = setTimeout(() => setRemote(null), message.final === true ? 600 : 5000);
    };
    return () => { if (expire.current !== null) clearTimeout(expire.current); channel.current = null; bus.close(); };
  }, [session, surfaceId]);
  return { remote, publish: (quad: Quad, final = false) => channel.current?.postMessage({ surfaceId, quad, final }) };
}
