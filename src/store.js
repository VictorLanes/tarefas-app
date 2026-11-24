import { getJSON, setJSON } from './storage.js';
import { uid, notifId } from './util.js';

export const LABEL_COLORS = ['#4bce97', '#f5cd47', '#fea362', '#f87168', '#9f8fef', '#579dff', '#6cc3e0', '#94c748'];
export const BOARD_COLORS = ['#0c66e4', '#1f845a', '#c9372c', '#6e5dc6', '#e2b203', '#227d9b', '#ae4787', '#505f79'];
export const PRIORITIES = {
  0: { name: 'Sem prioridade', color: 'transparent' },
  1: { name: 'Baixa', color: '#4bce97' },
  2: { name: 'Média', color: '#f5cd47' },
  3: { name: 'Alta', color: '#fea362' },
  4: { name: 'Urgente', color: '#f87168' },
};
export const REMINDERS = [
  [-1, 'Sem lembrete'],
  [0, 'Na hora do prazo'],
  [5, '5 minutos antes'],
  [15, '15 minutos antes'],
  [30, '30 minutos antes'],
  [60, '1 hora antes'],
  [120, '2 horas antes'],
  [1440, '1 dia antes'],
  [2880, '2 dias antes'],
];
export const REPEATS = [
  ['', 'Não repete'],
  ['day', 'Todo dia'],
  ['week', 'Toda semana'],
  ['month', 'Todo mês'],
];

const MAX_HISTORY = 3000;

function emptyData() {
  return {
    version: 1,
    boards: [],
    lists: [],
    cards: [],
    history: [],
    settings: { theme: 'system', defaultReminder: 15 },
  };
}

class Store {
  constructor() {
    this.userId = null;
    this.data = emptyData();
    this.listeners = new Set();
    this.onCardChanged = null; // ligado às notificações
  }

  async load(userId) {
    this.userId = userId;
    const d = await getJSON('data_' + userId, null);
    this.data = Object.assign(emptyData(), d || {});
    this.data.settings = Object.assign(emptyData().settings, this.data.settings || {});
    return this.data;
  }

  unload() {
    this.userId = null;
    this.data = emptyData();
  }

  async save() {
    if (!this.userId) return;
    await setJSON('data_' + this.userId, this.data);
  }

  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  commit() {
    this.save();
    this.listeners.forEach((fn) => fn());
  }

  log(type, text, ref = {}) {
    this.data.history.unshift({ id: uid(), at: Date.now(), type, text, ...ref });
    if (this.data.history.length > MAX_HISTORY) this.data.history.length = MAX_HISTORY;
  }

  // ---------- Consultas ----------
  get settings() {
    return this.data.settings;
  }
  boards(includeArchived = false) {
    return this.data.boards.filter((b) => includeArchived || !b.archived).sort((a, b) => a.order - b.order);
  }
  board(id) {
    return this.data.boards.find((b) => b.id === id);
  }
  lists(boardId) {
    return this.data.lists.filter((l) => l.boardId === boardId).sort((a, b) => a.order - b.order);
  }
  list(id) {
    return this.data.lists.find((l) => l.id === id);
  }
  cards(listId, includeArchived = false) {
    return this.data.cards
      .filter((c) => c.listId === listId && (includeArchived || !c.archived))
      .sort((a, b) => a.order - b.order);
  }
  card(id) {
    return this.data.cards.find((c) => c.id === id);
  }
  boardCards(boardId, includeArchived = false) {
    return this.data.cards.filter((c) => c.boardId === boardId && (includeArchived || !c.archived));
  }
  activeCards() {
    const liveBoards = new Set(this.boards().map((b) => b.id));
    return this.data.cards.filter((c) => !c.archived && liveBoards.has(c.boardId));
  }
  doneList(boardId) {
    return this.lists(boardId).find((l) => l.isDone);
  }

  // ---------- Quadros ----------
  createBoard(name, color, withDefaultLists = true) {
    const b = {
      id: uid(),
      name: name.trim() || 'Novo quadro',
      color: color || BOARD_COLORS[this.data.boards.length % BOARD_COLORS.length],
      labels: [
        { id: uid(), color: LABEL_COLORS[0], name: '' },
        { id: uid(), color: LABEL_COLORS[1], name: '' },
        { id: uid(), color: LABEL_COLORS[2], name: '' },
        { id: uid(), color: LABEL_COLORS[3], name: '' },
        { id: uid(), color: LABEL_COLORS[4], name: '' },
        { id: uid(), color: LABEL_COLORS[5], name: '' },
      ],
      order: Date.now(),
      createdAt: Date.now(),
      starred: false,
      archived: false,
    };
    this.data.boards.push(b);
    if (withDefaultLists) {
      ['A fazer', 'Fazendo', 'Concluído'].forEach((n, i) => {
        this.data.lists.push({ id: uid(), boardId: b.id, name: n, order: i, isDone: i === 2 });
      });
    }
    this.log('board_create', `Criou o quadro "${b.name}"`, { boardId: b.id });
    this.commit();
    return b;
  }

