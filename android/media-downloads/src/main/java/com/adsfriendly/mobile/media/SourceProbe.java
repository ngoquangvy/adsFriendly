package com.adsfriendly.mobile.media;

import com.adsfriendly.mobile.core.ModuleCatalog;
import com.adsfriendly.mobile.core.SharedLink;
import java.net.URI;
import java.net.HttpURLConnection;
import java.util.Locale;

/** Bounded metadata requests; no license, cookie extraction, JS execution or full-body buffering. */
final class SourceProbe {
    record Checked(URI uri, String extension, String mime, long bytes, long expiresAt) {}
    static Checked check(String input, ModuleCatalog catalog) throws Exception {
        URI uri = SharedLink.parse(input);
        if (SharedLink.youtube(uri)) throw new IllegalArgumentException("YouTube page detected. The mobile YouTube resolver is not available yet; this is not a direct media file.");
        HttpURLConnection connection = open(uri, "HEAD");
        try {
            if (connection.getResponseCode() >= 400) { connection.disconnect(); connection = open(uri, "GET"); }
            if (connection.getResponseCode() < 200 || connection.getResponseCode() >= 300)
                throw new IllegalArgumentException("Source check rejected: HTTP " + connection.getResponseCode());
            URI finalUri = SharedLink.validate(connection.getURL().toURI());
            String mime = connection.getContentType();
            mime = mime == null ? "" : mime.split(";", 2)[0].trim().toLowerCase(Locale.ROOT);
            String path = finalUri.getPath(), suffix = path.lastIndexOf('.') < 0 ? "" : path.substring(path.lastIndexOf('.') + 1).toLowerCase(Locale.ROOT);
            String extension = catalog.extensionFor(mime, suffix);
            if (extension == null) throw new IllegalArgumentException("Not a supported direct audio/video file. HTML, HLS/DASH playlists, DRM and unresolved player pages need a separate resolver.");
            long bytes = connection.getContentLengthLong();
            String range = connection.getHeaderField("Content-Range");
            if (connection.getResponseCode() == 206) {
                bytes = -1;
                if (range != null && range.length() <= 128 && range.matches("bytes \\d+-\\d+/\\d+")) {
                    try { bytes = Long.parseLong(range.substring(range.lastIndexOf('/') + 1)); }
                    catch (NumberFormatException invalid) { bytes = -1; }
                }
            }
            return new Checked(finalUri, extension, mime, bytes, System.currentTimeMillis() + 30000);
        } finally { connection.disconnect(); }
    }
    private static HttpURLConnection open(URI uri, String method) throws Exception {
        for (int hop = 0; hop < 4; hop++) {
            SharedLink.validate(uri); SharedLink.requirePublicDns(uri);
            var connection = (HttpURLConnection) uri.toURL().openConnection();
            connection.setInstanceFollowRedirects(false);
            connection.setConnectTimeout(8000); connection.setReadTimeout(8000);
            connection.setRequestMethod(method);
            connection.setRequestProperty("User-Agent", "AdsFriendlyMobile/0.1");
            if (method.equals("GET")) connection.setRequestProperty("Range", "bytes=0-0");
            int status;
            try { status = connection.getResponseCode(); }
            catch (Exception error) { connection.disconnect(); throw error; }
            if (status < 300 || status >= 400) return connection;
            String location = connection.getHeaderField("Location"); connection.disconnect();
            if (location == null) throw new IllegalArgumentException("Redirect has no destination.");
            try { uri = uri.resolve(location); }
            catch (IllegalArgumentException invalid) { throw new IllegalArgumentException("Source returned an invalid redirect."); }
        }
        throw new IllegalArgumentException("Too many redirects during source check.");
    }
}
