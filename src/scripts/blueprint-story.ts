const root = document.querySelector<HTMLElement>('[data-blueprint-story]');
if (root) {
  const view = root.querySelector<HTMLElement>('[data-blueprint-view]');
  const range = root.querySelector<HTMLInputElement>('[data-blueprint-range]');
  const toggle = root.querySelector<HTMLButtonElement>('[data-blueprint-toggle]');
  if (view && range && toggle) {
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const saveData = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData;
    let playing = !motion.matches && !saveData;
    let visible = false;
    let pageSuspended = false;
    let frameId = 0;
    let previous = 0;
    let phase = Math.PI / 2;
    function paint(value: number) {
      const percentage = Math.max(0, Math.min(100, value));
      view!.style.setProperty('--built', `${percentage.toFixed(2)}%`);
      range!.value = String(Math.round(percentage));
      range!.setAttribute('aria-valuetext', `${Math.round(percentage)} % de cocina terminada`);
    }
    function updateButton() {
      toggle!.textContent = playing ? 'Pausar transformación' : 'Reproducir transformación';
      toggle!.setAttribute('aria-pressed', String(playing));
    }
    function frame(now: number) {
      frameId = 0;
      if (!playing || !visible || document.hidden || pageSuspended) { previous = 0; return; }
      if (previous) phase += Math.min(now - previous, 80) * Math.PI * 2 / 18000;
      previous = now;
      paint(50 - 50 * Math.cos(phase));
      frameId = requestAnimationFrame(frame);
    }
    function sync() {
      updateButton();
      cancelAnimationFrame(frameId); frameId = 0; previous = 0;
      if (playing && visible && !document.hidden && !pageSuspended) frameId = requestAnimationFrame(frame);
    }
    function pause() { playing = false; sync(); }
    toggle.addEventListener('click', () => { playing = !playing; sync(); });
    range.addEventListener('pointerdown', pause);
    range.addEventListener('focus', pause);
    range.addEventListener('input', () => {
      pause();
      const value = Number(range.value);
      phase = Math.acos(1 - value / 50);
      paint(value);
    });
    motion.addEventListener('change', () => { if (motion.matches) pause(); });
    document.addEventListener('visibilitychange', sync);
    window.addEventListener('pagehide', () => { pageSuspended = true; cancelAnimationFrame(frameId); frameId = 0; previous = 0; });
    window.addEventListener('pageshow', event => {
      pageSuspended = false;
      // A restored page keeps its last comparison instead of restarting motion.
      if (event.persisted) playing = false;
      sync();
    });
    const observer = new IntersectionObserver(entries => { visible = entries[0]?.isIntersecting || false; sync(); }, { threshold: .15 });
    observer.observe(view);
    paint(Number(range.value)); updateButton();
  }
}
