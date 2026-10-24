package com.adsfriendly.mobile;

import android.app.Activity;
import android.content.Intent;
import android.os.Bundle;
import android.widget.TextView;
import com.adsfriendly.mobile.core.MobileModule;
import com.adsfriendly.mobile.core.ModuleCatalog;

public final class MainActivity extends Activity {
    private MobileModule module;
    @Override public void onCreate(Bundle state) { super.onCreate(state); show(getIntent()); }
    @Override public void onNewIntent(Intent intent) { super.onNewIntent(intent); setIntent(intent); show(intent); }
    private void show(Intent intent) {
        if (module != null) module.close();
        module = null;
        try {
            ModuleCatalog catalog = new ModuleCatalog(this);
            module = ModuleProvider.create(catalog);
            String text = Intent.ACTION_SEND.equals(intent.getAction()) ? String.valueOf(intent.getCharSequenceExtra(Intent.EXTRA_TEXT)) : "";
            setContentView(module.create(this, text));
            module.onStart();
        } catch (Exception error) {
            // Optional media failure cannot make the application unlaunchable.
            var message = new TextView(this); message.setPadding(24, 64, 24, 24);
            message.setText("AdsFriendly\n\nMedia module unavailable. Protection configuration and the desktop/Safari extensions are independent.");
            setContentView(message);
        }
    }
    @Override protected void onStart() { super.onStart(); if (module != null) module.onStart(); }
    @Override protected void onStop() { if (module != null) module.onStop(); super.onStop(); }
    @Override protected void onDestroy() { if (module != null) module.close(); super.onDestroy(); }
}