  updateBoard(id, patch) {
    const b = this.board(id);
    if (!b) return;
    if (patch.name != null && patch.name.trim() && patch.name.trim() !== b.name) {
      this.log('board_rename', `Renomeou o quadro "${b.name}" para "${patch.name.trim()}"`, { boardId: id });
      b.name = patch.name.trim();
    }
    if (patch.color) b.color = patch.color;
    if (patch.starred != null) b.starred = patch.starred;
    if (patch.labels) b.labels = patch.labels;
    if (patch.archived != null && patch.archived !== b.archived) {
      b.archived = patch.archived;
      this.log(patch.archived ? 'board_archive' : 'board_restore',
        `${patch.archived ? 'Arquivou' : 'Restaurou'} o quadro "${b.name}"`, { boardId: id });
      this.boardCards(id).forEach((c) => this.onCardChanged?.(c));
    }
    this.commit();
  }

  deleteBoard(id) {
    const b = this.board(id);
    if (!b) return;
    const cards = this.data.cards.filter((c) => c.boardId === id);
    cards.forEach((c) => this.onCardChanged?.({ ...c, deleted: true }));
    this.data.cards = this.data.cards.filter((c) => c.boardId !== id);
    this.data.lists = this.data.lists.filter((l) => l.boardId !== id);
    this.data.boards = this.data.boards.filter((x) => x.id !== id);
    this.log('board_delete', `Excluiu o quadro "${b.name}" (${cards.length} cartões)`);
    this.commit();
  }

  // ---------- Listas ----------
  createList(boardId, name) {
    const lists = this.lists(boardId);
    const l = { id: uid(), boardId, name: name.trim() || 'Nova lista', order: lists.length ? lists[lists.length - 1].order + 1 : 0, isDone: false };
    this.data.lists.push(l);
    this.log('list_create', `Criou a lista "${l.name}"`, { boardId });
    this.commit();
    return l;
  }

  updateList(id, patch) {
    const l = this.list(id);
    if (!l) return;
    if (patch.name != null && patch.name.trim() && patch.name.trim() !== l.name) {
      this.log('list_rename', `Renomeou a lista "${l.name}" para "${patch.name.trim()}"`, { boardId: l.boardId });
      l.name = patch.name.trim();
    }
    if (patch.isDone != null) {
      // só uma lista de concluídos por quadro
      if (patch.isDone) this.lists(l.boardId).forEach((x) => (x.isDone = false));
      l.isDone = patch.isDone;
    }
    this.commit();
  }

  reorderLists(boardId, orderedIds) {
    orderedIds.forEach((id, i) => {
      const l = this.list(id);
      if (l && l.boardId === boardId) l.order = i;
    });
    this.commit();
  }

  deleteList(id) {
    const l = this.list(id);
    if (!l) return;
    const cards = this.data.cards.filter((c) => c.listId === id);
    cards.forEach((c) => this.onCardChanged?.({ ...c, deleted: true }));
    this.data.cards = this.data.cards.filter((c) => c.listId !== id);
    this.data.lists = this.data.lists.filter((x) => x.id !== id);
    this.log('list_delete', `Excluiu a lista "${l.name}" (${cards.length} cartões)`, { boardId: l.boardId });
    this.commit();
  }

  archiveListCards(id) {
    const l = this.list(id);
    const cards = this.cards(id);
    cards.forEach((c) => {
      c.archived = true;
      c.updatedAt = Date.now();
      this.onCardChanged?.(c);
    });
    this.log('list_archive', `Arquivou ${cards.length} cartões da lista "${l.name}"`, { boardId: l.boardId });
    this.commit();
  }

