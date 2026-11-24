import { esc } from './util.js';
import { icon } from './icons.js';

// Pilha de sobreposições (para o botão voltar do Android fechar a de cima)
const stack = [];

export function pushOverlay(close) {
  stack.push(close);
}
export function popOverlay(close) {
  const i = stack.lastIndexOf(close);
  if (i >= 0) stack.splice(i, 1);
}
export function closeTopOverlay() {
  const close = stack[stack.length - 1];
  if (!close) return false;
  close();
  return true;
}
export const hasOverlay = () => stack.length > 0;

function mount(html, cls) {
  const el = document.createElement('div');
  el.className = 'overlay ' + cls;
  el.innerHTML = html;
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  return el;
}

function unmount(el) {
  el.classList.remove('show');
  setTimeout(() => el.remove(), 220);
}

// Menu de ações na parte de baixo da tela
export function actionSheet({ title, items }) {
  return new Promise((resolve) => {
    const el = mount(
      `<div class="backdrop" data-x></div>
       <div class="sheet" role="menu">
         ${title ? `<div class="sheet-title">${esc(title)}</div>` : ''}
         ${items
           .map((it, i) =>
             it.divider
               ? '<div class="sheet-div"></div>'
               : `<button class="sheet-item ${it.danger ? 'danger' : ''} ${it.active ? 'active' : ''}" data-i="${i}">
                    ${it.color ? `<span class="dot" style="background:${it.color}"></span>` : it.icon ? icon(it.icon) : ''}
                    <span>${esc(it.label)}</span>
                    ${it.active ? icon('check', 18, 'right') : ''}
                  </button>`,
           )
           .join('')}
         <button class="sheet-item cancel" data-x>Cancelar</button>
       </div>`,
      'sheet-wrap',
    );
    const done = (v) => {
      popOverlay(close);
      unmount(el);
      resolve(v);
    };
    const close = () => done(null);
    pushOverlay(close);
    el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-i]');
      if (b) return done(items[+b.dataset.i].value ?? items[+b.dataset.i].label);
      if (e.target.closest('[data-x]')) close();
    });
  });
}

// Caixa de diálogo genérica: confirmação ou campo de texto
export function dialog({ title, message, input, value = '', placeholder = '', multiline = false, ok = 'OK', cancel = 'Cancelar', danger = false, type = 'text' }) {
  return new Promise((resolve) => {
    const field = input
      ? multiline
        ? `<textarea class="input" rows="4" placeholder="${esc(placeholder)}">${esc(value)}</textarea>`
        : `<input class="input" type="${type}" value="${esc(value)}" placeholder="${esc(placeholder)}" autocomplete="off">`
      : '';
    const el = mount(
      `<div class="backdrop" data-x></div>
       <form class="dialog">
         ${title ? `<h3>${esc(title)}</h3>` : ''}
         ${message ? `<p class="muted">${esc(message)}</p>` : ''}
         ${field}
         <div class="dialog-actions">
           ${cancel ? `<button type="button" class="btn ghost" data-x>${esc(cancel)}</button>` : ''}
           <button type="submit" class="btn ${danger ? 'danger' : 'primary'}">${esc(ok)}</button>
         </div>
       </form>`,
      'dialog-wrap',
    );
    const f = el.querySelector('.input');
    if (f) setTimeout(() => { f.focus(); if (f.select) f.select(); }, 60);
    const done = (v) => {
      popOverlay(close);
      unmount(el);
      resolve(v);
    };
    const close = () => done(input ? null : false);
    pushOverlay(close);
    el.querySelector('form').addEventListener('submit', (e) => {
      e.preventDefault();
      done(input ? f.value : true);
    });
    el.addEventListener('click', (e) => {
      if (e.target.closest('[data-x]')) close();
    });
  });
}

export const confirmDialog = (title, message, ok = 'Confirmar', danger = true) =>
  dialog({ title, message, ok, danger });
export const promptDialog = (title, value = '', placeholder = '', opts = {}) =>
  dialog({ title, input: true, value, placeholder, ok: 'Salvar', ...opts });

let toastEl = null;
let toastTimer = null;
export function toast(msg, action) {
  if (!toastEl) {
    toastEl = document.createElement('div');
    toastEl.className = 'toast';
    document.body.appendChild(toastEl);
  }
  toastEl.innerHTML = `<span>${esc(msg)}</span>${action ? `<button>${esc(action.label)}</button>` : ''}`;
  if (action) toastEl.querySelector('button').onclick = () => { action.run(); hide(); };
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  const hide = () => toastEl.classList.remove('show');
  toastTimer = setTimeout(hide, action ? 5000 : 2600);
}

// Painel em tela cheia (detalhe do cartão, busca etc.)
export function fullPanel(cls, onClose) {
  const el = mount('', 'panel-wrap ' + cls);
  const close = () => {
    popOverlay(close);
    unmount(el);
    onClose?.();
  };
  pushOverlay(close);
  return { el, close };
}
