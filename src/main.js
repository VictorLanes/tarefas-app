import { Capacitor, SystemBars, SystemBarsStyle } from '@capacitor/core';
import { App } from '@capacitor/app';
import { Haptics, ImpactStyle } from '@capacitor/haptics';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import Sortable from 'sortablejs';

import * as auth from './auth.js';
import { store, PRIORITIES, REMINDERS, REPEATS, BOARD_COLORS, LABEL_COLORS } from './store.js';
import * as notify from './notify.js';
import { getJSON, setJSON, removeKey } from './storage.js';
import { icon } from './icons.js';
import { actionSheet, dialog, confirmDialog, promptDialog, toast, fullPanel, closeTopOverlay, hasOverlay } from './overlays.js';
import { esc, richText, fmtDue, fmtDayHeader, fmtTime, fmtDateTime, relTime, dueState, toInputValue, fromInputValue, startOfDay, uid } from './util.js';

const APP_VERSION = '1.0.0';
const native = Capacitor.isNativePlatform();
const $app = document.getElementById('app');

const state = {
  user: null,
  tab: 'boards', // boards | agenda | history | settings
  boardId: null,
  filter: { q: '', priority: 0, label: '', due: '' },
  showFilter: false,
  historyBoard: '',
  agendaShowDone: false,
  authMode: 'login',
};

let sortables = [];
let pendingOpenCard = null;
const haptic = () => native && Haptics.impact({ style: ImpactStyle.Light }).catch(() => {});

// ======================================================================
// Tema
// ======================================================================
function applyTheme() {
  const pref = state.user ? store.settings.theme : localStorage.getItem('theme') || 'system';
  const dark = pref === 'dark' || (pref === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  localStorage.setItem('theme', pref);
  if (native) SystemBars.setStyle({ style: dark ? SystemBarsStyle.Dark : SystemBarsStyle.Light }).catch(() => {});
}
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);

// ======================================================================
// Render principal
// ======================================================================
function render() {
  destroySortables();
  if (!state.user) return renderAuth();
  if (state.boardId && store.board(state.boardId)) return renderBoard();
  state.boardId = null;
  const body =
    state.tab === 'agenda' ? viewAgenda() : state.tab === 'history' ? viewHistory() : state.tab === 'settings' ? viewSettings() : viewHome();
  $app.innerHTML = `<div class="screen with-nav">${body}</div>${bottomNav()}`;
  if (state.tab === 'boards') $app.querySelector('.fab')?.classList.add('in');
}

function bottomNav() {
  const overdue = store.activeCards().filter((c) => dueState(c) === 'overdue').length;
  const tab = (id, ic, label, badge = 0) =>
    `<button class="nav-btn ${state.tab === id ? 'on' : ''}" data-act="tab" data-v="${id}">
       ${icon(ic, 22)}${badge ? `<span class="badge">${badge > 99 ? '99+' : badge}</span>` : ''}<span>${label}</span>
     </button>`;
  return `<nav class="bottom-nav">
    ${tab('boards', 'boards', 'Quadros')}
    ${tab('agenda', 'calendar', 'Agenda', overdue)}
    ${tab('history', 'history', 'Histórico')}
    ${tab('settings', 'settings', 'Ajustes')}
  </nav>`;
}

// ======================================================================
// Login / cadastro
// ======================================================================
async function renderAuth() {
  const users = await auth.listUsers();
  const reg = state.authMode === 'register' || users.length === 0;
  $app.innerHTML = `
  <div class="auth">
    <div class="auth-logo">${icon('boards', 40)}</div>
    <h1>Demandas</h1>
    <p class="muted">${reg ? 'Crie sua conta local para começar.' : 'Entre para ver suas demandas.'}</p>
    ${!reg && users.length > 1 ? `<div class="accounts">${users
      .map((u) => `<button class="chip" data-act="pick-user" data-v="${esc(u.username)}">${icon('user', 16)} ${esc(u.name)}</button>`)
      .join('')}</div>` : ''}
    <form id="auth-form" class="auth-form" autocomplete="off">
      ${reg ? `<label>Seu nome<input class="input" name="name" placeholder="Ex.: Victor" required></label>` : ''}
      <label>Usuário<input class="input" name="username" autocapitalize="none" autocorrect="off" placeholder="ex.: victor" required
        value="${!reg && users.length === 1 ? esc(users[0].username) : ''}"></label>
      <label>Senha<div class="pw"><input class="input" name="password" type="password" required minlength="4" placeholder="Mínimo 4 caracteres">
        <button type="button" class="icon-btn" data-act="toggle-pw">${icon('lock', 18)}</button></div></label>
      ${reg ? `<label>Confirmar senha<input class="input" name="password2" type="password" required></label>
               <label>Dica da senha <span class="muted">(opcional)</span><input class="input" name="hint" placeholder="Ajuda a lembrar, caso esqueça"></label>` : ''}
      <label class="check"><input type="checkbox" name="remember" checked> Manter conectado</label>
      <div class="auth-error" hidden></div>
      <button class="btn primary block" type="submit">${reg ? 'Criar conta' : 'Entrar'}</button>
    </form>
    ${users.length ? `<button class="link" data-act="auth-mode">${reg ? 'Já tenho conta — entrar' : 'Criar nova conta'}</button>` : ''}
    ${!reg ? `<button class="link muted" data-act="forgot">Esqueci minha senha</button>` : ''}
    <p class="muted small center">Seus dados ficam salvos só neste aparelho.</p>
  </div>`;

  const form = document.getElementById('auth-form');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(form));
    const err = form.querySelector('.auth-error');
    const btn = form.querySelector('button[type=submit]');
    err.hidden = true;
    btn.disabled = true;
    try {
      let user;
      if (reg) {
        if (f.password !== f.password2) throw new Error('As senhas não conferem.');
        user = await auth.register(f);
      } else {
        user = await auth.login(f.username, f.password);
      }
      await auth.saveSession(user.id, !!f.remember);
      await startSession(user, reg);
    } catch (ex) {
      err.textContent = ex.message;
      err.hidden = false;
      btn.disabled = false;
    }
  });
}

async function startSession(user, isNew = false) {
  state.user = user;
  state.tab = 'boards';
  state.boardId = null;
  await store.load(user.id);
  if (isNew && store.boards(true).length === 0) seedFirstBoard();
  applyTheme();
  await applyPendingActions();
  render();
  // agenda novamente todos os lembretes do usuário (garante após reinstalar/importar)
  resyncAllNotifications();
  if (native && (await notify.permissionStatus()) !== 'granted') {
    setTimeout(async () => {
      const st = await notify.requestPermission();
      if (st !== 'granted') toast('Notificações desativadas. Ative em Ajustes para receber lembretes.');
    }, 800);
  }
  if (pendingOpenCard) {
    const id = pendingOpenCard;
    pendingOpenCard = null;
    if (store.card(id)) openCard(id);
  }
}

function seedFirstBoard() {
  const b = store.createBoard('Minhas demandas');
  const [todo] = store.lists(b.id);
  const tomorrow = startOfDay().getTime() + 86400000 + 9 * 3600000;
  store.createCard(todo.id, 'Bem-vindo! Toque aqui para ver os detalhes', {
    desc: 'Cada cartão é uma demanda. Você pode:\n• Definir prazo e lembrete (notificação)\n• Escolher prioridade e etiquetas\n• Criar checklist e comentários\n• Segurar e arrastar para mudar de lista\n\nQuando terminar, marque como concluída ou arraste para "Concluído".',
    priority: 2,
    due: tomorrow,
    checklist: [
      { id: uid(), text: 'Criar minha primeira demanda', done: false },
      { id: uid(), text: 'Definir um prazo com lembrete', done: false },
    ],
  });
}

async function logout() {
  await auth.clearSession();
  state.user = null;
  store.unload();
  state.authMode = 'login';
  render();
}

