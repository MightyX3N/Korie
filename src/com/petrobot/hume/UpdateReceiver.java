package com.petrobot.hume;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInstaller;

/** Korie: what Android's installer says about an update Korie handed it (see Updater). */
public class UpdateReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context c, Intent i) {
        int status = i.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE);
        if (status == PackageInstaller.STATUS_PENDING_USER_ACTION) {
            // Android wants to ask first: show its own install question.
            Intent ask = i.getParcelableExtra(Intent.EXTRA_INTENT);
            if (ask != null) {
                try {
                    c.startActivity(ask.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
                } catch (Exception e) {
                    Addons.toast("Could not open Android's install question: " + e.getMessage());
                }
            }
        } else if (status != PackageInstaller.STATUS_SUCCESS) {
            String why = i.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE);
            android.util.Log.w("KorieUpdate", "installer: " + status + " " + why);
            if (status != PackageInstaller.STATUS_FAILURE_ABORTED) Addons.toast("The update was not installed" + (why == null ? "" : ": " + why));
        }
    }
}