  // ---------- Cartões ----------
  createCard(listId, title, extra = {}) {
    const l = this.list(listId);
    const cards = this.cards(listId, true);
    const c = {
      id: uid(),
      listId,
      boardId: l.boardId,
      title: title.trim(),
      desc: '',
      priority: 0,
      due: null,
      reminder: this.settings.defaultReminder,
      repeat: '',
      labels: [],
      checklist: [],
      comments: [],
      done: !!l.isDone,
      doneAt: l.isDone ? Date.now() : null,
      archived: false,
      order: cards.length ? Math.max(...cards.map((x) => x.order)) + 1 : 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      notifId: notifId(),
      ...extra,
    };
    this.data.cards.push(c);
    this.log('card_create', `Criou o cartão "${c.title}" em "${l.name}"`, { boardId: c.boardId, cardId: c.id });
    this.onCardChanged?.(c);
    this.commit();
    return c;
  }

  updateCard(id, patch, { silent = false } = {}) {
    const c = this.card(id);
    if (!c) return;
    const ref = { boardId: c.boardId, cardId: c.id };
    const msgs = [];
    if (patch.title != null && patch.title.trim() && patch.title.trim() !== c.title) {
      msgs.push(`Renomeou "${c.title}" para "${patch.title.trim()}"`);
      c.title = patch.title.trim();
    }
    if (patch.desc != null && patch.desc !== c.desc) {
      c.desc = patch.desc;
      msgs.push(`Editou a descrição de "${c.title}"`);
    }
    if (patch.priority != null && +patch.priority !== c.priority) {
      c.priority = +patch.priority;
      msgs.push(`Definiu prioridade ${PRIORITIES[c.priority].name.toLowerCase()} em "${c.title}"`);
    }
    if ('due' in patch && patch.due !== c.due) {
      c.due = patch.due;
      msgs.push(c.due ? `Definiu prazo de "${c.title}"` : `Removeu o prazo de "${c.title}"`);
    }
    if (patch.reminder != null && +patch.reminder !== c.reminder) c.reminder = +patch.reminder;
    if (patch.repeat != null) c.repeat = patch.repeat;
    if (patch.labels) c.labels = patch.labels;
    if (patch.checklist) c.checklist = patch.checklist;
    if (patch.done != null && patch.done !== c.done) {
      this._setDone(c, patch.done);
      msgs.push(patch.done ? `Concluiu "${c.title}"` : `Reabriu "${c.title}"`);
    }
    if (patch.archived != null && patch.archived !== c.archived) {
      c.archived = patch.archived;
      msgs.push(patch.archived ? `Arquivou "${c.title}"` : `Restaurou "${c.title}"`);
    }
    c.updatedAt = Date.now();
    if (!silent) msgs.forEach((m) => this.log('card_update', m, ref));
    this.onCardChanged?.(c);
    this.commit();
  }

  _setDone(c, done) {
    c.done = done;
    c.doneAt = done ? Date.now() : null;
    const dl = this.doneList(c.boardId);
    if (done && dl && c.listId !== dl.id) {
      c.listId = dl.id;
      c.order = -Date.now();
    }
    if (!done && dl && c.listId === dl.id) {
      const first = this.lists(c.boardId).find((l) => !l.isDone);
      if (first) c.listId = first.id;
    }
    // demanda recorrente: ao concluir, cria a próxima ocorrência
    if (done && c.repeat && c.due) {
      const next = new Date(c.due);
      if (c.repeat === 'day') next.setDate(next.getDate() + 1);
      if (c.repeat === 'week') next.setDate(next.getDate() + 7);
      if (c.repeat === 'month') next.setMonth(next.getMonth() + 1);
      const target = this.lists(c.boardId).find((l) => !l.isDone) || this.list(c.listId);
      setTimeout(() => {
        this.createCard(target.id, c.title, {
          desc: c.desc,
          priority: c.priority,
          due: next.getTime(),
          reminder: c.reminder,
          repeat: c.repeat,
          labels: [...c.labels],
          checklist: c.checklist.map((i) => ({ ...i, id: uid(), done: false })),
          done: false,
          doneAt: null,
        });
      }, 0);
      c.repeat = '';
    }
  }

  toggleDone(id) {
    const c = this.card(id);
    if (c) this.updateCard(id, { done: !c.done });
  }

