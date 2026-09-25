package com.mahimaministries.app;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Intent;
import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(MahimaPushTokenPlugin.class);
        registerPlugin(MahimaTrayNotificationPlugin.class);
        super.onCreate(savedInstanceState);
        createNotificationChannels();
        MahimaCallIntentStore.saveFromIntent(this, getIntent());
        MahimaShareIntentStore.saveFromIntent(this, getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        MahimaCallIntentStore.saveFromIntent(this, intent);
        MahimaShareIntentStore.saveFromIntent(this, intent);
    }

    private void createNotificationChannels() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;

        NotificationManager nm = getSystemService(NotificationManager.class);
        if (nm == null) return;

        NotificationChannel chatChannel = new NotificationChannel(
            "jai-masih",
            "Jai Masih - Chat Messages",
            NotificationManager.IMPORTANCE_HIGH
        );
        chatChannel.setDescription("Real-time chat messages from the Mahima Ministry community");
        chatChannel.enableVibration(true);
        chatChannel.setVibrationPattern(new long[]{0, 250, 100, 250});
        chatChannel.enableLights(true);
        chatChannel.setLightColor(Color.parseColor("#047857"));
        chatChannel.setShowBadge(true);
        nm.createNotificationChannel(chatChannel);

        NotificationChannel callChannel = new NotificationChannel(
            "jai-masih-calls",
            "Jai Masih - Calls",
            NotificationManager.IMPORTANCE_HIGH
        );
        callChannel.setDescription("Incoming Jai Masih audio and video calls");
        callChannel.enableVibration(true);
        callChannel.setVibrationPattern(new long[]{0, 600, 250, 600, 250, 600});
        callChannel.enableLights(true);
        callChannel.setLightColor(Color.parseColor("#047857"));
        callChannel.setShowBadge(true);
        nm.createNotificationChannel(callChannel);
        NotificationChannel generalChannel = new NotificationChannel(
            "mahima-general",
            "Mahima Ministry - General",
            NotificationManager.IMPORTANCE_DEFAULT
        );
        generalChannel.setDescription("Prayer requests, meetings and general alerts");
        generalChannel.enableVibration(true);
        generalChannel.enableLights(true);
        generalChannel.setLightColor(Color.parseColor("#047857"));
        generalChannel.setShowBadge(true);
        nm.createNotificationChannel(generalChannel);
    }
}
