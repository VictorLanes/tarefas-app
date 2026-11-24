package com.victorlanes.demandas.widget;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.os.Build;
import android.util.Log;

import androidx.core.app.NotificationManagerCompat;

import com.capacitorjs.plugins.localnotifications.NotificationStorage;
import com.capacitorjs.plugins.localnotifications.TimedNotificationPublisher;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Calendar;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * Lê (e altera) os dados do app direto do armazenamento do Capacitor Preferences
 * (SharedPreferences "CapacitorStorage"). O app grava o usuário logado em "widget_user".
 */
public class WidgetData {
    private static final String TAG = "DemandasWidget";
    public static final String PREFS = "CapacitorStorage";

    public static final int[] PRIORITY_COLORS = {
        Color.TRANSPARENT,
        Color.parseColor("#4BCE97"),
        Color.parseColor("#F5CD47"),
        Color.parseColor("#FEA362"),
        Color.parseColor("#F87168"),
    };

    public static class Item {
        public String id;
        public String title;
        public String subtitle;
        public String timeLabel;
        public int bucket; // 0 atrasada, 1 hoje, 2 amanhã
        public int priority;
        public long due;
    }

    public static class Snapshot {
        public boolean loggedIn;
        public final List<Item> items = new ArrayList<>();
        public int open;
        public int overdue;
        public int today;
        public int tomorrow;
    }

