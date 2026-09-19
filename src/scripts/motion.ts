/** Progressive motion: visible markup is the default, even if this module fails. */
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const precisePointer = window.matchMedia('(hover: hover) and (pointer: fine)');
const activeAnimations = new Map<HTMLElement, Animation>();
const enteredElements = new WeakSet<HTMLElement>();
const observedElements = new WeakSet<HTMLElement>();
const easeOut = 'cubic-bezier(.22, 1, .36, 1)';

function reveal(element: HTMLElement, order = 0) {
  if (reducedMotion.matches || element.hidden || typeof element.animate !== 'function') return;
  activeAnimations.get(element)?.cancel();
  const animation = element.animate(
    [{ opacity: .7, translate: '0 16px' }, { opacity: 1, translate: '0 0' }],
    { duration: 480, delay: Math.min(order, 3) * 40, easing: easeOut },
  );
  activeAnimations.set(element, animation);
  animation.onfinish = animation.oncancel = () => {
    if (activeAnimations.get(element) === animation) activeAnimations.delete(element);
  };
}

function staggerOrder(element: HTMLElement) {
  const siblings = element.parentElement?.children;
  if (!siblings || siblings.length < 2) return 0;
  if (element.parentElement?.matches('.product-grid, .process-grid, .services-grid, .installation-grid, .hero-copy')) {
    return Array.from(siblings).indexOf(element) % (element.parentElement.matches('.hero-copy') ? 4 : 3);
  }
  return 0;
}

const revealSelector = [
  '.hero-copy > .eyebrow', '.hero-copy > h1', '.hero-copy > p', '.hero-actions',
  '.section-heading', '.category-links', '.product-card', '.process-card', '.service-card', '.installation-card',
  '.installation-intro', '.service-list',
  '.custom-content > .eyebrow', '.custom-content > h2', '.custom-content > p',
  '.collection-bottom', '.sector-line', '.contact-band > .shell', '.catalog-help',
  '.product-detail-photo', '.product-detail-copy', '.contact-info', '.quote-form',
].join(', ');

// Nothing is hidden while waiting for intersection. Filtered cards can enter later.
const entranceObserver = 'IntersectionObserver' in window ? new IntersectionObserver(entries => {
  entries.forEach(entry => {
    const element = entry.target as HTMLElement;
    if (!entry.isIntersecting || element.hidden) return;
    enteredElements.add(element);
    entranceObserver?.unobserve(element);
    reveal(element, staggerOrder(element));
  });
}, { threshold: .06, rootMargin: '0px 0px -24px 0px' }) : null;

function observeEntrances() {
  if (!entranceObserver) return;
  document.querySelectorAll<HTMLElement>(revealSelector).forEach(element => {
    if (enteredElements.has(element) || observedElements.has(element)) return;
    observedElements.add(element);
    entranceObserver.observe(element);
  });
}
observeEntrances();
document.addEventListener('inox:catalog-updated', observeEntrances);

// Only newly restored cards animate after filtering; hidden cards never retain styles.
const results = document.querySelector('#catalog-results');
if (results) {
  new MutationObserver(records => {
    let order = 0;
    const restored = new Set<HTMLElement>();
    records.forEach(record => {
      const card = record.target;
      if (!(card instanceof HTMLElement) || !card.matches('.product-card')) return;
      if (card.hidden) {
        activeAnimations.get(card)?.cancel();
      } else if (record.oldValue !== null) {
        restored.add(card);
      }
    });
    restored.forEach(card => {
      const bounds = card.getBoundingClientRect();
      if (bounds.bottom > 0 && bounds.top < window.innerHeight - 24) {
        entranceObserver?.unobserve(card);
        enteredElements.add(card);
        reveal(card, order++ % 3);
      } else if (!enteredElements.has(card)) {
        entranceObserver?.observe(card);
      }
    });
  }).observe(results, { subtree: true, attributes: true, attributeFilter: ['hidden'], attributeOldValue: true });
}

// A maximum 3px of attraction makes large CTAs feel tactile without moving targets away.
let activeControl: HTMLElement | null = null;
let controlBounds: DOMRect | null = null;
let pointerX = 0;
let pointerY = 0;
let pointerFrame = 0;

function resetControl() {
  if (pointerFrame) window.cancelAnimationFrame(pointerFrame);
  pointerFrame = 0;
  activeControl?.style.removeProperty('--motion-x');
  activeControl?.style.removeProperty('--motion-y');
  activeControl = null;
  controlBounds = null;
}

function updateControl() {
  pointerFrame = 0;
  if (!activeControl || !controlBounds) return;
  const x = (pointerX - controlBounds.left - controlBounds.width / 2) / (controlBounds.width / 2);
  const y = (pointerY - controlBounds.top - controlBounds.height / 2) / (controlBounds.height / 2);
  activeControl.style.setProperty('--motion-x', `${Math.max(-3, Math.min(3, x * 3)).toFixed(2)}px`);
  activeControl.style.setProperty('--motion-y', `${Math.max(-2, Math.min(2, y * 2)).toFixed(2)}px`);
}

document.querySelectorAll<HTMLElement>('.hero-actions .button, .custom-content .button, .circle-cta').forEach(control => {
  control.addEventListener('pointerenter', event => {
    if (reducedMotion.matches || !precisePointer.matches || event.pointerType !== 'mouse') return;
    resetControl();
    activeControl = control;
    controlBounds = control.getBoundingClientRect();
  });
  control.addEventListener('pointermove', event => {
    if (activeControl !== control || !controlBounds) return;
    pointerX = event.clientX;
    pointerY = event.clientY;
    if (!pointerFrame) pointerFrame = window.requestAnimationFrame(updateControl);
  });
  control.addEventListener('pointerleave', resetControl);
  control.addEventListener('pointerdown', resetControl);
  control.addEventListener('blur', resetControl);
});

window.addEventListener('scroll', resetControl, { passive: true });
window.addEventListener('resize', resetControl, { passive: true });
window.addEventListener('blur', resetControl);
precisePointer.addEventListener('change', resetControl);
reducedMotion.addEventListener('change', () => {
  resetControl();
  if (reducedMotion.matches) {
    activeAnimations.forEach(animation => animation.cancel());
    activeAnimations.clear();
  }
});

export {};