  moveCard(id, toListId, index = null) {
    const c = this.card(id);
    const to = this.list(toListId);
    if (!c || !to) return;
    const from = this.list(c.listId);
    const siblings = this.cards(toListId).filter((x) => x.id !== id);
    if (index == null || index > siblings.length) index = siblings.length;
    siblings.splice(index, 0, c);
    siblings.forEach((x, i) => (x.order = i));
    const changedList = from?.id !== to.id;
    c.listId = to.id;
    c.boardId = to.boardId;
    c.updatedAt = Date.now();
    if (changedList) {
      this.log('card_move', `Moveu "${c.title}" de "${from?.name ?? '?'}" para "${to.name}"`, { boardId: c.boardId, cardId: c.id });
      if (to.isDone && !c.done) {
        c.done = true;
        c.doneAt = Date.now();
        this.log('card_update', `Concluiu "${c.title}"`, { boardId: c.boardId, cardId: c.id });
      } else if (!to.isDone && c.done && from?.isDone) {
        c.done = false;
        c.doneAt = null;
        this.log('card_update', `Reabriu "${c.title}"`, { boardId: c.boardId, cardId: c.id });
      }
    }
    this.onCardChanged?.(c);
    this.commit();
  }

  duplicateCard(id) {
    const c = this.card(id);
    if (!c) return;
    return this.createCard(c.listId, c.title + ' (cópia)', {
      desc: c.desc,
      priority: c.priority,
      due: c.due,
      reminder: c.reminder,
      labels: [...c.labels],
      checklist: c.checklist.map((i) => ({ ...i, id: uid() })),
    });
  }

  deleteCard(id) {
    const c = this.card(id);
    if (!c) return;
    this.onCardChanged?.({ ...c, deleted: true });
    this.data.cards = this.data.cards.filter((x) => x.id !== id);
    this.log('card_delete', `Excluiu o cartão "${c.title}"`, { boardId: c.boardId });
    this.commit();
  }

  addComment(id, text) {
    const c = this.card(id);
    if (!c || !text.trim()) return;
    c.comments.push({ id: uid(), text: text.trim(), at: Date.now() });
    c.updatedAt = Date.now();
    this.log('card_comment', `Comentou em "${c.title}"`, { boardId: c.boardId, cardId: c.id });
    this.commit();
  }

  deleteComment(id, commentId) {
    const c = this.card(id);
    if (!c) return;
    c.comments = c.comments.filter((x) => x.id !== commentId);
    this.commit();
  }

  addChecklistItem(id, text) {
    const c = this.card(id);
    if (!c || !text.trim()) return;
    c.checklist.push({ id: uid(), text: text.trim(), done: false });
    this.commit();
  }

  toggleChecklistItem(id, itemId) {
    const c = this.card(id);
    const it = c?.checklist.find((x) => x.id === itemId);
    if (!it) return;
    it.done = !it.done;
    if (it.done) this.log('check_done', `Marcou "${it.text}" em "${c.title}"`, { boardId: c.boardId, cardId: c.id });
    this.commit();
  }

  removeChecklistItem(id, itemId) {
    const c = this.card(id);
    if (!c) return;
    c.checklist = c.checklist.filter((x) => x.id !== itemId);
    this.commit();
  }

  snooze(id, minutes) {
    const c = this.card(id);
    if (!c) return;
    const base = Math.max(Date.now(), c.due || 0);
    this.updateCard(id, { due: base + minutes * 60000, reminder: 0 }, { silent: true });
    this.log('card_update', `Adiou "${c.title}" em ${minutes} min`, { boardId: c.boardId, cardId: c.id });
    this.commit();
  }

  // ---------- Histórico / ajustes / backup ----------
  clearHistory() {
    this.data.history = [];
    this.commit();
  }

  setSettings(patch) {
    Object.assign(this.data.settings, patch);
    this.commit();
  }

  exportJSON(user) {
    return JSON.stringify({ app: 'tarefas-app', exportedAt: new Date().toISOString(), user: { name: user.name, username: user.username }, data: this.data }, null, 2);
  }

  importJSON(text) {
    const parsed = JSON.parse(text);
    const d = parsed.data || parsed;
    if (!Array.isArray(d.boards) || !Array.isArray(d.cards) || !Array.isArray(d.lists))
      throw new Error('Arquivo de backup inválido.');
    // cancela lembretes atuais antes de substituir
    this.data.cards.forEach((c) => this.onCardChanged?.({ ...c, deleted: true }));
    this.data = Object.assign(emptyData(), d);
    this.data.cards.forEach((c) => {
      if (!c.notifId) c.notifId = notifId();
      this.onCardChanged?.(c);
    });
    this.log('import', `Importou backup (${d.boards.length} quadros, ${d.cards.length} cartões)`);
    this.commit();
  }
}

export const store = new Store();
