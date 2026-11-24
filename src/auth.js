import { getJSON, setJSON, removeKey } from './storage.js';
import { uid } from './util.js';

const ITERATIONS = 150_000;
const USERS_KEY = 'users';
const SESSION_KEY = 'session';

const enc = new TextEncoder();
const toB64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const fromB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function hashPassword(password, saltB64) {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: fromB64(saltB64), iterations: ITERATIONS, hash: 'SHA-256' },
    key,
    256,
  );
  return toB64(bits);
}

const normalize = (u) => u.trim().toLowerCase();

export async function listUsers() {
  return getJSON(USERS_KEY, []);
}

export async function getUser(id) {
  return (await listUsers()).find((u) => u.id === id) || null;
}

export async function register({ name, username, password, hint }) {
  const users = await listUsers();
  username = normalize(username);
  if (!/^[a-z0-9._-]{3,30}$/.test(username))
    throw new Error('Usuário deve ter de 3 a 30 caracteres (letras, números, ponto, _ ou -).');
  if (password.length < 4) throw new Error('A senha precisa ter pelo menos 4 caracteres.');
  if (users.some((u) => u.username === username)) throw new Error('Esse usuário já existe neste aparelho.');
  const salt = toB64(crypto.getRandomValues(new Uint8Array(16)));
  const user = {
    id: uid(),
    name: name.trim() || username,
    username,
    salt,
    hash: await hashPassword(password, salt),
    hint: (hint || '').trim(),
    createdAt: Date.now(),
  };
  users.push(user);
  await setJSON(USERS_KEY, users);
  return user;
}

export async function login(username, password) {
  const users = await listUsers();
  const user = users.find((u) => u.username === normalize(username));
  if (!user) throw new Error('Usuário não encontrado neste aparelho.');
  const h = await hashPassword(password, user.salt);
  if (h !== user.hash) throw new Error('Senha incorreta.');
  user.lastLogin = Date.now();
  await setJSON(USERS_KEY, users);
  return user;
}

export async function getHint(username) {
  const u = (await listUsers()).find((x) => x.username === normalize(username));
  return u ? u.hint || '' : null;
}

export async function changePassword(userId, current, next) {
  const users = await listUsers();
  const user = users.find((u) => u.id === userId);
  if (!user) throw new Error('Usuário não encontrado.');
  if ((await hashPassword(current, user.salt)) !== user.hash) throw new Error('Senha atual incorreta.');
  if (next.length < 4) throw new Error('A nova senha precisa ter pelo menos 4 caracteres.');
  user.salt = toB64(crypto.getRandomValues(new Uint8Array(16)));
  user.hash = await hashPassword(next, user.salt);
  await setJSON(USERS_KEY, users);
}

export async function updateProfile(userId, patch) {
  const users = await listUsers();
  const user = users.find((u) => u.id === userId);
  if (!user) return;
  if (patch.name != null) user.name = patch.name.trim() || user.username;
  if (patch.hint != null) user.hint = patch.hint.trim();
  await setJSON(USERS_KEY, users);
  return user;
}

export async function verifyPassword(userId, password) {
  const user = await getUser(userId);
  return !!user && (await hashPassword(password, user.salt)) === user.hash;
}

export async function deleteUser(userId) {
  const users = (await listUsers()).filter((u) => u.id !== userId);
  await setJSON(USERS_KEY, users);
  await removeKey('data_' + userId);
}

// Sessão: "manter conectado" grava no armazenamento; senão vale só enquanto o app estiver aberto
let memorySession = null;

export async function saveSession(userId, remember) {
  memorySession = { userId };
  if (remember) await setJSON(SESSION_KEY, { userId, at: Date.now() });
  else await removeKey(SESSION_KEY);
}

export async function loadSession() {
  if (memorySession) return memorySession;
  return getJSON(SESSION_KEY, null);
}

export async function clearSession() {
  memorySession = null;
  await removeKey(SESSION_KEY);
}
