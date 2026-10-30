import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const source = ts.transpileModule(readFileSync(new URL('../src/scripts/product-customization.ts', import.meta.url), 'utf8'),
  { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText.replace('export function', 'function');

function fixture() {
  const emitted = [], document = { activeElement: null, dispatchEvent(event) { emitted.push(event.detail); } };
  class Element {
    constructor(tag = 'div', attribute = '') { this.tagName = tag; this.attribute = attribute; this.hidden = false; this.children = []; this.attributes = new Map(); this.events = new Map(); this.textContent = ''; this.value = ''; }
    append(...children) { this.children.push(...children); children.forEach(child => child.parent = this); }
    setAttribute(name, value) { this.attributes.set(name, String(value)); }
    getAttribute(name) { return this.attributes.get(name); }
    querySelectorAll(selector) {
      const [first, ...rest] = selector.split(' ');
      return this.children.flatMap(child => {
        const matches = first === child.tagName || first === `[${child.attribute}]`;
        return [...(matches ? rest.length ? child.querySelectorAll(rest.join(' ')) : [child] : []), ...child.querySelectorAll(selector)];
      });
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    contains(element) { return element === this || this.children.some(child => child.contains(element)); }
    addEventListener(type, callback) { if (!this.events.has(type)) this.events.set(type, []); this.events.get(type).push(callback); }
    emit(type, event = {}) { event.type = type; event.preventDefault = () => event.defaultPrevented = true; this.events.get(type)?.forEach(callback => callback(event)); return event; }
    click() { this.emit('click'); }
    focus() { document.activeElement = this; }
    get options() { return this.children; }
    get selectedOptions() { return this.children.filter(option => option.value === this.value); }
  }
  const make = (attribute, tag = 'div') => new Element(tag, attribute);
  const detail = make('data-product-detail'), root = make('data-product-customization'), panel = make('data-customization-panel');
  const button = make('data-customization-toggle', 'button'), label = make('data-customization-label', 'span'), summary = make('data-customization-selection', 'p');
  const close = make('data-customization-close', 'button'), intro = make('data-customization-intro', 'p'), quote = make('data-product-quote', 'a');
  const family = make('data-product-family'), familySelect = make('data-product-family-select', 'select'), familySelection = make('data-product-family-selection', 'p');
  family.append(familySelect, familySelection);
  const variants = make('data-product-variant', 'select'), cooktop = make('data-cooktop-root'), cart = make('data-cart-root');
  const extras = make('data-product-extras'), extraOptions = make('data-product-extra-options'); extras.append(extraOptions);
  button.append(label); panel.append(close, intro, family, variants, cooktop, cart, extras); root.append(summary, button, panel); detail.append(root, quote);
  [root, panel, family, cooktop, cart, extras].forEach(node => node.hidden = true);
  button.setAttribute('aria-expanded', 'false');
  const context = { document, CustomEvent }; runInNewContext(source, context);
  const option = (value, text) => { const node = new Element('option'); node.value = value; node.textContent = text; return node; };
  return { detail, root, panel, button, label, summary, close, intro, quote, family, familySelect, familySelection, variants, cooktop, cart, extras, extraOptions, emitted, document,
    sync: (id = 'P04', origin = 'manufactured') => context.syncCustomization(detail, id, origin),
    setVariants(value = '') { variants.children = []; variants.append(option('', 'Modelo base'), option('large', '30 litros')); variants.value = value; },
    setFamily() { family.hidden = false; familySelect.append(option('P30', 'Estándar'), option('P31', 'Con base')); familySelection.textContent = 'Con base · Código P31'; },
    addExtra() { extras.hidden = false; extraOptions.append(new Element('input')); },
  };
}

test('no choices means no empty personalization entry, including invalid or missing configuration', () => {
  const f = fixture(); f.sync();
  assert.equal(f.root.hidden, true); assert.equal(f.panel.hidden, true); assert.equal(f.button.getAttribute('aria-expanded'), 'false');
  f.extras.hidden = false; f.sync(); assert.equal(f.root.hidden, true, 'empty additional options are not choices');
  f.setVariants(); f.sync(''); assert.equal(f.root.hidden, true, 'no product identity must not expose controls');
});

test('an imported model opens only from Cambiar versión and keeps its selected version outside the closed panel', () => {
  const f = fixture(); f.setVariants('large'); f.sync('ILUMI-B-30L', 'distributed');
  assert.equal(f.root.hidden, false); assert.equal(f.panel.hidden, true); assert.equal(f.label.textContent, 'Cambiar versión');
  assert.equal(f.summary.textContent, 'Versión seleccionada: 30 litros'); assert.equal(f.summary.hidden, false);
  assert.equal(f.quote.hidden, false);
  f.button.click(); assert.equal(f.panel.hidden, false); assert.equal(f.button.getAttribute('aria-expanded'), 'true');
  assert.equal(f.emitted.at(-1).productId, 'ILUMI-B-30L'); assert.equal(f.emitted.at(-1).open, true);
});

test('a family-only product advertises version switching, while actual manufactured modules or extras advertise personalization', () => {
  const f = fixture(); f.setFamily(); f.sync('P31');
  assert.equal(f.label.textContent, 'Cambiar versión'); assert.equal(f.summary.textContent, 'Con base · Código P31');
  f.cooktop.hidden = false; f.sync(); assert.equal(f.label.textContent, 'Personalizar');
  f.cooktop.hidden = true; f.cart.hidden = false; f.sync('P15'); assert.equal(f.label.textContent, 'Personalizar');
  f.cart.hidden = true; f.addExtra(); f.sync('P15'); assert.equal(f.label.textContent, 'Personalizar');
  f.sync('ILUMI', 'distributed'); assert.equal(f.label.textContent, 'Cambiar versión');
});

test('same-product updates preserve open state and selections without duplicate handlers; close and Escape restore focus', () => {
  const f = fixture(); f.setVariants('large'); f.sync(); f.button.click();
  f.sync(); f.sync(); assert.equal(f.panel.hidden, false); assert.equal(f.variants.value, 'large');
  f.close.click(); assert.equal(f.panel.hidden, true); assert.equal(f.document.activeElement, f.button); assert.equal(f.variants.value, 'large');
  f.button.click(); assert.equal(f.panel.hidden, false, 'multiple renders must not multiply toggle listeners');
  f.variants.focus(); const event = f.panel.emit('keydown', { key: 'Escape' });
  assert.equal(event.defaultPrevented, true); assert.equal(f.panel.hidden, true); assert.equal(f.document.activeElement, f.button);
  f.button.click(); assert.equal(f.variants.value, 'large'); assert.equal(f.emitted.at(-1).open, true);
});

test('a new product starts closed; revoked options remove editing and move focus to a visible action', () => {
  const f = fixture(); f.cooktop.hidden = false; f.sync(); f.button.click(); f.cooktop.focus();
  f.sync('P05'); assert.equal(f.panel.hidden, true); assert.equal(f.document.activeElement, f.button); assert.equal(f.emitted.at(-1).productId, 'P05');
  f.button.click(); f.cooktop.focus(); f.cooktop.hidden = true; f.sync('P05');
  assert.equal(f.root.hidden, true); assert.equal(f.emitted.at(-1).open, false); assert.equal(f.document.activeElement, f.quote);
});
