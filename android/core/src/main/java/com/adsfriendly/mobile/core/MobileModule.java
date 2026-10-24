package com.adsfriendly.mobile.core;

import android.app.Activity;
import android.view.View;

/** App shell knows this interface only. Removing media never removes the shell. */
public interface MobileModule {
    String id();
    View create(Activity activity, String sharedText);
    default void onStart() {}
    default void onStop() {}
    default void close() {}
}
