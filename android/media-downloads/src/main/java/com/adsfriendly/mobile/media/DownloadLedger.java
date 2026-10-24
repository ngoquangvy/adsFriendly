package com.adsfriendly.mobile.media;

import android.app.DownloadManager;
import android.content.Context;
import android.content.Intent;
import android.database.Cursor;
import android.os.Environment;
import org.json.JSONArray;
import org.json.JSONObject;
import java.util.UUID;

/** Our OS job IDs only. No browser history or source URLs are written to this ledger. */
final class DownloadLedger {
    record Item(long id, String name, long bytes, long total, int state, int reason) {}
    private final Context context;
    private final DownloadManager manager;
    DownloadLedger(Context context) { this.context = context; manager = context.getSystemService(DownloadManager.class); }
    synchronized void start(SourceProbe.Checked checked) throws Exception {
        if (checked.expiresAt() < System.currentTimeMillis()) throw new IllegalArgumentException("Source check expired. Check again.");
        String name = "AdsFriendly-" + UUID.randomUUID().toString().substring(0, 8) + "." + checked.extension();
        var request = new DownloadManager.Request(android.net.Uri.parse(checked.uri().toString()))
            .setTitle(name).setDescription("Original media · system download")
            .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE)
            .setDestinationInExternalFilesDir(context, Environment.DIRECTORY_DOWNLOADS, name);
        long id = manager.enqueue(request);
        try {
            JSONArray ids = ids();
            if (ids.length() >= 50) throw new IllegalArgumentException("History is full. Remove an old entry first.");
            ids.put(id);
            if (!context.getSharedPreferences("media", 0).edit().putString("jobIds", ids.toString()).commit()) throw new IllegalStateException("Could not save download ownership.");
        } catch (Exception error) { manager.remove(id); throw error; }
    }
    private JSONArray ids() { try { return new JSONArray(context.getSharedPreferences("media", 0).getString("jobIds", "[]")); } catch (Exception e) { return new JSONArray(); } }
    synchronized java.util.List<Item> list() {
        var result = new java.util.ArrayList<Item>(); JSONArray ids = ids();
        for (int i = ids.length() - 1; i >= 0; i--) {
            long id = ids.optLong(i);
            try (Cursor cursor = manager.query(new DownloadManager.Query().setFilterById(id))) {
                if (cursor == null || !cursor.moveToFirst()) continue;
                result.add(new Item(id, cursor.getString(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_TITLE)),
                    cursor.getLong(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR)),
                    cursor.getLong(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_TOTAL_SIZE_BYTES)),
                    cursor.getInt(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS)),
                    cursor.getInt(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_REASON))));
            }
        }
        return result;
    }
    void cancel(long id) { manager.remove(id); forget(id); }
    synchronized void forget(long id) {
        JSONArray next = new JSONArray(), previous = ids();
        for (int i = 0; i < previous.length(); i++) if (previous.optLong(i) != id) next.put(previous.optLong(i));
        context.getSharedPreferences("media", 0).edit().putString("jobIds", next.toString()).apply();
    }
    Intent fileIntent(long id, boolean share) {
        android.net.Uri uri = manager.getUriForDownloadedFile(id);
        if (uri == null) throw new IllegalArgumentException("File unavailable. Check the system download manager.");
        String mime = manager.getMimeTypeForDownloadedFile(id);
        if (mime == null) mime = "application/octet-stream";
        var intent = new Intent(share ? Intent.ACTION_SEND : Intent.ACTION_VIEW).setType(mime).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        if (share) intent.putExtra(Intent.EXTRA_STREAM, uri); else intent.setDataAndType(uri, mime);
        return intent;
    }
}
