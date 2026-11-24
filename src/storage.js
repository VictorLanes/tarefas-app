import { Preferences } from '@capacitor/preferences';

// Armazenamento local persistente (SharedPreferences no Android, localStorage no navegador)
export async function getJSON(key, fallback = null) {
  try {
    const { value } = await Preferences.get({ key });
    if (value == null) return fallback;
    return JSON.parse(value);
  } catch (e) {
    console.error('Falha ao ler', key, e);
    return fallback;
  }
}

export async function setJSON(key, data) {
  await Preferences.set({ key, value: JSON.stringify(data) });
}

export async function removeKey(key) {
  await Preferences.remove({ key });
}
