package com.victorlanes.demandas.widget;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** Ponte entre o app (JavaScript) e os widgets. */
@CapacitorPlugin(name = "WidgetBridge")
public class WidgetBridgePlugin extends Plugin {
    private static WidgetBridgePlugin instance;

    @Override
    public void load() {
        instance = this;
    }

    /** Chamado pelo app sempre que os dados mudam. */
    @PluginMethod
    public void refresh(PluginCall call) {
        Widgets.updateAll(getContext());
        call.resolve();
    }

    /** Avisa o app (se estiver aberto) que o widget alterou os dados. */
    public static void notifyDataChanged() {
        WidgetBridgePlugin p = instance;
        if (p != null && p.getBridge() != null) {
            p.getBridge().executeOnMainThread(() -> p.notifyListeners("dataChanged", new JSObject()));
        }
    }
}
