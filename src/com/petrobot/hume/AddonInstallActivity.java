package com.petrobot.hume;

import android.app.Activity;
import android.net.Uri;
import android.os.Bundle;

import java.io.InputStream;

/** Korie: "open with Korie" for a .korie file in a file manager or a browser's downloads. */
public final class AddonInstallActivity extends Activity {
    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        final Uri uri = getIntent() == null ? null : getIntent().getData();
        if (uri == null) {
            finish();
            return;
        }
        AddonUi.install(this, () -> {
            InputStream in = getContentResolver().openInputStream(uri);
            if (in == null) throw new java.io.IOException("the file could not be opened");
            return in;
        }, this::finish);
    }
}
