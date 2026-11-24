package com.victorlanes.demandas.widget;

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.widget.RemoteViews;

import com.victorlanes.demandas.R;

/** Widget "Resumo": pendentes, atrasadas e para hoje. */
public class SummaryWidget extends AppWidgetProvider {
    @Override
    public void onUpdate(Context c, AppWidgetManager m, int[] ids) {
        updateWidgets(c, m, ids);
    }

    static void updateWidgets(Context c, AppWidgetManager m, int[] ids) {
        WidgetData.Snapshot s = WidgetData.load(c);
        for (int id : ids) {
            RemoteViews v = new RemoteViews(c.getPackageName(), R.layout.widget_summary);
            v.setTextViewText(R.id.sum_open, s.loggedIn ? String.valueOf(s.open) : "–");
            v.setTextViewText(R.id.sum_overdue, s.loggedIn ? String.valueOf(s.overdue) : "–");
            v.setTextViewText(R.id.sum_today, s.loggedIn ? String.valueOf(s.today) : "–");
            v.setTextColor(R.id.sum_overdue, s.overdue > 0 ? 0xFFE2483D : c.getColor(R.color.widget_text));
            v.setTextColor(R.id.sum_today, s.today > 0 ? 0xFFE07A00 : c.getColor(R.color.widget_text));
            v.setOnClickPendingIntent(R.id.widget_root, Widgets.openApp(c, "demandas://agenda", 3));
            m.updateAppWidget(id, v);
        }
    }
}
