import { categories } from '../data/categories';
import { catalogStateUrl, catalogStatus, compareCatalogItems, matchesCatalogSearch, readCatalogState, sameCatalogQuery, type CatalogState } from '../lib/catalog-controls';
import { catalogTypes, catalogTypeById } from '../lib/catalog-taxonomy';

const grid = document.querySelector<HTMLElement>('#catalog-results');
const search = document.querySelector<HTMLInputElement>('#catalog-search');
const order = document.querySelector<HTMLSelectElement>('#catalog-order');
const buttons = [...document.querySelectorAll<HTMLButtonElement>('[data-filter]')];
const quickSearches = [...document.querySelectorAll<HTMLButtonElement>('[data-search-query]')];
const clearQuery = document.querySelector<HTMLButtonElement>('#clear-search-query');
const linePanel = document.querySelector<HTMLElement>('#catalog-line-panel');
const typeGrid = document.querySelector<HTMLElement>('[data-catalog-types]');
let state: CatalogState = readCatalogState(new URLSearchParams(location.search));
let expandedCategory: string | null = state.category === 'todos' ? null : state.category;
let panelSignature = '';

function renderLinePanel(cards: HTMLElement[], matchingSearch: HTMLElement[]) {
  if (!linePanel || !typeGrid) return;
  const category = categories.find(item => item.id === expandedCategory);
  linePanel.hidden = !category;
  if (!category) return;
  const allInLine = cards.filter(card => card.dataset.category === category.id);
  const matchingInLine = matchingSearch.filter(card => card.dataset.category === category.id);
  const title = linePanel.querySelector<HTMLElement>('#catalog-line-title');
  if (title) title.textContent = category.name;
  const signature = JSON.stringify([category.id, allInLine.map(card => [card.dataset.productType, card.querySelector('img')?.getAttribute('src')]), matchingInLine.map(card => card.dataset.productType)]);
  if (signature !== panelSignature) {
    panelSignature = signature;
    const options = catalogTypes.filter(type => type.category === category.id && allInLine.some(card => card.dataset.productType === type.id));
    const nodes = options.map(type => {
      const sample = allInLine.find(card => card.dataset.productType === type.id)!;
      const button = document.createElement('button'); button.type = 'button'; button.className = 'catalog-type'; button.dataset.catalogType = type.id;
      button.setAttribute('aria-controls', 'catalog-results');
      const sourceImage = sample.querySelector<HTMLImageElement>('img');
      if (sourceImage?.getAttribute('src')) {
        const image = document.createElement('img'); image.src = sourceImage.getAttribute('src')!; image.alt = ''; image.width = 64; image.height = 64; image.decoding = 'async'; image.loading = 'lazy';
        button.append(image);
      }
      const copy = document.createElement('span'); copy.className = 'catalog-type-copy';
      const label = document.createElement('span'); label.className = 'catalog-type-label'; label.textContent = type.label;
      const count = matchingInLine.filter(card => card.dataset.productType === type.id).length;
      const caption = document.createElement('span'); caption.className = 'catalog-type-count'; caption.textContent = `${count} ${count === 1 ? 'opción' : 'opciones'}`;
      copy.append(label, caption); button.append(copy); button.disabled = count === 0;
      button.addEventListener('click', () => { state.type = type.id; render(); });
      return button;
    });
    typeGrid.replaceChildren(...nodes);
    if (!nodes.length) {
      const empty = document.createElement('p'); empty.className = 'catalog-types-pending'; empty.textContent = allInLine.length ? 'Explora todos los equipos de esta línea.' : 'Los tipos aparecerán al cargar los equipos de esta línea.';
      typeGrid.append(empty);
    }
    const cover = linePanel.querySelector<HTMLImageElement>('[data-line-cover]');
    const source = allInLine[0]?.querySelector<HTMLImageElement>('img')?.getAttribute('src');
    if (cover) { cover.hidden = !source; if (source) cover.src = source; else cover.removeAttribute('src'); }
    const name = linePanel.querySelector<HTMLElement>('[data-line-name]'); if (name) name.textContent = category.name;
    const count = linePanel.querySelector<HTMLElement>('[data-line-count]'); if (count) count.textContent = `${matchingInLine.length} ${matchingInLine.length === 1 ? 'opción' : 'opciones'}`;
  }
  typeGrid.querySelectorAll<HTMLButtonElement>('[data-catalog-type]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.catalogType === state.type)));
  const all = linePanel.querySelector<HTMLButtonElement>('[data-line-all]');
  all?.setAttribute('aria-pressed', String(!state.type));
}

function closeLinePanel() {
  const previous = expandedCategory;
  expandedCategory = null; render(false);
  buttons.find(button => button.dataset.filter === previous)?.focus();
}

function render(updateUrl = true) {
  if (!grid) return;
  const cards = [...grid.querySelectorAll<HTMLElement>('.product-card')];
  const status = catalogStatus(grid.dataset.catalogMode === 'api', document.documentElement.dataset.cmsState, cards.length);
  const matchingSearch = cards.filter(card => matchesCatalogSearch(card.dataset.name || '', state.query));
  const matches = new Set(matchingSearch.filter(card => (state.category === 'todos' || card.dataset.category === state.category) && (!state.type || card.dataset.productType === state.type)));
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
    if (button.dataset.filter !== 'todos') button.setAttribute('aria-expanded', String(button.dataset.filter === expandedCategory));
    const count = button.querySelector<HTMLElement>('[data-filter-count]');
    if (count) count.textContent = String(button.dataset.filter === 'todos' ? matchingSearch.length : matchingSearch.filter(card => card.dataset.category === button.dataset.filter).length);
  });
  renderLinePanel(cards, matchingSearch);
  const label = catalogTypeById(state.type || '', state.category)?.label || categories.find(category => category.id === state.category)?.name || 'Todos los equipos';
  const heading = document.querySelector('#catalog-heading'); if (heading) heading.textContent = label;
  const counter = document.querySelector('#result-count');
  const result = status === 'loading' ? 'Cargando catálogo…' : status === 'unavailable' ? 'No se pudo cargar el catálogo' : `${matches.size} ${matches.size === 1 ? 'opción' : 'opciones'}${state.query.trim() ? ` para «${state.query.trim()}»` : ''}`;
  if (counter) counter.textContent = result;
  const feedback = document.querySelector('#catalog-search-feedback');
  if (feedback) feedback.textContent = result;
  if (clearQuery) clearQuery.hidden = !state.query;
  quickSearches.forEach(button => button.setAttribute('aria-pressed', String(sameCatalogQuery(state.query, button.dataset.searchQuery || ''))));
  grid.setAttribute('aria-busy', String(status === 'loading'));
  const empty = document.querySelector<HTMLElement>('#catalog-empty'); if (empty) empty.hidden = status !== 'ready' || matches.size > 0;
  const loading = document.querySelector<HTMLElement>('#catalog-loading'); if (loading) loading.hidden = status !== 'loading';
  const unavailable = document.querySelector<HTMLElement>('#catalog-unavailable'); if (unavailable) unavailable.hidden = status !== 'unavailable';
  const reset = document.querySelector<HTMLButtonElement>('#clear-catalog'); if (reset) reset.hidden = state.category === 'todos' && !state.query.trim();
  if (updateUrl) history.replaceState({}, '', catalogStateUrl(location.href, state));
}

