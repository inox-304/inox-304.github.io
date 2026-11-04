const heroVideo = document.querySelector<HTMLVideoElement>('#hero-video');
const heroToggle = document.querySelector<HTMLButtonElement>('.video-toggle');

if (heroVideo && heroToggle) {
  const video = heroVideo;
  const toggle = heroToggle;
  const source = video.querySelector<HTMLSourceElement>('source');
  const mobile = window.matchMedia('(max-width: 600px)');
  const tablet = window.matchMedia('(max-width: 1100px)');
  const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  type Family = 'mobile' | 'tablet' | 'desktop';
  const media = {
    mobile: { src: video.dataset.srcMobile, poster: video.dataset.posterMobile },
    tablet: { src: video.dataset.srcTablet, poster: video.dataset.posterTablet },
    desktop: { src: video.dataset.srcDesktop, poster: video.dataset.posterDesktop },
  };
  let family: Family | null = null;
  let loadedFamily: Family | null = null;
  let wantsPlayback = !motion.matches && !connection?.saveData;
  let pendingProgress: number | null = null;
  let playRequest = 0;
  let failed = false;

  function updatePlayback() {
    const playing = !video.paused;
    toggle.setAttribute('aria-label', playing ? 'Pausar video de presentación' : 'Reproducir video de presentación');
    toggle.setAttribute('aria-pressed', String(playing));
    const label = toggle.querySelector('[data-video-label]');
    const icon = toggle.querySelector('[data-video-icon]');
    if (label) label.textContent = playing ? 'Pausar' : 'Reproducir';
    if (icon) icon.textContent = playing ? 'Ⅱ' : '▶';
  }

  async function playVideo() {
    if (!source || !family || !wantsPlayback || document.hidden) return;
    const request = ++playRequest;
    if (loadedFamily !== family || failed) {
      const src = media[family].src;
      if (!src) return;
      source.src = src;
      loadedFamily = family;
      failed = false;
      video.load();
    }
    try {
      await video.play();
    } catch {
      // A source switch can abort an older play promise. Only the active
      // request may change intent after an actual playback rejection.
      if (request === playRequest && !document.hidden) wantsPlayback = false;
      updatePlayback();
    }
  }

  function chooseMedia() {
    const next: Family = mobile.matches ? 'mobile' : tablet.matches ? 'tablet' : 'desktop';
    if (next === family) return;
    if (loadedFamily && Number.isFinite(video.duration) && video.duration > 0) {
      pendingProgress = Math.min(.999, Math.max(0, video.currentTime / video.duration));
    }
    ++playRequest;
    family = next;
    video.dataset.heroMedia = next;
    video.poster = media[next].poster || '';
    if (loadedFamily) {
      video.pause();
      source?.removeAttribute('src');
      loadedFamily = null;
      // Release the old media without fetching the new file while paused.
      video.load();
    }
    if (wantsPlayback && !document.hidden) void playVideo();
  }

  video.addEventListener('loadedmetadata', () => {
    if (pendingProgress === null || !Number.isFinite(video.duration) || video.duration <= 0) return;
    video.currentTime = Math.max(0, Math.min(video.duration - .05, pendingProgress * video.duration));
    pendingProgress = null;
  });
  video.addEventListener('play', updatePlayback);
  video.addEventListener('pause', updatePlayback);
  const onError = () => {
    failed = true;
    wantsPlayback = false;
    updatePlayback();
  };
  video.addEventListener('error', onError);
  source?.addEventListener('error', onError);
  toggle.addEventListener('click', () => {
    wantsPlayback = video.paused;
    if (wantsPlayback) void playVideo();
    else { ++playRequest; video.pause(); }
  });
  mobile.addEventListener('change', chooseMedia);
  tablet.addEventListener('change', chooseMedia);
  motion.addEventListener('change', () => {
    if (motion.matches) { wantsPlayback = false; ++playRequest; video.pause(); }
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { ++playRequest; video.pause(); }
    else if (wantsPlayback) void playVideo();
  });
  window.addEventListener('pagehide', () => { ++playRequest; video.pause(); });
  window.addEventListener('pageshow', () => { if (wantsPlayback) void playVideo(); });
  chooseMedia();
  updatePlayback();
}
