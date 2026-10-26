// Small DOM helpers. Styles are set through CSSOM only (the CSP blocks style attributes).

export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k === 'style') Object.assign(el.style, v);
    else if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export function clear(el) {
  while (el.firstChild) el.firstChild.remove();
  return el;
}

export const button = (label, onClick, opts = {}) =>
  h('button', { type: 'button', class: opts.class || 'btn', onClick, 'aria-label': opts.aria, disabled: opts.disabled, 'aria-pressed': opts.pressed }, label);

// The one polite live region: card results, "Saved", and so on.
export function announce(text) {
  const live = document.getElementById('live');
  if (!live) return;
  live.textContent = '';
  setTimeout(() => {
    live.textContent = text;
  }, 50);
}

// A screen: heading, scrolling body, and a footer of actions in the bottom third.
export function screen({ title, back, backLabel = 'Back', actions = [], body = [], footer = [], footerClass = '', className = '' }) {
  const head = h(
    'header',
    { class: 'bar' },
    back ? button(backLabel, back, { class: 'btn link back' }) : null,
    h('h1', { tabindex: '-1' }, title),
    h('div', { class: 'bar-actions' }, actions),
  );
  return h('div', { class: `screen ${className}` }, head, h('main', { class: 'body' }, body), footer.length ? h('footer', { class: `foot ${footerClass}` }, footer) : null);
}

export function focusHeading(root) {
  const h1 = root.querySelector('h1');
  if (h1) h1.focus({ preventScroll: true });
}

export const num = (n) => Math.round(n).toLocaleString('en-GB');
export const plural = (n, one, many = one + 's') => `${num(n)} ${n === 1 ? one : many}`;