function readUrl() {
  state = readCatalogState(new URLSearchParams(location.search));
  expandedCategory = state.category === 'todos' ? null : state.category;
  if (search) search.value = state.query;
  if (order) order.value = state.order;
  render(false);
}
function reset() {
  state.category = 'todos'; state.query = ''; state.type = undefined; expandedCategory = null;
  if (search) search.value = '';
  render(); search?.focus();
}
function clearSearch() {
  state.query = ''; if (search) search.value = '';
  render(); search?.focus();
}
function updateQuery() {
  if (!search) return;
  state.query = search.value.slice(0, 160); render();
}
function focusSearchFromHash() {
  if (location.hash === '#catalog-search') search?.focus();
}
buttons.forEach(button => button.addEventListener('click', () => {
  const category = readCatalogState(new URLSearchParams({ categoria: button.dataset.filter || '' })).category;
  if (category !== state.category) state.type = undefined;
  state.category = category;
  expandedCategory = category === 'todos' || expandedCategory === category ? null : category;
  render();
}));
linePanel?.querySelector('[data-line-close]')?.addEventListener('click', closeLinePanel);
linePanel?.querySelector('[data-line-all]')?.addEventListener('click', () => { state.type = undefined; render(); });
linePanel?.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); closeLinePanel(); } });
search?.addEventListener('input', event => { if (!(event as InputEvent).isComposing) updateQuery(); });
search?.addEventListener('compositionend', updateQuery);
search?.addEventListener('keydown', event => {
  if (event.key === 'Escape' && !event.isComposing && state.query) { event.preventDefault(); clearSearch(); }
});
clearQuery?.addEventListener('click', clearSearch);
quickSearches.forEach(button => button.addEventListener('click', () => {
  state.category = 'todos'; state.query = (button.dataset.searchQuery || '').slice(0, 160); state.type = undefined; expandedCategory = null;
  if (search) search.value = state.query;
  render(); search?.focus();
}));
order?.addEventListener('change', () => { state.order = order.value === 'nombre' ? 'nombre' : 'catalogo'; render(); });
document.querySelector('.catalog-tools')?.addEventListener('submit', event => {
  event.preventDefault(); updateQuery();
  const heading = document.querySelector<HTMLElement>('#catalog-heading');
  heading?.focus({ preventScroll: true }); heading?.scrollIntoView({ block: 'start' });
});
document.querySelectorAll('[data-catalog-reset]').forEach(button => button.addEventListener('click', reset));
document.querySelector('#retry-catalog')?.addEventListener('click', () => document.dispatchEvent(new Event('inox:catalog-refresh')));
window.addEventListener('popstate', readUrl);
window.addEventListener('hashchange', focusSearchFromHash);
document.addEventListener('keydown', event => {
  const target = event.target as HTMLElement | null;
  if (event.key !== '/' || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.isComposing || event.defaultPrevented
    || target?.closest?.('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="combobox"]')
    || document.querySelector('dialog[open], [aria-modal="true"]')) return;
  event.preventDefault(); search?.focus();
});
document.addEventListener('inox:catalog-updated', () => render(false));
new MutationObserver(() => render(false)).observe(document.documentElement, { attributes: true, attributeFilter: ['data-cms-state'] });
readUrl();
focusSearchFromHash();