    private static SharedPreferences prefs(Context c) {
        return c.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    public static String userId(Context c) {
        String v = prefs(c).getString("widget_user", null);
        return (v == null || v.isEmpty()) ? null : v;
    }

    private static JSONObject loadData(Context c, String uid) {
        try {
            String s = prefs(c).getString("data_" + uid, null);
            return s == null ? null : new JSONObject(s);
        } catch (Exception e) {
            Log.e(TAG, "Falha ao ler dados", e);
            return null;
        }
    }

    private static long startOfToday() {
        Calendar cal = Calendar.getInstance();
        cal.set(Calendar.HOUR_OF_DAY, 0);
        cal.set(Calendar.MINUTE, 0);
        cal.set(Calendar.SECOND, 0);
        cal.set(Calendar.MILLISECOND, 0);
        return cal.getTimeInMillis();
    }

    private static String hm(long ts) {
        Calendar cal = Calendar.getInstance();
        cal.setTimeInMillis(ts);
        return String.format(Locale.US, "%02d:%02d", cal.get(Calendar.HOUR_OF_DAY), cal.get(Calendar.MINUTE));
    }

    private static String dm(long ts) {
        Calendar cal = Calendar.getInstance();
        cal.setTimeInMillis(ts);
        return String.format(Locale.US, "%02d/%02d", cal.get(Calendar.DAY_OF_MONTH), cal.get(Calendar.MONTH) + 1);
    }

    public static Snapshot load(Context c) {
        Snapshot snap = new Snapshot();
        String uid = userId(c);
        if (uid == null) return snap;
        JSONObject data = loadData(c, uid);
        if (data == null) return snap;
        snap.loggedIn = true;
        try {
            Map<String, String> boards = new HashMap<>();
            JSONArray ba = data.optJSONArray("boards");
            if (ba != null) for (int i = 0; i < ba.length(); i++) {
                JSONObject b = ba.getJSONObject(i);
                if (!b.optBoolean("archived")) boards.put(b.getString("id"), b.optString("name"));
            }
            Map<String, String> lists = new HashMap<>();
            JSONArray la = data.optJSONArray("lists");
            if (la != null) for (int i = 0; i < la.length(); i++) {
                JSONObject l = la.getJSONObject(i);
                lists.put(l.getString("id"), l.optString("name"));
            }
            long now = System.currentTimeMillis();
            long t0 = startOfToday();
            long day = 86_400_000L;
            JSONArray ca = data.optJSONArray("cards");
            if (ca != null) for (int i = 0; i < ca.length(); i++) {
                JSONObject card = ca.getJSONObject(i);
                if (card.optBoolean("archived") || card.optBoolean("done")) continue;
                String boardName = boards.get(card.optString("boardId"));
                if (boardName == null) continue;
                snap.open++;
                long due = card.optLong("due", 0);
                if (due <= 0) continue;
                int bucket;
                String label;
                if (due < now) {
                    bucket = 0;
                    snap.overdue++;
                    label = due >= t0 ? "atrasada " + hm(due) : "atrasada " + dm(due);
                } else if (due < t0 + day) {
                    bucket = 1;
                    snap.today++;
                    label = hm(due);
                } else if (due < t0 + 2 * day) {
                    bucket = 2;
                    snap.tomorrow++;
                    label = "amanhã " + hm(due);
                } else {
                    continue;
                }
                Item it = new Item();
                it.id = card.getString("id");
                it.title = card.optString("title");
                String listName = lists.get(card.optString("listId"));
                it.subtitle = listName == null ? boardName : boardName + " · " + listName;
                it.timeLabel = label;
                it.bucket = bucket;
                it.priority = Math.max(0, Math.min(4, card.optInt("priority", 0)));
                it.due = due;
                snap.items.add(it);
            }
            Collections.sort(snap.items, (a, b) -> Long.compare(a.due, b.due));
        } catch (Exception e) {
            Log.e(TAG, "Falha ao montar widget", e);
        }
        return snap;
    }

    /** Resultado de {@link #complete}. */
    public static final int DONE = 0;
    public static final int NEEDS_APP = 1;
    public static final int NOT_FOUND = -1;

    /**
     * Conclui a demanda direto pelo widget. Demandas recorrentes são concluídas pelo app
     * (para criar a próxima ocorrência), por isso retornam NEEDS_APP.
     */
    public static synchronized int complete(Context c, String cardId) {
        String uid = userId(c);
        if (uid == null) return NOT_FOUND;
        JSONObject data = loadData(c, uid);
        if (data == null) return NOT_FOUND;
        try {
            JSONArray ca = data.getJSONArray("cards");
            JSONObject card = null;
            for (int i = 0; i < ca.length(); i++) {
                if (cardId.equals(ca.getJSONObject(i).optString("id"))) {
                    card = ca.getJSONObject(i);
                    break;
                }
            }
            if (card == null) return NOT_FOUND;
            if (card.optBoolean("done")) return DONE;
            String repeat = card.optString("repeat", "");
            if (!repeat.isEmpty() && card.optLong("due", 0) > 0) return NEEDS_APP;

            long now = System.currentTimeMillis();
            card.put("done", true);
            card.put("doneAt", now);
            card.put("updatedAt", now);

            // move para a lista de concluídos do quadro, se existir
            JSONArray la = data.optJSONArray("lists");
            if (la != null) for (int i = 0; i < la.length(); i++) {
                JSONObject l = la.getJSONObject(i);
                if (l.optBoolean("isDone") && card.optString("boardId").equals(l.optString("boardId"))) {
                    card.put("listId", l.getString("id"));
                    card.put("order", -now);
                    break;
                }
            }

            // registra no histórico
            JSONObject h = new JSONObject();
            h.put("id", Long.toString(now, 36) + "w");
            h.put("at", now);
            h.put("type", "card_update");
            h.put("text", "Concluiu \"" + card.optString("title") + "\" pelo widget");
            h.put("boardId", card.optString("boardId"));
            h.put("cardId", cardId);
            JSONArray oldHist = data.optJSONArray("history");
            JSONArray hist = new JSONArray();
            hist.put(h);
            if (oldHist != null) for (int i = 0; i < oldHist.length() && i < 2999; i++) hist.put(oldHist.get(i));
            data.put("history", hist);

            prefs(c).edit().putString("data_" + uid, data.toString()).commit();

            int nid = card.optInt("notifId", 0);
            if (nid > 0) {
                cancelNotification(c, nid);
                cancelNotification(c, nid + 1);
            }
            return DONE;
        } catch (Exception e) {
            Log.e(TAG, "Falha ao concluir", e);
            return NOT_FOUND;
        }
    }

    /** Cancela um lembrete agendado pelo plugin Local Notifications. */
    private static void cancelNotification(Context c, int id) {
        try {
            Intent intent = new Intent(c, TimedNotificationPublisher.class);
            int flags = PendingIntent.FLAG_NO_CREATE;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) flags |= PendingIntent.FLAG_MUTABLE;
            PendingIntent pi = PendingIntent.getBroadcast(c, id, intent, flags);
            if (pi != null) {
                AlarmManager am = (AlarmManager) c.getSystemService(Context.ALARM_SERVICE);
                am.cancel(pi);
                pi.cancel();
            }
            new NotificationStorage(c).deleteNotification(String.valueOf(id));
            NotificationManagerCompat.from(c).cancel(id);
        } catch (Exception e) {
            Log.e(TAG, "Falha ao cancelar lembrete " + id, e);
        }
    }
}
