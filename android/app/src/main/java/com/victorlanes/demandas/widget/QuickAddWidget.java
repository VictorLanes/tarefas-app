package com.victorlanes.demandas.widget;

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.widget.RemoteViews;

import com.victorlanes.demandas.R;

/** Widget 1x1 que abre o app direto na criação de uma nova demanda. */
public class QuickAddWidget extends AppWidgetProvider {
    @Override
    public void onUpdate(Context c, AppWidgetManager m, int[] ids) {
        updateWidgets(c, m, ids);
    }

    static void updateWidgets(Context c, AppWidgetManager m, int[] ids) {
        for (int id : ids) {
            RemoteViews v = new RemoteViews(c.getPackageName(), R.layout.widget_quickadd);
            v.setOnClickPendingIntent(R.id.widget_root, Widgets.openApp(c, "demandas://new", 4));
            m.updateAppWidget(id, v);
        }
    }
}
