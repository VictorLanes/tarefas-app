package com.victorlanes.demandas.widget;

import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.widget.RemoteViews;
import android.widget.RemoteViewsService;

import com.victorlanes.demandas.R;

import java.util.ArrayList;
import java.util.List;

/** Fornece as linhas da lista do widget "Demandas de hoje". */
public class TodayWidgetService extends RemoteViewsService {
    @Override
    public RemoteViewsFactory onGetViewFactory(Intent intent) {
        return new Factory(getApplicationContext());
    }

    static class Factory implements RemoteViewsFactory {
        private final Context c;
        private List<WidgetData.Item> items = new ArrayList<>();

        Factory(Context c) {
            this.c = c;
        }

        @Override public void onCreate() {}
        @Override public void onDestroy() {}

        @Override
        public void onDataSetChanged() {
            items = WidgetData.load(c).items;
        }

        @Override
        public int getCount() {
            return items.size();
        }

        @Override
        public RemoteViews getViewAt(int pos) {
            RemoteViews v = new RemoteViews(c.getPackageName(), R.layout.widget_today_item);
            if (pos >= items.size()) return v;
            WidgetData.Item it = items.get(pos);
            v.setTextViewText(R.id.item_title, it.title);
            v.setTextViewText(R.id.item_subtitle, it.subtitle);
            v.setTextViewText(R.id.item_time, it.timeLabel);
            int timeColor = it.bucket == 0 ? 0xFFE2483D : it.bucket == 1 ? c.getColor(R.color.widget_accent) : c.getColor(R.color.widget_muted);
            v.setTextColor(R.id.item_time, timeColor);
            if (it.priority > 0) {
                v.setViewVisibility(R.id.item_priority, android.view.View.VISIBLE);
                v.setInt(R.id.item_priority, "setColorFilter", WidgetData.PRIORITY_COLORS[it.priority]);
            } else {
                v.setViewVisibility(R.id.item_priority, android.view.View.GONE);
            }
            Intent done = new Intent();
            done.setData(Uri.parse("demandas://done/" + it.id));
            v.setOnClickFillInIntent(R.id.item_check, done);
            Intent open = new Intent();
            open.setData(Uri.parse("demandas://card/" + it.id));
            v.setOnClickFillInIntent(R.id.item_body, open);
            return v;
        }

        @Override public RemoteViews getLoadingView() { return null; }
        @Override public int getViewTypeCount() { return 1; }
        @Override public long getItemId(int pos) { return pos < items.size() ? items.get(pos).id.hashCode() : pos; }
        @Override public boolean hasStableIds() { return true; }
    }
}
