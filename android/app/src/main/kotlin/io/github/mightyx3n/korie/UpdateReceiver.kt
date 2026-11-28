package io.github.mightyx3n.korie

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller

/** Android's installer reports here; when it needs the viewer to confirm, its screen is opened. */
class UpdateReceiver : BroadcastReceiver() {
    override fun onReceive(c: Context, i: Intent) {
        when (i.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE)) {
            PackageInstaller.STATUS_PENDING_USER_ACTION -> {
                @Suppress("DEPRECATION")
                val confirm = i.getParcelableExtra<Intent>(Intent.EXTRA_INTENT) ?: return
                confirm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                try { c.startActivity(confirm) } catch (_: Exception) {}
            }
            PackageInstaller.STATUS_SUCCESS -> {}
            else -> {
                // Play Protect blocking it, too little space, a broken download…: Korie says so.
                val status = i.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE)
                val msg = i.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE)
                android.util.Log.w("KorieUpdate", "install: $status $msg")
                MainActivity.installFailed(status, msg)
            }
        }
    }
}
