package com.adsfriendly.mobile;
import android.app.Activity;
import android.view.View;
import android.widget.TextView;
import com.adsfriendly.mobile.core.MobileModule;
import com.adsfriendly.mobile.core.ModuleCatalog;

final class ModuleProvider {
    static MobileModule create(ModuleCatalog catalog) {
        return new MobileModule() {
            public String id() { return "protection"; }
            public View create(Activity activity, String ignored) {
                TextView text = new TextView(activity); text.setPadding(24, 64, 24, 24);
                text.setText("AdsFriendly Core\n\nMedia Tools is not bundled in this build. This companion does not block ads inside Chrome or other Android apps. Use AdsFriendly's browser extension for browser protection.");
                return text;
            }
        };
    }
}
