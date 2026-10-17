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
  let currentId = expectedId, autoplayNext = false, pendingNextUntil = 0, resumePending = false;
  let sessionReady = false;
  let controlNotice = '', noticeUntil = 0, toggleAt = 0, endedTimer;
  const bound = new WeakSet();
  const pageId = () => location.pathname === '/watch' && /^[\w-]{11}$/.test(new URLSearchParams(location.search).get('v') || '') ? new URLSearchParams(location.search).get('v') : null;
  const targetPage = () => !!pageId();
  const player = () => document.querySelector('#movie_player.html5-video-player');
  const video = () => player()?.querySelector('video');
  const visible = node => !!node && node.getBoundingClientRect().width > 0 && node.getBoundingClientRect().height > 0;
  const usable = node => visible(node) && !node.disabled && node.getAttribute('aria-disabled') !== 'true' && getComputedStyle(node).visibility !== 'hidden' && getComputedStyle(node).display !== 'none';
  const adPlaying = () => !!player()?.classList.contains('ad-showing');
  const watchLink = node => {
    try { const url = new URL(node?.getAttribute('href'), location.href); return url.protocol === 'https:' && ['www.youtube.com', 'youtube.com'].includes(url.hostname) && url.pathname === '/watch' && /^[\w-]{11}$/.test(url.searchParams.get('v') || '') && url.searchParams.get('v') !== pageId(); } catch { return false; }
  };
  const nextButton = () => {
    const node = player()?.querySelector('.ytp-next-button');
    // Outside playlists YouTube hides this button but still supplies its real
    // next-video href. Follow that ordinary link; never invent a video ID.
    if (node && !node.disabled && node.getAttribute('aria-disabled') !== 'true' && (usable(node) || watchLink(node))) return node;
    return [...document.querySelectorAll('.ytp-autonav-endscreen-link-container[href], #related a[href*="watch?v="]')].find(watchLink);
  };
  const skipButton = () => adPlaying() ? [...(player()?.querySelectorAll('.ytp-skip-ad-button, .ytp-ad-skip-button-modern, .ytp-ad-skip-button, .ytp-ad-skip-button-container button') || [])].find(usable) : null;
  function message(text) { controlNotice = text; noticeUntil = Date.now() + 6000; }
  function next() {
    if (pendingNextUntil > Date.now()) return;
    const button = nextButton();
    if (!button) { message('YouTube has no next video available. Open YouTube window to choose one.'); return; }
    allowPlay = true; pendingNextUntil = Date.now() + 12000; button.click();
  }
  function syncAutoplay() {
    const toggle = player()?.querySelector('.ytp-autonav-toggle-button[aria-checked]');
    if (visible(toggle) && !toggle.disabled && (toggle.getAttribute('aria-checked') === 'true') !== autoplayNext && Date.now() - toggleAt > 1000) {
      toggleAt = Date.now(); toggle.click();
    }
  }
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
      v.addEventListener('ended', () => {
        clearTimeout(endedTimer);
        // Let YouTube perform its own transition first. Fall back to its normal
        // Next button, once, if the page stays on the ended video. Never skip ads.
        if (adPlaying() || !autoplayNext || !allowPlay) return;
        const endedId = pageId();
        endedTimer = setTimeout(() => {
          if (pageId() === endedId && autoplayNext && allowPlay && !adPlaying()) next();
        }, 1800);
      });
    }
    if (muted) v.muted = true;
    if (!allowPlay && !v.paused) v.pause();
  }
  function tick(force = false) {
    if (!sessionReady) { guard(video()); return; }
    const id = pageId();
    if (id && id !== currentId) {
      const continuePlayback = allowPlay && (autoplayNext || pendingNextUntil > Date.now());
      currentId = id; started = false; hasPlayed = false; loadedAt = Date.now();
      clearTimeout(endedTimer); pendingNextUntil = 0; allowPlay = continuePlayback; resumePending = continuePlayback;
      if (!continuePlayback) muted = true;
    }
    if (pendingNextUntil && Date.now() > pendingNextUntil) { pendingNextUntil = 0; message('YouTube did not open the next video. Try Next video again or open the YouTube window.'); }
    const v = video(); guard(v);
    if (!targetPage()) { allowPlay = false; resumePending = false; v?.pause(); }
    const problem = notice();
    if (problem && style) { style.remove(); style = undefined; }
    if (!normalPage && !style && !problem) presentation(true);
    if (v && v.readyState >= 1 && !started && !player()?.classList.contains('ad-showing')) {
      if (currentId === expectedId && start && Number.isFinite(v.duration)) v.currentTime = Math.min(start, Math.max(0, v.duration - .1));
      started = true;
    }
    syncAutoplay();
    if (resumePending && allowPlay && v?.readyState >= 2 && !problem) {
      resumePending = false; v.muted = muted; void v.play().catch(() => message('Press Play muted to continue this video.'));
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
    const status = problem || (ready && adPlaying() ? `${playing ? 'Ad playing' : 'Ad paused'} · ${skipButton() ? 'Skip ad available' : 'Waiting for YouTube to allow skipping'}` : '') || (v?.error ? 'YouTube could not decode this video. Open YouTube window for details.' : ready ? (playing ? 'Playing on YouTube' : v.ended ? 'Video ended' : hasPlayed ? 'Paused on YouTube' : 'Ready on YouTube · paused and muted') : Date.now() - loadedAt > 25000 ? 'YouTube has not loaded. Open YouTube window to check the page, or reload video.' : 'Loading YouTube watch page…');
    const title = (document.querySelector('ytd-watch-metadata h1 yt-formatted-string, h1.ytd-watch-metadata yt-formatted-string')?.textContent || document.title.replace(/ - YouTube$/, '')).trim().slice(0, 200);
    const state = { ready: ready && !!region, playing, hasPlayed, status, currentTime: Number.isFinite(v?.currentTime) ? v.currentTime : 0, duration: Number.isFinite(v?.duration) ? v.duration : 0, region,
      allowPlay, muted, currentTitle: title, autoplayNext, canGoNext: !!nextButton(), adPlaying: adPlaying(), canSkipAd: !!skipButton(), controlNotice: Date.now() < noticeUntil ? controlNotice : '' };
    const serialized = JSON.stringify(state);
    if (force || (serialized !== lastState && Date.now() - lastReport > 200) || Date.now() - lastReport > 750) {
      lastState = serialized; lastReport = Date.now(); ipcRenderer.send('media:source-state', state);
    }
  }
  ipcRenderer.on('media:source-command', (_event, command) => {
    const v = video();
    controlNotice = ''; noticeUntil = 0;
    if (command.action === 'source-view') { presentation(!command.open); tick(true); return; }
    if (command.action === 'session') { sessionReady = true; currentId = pageId() || currentId; autoplayNext = command.autoplayNext === true; muted = command.muted !== false; allowPlay = command.allowPlay === true; resumePending = allowPlay; tick(true); return; }
    if (command.action === 'autoplay-next') { autoplayNext = command.enabled === true; if (!autoplayNext) clearTimeout(endedTimer); }
    if (command.action === 'next') next();
    if (command.action === 'skip-ad') { const button = skipButton(); if (button) button.click(); else message('YouTube has not made this ad skippable yet.'); }
    if (command.action === 'play') { allowPlay = true; muted = true; if (v) { v.muted = true; void v.play().catch(() => tick(true)); } }
    if (command.action === 'pause') { allowPlay = false; resumePending = false; pendingNextUntil = 0; clearTimeout(endedTimer); v?.pause(); }
    if (command.action === 'mute') { muted = true; if (v) v.muted = true; }
    if (command.action === 'unmute') { muted = false; if (v) { v.muted = false; if (v.volume === 0) v.volume = 1; } }
    if (command.action === 'seek' && !adPlaying() && v && Number.isFinite(command.seconds)) v.currentTime = Math.min(command.seconds, Number.isFinite(v.duration) ? Math.max(0, v.duration - .1) : command.seconds);
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
