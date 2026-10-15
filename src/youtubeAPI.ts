export interface Player { destroy(): void; playVideo(): void; pauseVideo(): void; mute(): void; unMute(): void; isMuted(): boolean; getCurrentTime(): number; getDuration(): number; seekTo(seconds: number, allowSeekAhead: boolean): void }
interface YouTubeAPI { Player: new (frame: HTMLIFrameElement, options: { events: { onReady: () => void; onStateChange: (event: { data: number }) => void; onError: (event: { data: number }) => void; onAutoplayBlocked: () => void } }) => Player }
declare global { interface Window { YT?: YouTubeAPI; onYouTubeIframeAPIReady?: () => void } }
let apiPromise: Promise<YouTubeAPI> | undefined;
export function loadAPI() {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (apiPromise) return apiPromise;
  const pending = new Promise<YouTubeAPI>((resolve, reject) => {
    const script = document.createElement('script'), previous = window.onYouTubeIframeAPIReady;
    const timeout = window.setTimeout(() => finish(new Error('YouTube did not respond. Check your connection, then retry.')), 15000);
    const callback = () => { previous?.(); finish(); };
    const finish = (error?: Error) => {
      clearTimeout(timeout); script.onerror = null;
      if (window.onYouTubeIframeAPIReady === callback) window.onYouTubeIframeAPIReady = previous;
      if (error) { script.remove(); reject(error); }
      else if (window.YT?.Player) resolve(window.YT);
      else reject(new Error('The YouTube player could not load.'));
    };
    window.onYouTubeIframeAPIReady = callback;
    script.src = 'https://www.youtube.com/iframe_api'; script.async = true;
    script.onerror = () => finish(new Error('Could not reach YouTube. Check your connection or content blocker, then retry.'));
    document.head.append(script);
  });
  apiPromise = pending;
  void pending.catch(() => { if (apiPromise === pending) apiPromise = undefined; });
  return pending;
}
export function youtubePlayerError(code: number) {
  if (code === 153) return 'YouTube rejected this app’s playback identity (153). Try the local browser studio.';
  if (code === 101 || code === 150) return 'This video’s owner does not allow embedded playback. Choose another video.';
  if (code === 100) return 'This video is unavailable or private. Choose another video.';
  if (code === 2) return 'YouTube rejected this video link.';
  return 'YouTube could not play this video (error ' + code + '). Try another video or retry.';
}