// ======================================================================
// Início (lista de quadros)
// ======================================================================
function stats() {
  const cards = store.activeCards();
  const open = cards.filter((c) => !c.done);
  const today0 = startOfDay().getTime();
  const today1 = today0 + 86400000;
  const weekAgo = Date.now() - 7 * 86400000;
  return {
    open: open.length,
    overdue: open.filter((c) => c.due && c.due < Date.now()).length,
    today: open.filter((c) => c.due && c.due >= today0 && c.due < today1).length,
    doneWeek: store.data.cards.filter((c) => c.done && c.doneAt > weekAgo).length,
  };
}

function boardTile(b) {
  const cards = store.boardCards(b.id);
  const open = cards.filter((c) => !c.done).length;
  return `<button class="board-tile" style="--bc:${b.color}" data-act="open-board" data-v="${b.id}">
    <span class="bt-name">${esc(b.name)}</span>
    <span class="bt-meta">${open} pendente${open === 1 ? '' : 's'} · ${cards.length} total</span>
    ${b.starred ? `<span class="bt-star">${icon('star', 16)}</span>` : ''}
  </button>`;
}

function viewHome() {
  const s = stats();
  const boards = store.boards();
  const starred = boards.filter((b) => b.starred);
  const archived = store.boards(true).filter((b) => b.archived);
  const hour = new Date().getHours();
  const greet = hour < 12 ? 'Bom dia' : hour < 18 ? 'Boa tarde' : 'Boa noite';
  return `
  <header class="top">
    <div><div class="muted small">${greet},</div><h1>${esc(state.user.name)}</h1></div>
    <button class="icon-btn" data-act="search" aria-label="Buscar">${icon('search')}</button>
  </header>
  <div class="stats">
    <button class="stat" data-act="tab" data-v="agenda"><b>${s.open}</b><span>Pendentes</span></button>
    <button class="stat ${s.overdue ? 'red' : ''}" data-act="tab" data-v="agenda"><b>${s.overdue}</b><span>Atrasadas</span></button>
    <button class="stat ${s.today ? 'orange' : ''}" data-act="tab" data-v="agenda"><b>${s.today}</b><span>Para hoje</span></button>
    <div class="stat green"><b>${s.doneWeek}</b><span>Feitas (7 dias)</span></div>
  </div>
  ${starred.length ? `<h2 class="section">${icon('star', 16)} Favoritos</h2><div class="board-grid">${starred.map(boardTile).join('')}</div>` : ''}
  <h2 class="section">${icon('boards', 16)} Seus quadros</h2>
  ${boards.length ? `<div class="board-grid">${boards.map(boardTile).join('')}</div>`
    : `<div class="empty">${icon('boards', 40)}<p>Nenhum quadro ainda.</p><button class="btn primary" data-act="new-board">Criar quadro</button></div>`}
  ${archived.length ? `<button class="link center block" data-act="archived-boards">${icon('archive', 16)} Quadros arquivados (${archived.length})</button>` : ''}
  <button class="fab" data-act="new-board" aria-label="Novo quadro">${icon('plus', 26)}</button>`;
}

async function newBoard() {
  const name = await promptDialog('Novo quadro', '', 'Ex.: Trabalho, Casa, Faculdade', { ok: 'Criar' });
  if (name == null || !name.trim()) return;
  const color = await actionSheet({
    title: 'Cor do quadro',
    items: BOARD_COLORS.map((c, i) => ({ label: ['Azul', 'Verde', 'Vermelho', 'Roxo', 'Amarelo', 'Azul-petróleo', 'Rosa', 'Cinza'][i], color: c, value: c })),
  });
  const b = store.createBoard(name, color || undefined);
  openBoard(b.id);
}

function openBoard(id) {
  state.boardId = id;
  state.filter = { q: '', priority: 0, label: '', due: '' };
  state.showFilter = false;
  render();
}

// ======================================================================
// Quadro (listas e cartões)
// ======================================================================
function cardMatches(c) {
  const f = state.filter;
  if (f.q) {
    const q = f.q.toLowerCase();
    if (!c.title.toLowerCase().includes(q) && !c.desc.toLowerCase().includes(q)) return false;
  }
  if (f.priority && c.priority !== +f.priority) return false;
  if (f.label && !c.labels.includes(f.label)) return false;
  if (f.due === 'overdue' && dueState(c) !== 'overdue') return false;
  if (f.due === 'soon' && !['overdue', 'soon'].includes(dueState(c))) return false;
  if (f.due === 'none' && c.due) return false;
  if (f.due === 'open' && c.done) return false;
  return true;
}
const filterActive = () => state.filter.q || state.filter.priority || state.filter.label || state.filter.due;

function cardHTML(c, board) {
  const labels = c.labels.map((id) => board.labels.find((l) => l.id === id)).filter(Boolean);
  const ds = dueState(c);
  const checks = c.checklist.length;
  const checksDone = c.checklist.filter((i) => i.done).length;
  return `<div class="card ${c.done ? 'is-done' : ''}" data-act="open-card" data-v="${c.id}" data-id="${c.id}">
    ${c.priority ? `<span class="prio-bar" style="background:${PRIORITIES[c.priority].color}"></span>` : ''}
    ${labels.length ? `<div class="card-labels">${labels.map((l) => `<span class="lbl" style="background:${l.color}">${esc(l.name)}</span>`).join('')}</div>` : ''}
    <div class="card-title">${c.done ? `<span class="done-tick">${icon('check', 14)}</span>` : ''}${esc(c.title)}</div>
    <div class="card-badges">
      ${c.due ? `<span class="bdg due-${ds}">${icon('clock', 13)} ${fmtDue(c.due)}</span>` : ''}
      ${c.due && c.reminder >= 0 && !c.done ? `<span class="bdg">${icon('bell', 13)}</span>` : ''}
      ${c.repeat ? `<span class="bdg">${icon('repeat', 13)}</span>` : ''}
      ${c.desc ? `<span class="bdg">${icon('desc', 13)}</span>` : ''}
      ${checks ? `<span class="bdg ${checksDone === checks ? 'due-done' : ''}">${icon('checklist', 13)} ${checksDone}/${checks}</span>` : ''}
      ${c.comments.length ? `<span class="bdg">${icon('comment', 13)} ${c.comments.length}</span>` : ''}
    </div>
  </div>`;
}

