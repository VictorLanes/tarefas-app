import { Capacitor } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';
import { fmtDue } from './util.js';

const native = Capacitor.isNativePlatform();
const CHANNEL = 'lembretes';

export const notificationsSupported = native;

export async function initNotifications(onAction) {
  if (!native) return;
  try {
    await LocalNotifications.createChannel({
      id: CHANNEL,
      name: 'Lembretes de demandas',
      description: 'Avisos de prazo das suas demandas',
      importance: 5,
      visibility: 1,
      vibration: true,
      lights: true,
    });
    await LocalNotifications.registerActionTypes({
      types: [
        {
          id: 'CARD',
          actions: [
            { id: 'done', title: '✓ Concluir' },
            { id: 'snooze', title: 'Adiar 15 min' },
          ],
        },
      ],
    });
    await LocalNotifications.addListener('localNotificationActionPerformed', (e) => {
      onAction(e.actionId, e.notification?.extra || {});
    });
  } catch (e) {
    console.error('initNotifications', e);
  }
}

export async function permissionStatus() {
  if (!native) return 'unsupported';
  const p = await LocalNotifications.checkPermissions();
  return p.display;
}

export async function requestPermission() {
  if (!native) return 'unsupported';
  let p = await LocalNotifications.checkPermissions();
  if (p.display !== 'granted') p = await LocalNotifications.requestPermissions();
  return p.display;
}

export async function exactAlarmStatus() {
  if (!native) return 'unsupported';
  try {
    return (await LocalNotifications.checkExactNotificationSetting()).exact_alarm;
  } catch {
    return 'granted';
  }
}

export async function openExactAlarmSettings() {
  if (!native) return;
  try {
    await LocalNotifications.changeExactNotificationSetting();
  } catch (e) {
    console.error(e);
  }
}

async function cancelIds(ids) {
  if (!native || !ids.length) return;
  try {
    await LocalNotifications.cancel({ notifications: ids.map((id) => ({ id })) });
  } catch (e) {
    console.error('cancel', e);
  }
}

function build(id, title, body, at, extra) {
  return {
    id,
    title,
    body,
    largeBody: body,
    channelId: CHANNEL,
    actionTypeId: 'CARD',
    smallIcon: 'ic_stat_notify',
    iconColor: '#0c66e4',
    autoCancel: true,
    schedule: { at: new Date(at), allowWhileIdle: true },
    extra,
  };
}

// Agenda (ou cancela) os lembretes de um cartão: um antes do prazo e outro na hora
export async function syncCard(card, ctx) {
  if (!native || !card?.notifId) return;
  const idBefore = card.notifId;
  const idDue = card.notifId + 1;
  await cancelIds([idBefore, idDue]);
  if (card.deleted || card.done || card.archived || !card.due || card.reminder < 0 || ctx.boardArchived) return;
  const now = Date.now() + 2000;
  const extra = { cardId: card.id, userId: ctx.userId, notifId: card.notifId, title: card.title };
  const where = ctx.boardName ? `${ctx.boardName} · ` : '';
  const list = [];
  if (card.reminder > 0) {
    const at = card.due - card.reminder * 60000;
    if (at > now) list.push(build(idBefore, `⏰ ${card.title}`, `${where}Prazo ${fmtDue(card.due)}`, at, extra));
  }
  if (card.due > now) list.push(build(idDue, `🔔 Prazo agora: ${card.title}`, `${where}Venceu ${fmtDue(card.due)}`, card.due, extra));
  if (!list.length) return;
  try {
    await LocalNotifications.schedule({ notifications: list });
  } catch (e) {
    console.error('schedule', e);
  }
}

export async function snoozeNotification(extra, minutes = 15) {
  if (!native) return;
  const at = Date.now() + minutes * 60000;
  await LocalNotifications.schedule({
    notifications: [build((extra.notifId || 2) + 1, `🔔 ${extra.title || 'Demanda'}`, `Adiada por ${minutes} min`, at, extra)],
  });
}

export async function testNotification() {
  if (!native) return false;
  await LocalNotifications.schedule({
    notifications: [build(7, '✅ Notificações funcionando', 'Você receberá lembretes dos prazos das suas demandas.', Date.now() + 3000, {})],
  });
  return true;
}
