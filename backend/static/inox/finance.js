/* Progressive enhancement only: server validation and forms work without JS. */
document.querySelectorAll('[data-finance-company]').forEach((selector) => {
  selector.addEventListener('change', () => {
    const next = new URL(window.location.href);
    next.searchParams.set('company', selector.value);
    window.location.assign(next.toString());
  });
});
const lineList = document.querySelector('[data-finance-lines]');
const lineTemplate = document.querySelector('[data-finance-line-template]');
const addLine = document.querySelector('[data-finance-add-line]');
if (lineList && lineTemplate && addLine) {
  const total = document.querySelector('#id_lines-TOTAL_FORMS');
  const refresh = () => { addLine.disabled = Number(total.value) >= 20; };
  addLine.addEventListener('click', () => {
    const index = Number(total.value);
    if (!Number.isInteger(index) || index >= 20) return;
    const fragment = lineTemplate.content.cloneNode(true);
    fragment.querySelectorAll('[name],[id],[for]').forEach((node) => {
      for (const attribute of ['name', 'id', 'for']) {
        if (node.hasAttribute(attribute)) node.setAttribute(attribute, node.getAttribute(attribute).replaceAll('__prefix__', String(index)));
      }
    });
    const heading = fragment.querySelector('[data-line-number]');
    if (heading) heading.textContent = `Línea ${index + 1}`;
    lineList.append(fragment);
    total.value = String(index + 1);
    refresh();
    lineList.lastElementChild?.querySelector('select,input')?.focus();
  });
  refresh();
}
