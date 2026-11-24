package com.victorlanes.demandas;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;
import com.victorlanes.demandas.widget.WidgetBridgePlugin;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(WidgetBridgePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
