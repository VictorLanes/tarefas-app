package com.victorlanes.demandas.widget;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.widget.Toast;

import com.victorlanes.demandas.MainActivity;

/**
 * Activity invisível que recebe os toques nos itens do widget.
 * "demandas://done/ID" conclui sem abrir o app; "demandas://card/ID" abre o cartão.
 */
public class WidgetActionActivity extends Activity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        Uri uri = getIntent() != null ? getIntent().getData() : null;
        if (uri != null && "done".equals(uri.getHost()) && uri.getLastPathSegment() != null) {
            String cardId = uri.getLastPathSegment();
            int r = WidgetData.complete(this, cardId);
            if (r == WidgetData.DONE) {
                Toast.makeText(this, "Demanda concluída ✓", Toast.LENGTH_SHORT).show();
                Widgets.updateAll(this);
                WidgetBridgePlugin.notifyDataChanged();
            } else if (r == WidgetData.NEEDS_APP) {
                openMain(uri); // recorrente: o app conclui e cria a próxima
            } else {
                Widgets.updateAll(this);
            }
        } else if (uri != null) {
            openMain(uri);
        }
        finish();
        overridePendingTransition(0, 0);
    }

    private void openMain(Uri uri) {
        Intent i = new Intent(Intent.ACTION_VIEW, uri, this, MainActivity.class);
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        startActivity(i);
    }
}