function renderBoard() {
  destroySortables();
  const b = store.board(state.boardId);
  const lists = store.lists(b.id);
  const prevCanvas = $app.querySelector('.canvas');
  const scrollLeft = prevCanvas ? prevCanvas.scrollLeft : 0;
  const listScroll = {};
  $app.querySelectorAll('.list-cards').forEach((el) => (listScroll[el.dataset.list] = el.scrollTop));
  const f = state.filter;

  $app.innerHTML = `
  <div class="screen board-screen" style="--bc:${b.color}">
    <header class="board-head">
      <button class="icon-btn" data-act="back">${icon('back')}</button>
      <button class="board-title" data-act="rename-board">${esc(b.name)}</button>
      <button class="icon-btn ${b.starred ? 'starred' : ''}" data-act="star-board">${icon('star')}</button>
      <button class="icon-btn ${filterActive() ? 'on' : ''}" data-act="toggle-filter">${icon('filter')}</button>
      <button class="icon-btn" data-act="board-menu">${icon('more')}</button>
    </header>
    ${state.showFilter ? `
    <div class="filter-bar">
      <input class="input" id="filter-q" placeholder="Buscar neste quadro..." value="${esc(f.q)}">
      <div class="filter-row">
        <select class="input" data-filter="priority">
          <option value="0">Prioridade: todas</option>
          ${[4, 3, 2, 1].map((p) => `<option value="${p}" ${+f.priority === p ? 'selected' : ''}>${PRIORITIES[p].name}</option>`).join('')}
        </select>
        <select class="input" data-filter="due">
          <option value="">Prazo: todos</option>
          <option value="overdue" ${f.due === 'overdue' ? 'selected' : ''}>Atrasadas</option>
          <option value="soon" ${f.due === 'soon' ? 'selected' : ''}>Vencem em 24h</option>
          <option value="none" ${f.due === 'none' ? 'selected' : ''}>Sem prazo</option>
          <option value="open" ${f.due === 'open' ? 'selected' : ''}>Só pendentes</option>
        </select>
        <select class="input" data-filter="label">
          <option value="">Etiqueta: todas</option>
          ${b.labels.map((l, i) => `<option value="${l.id}" ${f.label === l.id ? 'selected' : ''}>${esc(l.name || 'Etiqueta ' + (i + 1))}</option>`).join('')}
        </select>
      </div>
      ${filterActive() ? `<button class="link" data-act="clear-filter">Limpar filtros</button>` : ''}
    </div>` : ''}
    <div class="canvas">
      ${lists
        .map((l) => {
          const all = store.cards(l.id);
          const cards = all.filter(cardMatches);
          return `<section class="list" data-list="${l.id}">
            <div class="list-head">
              <span class="list-grip">${icon('grip', 18)}</span>
              <button class="list-name" data-act="rename-list" data-v="${l.id}">${esc(l.name)}${l.isDone ? ` <span class="done-flag">${icon('check', 14)}</span>` : ''}</button>
              <span class="count">${filterActive() ? `${cards.length}/` : ''}${all.length}</span>
              <button class="icon-btn sm" data-act="list-menu" data-v="${l.id}">${icon('more', 18)}</button>
            </div>
            <div class="list-cards" data-list="${l.id}">${cards.map((c) => cardHTML(c, b)).join('')}</div>
            <div class="composer" data-list="${l.id}">
              <button class="add-card" data-act="compose" data-v="${l.id}">${icon('plus', 18)} Adicionar cartão</button>
            </div>
          </section>`;
        })
        .join('')}
      <section class="list add-list"><button class="add-card" data-act="new-list">${icon('plus', 18)} Adicionar lista</button></section>
    </div>
  </div>`;

  const canvas = $app.querySelector('.canvas');
  canvas.scrollLeft = scrollLeft;
  $app.querySelectorAll('.list-cards').forEach((el) => (el.scrollTop = listScroll[el.dataset.list] || 0));

  const q = document.getElementById('filter-q');
  if (q) {
    q.addEventListener('input', () => {
      state.filter.q = q.value;
      const pos = q.selectionStart;
      renderBoard();
      const nq = document.getElementById('filter-q');
      nq.focus();
      nq.setSelectionRange(pos, pos);
    });
  }
  setupSortables(b.id);
}

function destroySortables() {
  sortables.forEach((s) => s.destroy());
  sortables = [];
}

function setupSortables(boardId) {
  const common = {
    animation: 160,
    delay: 220,
    delayOnTouchOnly: true,
    touchStartThreshold: 6,
    scroll: true,
    scrollSensitivity: 70,
    scrollSpeed: 14,
    bubbleScroll: true,
    forceAutoScrollFallback: true,
    onChoose: haptic,
  };
  $app.querySelectorAll('.list-cards').forEach((el) => {
    sortables.push(
      Sortable.create(el, {
        ...common,
        group: 'cards',
        ghostClass: 'card-ghost',
        chosenClass: 'card-chosen',
        dragClass: 'card-drag',
        fallbackOnBody: true,
        onEnd: (e) => {
          const id = e.item.dataset.id;
          const toList = e.to.dataset.list;
          // índice entre os cartões visíveis; com filtro ativo, coloca no fim
          const idx = filterActive() ? null : e.newIndex;
          if (e.from === e.to && e.oldIndex === e.newIndex) return;
          store.moveCard(id, toList, idx);
        },
      }),
    );
  });
  const canvas = $app.querySelector('.canvas');
  sortables.push(
    Sortable.create(canvas, {
      ...common,
      handle: '.list-grip',
      draggable: '.list:not(.add-list)',
      delay: 0,
      ghostClass: 'list-ghost',
      onEnd: () => {
        const ids = [...canvas.querySelectorAll('.list[data-list]')].map((x) => x.dataset.list);
        store.reorderLists(boardId, ids);
      },
    }),
  );
}

function openComposer(listId) {
  const wrap = $app.querySelector(`.composer[data-list="${listId}"]`);
  if (!wrap) return;
  wrap.innerHTML = `<form class="composer-form">
    <textarea class="input" rows="2" placeholder="Título da demanda..." enterkeyhint="done"></textarea>
    <div class="row"><button class="btn primary" type="submit">Adicionar</button>
    <button class="icon-btn" type="button" data-act="cancel-compose">${icon('close')}</button></div>
  </form>`;
  const ta = wrap.querySelector('textarea');
  ta.focus();
  const submit = () => {
    const t = ta.value.trim();
    if (!t) return;
    store.createCard(listId, t);
    setTimeout(() => {
      openComposer(listId);
      const lc = $app.querySelector(`.list-cards[data-list="${listId}"]`);
      if (lc) lc.scrollTop = lc.scrollHeight;
    }, 0);
  };
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  });
  wrap.querySelector('form').addEventListener('submit', (e) => {
    e.preventDefault();
    submit();
  });
}

async function boardMenu() {
  const b = store.board(state.boardId);
  const v = await actionSheet({
    title: b.name,
    items: [
      { label: 'Renomear quadro', icon: 'edit', value: 'rename' },
      { label: 'Mudar cor', icon: 'boards', value: 'color' },
      { label: 'Editar etiquetas', icon: 'tag', value: 'labels' },
      { label: 'Cartões arquivados', icon: 'archive', value: 'archived' },
      { label: 'Histórico do quadro', icon: 'history', value: 'history' },
      { divider: true },
      { label: 'Arquivar quadro', icon: 'archive', value: 'archive' },
      { label: 'Excluir quadro', icon: 'trash', value: 'delete', danger: true },
    ],
  });
  if (v === 'rename') renameBoard();
  if (v === 'color') {
    const c = await actionSheet({ title: 'Cor do quadro', items: BOARD_COLORS.map((c) => ({ label: c, color: c, value: c, active: c === b.color })) });
    if (c) store.updateBoard(b.id, { color: c });
  }
  if (v === 'labels') editLabels(b.id);
  if (v === 'archived') archivedCards(b.id);
  if (v === 'history') {
    state.historyBoard = b.id;
    state.tab = 'history';
    state.boardId = null;
    render();
  }
  if (v === 'archive') {
    store.updateBoard(b.id, { archived: true });
    state.boardId = null;
    render();
    toast('Quadro arquivado', { label: 'Desfazer', run: () => store.updateBoard(b.id, { archived: false }) });
  }
  if (v === 'delete') {
    const n = store.boardCards(b.id, true).length;
    if (await confirmDialog('Excluir quadro?', `"${b.name}" e seus ${n} cartões serão apagados definitivamente.`, 'Excluir')) {
      state.boardId = null;
      store.deleteBoard(b.id);
      toast('Quadro excluído');
    }
  }
}

async function renameBoard() {
  const b = store.board(state.boardId);
  const name = await promptDialog('Nome do quadro', b.name);
  if (name) store.updateBoard(b.id, { name });
}

