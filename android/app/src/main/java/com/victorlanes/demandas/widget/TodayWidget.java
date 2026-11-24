package com.victorlanes.demandas.widget;

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.widget.RemoteViews;

import com.victorlanes.demandas.R;

/** Widget "Demandas de hoje": atrasadas, hoje e amanhã, com botão de concluir. */
public class TodayWidget extends AppWidgetProvider {

    @Override
    public void onUpdate(Context c, AppWidgetManager m, int[] ids) {
        updateWidgets(c, m, ids);
        m.notifyAppWidgetViewDataChanged(ids, R.id.widget_list);
    }

    @Override
    public void onReceive(Context c, Intent intent) {
        super.onReceive(c, intent);
        String a = intent.getAction();
        if (Intent.ACTION_DATE_CHANGED.equals(a) || Intent.ACTION_TIME_CHANGED.equals(a) || Intent.ACTION_TIMEZONE_CHANGED.equals(a)) {
            Widgets.updateAll(c);
        }
    }

    static void updateWidgets(Context c, AppWidgetManager m, int[] ids) {
        WidgetData.Snapshot s = WidgetData.load(c);
        for (int id : ids) {
            RemoteViews v = new RemoteViews(c.getPackageName(), R.layout.widget_today);

            String sub;
            if (!s.loggedIn) sub = "Toque para entrar";
            else if (s.overdue + s.today == 0) sub = s.tomorrow > 0 ? s.tomorrow + " para amanhã" : "Tudo em dia";
            else {
                StringBuilder b = new StringBuilder();
                if (s.overdue > 0) b.append(s.overdue).append(s.overdue == 1 ? " atrasada" : " atrasadas");
                if (s.today > 0) {
                    if (b.length() > 0) b.append(" · ");
                    b.append(s.today).append(" hoje");
                }
                sub = b.toString();
            }
            v.setTextViewText(R.id.widget_subtitle, sub);
            v.setTextColor(R.id.widget_subtitle, s.overdue > 0 ? 0xFFE2483D : c.getColor(R.color.widget_muted));

            Intent svc = new Intent(c, TodayWidgetService.class);
            svc.putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id);
            svc.setData(Uri.parse(svc.toUri(Intent.URI_INTENT_SCHEME)));
            v.setRemoteAdapter(R.id.widget_list, svc);
            v.setEmptyView(R.id.widget_list, R.id.widget_empty);
            v.setTextViewText(R.id.widget_empty, s.loggedIn ? "Nada pendente para hoje 🎉" : "Entre no app Demandas para ver suas tarefas");
            v.setPendingIntentTemplate(R.id.widget_list, Widgets.itemTemplate(c));

            v.setOnClickPendingIntent(R.id.widget_header, Widgets.openApp(c, "demandas://agenda", 1));
            v.setOnClickPendingIntent(R.id.widget_empty, Widgets.openApp(c, "demandas://agenda", 1));
            v.setOnClickPendingIntent(R.id.widget_add, Widgets.openApp(c, "demandas://new", 2));
            m.updateAppWidget(id, v);
        }
    }
}
