import com.adsfriendly.mobile.core.SharedLink;

public class SharedLinkChecks {
    private static int checks;
    private static void expect(boolean value) { if (!value) throw new AssertionError("Contract failed: " + checks); checks++; }
    private static void rejects(String text) {
        try { SharedLink.parse(text); throw new AssertionError("Unsafe source accepted"); }
        catch (IllegalArgumentException error) { expect(!error.getMessage().contains("secret")); }
    }
    public static void main(String[] args) {
        expect(SharedLink.parse("Shared track https://media.example.org/song.ogg?sig=secret").getPath().equals("/song.ogg"));
        expect(SharedLink.youtube(SharedLink.parse("https://youtu.be/abcdefghijk")));
        expect(!SharedLink.youtube(SharedLink.parse("https://notyoutube.com/song.mp4")));
        rejects(null); rejects(""); rejects("http://example.org/secret.mp4");
        rejects("https://user:secret@example.org/a.mp4");
        rejects("https://localhost/secret.mp4"); rejects("https://127.0.0.1/secret.mp4");
        rejects("https://foo.local/secret.mp4"); rejects("https://foo.local./secret.mp4");
        rejects("https://[::1]/secret.mp4"); rejects("https://example.org:8080/secret.mp4");
        rejects("https://example.org/a.mp4 https://example.org/b.mp4");
        rejects("https://" + "a".repeat(17000));
        System.out.println("Shared-link contracts passed: " + checks);
    }
}
