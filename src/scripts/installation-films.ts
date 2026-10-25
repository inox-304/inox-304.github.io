type FilmState = 'idle' | 'loading' | 'playing' | 'paused' | 'error';
type FilmPlayer = {
  card: HTMLElement;
  video: HTMLVideoElement;
  button: HTMLButtonElement;
  label: HTMLElement;
  status: HTMLElement;
  generation: number;
  pending: number | null;
};

const players: FilmPlayer[] = [];
let activePlayer: FilmPlayer | null = null;

function setState(player: FilmPlayer, state: FilmState, message = '') {
  player.card.dataset.filmState = state;
  player.button.hidden = state === 'playing' || state === 'paused';
  player.button.disabled = state === 'loading';
  player.button.setAttribute('aria-busy', String(state === 'loading'));
  player.label.textContent = state === 'loading' ? 'Cargando video…' : state === 'error' ? 'Volver a intentar' : 'Ver video';
  player.status.textContent = message;
}

function pausePlayer(player: FilmPlayer) {
  // Invalidates any earlier play() promise, including one still waiting on the network.
  player.generation += 1;
  player.video.pause();
  if (player.card.dataset.filmState === 'loading' || player.card.dataset.filmState === 'playing') {
    setState(player, 'paused');
  }
  if (activePlayer === player) activePlayer = null;
}

function activatePlayer(player: FilmPlayer) {
  activePlayer = player;
  for (const other of players) {
    if (other !== player && (other.pending !== null || !other.video.paused || other.card.dataset.filmState === 'loading')) pausePlayer(other);
  }
  // Includes the decorative hero: two different videos should never compete for attention.
  for (const video of document.querySelectorAll<HTMLVideoElement>('video')) {
    if (video !== player.video && !players.some(other => other.video === video)) video.pause();
  }
}

function isCancelledPlay(player: FilmPlayer) {
  return player.pending !== null && player.pending !== player.generation;
}

function failPlayer(player: FilmPlayer) {
  const focusRetry = document.activeElement === player.video || document.activeElement === player.button;
  player.generation += 1;
  player.video.pause();
  player.video.hidden = true;
  if (activePlayer === player) activePlayer = null;
  setState(player, 'error', 'No se pudo cargar el video. Comprueba tu conexión y vuelve a intentarlo.');
  if (focusRetry) player.button.focus({ preventScroll: true });
}

async function startPlayer(player: FilmPlayer) {
  const src = player.video.dataset.videoSrc;
  if (!src) { failPlayer(player); return; }
  const reloadSource = !player.video.hasAttribute('src') || Boolean(player.video.error) || player.card.dataset.filmState === 'error';
  const moveFocusToVideo = document.activeElement === player.button;
  const request = ++player.generation;
  player.pending = request;
  activatePlayer(player);
  setState(player, 'loading', 'Cargando video…');
  player.video.hidden = false;
  player.video.controls = true;
  if (reloadSource) {
    player.video.src = src;
    player.video.load();
  }
  const timeout = window.setTimeout(() => {
    if (request === player.generation && activePlayer === player && player.card.dataset.filmState === 'loading') failPlayer(player);
  }, 30_000);
  try {
    await player.video.play();
    if (request !== player.generation || activePlayer !== player) {
      // Do not pause a newer attempt on this same player when an old promise settles.
      if (activePlayer !== player) player.video.pause();
      return;
    }
    setState(player, 'playing');
    if (moveFocusToVideo) player.video.focus({ preventScroll: true });
  } catch {
    if (request === player.generation && activePlayer === player) failPlayer(player);
  } finally {
    window.clearTimeout(timeout);
    if (player.pending === request) player.pending = null;
  }
}

for (const card of document.querySelectorAll<HTMLElement>('[data-installation-film]')) {
  const video = card.querySelector<HTMLVideoElement>('[data-installation-video]');
  const button = card.querySelector<HTMLButtonElement>('[data-film-play]');
  const label = card.querySelector<HTMLElement>('[data-film-play-label]');
  const status = card.querySelector<HTMLElement>('[data-film-status]');
  if (!video || !button || !label || !status) continue;
  const player: FilmPlayer = { card, video, button, label, status, generation: 0, pending: null };
  players.push(player);
  button.addEventListener('click', () => { void startPlayer(player); });
  video.addEventListener('play', () => {
    if (isCancelledPlay(player)) { video.pause(); return; }
    activatePlayer(player);
  });
  video.addEventListener('playing', () => {
    if (isCancelledPlay(player)) { video.pause(); return; }
    activatePlayer(player);
    setState(player, 'playing');
  });
  video.addEventListener('pause', () => {
    if (card.dataset.filmState === 'playing') setState(player, 'paused');
  });
  video.addEventListener('ended', () => { setState(player, 'paused'); });
  video.addEventListener('error', () => {
    if (video.error?.code !== MediaError.MEDIA_ERR_ABORTED) failPlayer(player);
  });
}

if ('IntersectionObserver' in window) {
  const observer = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (entry.isIntersecting) continue;
      const player = players.find(item => item.video.parentElement === entry.target);
      if (player && (player.card.dataset.filmState === 'loading' || !player.video.paused)) pausePlayer(player);
    }
  });
  for (const player of players) if (player.video.parentElement) observer.observe(player.video.parentElement);
}

function pauseAllFilms() { for (const player of players) pausePlayer(player); }
document.addEventListener('play', event => {
  if (event.target instanceof HTMLVideoElement && !players.some(player => player.video === event.target)) pauseAllFilms();
}, true);
document.addEventListener('visibilitychange', () => { if (document.hidden) pauseAllFilms(); });
window.addEventListener('pagehide', pauseAllFilms);
