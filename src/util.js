export const uid = () =>
  Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

export const notifId = () => 2 * (1 + Math.floor(Math.random() * 900_000_000));

export function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Texto com quebras de linha e links clicáveis
export function richText(s) {
  return esc(s)
    .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>')
    .replace(/\n/g, '<br>');
}

const pad = (n) => String(n).padStart(2, '0');

export function startOfDay(d = new Date()) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function toInputValue(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function fromInputValue(v) {
  if (!v) return null;
  const t = new Date(v).getTime();
  return isNaN(t) ? null : t;
}

const WEEK = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

export function fmtTime(ts) {
  const d = new Date(ts);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function fmtDate(ts) {
  const d = new Date(ts);
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}

export function fmtDateTime(ts) {
  return `${fmtDate(ts)} ${fmtTime(ts)}`;
}

// "hoje 14:00", "amanhã 09:30", "qui 25 nov 10:00"
export function fmtDue(ts) {
  const d = new Date(ts);
  const today = startOfDay().getTime();
  const day = startOfDay(d).getTime();
  const diff = Math.round((day - today) / 86400000);
  const hm = fmtTime(ts);
  if (diff === 0) return `hoje ${hm}`;
  if (diff === 1) return `amanhã ${hm}`;
  if (diff === -1) return `ontem ${hm}`;
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return `${WEEK[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}${sameYear ? '' : ' ' + d.getFullYear()} ${hm}`;
}

export function fmtDayHeader(ts) {
  const today = startOfDay().getTime();
  const day = startOfDay(ts).getTime();
  const diff = Math.round((today - day) / 86400000);
  if (diff === 0) return 'Hoje';
  if (diff === 1) return 'Ontem';
  const d = new Date(ts);
  return `${WEEK[d.getDay()]}, ${d.getDate()} de ${MONTHS[d.getMonth()]} de ${d.getFullYear()}`;
}

export function relTime(ts) {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return 'agora';
  const m = Math.round(s / 60);
  if (m < 60) return `há ${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `há ${h} h`;
  const dd = Math.round(h / 24);
  if (dd < 30) return `há ${dd} d`;
  return fmtDate(ts);
}

// Situação do prazo: 'overdue' | 'soon' (próximas 24h) | 'future' | 'done' | null
export function dueState(card) {
  if (!card.due) return null;
  if (card.done) return 'done';
  const now = Date.now();
  if (card.due < now) return 'overdue';
  if (card.due - now < 86400000) return 'soon';
  return 'future';
}

export function debounce(fn, ms) {
  let t;
  return (...a) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
}
