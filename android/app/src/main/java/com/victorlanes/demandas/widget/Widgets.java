package com.victorlanes.demandas.widget;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;

import com.victorlanes.demandas.MainActivity;
import com.victorlanes.demandas.R;

/** Utilidades comuns aos widgets. */
public class Widgets {

    /** Atualiza todos os widgets do app. */
    public static void updateAll(Context c) {
        AppWidgetManager m = AppWidgetManager.getInstance(c);
        int[] today = m.getAppWidgetIds(new ComponentName(c, TodayWidget.class));
        if (today.length > 0) {
            TodayWidget.updateWidgets(c, m, today);
            m.notifyAppWidgetViewDataChanged(today, R.id.widget_list);
        }
        int[] summary = m.getAppWidgetIds(new ComponentName(c, SummaryWidget.class));
        if (summary.length > 0) SummaryWidget.updateWidgets(c, m, summary);
        int[] quick = m.getAppWidgetIds(new ComponentName(c, QuickAddWidget.class));
        if (quick.length > 0) QuickAddWidget.updateWidgets(c, m, quick);
    }

    /** Abre o app num endereço interno, ex.: demandas://new, demandas://card/ID, demandas://agenda */
    public static PendingIntent openApp(Context c, String link, int requestCode) {
        Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse(link), c, MainActivity.class);
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE;
        return PendingIntent.getActivity(c, requestCode, i, flags);
    }

    /** Modelo de clique para os itens da lista (preenchido por item com demandas://done/ID ou demandas://card/ID). */
    public static PendingIntent itemTemplate(Context c) {
        Intent i = new Intent(c, WidgetActionActivity.class);
        i.setAction(Intent.ACTION_VIEW);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) flags |= PendingIntent.FLAG_MUTABLE;
        return PendingIntent.getActivity(c, 900, i, flags);
    }
}