async function listMenu(listId) {
  const l = store.list(listId);
  const v = await actionSheet({
    title: l.name,
    items: [
      { label: 'Renomear lista', icon: 'edit', value: 'rename' },
      { label: 'Adicionar cartão', icon: 'plus', value: 'add' },
      { label: l.isDone ? 'Deixar de ser lista de concluídos' : 'Usar como lista de concluídos', icon: 'check', value: 'done' },
      { label: 'Ordenar por prazo', icon: 'clock', value: 'sort-due' },
      { label: 'Ordenar por prioridade', icon: 'flag', value: 'sort-prio' },
      { label: 'Mover todos os cartões para...', icon: 'move', value: 'move-all' },
      { label: 'Arquivar todos os cartões', icon: 'archive', value: 'archive' },
      { divider: true },
      { label: 'Excluir lista', icon: 'trash', value: 'delete', danger: true },
    ],
  });
  if (v === 'rename') renameList(listId);
  if (v === 'add') openComposer(listId);
  if (v === 'done') {
    store.updateList(listId, { isDone: !l.isDone });
    toast(l.isDone ? 'Cartões movidos para cá serão marcados como concluídos' : 'Lista normal');
  }
  if (v === 'sort-due' || v === 'sort-prio') {
    const cards = store.cards(listId);
    cards.sort((a, b) => (v === 'sort-due' ? (a.due || Infinity) - (b.due || Infinity) : b.priority - a.priority));
    cards.forEach((c, i) => (c.order = i));
    store.commit();
  }
  if (v === 'move-all') {
    const others = store.lists(l.boardId).filter((x) => x.id !== listId);
    const to = await actionSheet({ title: 'Mover para', items: others.map((x) => ({ label: x.name, value: x.id })) });
    if (to) store.cards(listId).forEach((c) => store.moveCard(c.id, to));
  }
  if (v === 'archive') {
    const n = store.cards(listId).length;
    if (n && (await confirmDialog('Arquivar cartões?', `${n} cartões desta lista serão arquivados.`, 'Arquivar', false))) store.archiveListCards(listId);
  }
  if (v === 'delete') {
    const n = store.cards(listId, true).length;
    if (await confirmDialog('Excluir lista?', n ? `A lista e seus ${n} cartões serão apagados.` : 'A lista será apagada.', 'Excluir')) store.deleteList(listId);
  }
}

async function renameList(listId) {
  const l = store.list(listId);
  const name = await promptDialog('Nome da lista', l.name);
  if (name) store.updateList(listId, { name });
}

async function newList() {
  const name = await promptDialog('Nova lista', '', 'Ex.: Aguardando retorno', { ok: 'Criar' });
  if (name && name.trim()) {
    store.createList(state.boardId, name);
    setTimeout(() => {
      const c = $app.querySelector('.canvas');
      if (c) c.scrollTo({ left: c.scrollWidth, behavior: 'smooth' });
    }, 30);
  }
}

function editLabels(boardId) {
  const b = store.board(boardId);
  const { el, close } = fullPanel('labels-panel');
  const draw = () => {
    el.innerHTML = `<div class="panel">
      <header class="panel-head"><button class="icon-btn" data-x>${icon('back')}</button><h2>Etiquetas</h2></header>
      <div class="panel-body">
        <p class="muted small">Dê nomes às cores para organizar (ex.: Cliente, Urgente, Financeiro).</p>
        ${b.labels.map((l) => `<div class="label-edit"><span class="lbl big" style="background:${l.color}"></span>
          <input class="input" data-lid="${l.id}" value="${esc(l.name)}" placeholder="Sem nome">
          <button class="icon-btn" data-del="${l.id}">${icon('trash', 18)}</button></div>`).join('')}
        <div class="color-row">${LABEL_COLORS.map((c) => `<button class="swatch" style="background:${c}" data-add="${c}"></button>`).join('')}</div>
        <p class="muted small">Toque numa cor acima para criar uma nova etiqueta.</p>
      </div></div>`;
  };
  draw();
  el.addEventListener('click', (e) => {
    if (e.target.closest('[data-x]')) return close();
    const del = e.target.closest('[data-del]');
    if (del) {
      const id = del.dataset.del;
      store.updateBoard(boardId, { labels: b.labels.filter((l) => l.id !== id) });
      store.boardCards(boardId, true).forEach((c) => (c.labels = c.labels.filter((x) => x !== id)));
      store.commit();
      draw();
    }
    const add = e.target.closest('[data-add]');
    if (add) {
      store.updateBoard(boardId, { labels: [...b.labels, { id: uid(), color: add.dataset.add, name: '' }] });
      draw();
    }
  });
  el.addEventListener('change', (e) => {
    const inp = e.target.closest('[data-lid]');
    if (!inp) return;
    const l = b.labels.find((x) => x.id === inp.dataset.lid);
    if (l) {
      l.name = inp.value.trim();
      store.commit();
    }
  });
}

function archivedCards(boardId) {
  const { el, close } = fullPanel('archived-panel');
  const draw = () => {
    const cards = store.boardCards(boardId, true).filter((c) => c.archived).sort((a, b) => b.updatedAt - a.updatedAt);
    el.innerHTML = `<div class="panel">
      <header class="panel-head"><button class="icon-btn" data-x>${icon('back')}</button><h2>Cartões arquivados</h2></header>
      <div class="panel-body">
        ${cards.length ? cards.map((c) => `<div class="row-item"><div class="grow"><b>${esc(c.title)}</b><div class="muted small">${esc(store.list(c.listId)?.name || '')} · ${relTime(c.updatedAt)}</div></div>
          <button class="btn ghost sm" data-restore="${c.id}">Restaurar</button>
          <button class="icon-btn" data-del="${c.id}">${icon('trash', 18)}</button></div>`).join('')
        : `<div class="empty">${icon('archive', 36)}<p>Nenhum cartão arquivado.</p></div>`}
      </div></div>`;
  };
  draw();
  el.addEventListener('click', async (e) => {
    if (e.target.closest('[data-x]')) return close();
    const r = e.target.closest('[data-restore]');
    if (r) {
      store.updateCard(r.dataset.restore, { archived: false });
      draw();
    }
    const d = e.target.closest('[data-del]');
    if (d && (await confirmDialog('Excluir cartão?', 'Essa ação não pode ser desfeita.', 'Excluir'))) {
      store.deleteCard(d.dataset.del);
      draw();
    }
  });
}

function archivedBoards() {
  const { el, close } = fullPanel('archived-panel');
  const draw = () => {
    const boards = store.boards(true).filter((b) => b.archived);
    el.innerHTML = `<div class="panel">
      <header class="panel-head"><button class="icon-btn" data-x>${icon('back')}</button><h2>Quadros arquivados</h2></header>
      <div class="panel-body">
        ${boards.length ? boards.map((b) => `<div class="row-item"><span class="dot big" style="background:${b.color}"></span><div class="grow"><b>${esc(b.name)}</b></div>
          <button class="btn ghost sm" data-restore="${b.id}">Restaurar</button>
          <button class="icon-btn" data-del="${b.id}">${icon('trash', 18)}</button></div>`).join('')
        : `<div class="empty"><p>Nenhum quadro arquivado.</p></div>`}
      </div></div>`;
  };
  draw();
  el.addEventListener('click', async (e) => {
    if (e.target.closest('[data-x]')) return close();
    const r = e.target.closest('[data-restore]');
    if (r) {
      store.updateBoard(r.dataset.restore, { archived: false });
      draw();
    }
    const d = e.target.closest('[data-del]');
    if (d && (await confirmDialog('Excluir quadro?', 'O quadro e todos os cartões serão apagados.', 'Excluir'))) {
      store.deleteBoard(d.dataset.del);
      draw();
    }
  });
}

// ======================================================================
// Detalhe do cartão
// ======================================================================
let cardPanel = null;

