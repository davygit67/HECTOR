const { ipcRenderer } = require('electron');
// Runs only in the isolated, sandboxed main frame. No API is exposed to the
// remote page: no scene, tools, files, shell, cookies or desktop capture bridge.
if (process.isMainFrame) {
  const argument = name => process.argv.find(a => a.startsWith(name + '='))?.slice(name.length + 1);
  const expectedId = argument('--projection-video');
  const start = Math.max(0, Number(argument('--projection-start')) || 0);
  let allowPlay = false, muted = true, hasPlayed = false, normalPage = false;
  let started = false, lastReport = 0, loadedAt = Date.now(), lastState = '';
  let currentVideo, style;
  const bound = new WeakSet();
  const targetPage = () => location.pathname === '/watch' && new URLSearchParams(location.search).get('v') === expectedId;
  const player = () => document.querySelector('#movie_player.html5-video-player');
  const video = () => player()?.querySelector('video');
  const visible = node => !!node && node.getBoundingClientRect().width > 0 && node.getBoundingClientRect().height > 0;
  const notice = () => {
    if (!targetPage()) return 'Open YouTube window to finish sign-in or consent, then return to projection.';
    const consent = document.querySelector('ytd-consent-bump-v2-lightbox, ytd-consent-bump-lightbox, tp-yt-paper-dialog[opened]');
    if (visible(consent)) return 'YouTube needs your attention. Open YouTube window to continue.';
    const error = document.querySelector('.ytp-error-content-wrap');
    if (visible(error)) return (error.innerText || 'YouTube cannot play this video.').replace(/\s+/g, ' ').slice(0, 220) + ' Open YouTube window for details.';
    return '';
  };
  function presentation(enabled) {
    normalPage = !enabled;
    if (style) style.remove();
    style = undefined;
    // Keep the real YouTube player, including controls, branding and ads. Only
    // its layout changes; video frames still come from normal browser playback.
    if (enabled && targetPage() && !notice() && document.documentElement) {
      style = document.createElement('style');
      style.textContent = `html,body{overflow:hidden!important} body *:not(#movie_player, #movie_player *, :has(#movie_player)){visibility:hidden!important} #movie_player.html5-video-player{position:fixed!important;inset:0!important;margin:0!important;width:100vw!important;height:100vh!important;max-width:none!important;max-height:none!important;z-index:2200!important;border-radius:0!important} #movie_player .html5-video-container{width:100%!important;height:100%!important} #movie_player video{left:0!important;top:0!important;width:100%!important;height:100%!important;object-fit:contain!important}`;
      document.documentElement.appendChild(style);
    }
    window.dispatchEvent(new Event('resize'));
  }
  function guard(v) {
    if (!v) return;
    currentVideo = v;
    if (!bound.has(v)) {
      bound.add(v);
      v.addEventListener('play', () => { if (!allowPlay) v.pause(); });
      v.addEventListener('volumechange', () => { if (muted && !v.muted) v.muted = true; });
    }
    if (muted) v.muted = true;
    if (!allowPlay && !v.paused) v.pause();
  }
  function tick(force = false) {
    const v = video(); guard(v);
    if (!targetPage()) { allowPlay = false; v?.pause(); }
    const problem = notice();
    if (problem && style) { style.remove(); style = undefined; }
    if (!normalPage && !style && !problem) presentation(true);
    if (v && v.readyState >= 1 && !started && !player()?.classList.contains('ad-showing')) {
      if (start && Number.isFinite(v.duration)) v.currentTime = Math.min(start, Math.max(0, v.duration - .1));
      started = true;
    }
    const ready = !!v && v.readyState >= 2 && !v.error && !problem && targetPage();
    const playing = ready && !v.paused && !v.ended && allowPlay;
    if (playing) hasPlayed = true;
    const rect = ready ? player()?.getBoundingClientRect() : null;
    let region;
    if (rect && rect.width > 100 && rect.height > 100 && rect.x >= -.5 && rect.y >= -.5 && rect.right <= innerWidth + .5 && rect.bottom <= innerHeight + .5) {
      const x = Math.max(0, Math.round(rect.x)), y = Math.max(0, Math.round(rect.y));
      region = { x, y, width: Math.min(Math.round(rect.width), innerWidth - x), height: Math.min(Math.round(rect.height), innerHeight - y), viewportWidth: innerWidth, viewportHeight: innerHeight };
    }
    const status = problem || (v?.error ? 'YouTube could not decode this video. Open YouTube window for details.' : ready ? (playing ? 'Playing on YouTube' : v.ended ? 'Video ended' : hasPlayed ? 'Paused on YouTube' : 'Ready on YouTube · paused and muted') : Date.now() - loadedAt > 25000 ? 'YouTube has not loaded. Open YouTube window to check the page, or reload video.' : 'Loading YouTube watch page…');
    const state = { ready: ready && !!region, playing, hasPlayed, status, currentTime: Number.isFinite(v?.currentTime) ? v.currentTime : 0, duration: Number.isFinite(v?.duration) ? v.duration : 0, region };
    const serialized = JSON.stringify(state);
    if (force || (serialized !== lastState && Date.now() - lastReport > 200) || Date.now() - lastReport > 750) {
      lastState = serialized; lastReport = Date.now(); ipcRenderer.send('media:source-state', state);
    }
  }
  ipcRenderer.on('media:source-command', (_event, command) => {
    const v = video();
    if (command.action === 'source-view') { presentation(!command.open); tick(true); return; }
    if (command.action === 'play') { allowPlay = true; muted = true; if (v) { v.muted = true; void v.play().catch(() => tick(true)); } }
    if (command.action === 'pause') { allowPlay = false; v?.pause(); }
    if (command.action === 'mute') { muted = true; if (v) v.muted = true; }
    if (command.action === 'unmute') { muted = false; if (v) { v.muted = false; if (v.volume === 0) v.volume = 1; } }
    if (command.action === 'seek' && v && Number.isFinite(command.seconds)) v.currentTime = Math.min(command.seconds, Number.isFinite(v.duration) ? Math.max(0, v.duration - .1) : command.seconds);
    tick(true);
  });
  // A real user may use YouTube's own controls, too. Native audio remains muted
  // until the Studio's explicit Unmute command, regardless of page activity.
  document.addEventListener('pointerdown', e => { if (e.isTrusted && e.target.closest?.('#movie_player')) allowPlay = true; }, true);
  document.addEventListener('keydown', e => { if (e.isTrusted && [' ', 'k', 'K', 'Enter'].includes(e.key)) allowPlay = true; }, true);
  new MutationObserver(() => guard(video())).observe(document, { childList: true, subtree: true });
  window.addEventListener('pagehide', () => { allowPlay = false; currentVideo?.pause(); });
  setInterval(tick, 100);
  document.addEventListener('DOMContentLoaded', () => tick(true));
}
