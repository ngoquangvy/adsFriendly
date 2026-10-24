package com.adsfriendly.mobile.media;

import android.app.Activity;
import android.app.AlertDialog;
import android.app.DownloadManager;
import android.content.Intent;
import android.os.Handler;
import android.os.Looper;
import android.text.Editable;
import android.text.TextWatcher;
import android.view.View;
import android.widget.*;
import com.adsfriendly.mobile.core.MobileModule;
import com.adsfriendly.mobile.core.ModuleCatalog;
import java.util.HashMap;
import java.util.concurrent.Executors;

/** View owns UI lifecycle only; Android owns background transfers. */
public final class MediaDownloadsModule implements MobileModule {
    private final ModuleCatalog catalog;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final java.util.concurrent.ExecutorService worker = Executors.newSingleThreadExecutor();
    private final HashMap<Long, LinearLayout> rows = new HashMap<>();
    private Activity activity;
    private DownloadLedger ledger;
    private EditText input;
    private TextView status;
    private Button check, download;
    private LinearLayout history;
    private SourceProbe.Checked checked;
    private boolean visible, closed;
    private int generation;
    private final Runnable poll = new Runnable() { public void run() {
        if (!visible || closed) return;
        renderHistory(); main.postDelayed(this, 3000);
    }};
    public MediaDownloadsModule(ModuleCatalog catalog) { this.catalog = catalog; }
    public String id() { return "media"; }
    public View create(Activity activity, String sharedText) {
        this.activity = activity; ledger = new DownloadLedger(activity);
        var scroll = new ScrollView(activity);
        var root = new LinearLayout(activity); root.setOrientation(LinearLayout.VERTICAL); root.setPadding(24, 48, 24, 24); scroll.addView(root);
        scroll.setOnApplyWindowInsetsListener((view, insets) -> { root.setPadding(24, insets.getSystemWindowInsetTop() + 24, 24, insets.getSystemWindowInsetBottom() + 24); return insets; });
        TextView title = text("AdsFriendly · Media Tools", 24); root.addView(title);
        root.addView(text("Share a link from another app, or paste one HTTPS audio/video URL. Nothing downloads until you confirm.", 15));
        input = new EditText(activity); input.setHint("HTTPS media URL"); input.setSingleLine(false); input.setMinLines(2); input.setSaveEnabled(false);
        input.setInputType(android.text.InputType.TYPE_CLASS_TEXT | android.text.InputType.TYPE_TEXT_VARIATION_URI);
        if (sharedText != null && !sharedText.equals("null") && sharedText.length() <= 16384) input.setText(sharedText);
        root.addView(input);
        status = text("Original files only. YouTube pages, HLS/DASH and DRM require a future mobile resolver.", 14); root.addView(status);
        check = button("Check source", () -> checkSource()); root.addView(check);
        download = button("Download original", () -> confirm()); download.setEnabled(false); root.addView(download);
        root.addView(text("Downloads · saved in this app's files (removed on uninstall). Use Share to export. Downloaded means transfer completed, not media validation.", 15));
        history = new LinearLayout(activity); history.setOrientation(LinearLayout.VERTICAL); root.addView(history);
        input.addTextChangedListener(new TextWatcher() {
            public void beforeTextChanged(CharSequence s, int a, int c, int f) {}
            public void onTextChanged(CharSequence s, int a, int b, int c) { generation++; checked = null; download.setEnabled(false); check.setEnabled(true); }
            public void afterTextChanged(Editable e) {}
        });
        return scroll;
    }
    private TextView text(String value, int size) { var view = new TextView(activity); view.setText(value); view.setTextSize(size); view.setPadding(0, 12, 0, 12); return view; }
    private Button button(String label, Runnable action) { var view = new Button(activity); view.setText(label); view.setMinHeight(48); view.setOnClickListener(v -> action.run()); return view; }
    private void checkSource() {
        final String value = input.getText().toString(); final int epoch = ++generation;
        checked = null; check.setEnabled(false); download.setEnabled(false); status.setText("Checking response metadata…");
        worker.submit(() -> {
            try {
                var result = SourceProbe.check(value, catalog);
                main.post(() -> { if (closed || !visible || epoch != generation) return;
                    checked = result; check.setEnabled(true); download.setEnabled(true);
                    status.setText(result.uri().getHost() + " · Original " + result.extension().toUpperCase() + " · " + size(result.bytes()) + "\nCheck expires in 30 seconds; signed/session URLs may still expire during download.");
                });
            } catch (Exception error) { main.post(() -> { if (closed || !visible || epoch != generation) return;
                check.setEnabled(true); status.setText(error instanceof IllegalArgumentException ? error.getMessage() : "Source check failed: network, permission or browser-session requirements. No download started.");
            }); }
        });
    }
    private void confirm() {
        var ticket = checked;
        if (ticket == null) return;
        new AlertDialog.Builder(activity).setTitle("Download original file?")
            .setMessage("Android will save this " + ticket.extension().toUpperCase() + " file (" + size(ticket.bytes()) + "). Browser cookies are not copied. Playback compatibility is not guaranteed by a metadata check.")
            .setNegativeButton("Cancel", null).setPositiveButton("Download", (dialog, which) -> {
                if (!visible || closed || checked != ticket) return;
                try { ledger.start(ticket); checked = null; download.setEnabled(false); status.setText("Handed to Android Download Manager."); renderHistory(); }
                catch (Exception error) { status.setText("Could not start transfer, or source check expired. Check again. Chrome/other apps were not changed."); }
            }).show();
    }
    private void renderHistory() {
        try {
            var items = ledger.list(); var keep = new java.util.HashSet<Long>();
            for (var item : items) {
                keep.add(item.id());
                LinearLayout row = rows.get(item.id());
                if (row == null) {
                    row = new LinearLayout(activity); row.setOrientation(LinearLayout.VERTICAL);
                    row.addView(text(item.name(), 16)); row.addView(text("", 14));
                    row.addView(button("Open", () -> open(item.id(), false)));
                    row.addView(button("Share", () -> open(item.id(), true)));
                    row.addView(button("Cancel", () -> new AlertDialog.Builder(activity).setMessage("Cancel this app's download?").setNegativeButton("Keep", null).setPositiveButton("Cancel download", (d, w) -> { ledger.cancel(item.id()); renderHistory(); }).show()));
                    row.addView(button("Remove history", () -> { ledger.forget(item.id()); renderHistory(); }));
                    rows.put(item.id(), row); history.addView(row, 0);
                }
                boolean saved = item.state() == DownloadManager.STATUS_SUCCESSFUL;
                boolean active = item.state() != DownloadManager.STATUS_FAILED && !saved;
                String state = saved ? "Downloaded by Android" : item.state() == DownloadManager.STATUS_FAILED ? "Failed · system reason " + item.reason() : item.state() == DownloadManager.STATUS_PAUSED ? "Waiting for Android/network" : "Downloading";
                String progress = item.total() > 0 ? Math.min(100, item.bytes() * 100 / item.total()) + "% · " : "";
                ((TextView)row.getChildAt(1)).setText(state + " · " + (active ? progress : "") + size(item.bytes()));
                row.getChildAt(2).setVisibility(saved ? View.VISIBLE : View.GONE);
                row.getChildAt(3).setVisibility(saved ? View.VISIBLE : View.GONE);
                row.getChildAt(4).setVisibility(active ? View.VISIBLE : View.GONE);
                row.getChildAt(5).setVisibility(active ? View.GONE : View.VISIBLE);
            }
            for (long id : new java.util.ArrayList<>(rows.keySet())) if (!keep.contains(id)) history.removeView(rows.remove(id));
        } catch (Exception error) { status.setText("Could not read system download state. Existing downloads are unchanged."); }
    }
    private void open(long id, boolean share) {
        try { Intent intent = ledger.fileIntent(id, share); activity.startActivity(share ? Intent.createChooser(intent, "Export media") : intent); }
        catch (Exception error) { status.setText("No compatible app or file found. Try Share or the system file manager."); }
    }
    private static String size(long bytes) { return bytes < 0 ? "Size unavailable" : String.format(java.util.Locale.ROOT, "%.1f MB", bytes / 1_000_000.0); }
    public void onStart() { if (!closed && !visible) { visible = true; check.setEnabled(true); main.post(poll); } }
    public void onStop() { visible = false; generation++; main.removeCallbacks(poll); }
    public void close() { onStop(); closed = true; worker.shutdownNow(); }
}