function openCard(cardId) {
  if (!store.card(cardId)) return;
  if (cardPanel) cardPanel.close();
  const panel = fullPanel('card-panel', () => {
    cardPanel = null;
    unsub();
  });
  cardPanel = { ...panel, cardId };
  const { el, close } = panel;
  let editing = false;

  const draw = () => {
    const c = store.card(cardId);
    if (!c) return close();
    const b = store.board(c.boardId);
    const lists = store.lists(c.boardId);
    const checksDone = c.checklist.filter((i) => i.done).length;
    const pct = c.checklist.length ? Math.round((checksDone / c.checklist.length) * 100) : 0;
    const ds = dueState(c);
    const hist = store.data.history.filter((h) => h.cardId === c.id).slice(0, 30);
    el.innerHTML = `<div class="panel">
      <header class="panel-head" style="--bc:${b.color}">
        <button class="icon-btn" data-x>${icon('close')}</button>
        <div class="grow crumbs">${esc(b.name)}</div>
        <button class="icon-btn" data-c="menu">${icon('more')}</button>
      </header>
      <div class="panel-body card-detail">
        ${c.archived ? `<div class="banner">${icon('archive', 16)} Este cartão está arquivado. <button class="link" data-c="unarchive">Restaurar</button></div>` : ''}
        <textarea class="title-input" rows="1" data-f="title">${esc(c.title)}</textarea>
        <button class="done-btn ${c.done ? 'on' : ''}" data-c="done">${icon('check', 18)} ${c.done ? 'Concluída' + (c.doneAt ? ' · ' + relTime(c.doneAt) : '') : 'Marcar como concluída'}</button>

        <div class="field"><label>${icon('boards', 16)} Lista</label>
          <select class="input" data-f="list">${lists.map((l) => `<option value="${l.id}" ${l.id === c.listId ? 'selected' : ''}>${esc(l.name)}</option>`).join('')}</select></div>

        <div class="field"><label>${icon('flag', 16)} Prioridade</label>
          <div class="seg">${[0, 1, 2, 3, 4].map((p) => `<button class="${c.priority === p ? 'on' : ''}" data-prio="${p}" style="--pc:${PRIORITIES[p].color}">${p ? PRIORITIES[p].name : 'Nenhuma'}</button>`).join('')}</div></div>

        <div class="field"><label>${icon('clock', 16)} Prazo ${ds && ds !== 'future' ? `<span class="bdg due-${ds}">${ds === 'overdue' ? 'Atrasada' : ds === 'soon' ? 'Em breve' : 'Concluída'}</span>` : ''}</label>
          <div class="row"><input class="input grow" type="datetime-local" data-f="due" value="${toInputValue(c.due)}">
          ${c.due ? `<button class="icon-btn" data-c="clear-due">${icon('close', 18)}</button>` : ''}</div>
          <div class="quick-dates">
            <button class="chip" data-quick="today">Hoje 18h</button><button class="chip" data-quick="tomorrow">Amanhã 9h</button>
            <button class="chip" data-quick="week">Em 7 dias</button><button class="chip" data-quick="1h">Daqui 1h</button>
          </div>
        </div>
        ${c.due ? `<div class="field two">
          <div><label>${icon('bell', 16)} Lembrete</label><select class="input" data-f="reminder">${REMINDERS.map(([v, t]) => `<option value="${v}" ${c.reminder === v ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
          <div><label>${icon('repeat', 16)} Repetir</label><select class="input" data-f="repeat">${REPEATS.map(([v, t]) => `<option value="${v}" ${(c.repeat || '') === v ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
        </div>` : ''}

        <div class="field"><label>${icon('tag', 16)} Etiquetas <button class="link small" data-c="edit-labels">editar</button></label>
          <div class="label-pick">${b.labels.map((l) => `<button class="lbl pick ${c.labels.includes(l.id) ? 'on' : ''}" style="background:${l.color}" data-lbl="${l.id}">${c.labels.includes(l.id) ? icon('check', 14) : ''}${esc(l.name)}</button>`).join('')}</div></div>

        <div class="field"><label>${icon('desc', 16)} Descrição</label>
          ${editing || !c.desc
            ? `<textarea class="input" rows="4" data-f="desc" placeholder="Adicione detalhes, links, telefones...">${esc(c.desc)}</textarea>`
            : `<div class="desc-view" data-c="edit-desc">${richText(c.desc)}</div>`}
        </div>

        <div class="field"><label>${icon('checklist', 16)} Checklist ${c.checklist.length ? `<span class="muted">${checksDone}/${c.checklist.length}</span>` : ''}</label>
          ${c.checklist.length ? `<div class="progress"><span style="width:${pct}%"></span></div>` : ''}
          ${c.checklist.map((i) => `<div class="check-item ${i.done ? 'on' : ''}"><button class="cb" data-chk="${i.id}">${i.done ? icon('check', 14) : ''}</button><span class="grow">${esc(i.text)}</span><button class="icon-btn sm" data-chkdel="${i.id}">${icon('close', 16)}</button></div>`).join('')}
          <form class="row add-check"><input class="input grow" placeholder="Adicionar item..." enterkeyhint="done"><button class="btn ghost sm" type="submit">${icon('plus', 16)}</button></form>
        </div>

        <div class="field"><label>${icon('comment', 16)} Comentários</label>
          <form class="row add-comment"><textarea class="input grow" rows="1" placeholder="Escreva um comentário..."></textarea><button class="btn primary sm" type="submit">Enviar</button></form>
          ${c.comments.slice().reverse().map((m) => `<div class="comment"><div class="muted small">${fmtDateTime(m.at)}<button class="link small" data-cdel="${m.id}">excluir</button></div><div>${richText(m.text)}</div></div>`).join('')}
        </div>

        <div class="field"><label>${icon('history', 16)} Atividade</label>
          ${hist.map((h) => `<div class="hist-mini"><span>${esc(h.text)}</span><span class="muted small">${relTime(h.at)}</span></div>`).join('') || '<p class="muted small">Sem atividade.</p>'}
          <p class="muted small">Criado em ${fmtDateTime(c.createdAt)}</p>
        </div>
      </div></div>`;
    const t = el.querySelector('.title-input');
    autoGrow(t);
  };

  const unsub = store.subscribe(() => {
    // redesenha só se o foco não estiver num campo de texto
    const a = document.activeElement;
    if (a && el.contains(a) && (a.tagName === 'TEXTAREA' || (a.tagName === 'INPUT' && a.type === 'text'))) return;
    draw();
  });
  draw();

  el.addEventListener('input', (e) => {
    if (e.target.tagName === 'TEXTAREA') autoGrow(e.target);
  });
  el.addEventListener('keydown', (e) => {
    if (e.target.dataset.f === 'title' && e.key === 'Enter') {
      e.preventDefault();
      e.target.blur();
    }
  });
  el.addEventListener('focusout', (e) => {
    const f = e.target.dataset.f;
    if (f === 'title') {
      if (e.target.value.trim()) store.updateCard(cardId, { title: e.target.value });
      else draw();
    }
    if (f === 'desc') {
      editing = false;
      store.updateCard(cardId, { desc: e.target.value.trim() });
      draw();
    }
  });
  el.addEventListener('change', (e) => {
    const f = e.target.dataset.f;
    if (f === 'list') store.moveCard(cardId, e.target.value);
    if (f === 'due') setDue(fromInputValue(e.target.value));
    if (f === 'reminder') store.updateCard(cardId, { reminder: +e.target.value });
    if (f === 'repeat') store.updateCard(cardId, { repeat: e.target.value });
  });
  el.addEventListener('submit', (e) => {
    e.preventDefault();
    const form = e.target;
    const inp = form.querySelector('.input');
    if (form.classList.contains('add-check')) {
      store.addChecklistItem(cardId, inp.value);
      draw();
      el.querySelector('.add-check .input').focus();
    }
    if (form.classList.contains('add-comment')) {
      store.addComment(cardId, inp.value);
      draw();
    }
  });

  const setDue = async (ts) => {
    const c = store.card(cardId);
    store.updateCard(cardId, { due: ts });
    if (ts && c.reminder >= 0 && native && (await notify.permissionStatus()) !== 'granted') {
      const st = await notify.requestPermission();
      if (st !== 'granted') toast('Ative as notificações para receber o lembrete');
    }
  };

  el.addEventListener('click', async (e) => {
    if (e.target.closest('[data-x]')) return close();
    const c = store.card(cardId);
    const t = e.target.closest('[data-c],[data-prio],[data-lbl],[data-chk],[data-chkdel],[data-cdel],[data-quick]');
    if (!t) return;
    const d = t.dataset;
    if (d.prio != null) store.updateCard(cardId, { priority: +d.prio });
    if (d.lbl) {
      const has = c.labels.includes(d.lbl);
      store.updateCard(cardId, { labels: has ? c.labels.filter((x) => x !== d.lbl) : [...c.labels, d.lbl] });
    }
    if (d.chk) {
      store.toggleChecklistItem(cardId, d.chk);
      haptic();
    }
    if (d.chkdel) store.removeChecklistItem(cardId, d.chkdel);
    if (d.cdel && (await confirmDialog('Excluir comentário?', '', 'Excluir'))) store.deleteComment(cardId, d.cdel);
    if (d.quick) {
      const n = new Date();
      if (d.quick === 'today') n.setHours(18, 0, 0, 0);
      if (d.quick === 'tomorrow') { n.setDate(n.getDate() + 1); n.setHours(9, 0, 0, 0); }
      if (d.quick === 'week') { n.setDate(n.getDate() + 7); n.setHours(9, 0, 0, 0); }
      if (d.quick === '1h') n.setTime(Date.now() + 3600000);
      setDue(n.getTime());
    }
    switch (d.c) {
      case 'done':
        store.toggleDone(cardId);
        haptic();
        break;
      case 'clear-due':
        store.updateCard(cardId, { due: null });
        break;
      case 'edit-desc':
        if (e.target.closest('a')) return;
        editing = true;
        draw();
        el.querySelector('[data-f="desc"]').focus();
        break;
      case 'edit-labels':
        editLabels(c.boardId);
        break;
      case 'unarchive':
        store.updateCard(cardId, { archived: false });
        break;
      case 'menu':
        cardMenu(cardId, close);
        break;
    }
  });
}

async function cardMenu(cardId, closePanel) {
  const c = store.card(cardId);
  const v = await actionSheet({
    title: c.title,
    items: [
      { label: 'Mover para outro quadro', icon: 'move', value: 'move' },
      { label: 'Duplicar', icon: 'copy', value: 'dup' },
      { label: 'Compartilhar como texto', icon: 'upload', value: 'share' },
      { label: c.archived ? 'Restaurar' : 'Arquivar', icon: 'archive', value: 'archive' },
      { divider: true },
      { label: 'Excluir cartão', icon: 'trash', value: 'delete', danger: true },
    ],
  });
  if (v === 'move') {
    const boards = store.boards();
    const bId = await actionSheet({ title: 'Quadro de destino', items: boards.map((b) => ({ label: b.name, color: b.color, value: b.id, active: b.id === c.boardId })) });
    if (!bId) return;
    const lists = store.lists(bId);
    if (!lists.length) return toast('Esse quadro não tem listas');
    const lId = await actionSheet({ title: 'Lista de destino', items: lists.map((l) => ({ label: l.name, value: l.id, active: l.id === c.listId })) });
    if (!lId) return;
    if (bId !== c.boardId) c.labels = []; // etiquetas são por quadro
    store.moveCard(cardId, lId);
    toast('Cartão movido');
  }
  if (v === 'dup') {
    const n = store.duplicateCard(cardId);
    toast('Cartão duplicado');
    openCard(n.id);
  }
  if (v === 'share') {
    const b = store.board(c.boardId);
    const lines = [
      `📌 ${c.title}`,
      `Quadro: ${b.name} · Lista: ${store.list(c.listId)?.name}`,
      c.priority ? `Prioridade: ${PRIORITIES[c.priority].name}` : '',
      c.due ? `Prazo: ${fmtDateTime(c.due)}` : '',
      c.desc ? `\n${c.desc}` : '',
      c.checklist.length ? '\nChecklist:\n' + c.checklist.map((i) => `${i.done ? '☑' : '☐'} ${i.text}`).join('\n') : '',
    ].filter(Boolean).join('\n');
    shareText(c.title, lines);
  }
  if (v === 'archive') {
    store.updateCard(cardId, { archived: !c.archived });
    if (!c.archived) return;
    closePanel();
    toast('Cartão arquivado', { label: 'Desfazer', run: () => store.updateCard(cardId, { archived: false }) });
  }
  if (v === 'delete') {
    if (!(await confirmDialog('Excluir cartão?', `"${c.title}" será apagado.`, 'Excluir'))) return;
    const snapshot = JSON.parse(JSON.stringify(c));
    closePanel();
    store.deleteCard(cardId);
    toast('Cartão excluído', {
      label: 'Desfazer',
      run: () => {
        if (!store.list(snapshot.listId)) return toast('A lista não existe mais');
        store.data.cards.push(snapshot);
        store.log('card_create', `Restaurou o cartão "${snapshot.title}"`, { boardId: snapshot.boardId, cardId: snapshot.id });
        store.onCardChanged?.(snapshot);
        store.commit();
      },
    });
  }
}

function autoGrow(t) {
  if (!t) return;
  t.style.height = 'auto';
  t.style.height = t.scrollHeight + 'px';
}

// ======================================================================
// Agenda
// ======================================================================
function agendaItem(c) {
  const b = store.board(c.boardId);
  const ds = dueState(c);
  return `<div class="agenda-item ${c.done ? 'is-done' : ''}">
    <button class="cb round ${c.done ? 'on' : ''}" data-act="toggle-done" data-v="${c.id}">${c.done ? icon('check', 14) : ''}</button>
    <button class="grow agenda-main" data-act="open-card" data-v="${c.id}">
      <span class="agenda-title">${c.priority ? `<span class="dot" style="background:${PRIORITIES[c.priority].color}"></span>` : ''}${esc(c.title)}</span>
      <span class="muted small"><span class="dot" style="background:${b.color}"></span>${esc(b.name)} · ${esc(store.list(c.listId)?.name || '')}</span>
    </button>
    ${c.due ? `<span class="bdg due-${ds}">${fmtDue(c.due)}</span>` : ''}
  </div>`;
}

function viewAgenda() {
  const cards = store.activeCards().filter((c) => state.agendaShowDone || !c.done);
  const t0 = startOfDay().getTime();
  const day = 86400000;
  const groups = [
    ['Atrasadas', (c) => c.due && c.due < Date.now() && !c.done, 'red'],
    ['Hoje', (c) => c.due && c.due >= t0 && c.due < t0 + day && !(c.due < Date.now() && !c.done)],
    ['Amanhã', (c) => c.due && c.due >= t0 + day && c.due < t0 + 2 * day],
    ['Próximos 7 dias', (c) => c.due && c.due >= t0 + 2 * day && c.due < t0 + 8 * day],
    ['Mais tarde', (c) => c.due && c.due >= t0 + 8 * day],
    ['Antes de hoje (concluídas)', (c) => c.due && c.due < t0 && c.done],
    ['Sem prazo', (c) => !c.due],
  ];
  const used = new Set();
  const sections = groups
    .map(([name, fn, cls]) => {
      const items = cards.filter((c) => !used.has(c.id) && fn(c)).sort((a, b) => (a.due || 0) - (b.due || 0) || b.priority - a.priority);
      items.forEach((c) => used.add(c.id));
      if (!items.length) return '';
      return `<h2 class="section ${cls || ''}">${name} <span class="muted">${items.length}</span></h2><div class="agenda-group">${items.map(agendaItem).join('')}</div>`;
    })
    .join('');
  return `<header class="top"><h1>Agenda</h1>
      <button class="chip ${state.agendaShowDone ? 'on' : ''}" data-act="agenda-done">${icon('check', 16)} Mostrar concluídas</button></header>
    ${sections || `<div class="empty">${icon('calendar', 40)}<p>Nada pendente. 🎉</p></div>`}`;
}

// ======================================================================
// Histórico
// ======================================================================
const HIST_ICON = { board: 'boards', list: 'desc', card_create: 'plus', card_move: 'move', card_delete: 'trash', card_comment: 'comment', check_done: 'checklist', card_update: 'edit', import: 'upload' };

function viewHistory() {
  const boards = store.boards(true);
  let items = store.data.history;
  if (state.historyBoard) items = items.filter((h) => h.boardId === state.historyBoard);
  items = items.slice(0, 400);
  let lastDay = '';
  const rows = items
    .map((h) => {
      const dh = fmtDayHeader(h.at);
      const head = dh !== lastDay ? `<h2 class="section">${dh}</h2>` : '';
      lastDay = dh;
      const b = h.boardId && store.board(h.boardId);
      const ic = HIST_ICON[h.type] || HIST_ICON[h.type.split('_')[0]] || 'info';
      const clickable = h.cardId && store.card(h.cardId);
      return `${head}<button class="hist-row" ${clickable ? `data-act="open-card" data-v="${h.cardId}"` : 'disabled'}>
        <span class="hist-ic">${icon(ic, 16)}</span>
        <span class="grow"><span>${esc(h.text)}</span>${b ? `<span class="muted small block"><span class="dot" style="background:${b.color}"></span>${esc(b.name)}</span>` : ''}</span>
        <span class="muted small">${fmtTime(h.at)}</span>
      </button>`;
    })
    .join('');
  return `<header class="top"><h1>Histórico</h1>
      ${store.data.history.length ? `<button class="icon-btn" data-act="clear-history">${icon('trash')}</button>` : ''}</header>
    <select class="input" data-act-change="history-board">
      <option value="">Todos os quadros</option>
      ${boards.map((b) => `<option value="${b.id}" ${state.historyBoard === b.id ? 'selected' : ''}>${esc(b.name)}</option>`).join('')}
    </select>
    ${rows || `<div class="empty">${icon('history', 40)}<p>Nenhuma atividade registrada.</p></div>`}`;
}

// ======================================================================
// Ajustes
// ======================================================================
function viewSettings() {
  const s = store.settings;
  const total = store.data.cards.length;
  return `<header class="top"><h1>Ajustes</h1></header>
  <div class="settings">
    <div class="profile-card">
      <div class="avatar">${esc(state.user.name.slice(0, 1).toUpperCase())}</div>
      <div class="grow"><b>${esc(state.user.name)}</b><div class="muted small">@${esc(state.user.username)} · ${store.boards(true).length} quadros · ${total} cartões</div></div>
      <button class="icon-btn" data-act="edit-name">${icon('edit', 18)}</button>
    </div>

    <h2 class="section">Aparência</h2>
    <div class="seg full">${[['system', 'Automático'], ['light', 'Claro'], ['dark', 'Escuro']].map(([v, t]) => `<button class="${s.theme === v ? 'on' : ''}" data-act="theme" data-v="${v}">${t}</button>`).join('')}</div>

    <h2 class="section">Notificações</h2>
    <div class="set-row"><span class="grow">Status</span><span id="notif-status" class="muted">verificando...</span></div>
    <div class="set-row"><span class="grow">Lembrete padrão para novas demandas</span>
      <select class="input auto" data-act-change="default-reminder">${REMINDERS.map(([v, t]) => `<option value="${v}" ${s.defaultReminder === v ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
    <button class="set-btn" data-act="notif-allow">${icon('bell', 18)} Permitir notificações</button>
    <button class="set-btn" data-act="notif-exact">${icon('clock', 18)} Alarmes exatos (lembretes no horário certo)</button>
    <button class="set-btn" data-act="notif-test">${icon('bell', 18)} Enviar notificação de teste</button>
    <button class="set-btn" data-act="notif-resync">${icon('repeat', 18)} Reagendar todos os lembretes</button>

    <h2 class="section">Backup</h2>
    <p class="muted small">Os dados ficam só no celular. Se desinstalar o app, eles somem — faça backup de vez em quando.</p>
    <button class="set-btn" data-act="export">${icon('download', 18)} Exportar backup (.json)</button>
    <label class="set-btn">${icon('upload', 18)} Importar backup<input type="file" accept="application/json,.json,text/plain" hidden data-act-change="import"></label>

    <h2 class="section">Conta</h2>
    <button class="set-btn" data-act="change-pw">${icon('lock', 18)} Alterar senha</button>
    <button class="set-btn" data-act="edit-hint">${icon('info', 18)} Dica da senha</button>
    <button class="set-btn" data-act="logout">${icon('logout', 18)} Sair</button>
    <button class="set-btn danger" data-act="delete-account">${icon('trash', 18)} Excluir conta e dados</button>

    <p class="muted small center">Demandas v${APP_VERSION}</p>
  </div>`;
}

async function refreshNotifStatus() {
  const el = document.getElementById('notif-status');
  if (!el) return;
  if (!native) return (el.textContent = 'Disponível no app Android');
  const p = await notify.permissionStatus();
  const ex = await notify.exactAlarmStatus();
  el.textContent = p === 'granted' ? (ex === 'granted' ? 'Ativadas ✓' : 'Ativadas (horário aproximado)') : 'Desativadas';
  el.className = p === 'granted' ? 'ok' : 'warn';
}

async function exportBackup() {
  const json = store.exportJSON(state.user);
  const d = new Date();
  const name = `demandas-backup-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}.json`;
  if (native) {
    try {
      const res = await Filesystem.writeFile({ path: name, data: json, directory: Directory.Cache, encoding: Encoding.UTF8 });
      await Share.share({ title: 'Backup Demandas', files: [res.uri], dialogTitle: 'Salvar backup em...' });
    } catch (e) {
      if (!String(e?.message || e).toLowerCase().includes('cancel')) toast('Não foi possível exportar: ' + (e.message || e));
    }
  } else {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    a.download = name;
    a.click();
  }
}

async function shareText(title, text) {
  try {
    if (native) await Share.share({ title, text, dialogTitle: 'Compartilhar' });
    else if (navigator.share) await navigator.share({ title, text });
    else {
      await navigator.clipboard.writeText(text);
      toast('Copiado para a área de transferência');
    }
  } catch {}
}

async function importBackup(file) {
  if (!file) return;
  try {
    const text = await file.text();
    if (!(await confirmDialog('Importar backup?', 'Os dados atuais desta conta serão substituídos pelos do arquivo.', 'Importar'))) return;
    store.importJSON(text);
    applyTheme();
    toast('Backup importado ✓');
  } catch (e) {
    toast('Erro: ' + e.message);
  }
}

// ======================================================================
// Busca global
// ======================================================================
function openSearch() {
  const { el, close } = fullPanel('search-panel');
  el.innerHTML = `<div class="panel">
    <header class="panel-head"><button class="icon-btn" data-x>${icon('back')}</button>
      <input class="input grow" id="gsearch" placeholder="Buscar em todos os quadros..." autocomplete="off"></header>
    <div class="panel-body" id="gresults"><p class="muted center">Digite para buscar por título, descrição ou comentário.</p></div></div>`;
  const inp = el.querySelector('#gsearch');
  const out = el.querySelector('#gresults');
  setTimeout(() => inp.focus(), 80);
  inp.addEventListener('input', () => {
    const q = inp.value.trim().toLowerCase();
    if (!q) return (out.innerHTML = '');
    const res = store
      .activeCards()
      .concat(store.data.cards.filter((c) => c.archived))
      .filter((c) => c.title.toLowerCase().includes(q) || c.desc.toLowerCase().includes(q) || c.comments.some((m) => m.text.toLowerCase().includes(q)))
      .slice(0, 60);
    out.innerHTML = res.length ? res.map(agendaItem).join('') : '<p class="muted center">Nada encontrado.</p>';
  });
  el.addEventListener('click', (e) => {
    if (e.target.closest('[data-x]')) return close();
    const o = e.target.closest('[data-act="open-card"]');
    if (o) openCard(o.dataset.v);
    const t = e.target.closest('[data-act="toggle-done"]');
    if (t) {
      store.toggleDone(t.dataset.v);
      inp.dispatchEvent(new Event('input'));
    }
  });
}

// ======================================================================
// Eventos (delegação)
// ======================================================================
$app.addEventListener('click', async (e) => {
  const t = e.target.closest('[data-act]');
  if (!t) return;
  const v = t.dataset.v;
  switch (t.dataset.act) {
    case 'tab':
      state.tab = v;
      if (v !== 'history') state.historyBoard = '';
      render();
      if (v === 'settings') refreshNotifStatus();
      window.scrollTo(0, 0);
      break;
    case 'auth-mode':
      state.authMode = state.authMode === 'login' ? 'register' : 'login';
      render();
      break;
    case 'pick-user':
      $app.querySelector('[name=username]').value = v;
      $app.querySelector('[name=password]').focus();
      break;
    case 'toggle-pw': {
      const p = $app.querySelector('[name=password]');
      p.type = p.type === 'password' ? 'text' : 'password';
      break;
    }
    case 'forgot': {
      const u = $app.querySelector('[name=username]').value;
      if (!u) return toast('Digite seu usuário primeiro');
      const hint = await auth.getHint(u);
      if (hint === null) return toast('Usuário não encontrado');
      dialog({
        title: 'Dica da senha',
        message: hint ? `Sua dica: "${hint}"` : 'Nenhuma dica cadastrada. Como os dados são locais, não é possível redefinir a senha sem perder a conta.',
        cancel: null,
      });
      break;
    }
    case 'search':
      openSearch();
      break;
    case 'new-board':
      newBoard();
      break;
    case 'open-board':
      openBoard(v);
      break;
    case 'archived-boards':
      archivedBoards();
      break;
    case 'back':
      state.boardId = null;
      render();
      break;
    case 'rename-board':
      renameBoard();
      break;
    case 'star-board': {
      const b = store.board(state.boardId);
      store.updateBoard(b.id, { starred: !b.starred });
      haptic();
      break;
    }
    case 'toggle-filter':
      state.showFilter = !state.showFilter;
      render();
      if (state.showFilter) document.getElementById('filter-q')?.focus();
      break;
    case 'clear-filter':
      state.filter = { q: '', priority: 0, label: '', due: '' };
      render();
      break;
    case 'board-menu':
      boardMenu();
      break;
    case 'list-menu':
      listMenu(v);
      break;
    case 'rename-list':
      renameList(v);
      break;
    case 'new-list':
      newList();
      break;
    case 'compose':
      openComposer(v);
      break;
    case 'cancel-compose':
      render();
      break;
    case 'open-card':
      openCard(v);
      break;
    case 'toggle-done':
      store.toggleDone(v);
      haptic();
      break;
    case 'agenda-done':
      state.agendaShowDone = !state.agendaShowDone;
      render();
      break;
    case 'clear-history':
      if (await confirmDialog('Limpar histórico?', 'Todo o registro de atividades será apagado.', 'Limpar')) store.clearHistory();
      break;
    case 'theme':
      store.setSettings({ theme: v });
      applyTheme();
      break;
    case 'notif-allow': {
      const st = await notify.requestPermission();
      if (st === 'unsupported') toast('Notificações funcionam no app instalado');
      else if (st !== 'granted') toast('Permissão negada. Ative em Configurações > Apps > Demandas > Notificações');
      refreshNotifStatus();
      break;
    }
    case 'notif-exact':
      if (!native) return toast('Disponível no app Android');
      await notify.openExactAlarmSettings();
      refreshNotifStatus();
      break;
    case 'notif-test':
      if ((await notify.requestPermission()) !== 'granted') return toast('Permita as notificações primeiro');
      (await notify.testNotification()) ? toast('Notificação chega em 3 segundos') : toast('Disponível no app Android');
      break;
    case 'notif-resync':
      await resyncAllNotifications();
      toast('Lembretes reagendados');
      break;
    case 'export':
      exportBackup();
      break;
    case 'edit-name': {
      const name = await promptDialog('Seu nome', state.user.name);
      if (name) {
        state.user = await auth.updateProfile(state.user.id, { name });
        render();
      }
      break;
    }
    case 'edit-hint': {
      const hint = await promptDialog('Dica da senha', state.user.hint || '', 'Algo que te lembre a senha');
      if (hint != null) {
        state.user = await auth.updateProfile(state.user.id, { hint });
        toast('Dica salva');
      }
      break;
    }
    case 'change-pw': {
      const cur = await promptDialog('Senha atual', '', '', { type: 'password', ok: 'Continuar' });
      if (cur == null) return;
      const nx = await promptDialog('Nova senha', '', 'Mínimo 4 caracteres', { type: 'password' });
      if (nx == null) return;
      try {
        await auth.changePassword(state.user.id, cur, nx);
        toast('Senha alterada ✓');
      } catch (ex) {
        toast(ex.message);
      }
      break;
    }
    case 'logout':
      if (await confirmDialog('Sair da conta?', 'Seus dados continuam salvos neste aparelho.', 'Sair', false)) logout();
      break;
    case 'delete-account': {
      const pw = await promptDialog('Excluir conta', '', 'Digite sua senha para confirmar', { type: 'password', ok: 'Excluir', danger: true, message: 'Todos os quadros, cartões e histórico desta conta serão apagados.' });
      if (pw == null) return;
      if (!(await auth.verifyPassword(state.user.id, pw))) return toast('Senha incorreta');
      store.data.cards.forEach((c) => store.onCardChanged?.({ ...c, deleted: true }));
      await auth.deleteUser(state.user.id);
      await logout();
      toast('Conta excluída');
      break;
    }
  }
});

$app.addEventListener('change', (e) => {
  const t = e.target;
  if (t.dataset.filter) {
    state.filter[t.dataset.filter] = t.value;
    render();
  }
  const a = t.dataset.actChange;
  if (a === 'history-board') {
    state.historyBoard = t.value;
    render();
  }
  if (a === 'default-reminder') store.setSettings({ defaultReminder: +t.value });
  if (a === 'import') {
    importBackup(t.files[0]);
    t.value = '';
  }
});

// ======================================================================
// Notificações e integração nativa
// ======================================================================
function cardCtx(c) {
  const b = store.board(c.boardId);
  return { userId: store.userId, boardName: b?.name, boardArchived: !!b?.archived };
}

store.onCardChanged = (c) => notify.syncCard(c, cardCtx(c));

async function resyncAllNotifications() {
  for (const c of store.data.cards) await notify.syncCard(c, cardCtx(c));
}

async function applyPendingActions() {
  const all = await getJSON('pendingActions', []);
  if (!all.length) return;
  const mine = all.filter((a) => a.userId === state.user.id);
  mine.forEach((a) => {
    const c = store.card(a.cardId);
    if (c && a.type === 'done' && !c.done) store.updateCard(c.id, { done: true });
  });
  const rest = all.filter((a) => a.userId !== state.user.id);
  rest.length ? await setJSON('pendingActions', rest) : await removeKey('pendingActions');
}

async function handleNotificationAction(actionId, extra) {
  if (!extra.cardId) return;
  const sameUser = state.user && state.user.id === extra.userId;
  if (actionId === 'snooze') {
    await notify.snoozeNotification(extra, 15);
    if (sameUser && store.card(extra.cardId)) store.snooze(extra.cardId, 15);
    return;
  }
  if (actionId === 'done') {
    if (sameUser) {
      store.updateCard(extra.cardId, { done: true });
      toast('Demanda concluída ✓');
    } else {
      const all = await getJSON('pendingActions', []);
      all.push({ type: 'done', cardId: extra.cardId, userId: extra.userId, at: Date.now() });
      await setJSON('pendingActions', all);
    }
    return;
  }
  // toque na notificação: abre o cartão
  if (sameUser) openCard(extra.cardId);
  else pendingOpenCard = extra.cardId;
}

App.addListener('backButton', () => {
  if (closeTopOverlay()) return;
  if (state.user && state.boardId) {
    state.boardId = null;
    return render();
  }
  if (state.user && state.tab !== 'boards') {
    state.tab = 'boards';
    return render();
  }
  App.minimizeApp();
});

App.addListener('appStateChange', ({ isActive }) => {
  if (isActive && state.user && !hasOverlay()) render(); // atualiza "atrasadas", "hoje" etc.
});

store.subscribe(() => {
  if (state.user) render();
});

// Atualiza a tela a cada minuto (prazos mudam de status)
setInterval(() => {
  if (state.user && !hasOverlay() && !document.activeElement?.matches('input,textarea,select')) render();
}, 60000);

// ======================================================================
// Inicialização
// ======================================================================
(async function init() {
  applyTheme();
  await notify.initNotifications(handleNotificationAction);
  const session = await auth.loadSession();
  if (session) {
    const user = await auth.getUser(session.userId);
    if (user) {
      await auth.saveSession(user.id, true);
      return startSession(user);
    }
  }
  render();
})();
