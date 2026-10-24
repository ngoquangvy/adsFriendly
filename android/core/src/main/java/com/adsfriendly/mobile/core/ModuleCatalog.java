package com.adsfriendly.mobile.core;

import android.content.Context;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.IOException;
import java.nio.charset.StandardCharsets;

public final class ModuleCatalog {
    private final JSONObject data;
    public ModuleCatalog(Context context) throws Exception {
        try (var input = context.getAssets().open("mobile-modules.json")) {
            var bytes = new java.io.ByteArrayOutputStream();
            byte[] buffer = new byte[4096]; int count;
            while ((count = input.read(buffer)) != -1) bytes.write(buffer, 0, count);
            data = new JSONObject(bytes.toString(StandardCharsets.UTF_8.name()));
        }
        if (data.optInt("schemaVersion") != 1) throw new IOException("Unsupported module schema");
    }
    public boolean includes(String id) {
        JSONArray modules = data.optJSONArray("modules");
        if (modules == null) return false;
        for (int i = 0; i < modules.length(); i++) if (id.equals(modules.optJSONObject(i).optString("id"))) return true;
        return false;
    }
    public String extensionFor(String mime, String fallback) {
        JSONArray formats = data.optJSONArray("directFormats");
        if (formats == null) return null;
        for (int i = 0; i < formats.length(); i++) {
            JSONObject format = formats.optJSONObject(i);
            JSONArray mimes = format.optJSONArray("mime");
            for (int j = 0; mimes != null && j < mimes.length(); j++) if (mime.equals(mimes.optString(j))) return format.optString("extension");
        }
        if (!mime.isEmpty() && !mime.equals("application/octet-stream")) return null;
        for (int i = 0; i < formats.length(); i++) if (fallback.equals(formats.optJSONObject(i).optString("extension"))) return fallback;
        return null;
    }
}
