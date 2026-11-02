/** A continuous showcase using real cards only, with no duplicated interactive content. */
document.querySelectorAll<HTMLElement>('[data-featured-rail]').forEach(root => {
  if (root.dataset.featuredReady) return;
  root.dataset.featuredReady = 'true';
  const viewport = root.querySelector<HTMLElement>('[data-featured-viewport]');
  const track = root.querySelector<HTMLElement>('[data-cms-products="home-featured"]');
  const pause = root.querySelector<HTMLButtonElement>('[data-featured-pause]');
  const prev = root.querySelector<HTMLButtonElement>('[data-featured-prev]');
  const next = root.querySelector<HTMLButtonElement>('[data-featured-next]');
  if (!viewport || !track || !pause || !prev || !next) return;
  const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let userPaused = motion.matches;
  let focused = false, touching = false, inView = false, pageSuspended = false;
  let keyboardNavigation = true;
  let stride = 0, canMove = false, frame = 0, previousTime = 0, position = viewport.scrollLeft;
  let manualUntil = 0;
  function updateButton() {
    pause!.setAttribute('aria-pressed', String(userPaused));
    pause!.setAttribute('aria-label', userPaused ? 'Reanudar movimiento de destacados' : 'Pausar movimiento de destacados');
    const label = pause!.querySelector('[data-featured-pause-label]');
    if (label) label.textContent = userPaused ? 'Reanudar' : 'Pausar';
    pause!.disabled = prev!.disabled = next!.disabled = !canMove;
  }
  function stop() { if (frame) cancelAnimationFrame(frame); frame = 0; previousTime = 0; root.dataset.featuredMotion = 'paused'; }
  function allowed() { return canMove && !userPaused && !focused && !touching && inView && !document.hidden && !pageSuspended; }
  function tick(time: number) {
    frame = 0;
    if (!allowed()) return;
    if (time >= manualUntil) {
      const delta = previousTime ? Math.min(64, time - previousTime) : 0;
      position += delta * .025;
      while (position >= stride && track!.children.length > 1) {
        track!.append(track!.firstElementChild!);
        position -= stride;
      }
      viewport!.scrollLeft = position;
    } else position = viewport!.scrollLeft;
    previousTime = time;
    frame = requestAnimationFrame(tick);
  }
  function resume() {
    root.dataset.featuredMotion = allowed() ? 'playing' : 'paused';
    if (!allowed()) { stop(); return; }
    if (!frame) { position = viewport!.scrollLeft; previousTime = 0; frame = requestAnimationFrame(tick); }
  }
  function measure() {
    const cards = track!.children;
    stride = cards.length > 1 ? (cards[1] as HTMLElement).offsetLeft - (cards[0] as HTMLElement).offsetLeft : 0;
    canMove = stride > 0 && viewport!.scrollWidth > viewport!.clientWidth + 2;
    updateButton(); resume();
  }
  function manual(direction: number) {
    stop();
    if (!canMove) return;
    if (direction < 0 && viewport!.scrollLeft < stride) {
      track!.prepend(track!.lastElementChild!);
      viewport!.scrollLeft += stride;
    } else if (direction > 0 && viewport!.scrollLeft + stride > viewport!.scrollWidth - viewport!.clientWidth) {
      track!.append(track!.firstElementChild!);
      viewport!.scrollLeft = Math.max(0, viewport!.scrollLeft - stride);
    }
    viewport!.scrollBy({ left: direction * stride, behavior: motion.matches ? 'instant' : 'smooth' });
    manualUntil = performance.now() + 1000;
    position = viewport!.scrollLeft;
    resume();
  }
  pause.addEventListener('click', () => { userPaused = !userPaused; updateButton(); resume(); });
  prev.addEventListener('click', () => manual(-1)); next.addEventListener('click', () => manual(1));
  // A stationary pointer over this full-width section must not freeze the showcase.
  // Pause for deliberate interaction instead; keyboard readers keep stable cards,
  // while focusing the pause/arrow controls never prevents explicit resumption.
  document.addEventListener('keydown', event => { if (event.key === 'Tab') keyboardNavigation = true; });
  root.addEventListener('pointerdown', () => { keyboardNavigation = false; focused = false; resume(); }, { passive: true });
  const syncFocus = () => { focused = keyboardNavigation && viewport.contains(document.activeElement); resume(); };
  root.addEventListener('focusin', syncFocus);
  root.addEventListener('focusout', () => { queueMicrotask(syncFocus); });
  viewport.addEventListener('keydown', () => { keyboardNavigation = true; syncFocus(); });
  viewport.addEventListener('pointerdown', () => { touching = true; resume(); }, { passive: true });
  const release = () => { if (!touching) return; touching = false; manualUntil = performance.now() + 1000; position = viewport.scrollLeft; resume(); };
  document.addEventListener('pointerup', release, { passive: true }); document.addEventListener('pointercancel', release, { passive: true });
  viewport.addEventListener('wheel', event => {
    if (Math.abs(event.deltaX) > Math.abs(event.deltaY) || event.shiftKey) {
      manualUntil = performance.now() + 1000; position = viewport.scrollLeft;
    }
  }, { passive: true });
  document.addEventListener('visibilitychange', resume);
  window.addEventListener('pagehide', () => { pageSuspended = true; stop(); });
  window.addEventListener('pageshow', () => {
    pageSuspended = false;
    // Going back from a product restores the user's choice, not a new forced pause.
    resume();
  });
  motion.addEventListener('change', () => { userPaused = motion.matches; updateButton(); resume(); });
  new IntersectionObserver(entries => { inView = entries.some(entry => entry.isIntersecting); resume(); }, { threshold: .05 }).observe(root);
  new ResizeObserver(measure).observe(viewport);
  // CMS owns the card list. Its event runs once after replacement, avoiding observers
  // that would mistake our own harmless node rotations for catalog updates.
  document.addEventListener('inox:catalog-updated', () => { stop(); viewport.scrollLeft = 0; position = 0; measure(); });
  measure();
});
