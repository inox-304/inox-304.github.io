import { categories } from '../data/categories';
import { catalogStateUrl, catalogStatus, compareCatalogItems, matchesCatalogSearch, readCatalogState, type CatalogState } from '../lib/catalog-controls';

const grid = document.querySelector<HTMLElement>('#catalog-results');
const search = document.querySelector<HTMLInputElement>('#catalog-search');
const order = document.querySelector<HTMLSelectElement>('#catalog-order');
const buttons = [...document.querySelectorAll<HTMLButtonElement>('[data-filter]')];
let state: CatalogState = readCatalogState(new URLSearchParams(location.search));

function render(updateUrl = true) {
  if (!grid) return;
  const cards = [...grid.querySelectorAll<HTMLElement>('.product-card')];
  const status = catalogStatus(grid.dataset.catalogMode === 'api', document.documentElement.dataset.cmsState, cards.length);
  const matchingSearch = cards.filter(card => matchesCatalogSearch(card.dataset.name || '', state.query));
  const matches = new Set(matchingSearch.filter(card => state.category === 'todos' || card.dataset.category === state.category));
  cards.forEach(card => { card.hidden = !matches.has(card); });
  const sorted = [...cards].sort((a, b) => compareCatalogItems(
    { name: a.dataset.title || '', order: Number(a.dataset.catalogOrder || 0) },
    { name: b.dataset.title || '', order: Number(b.dataset.catalogOrder || 0) }, state.order,
  ));
  // Avoid detaching focused links or moving every card on ordinary keystrokes.
  if (sorted.some((card, index) => card !== cards[index])) sorted.forEach(card => grid.append(card));
  buttons.forEach(button => {
    const selected = button.dataset.filter === state.category;
    button.classList.toggle('active', selected);
    button.setAttribute('aria-pressed', String(selected));
    const count = button.querySelector<HTMLElement>('[data-filter-count]');
    if (count) count.textContent = String(button.dataset.filter === 'todos' ? matchingSearch.length : matchingSearch.filter(card => card.dataset.category === button.dataset.filter).length);
  });
  const label = categories.find(category => category.id === state.category)?.name || 'Todos los equipos';
  const heading = document.querySelector('#catalog-heading'); if (heading) heading.textContent = label;
  const counter = document.querySelector('#result-count');
  if (counter) counter.textContent = status === 'loading' ? 'Cargando catálogo…' : status === 'unavailable' ? 'No se pudo cargar el catálogo' : `${matches.size} ${matches.size === 1 ? 'equipo' : 'equipos'}${state.query.trim() ? ` para «${state.query.trim()}»` : ''}`;
  grid.setAttribute('aria-busy', String(status === 'loading'));
  const empty = document.querySelector<HTMLElement>('#catalog-empty'); if (empty) empty.hidden = status !== 'ready' || matches.size > 0;
  const loading = document.querySelector<HTMLElement>('#catalog-loading'); if (loading) loading.hidden = status !== 'loading';
  const unavailable = document.querySelector<HTMLElement>('#catalog-unavailable'); if (unavailable) unavailable.hidden = status !== 'unavailable';
  const reset = document.querySelector<HTMLButtonElement>('#clear-catalog'); if (reset) reset.hidden = state.category === 'todos' && !state.query.trim();
  if (updateUrl) history.replaceState({}, '', catalogStateUrl(location.href, state));
}

function readUrl() {
  state = readCatalogState(new URLSearchParams(location.search));
  if (search) search.value = state.query;
  if (order) order.value = state.order;
  render(false);
}
function reset() {
  state.category = 'todos'; state.query = '';
  if (search) search.value = '';
  render(); search?.focus();
}
buttons.forEach(button => button.addEventListener('click', () => {
  state.category = readCatalogState(new URLSearchParams({ categoria: button.dataset.filter || '' })).category;
  render();
}));
search?.addEventListener('input', () => { state.query = search.value; render(); });
order?.addEventListener('change', () => { state.order = order.value === 'nombre' ? 'nombre' : 'catalogo'; render(); });
document.querySelector('.catalog-tools')?.addEventListener('submit', event => { event.preventDefault(); render(); });
document.querySelectorAll('[data-catalog-reset]').forEach(button => button.addEventListener('click', reset));
document.querySelector('#retry-catalog')?.addEventListener('click', () => document.dispatchEvent(new Event('inox:catalog-refresh')));
window.addEventListener('popstate', readUrl);
document.addEventListener('inox:catalog-updated', () => render(false));
new MutationObserver(() => render(false)).observe(document.documentElement, { attributes: true, attributeFilter: ['data-cms-state'] });
readUrl();
