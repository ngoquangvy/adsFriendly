package com.adsfriendly.mobile.core;

import java.net.URI;
import java.net.InetAddress;
import java.util.Locale;
import java.util.regex.Pattern;

/** Never log the input, which may contain a temporary signed query. */
public final class SharedLink {
    private static final Pattern URL = Pattern.compile("https://[^\\s<>\"']+", Pattern.CASE_INSENSITIVE);
    public static URI parse(String text) {
        if (text == null || text.length() > 16384) throw new IllegalArgumentException("Paste or share one HTTPS media URL.");
        var matches = URL.matcher(text.trim());
        if (!matches.find()) throw new IllegalArgumentException("Only HTTPS links are supported.");
        String value = matches.group();
        if (matches.find()) throw new IllegalArgumentException("Share one link at a time.");
        try { return validate(URI.create(value)); }
        catch (IllegalArgumentException error) { throw new IllegalArgumentException("Invalid public HTTPS link. Remove credentials or local addresses."); }
    }
    public static URI validate(URI uri) {
        String host = uri.getHost();
        if (!"https".equalsIgnoreCase(uri.getScheme()) || host == null || uri.getRawUserInfo() != null || uri.getPort() != -1 && uri.getPort() != 443)
            throw new IllegalArgumentException("Only credential-free public HTTPS links are supported.");
        host = host.toLowerCase(Locale.ROOT);
        if (host.endsWith(".")) host = host.substring(0, host.length() - 1);
        if (!host.contains(".") || host.endsWith(".local") || host.endsWith(".localhost") || host.matches("[0-9.]+") || host.contains(":"))
            throw new IllegalArgumentException("Local/private addresses are not supported.");
        return uri;
    }
    public static void requirePublicDns(URI uri) throws Exception {
        for (InetAddress address : InetAddress.getAllByName(uri.getHost()))
            if (address.isAnyLocalAddress() || address.isLoopbackAddress() || address.isLinkLocalAddress() || address.isSiteLocalAddress() || address.isMulticastAddress() || address.getAddress().length == 16 && (address.getAddress()[0] & 0xfe) == 0xfc)
                throw new IllegalArgumentException("Private network sources are not supported.");
    }
    public static boolean youtube(URI uri) {
        String h = uri.getHost().toLowerCase(Locale.ROOT);
        return h.equals("youtu.be") || h.equals("youtube.com") || h.endsWith(".youtube.com");
    }
}
