package com.adsfriendly.mobile;
import com.adsfriendly.mobile.core.MobileModule;
import com.adsfriendly.mobile.core.ModuleCatalog;
import com.adsfriendly.mobile.media.MediaDownloadsModule;

final class ModuleProvider {
    static MobileModule create(ModuleCatalog catalog) {
        if (!catalog.includes("media")) throw new IllegalStateException("Media is not registered in this profile");
        return new MediaDownloadsModule(catalog);
    }
}
