package com.mahimaministries.app;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.firebase.messaging.FirebaseMessaging;
import android.content.Context;
import android.content.SharedPreferences;

@CapacitorPlugin(name = "MahimaPushToken")
public class MahimaPushTokenPlugin extends Plugin {
    private static final String PREFS = "mahima_call_intents";
    private static final String PENDING_CALL_JSON = "pending_call_json";
    private static final String SHARE_PREFS = "mahima_share_intents";
    private static final String PENDING_SHARE_JSON = "pending_share_json";

    @PluginMethod
    public void getToken(PluginCall call) {
        FirebaseMessaging.getInstance().getToken()
            .addOnCompleteListener(task -> {
                if (!task.isSuccessful()) {
                    Exception ex = task.getException();
                    call.reject(ex != null ? ex.getMessage() : "Unable to get Firebase token");
                    return;
                }

                String token = task.getResult();
                JSObject ret = new JSObject();
                ret.put("token", token == null ? "" : token);
                call.resolve(ret);
            });
    }
    @PluginMethod
    public void getPendingCallIntent(PluginCall call) {
        SharedPreferences prefs = getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String json = prefs.getString(PENDING_CALL_JSON, "");
        prefs.edit().remove(PENDING_CALL_JSON).apply();

        JSObject ret = new JSObject();
        ret.put("json", json == null ? "" : json);
        call.resolve(ret);
    }

    @PluginMethod
    public void getPendingShareIntent(PluginCall call) {
        SharedPreferences prefs = getContext().getSharedPreferences(SHARE_PREFS, Context.MODE_PRIVATE);
        String json = prefs.getString(PENDING_SHARE_JSON, "");
        prefs.edit().remove(PENDING_SHARE_JSON).apply();

        JSObject ret = new JSObject();
        ret.put("json", json == null ? "" : json);
        call.resolve(ret);
    }
}
