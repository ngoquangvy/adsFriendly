# iOS 1.5.3: two test builds

These are separate unsigned IPAs for Sideloadly:

| Build        | Native features                                                       | Project                       |
| ------------ | --------------------------------------------------------------------- | ----------------------------- |
| Basic        | Safari protection, DNS profile export, direct HTTPS music/video files | AdsFriendly_iOS.xcodeproj     |
| YouTube test | All basic features, plus separate YouTube video/audio screen          | AdsFriendly_YouTube.xcodeproj |

Both currently use the same app/extension bundle identifiers. Installing one
replaces the other; it is an upgrade/downgrade test rather than side-by-side apps.
Keep the same Sideloadly signing identity to retain the container and settings.
Cancel active YouTube transfers before switching back to the basic edition,
which does not include their session handler or history UI. Saved YouTube files
remain in the app container and are accessible again in the advanced edition.
No website, payments, licensing or upgrade prompt is introduced at this stage.

## Source and build isolation

Basic source lists contain no YouTube implementation or package dependency.
The separate module is in `YouTubeEdition/`. The generated advanced Xcode
project references the existing basic files rather than copying protection code,
adds only the YouTube source files, selects its own composition JSON and links
YouTubeKit at revision `89854c93207ad0d2b3d78d6f1aea24595ca66552`.
Only that project defines `AF_YOUTUBE`. Source guards are additional protection;
the basic project does not even compile the optional files.

`scripts/build-ios-youtube-project.mjs` is the authority for the advanced project
and shared scheme. Regenerate it after changing the basic project.
`scripts/mobile-config.mjs` generates both profiles into different directories;
it refuses to overwrite the basic profile with the YouTube profile.
`ios:check` checks all generated files without modifying them.

The basic workflow checks executable/debug-dylib symbols and packaged resources
to reject leaked YouTube code. Its protection-only build still excludes all
native download implementations. The advanced workflow checks its own profile,
native module symbols, license and existing Package/DNS resources.

YouTubeKit is MIT licensed; the full notice is bundled only with the advanced
app. Extraction explicitly uses `methods: [.local]`, without OAuth/cache or the
library's optional remote fallback. Desktop Node Helper code is not imported.
YouTube can change its interface or restrict requests by location/network.
Build success and fixture tests do not establish live YouTube availability.

## User flow

Basic direct-file music support (MP3/M4A/OGG/Opus/FLAC/WAV and supported videos)
stays available in both editions through Media Tools. Those links must point
to a file, rather than a general website requiring a custom resolver.

In the YouTube edition:

1. Open YouTube · Video / Audio (test); paste a watch, Shorts or youtu.be link.
2. Analyze sources. Merely pasting/analyzing does not start a media transfer.
3. Choose audio or a video resolution. Each source is checked before the
   confirmation dialog; signed source URLs/checks expire.
4. Confirm download. Swipe a job to cancel, or Share a saved result to Files.

Audio defaults to native AAC/M4A. Within that format it selects the highest
declared average bitrate (otherwise declared bitrate); unknown bitrate ranks
below known data. Files stay original; there is no re-encoding or MP3 conversion.
The optional "Xem thêm nguồn WebM" button reveals the best original Opus/WebM
source with a separate compatibility warning. Bitrate across different codecs
is not a guarantee of relative quality. If AAC is unavailable, the screen says
so and never silently falls back to WebM. Video MP4 remains available if found.
WebM is saved/exported as WebM, never relabeled M4A. Tapping an existing saved
WebM explains its playback limits and offers export instead of Quick Look.
To get native playback for an old WebM download, analyze its YouTube link again
and download the M4A choice; this update does not convert existing files.

Video uses compatible H.264 MP4 and the best separately available AAC track,
even when a combined source also exists. If no separate AAC exists, a complete
progressive MP4 can be used; silent video-only sources are never offered.
AVFoundation merges the selected tracks without re-encoding, validates both
tracks/duration, and only then marks the file saved.

Both probe and acquisition validate response MIME, complete-file status/length
and exact googlevideo.com playback endpoints. Redirects must remain within that
scope for transfers. HTML, partial/truncated files, expired checks and unavailable
sources must not produce a saved result. Original WebM audio additionally gets
bounded EBML DocType, audio-only Opus track and cluster-bound inspection; this is
structural verification, not a decoder of every audio packet.

Transfers use a dedicated background URLSession. Final inspection/assembly runs
when the app is active; the UI says to reopen the app if needed. It does not
promise completion while force-quit. The private ledger stores generated file
names, roles, lengths and fixed status/reason codes; source URLs/tokens are held
only by memory/OS tasks. History is bounded to 50 jobs. Forget retains the saved
file; uninstall removes app-owned files, so export files you want to keep.

## Tests and physical acceptance

Existing Safari/Package/DNS/desktop suites must pass in addition to composition
checks. Advanced native tests use self-generated black video and silent AAC/Opus
fixtures to test byte-exact original audio, native AAC-to-PCM decoding of the
saved M4A and merged MP4, native mux audio+video, invalid files,
expiry, cancellation, history privacy and strict links. Synthetic requests are
intercepted by URLProtocol; they never reach YouTube.
Ranking/visibility tests cover higher-bitrate Opus alongside AAC, the best AAC
within its format, unknown bitrate, optional originals and Opus-only sources.
Workflows run on `main` and `ios/**`; the working branch is `ios/protection-dns`.

After deterministic tests, a separate live diagnostic on pushes (or the manual
`live_probe` input) analyzes the public Big Buck Bunny YouTube video and
preflights audio/video sources, without downloading the full video. This step
can fail due to the provider, region or GitHub runner's network and does not
prevent packaging the test IPA. Its outcome must be reported separately;
a green overall build must not be presented as proof that live extraction works.

On the iPhone, test at least one music-file link, one YouTube audio choice and
one video choice, then background/return, cancel, reopen during transfer, export,
playback/duration and saved file integrity. Repeat Block/Default/Allow, individual
Hide/Keep/Show, Package import/undo and DNS export after replacing the IPA.

## DNS profile instructions

Version 1.5.1 replaces the default Mail/export path with a bundled profile and
browser handoff; see [DNS handoff](DNS_PROFILE_HANDOFF.md). The paragraph below
describes the older 1.5.0 fallback, which is still available under custom DNS.

The main screen now shows the full sequence: keep the default endpoint unless
using your own resolver → consent → Export DNS file → Files/Mail → open the
`.mobileconfig` → Settings → Profile Downloaded → Install. If opening a local
Files item does not offer installation, open the Mail attachment or use the
official AdGuard DNS page in Safari. Creating/exporting is not activation.

Profiles are managed/removed in Settings → General → VPN & Device Management.
The profile contains removable DNS-over-HTTPS configuration, without a VPN or
decryption certificate. Queries go to the chosen DNS provider; domain filtering
does not block arbitrary HTTPS paths or every in-app advertisement.

See [download UI, naming and parallel transfers](DOWNLOAD_EXPERIENCE.md) for the 1.5.3 flow, migration and validation boundaries.
