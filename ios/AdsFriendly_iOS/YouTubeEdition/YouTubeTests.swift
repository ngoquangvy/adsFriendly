#if AF_YOUTUBE && !AF_PROTECTION_ONLY
import XCTest
import AVFoundation
@testable import AdsFriendly_iOS

private final class YouTubePendingProtocol: URLProtocol {
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {} // Tasks stay pending; no request reaches the internet.
    override func stopLoading() {}
}

final class YouTubeTests: XCTestCase {
    private let sourceURL = URL(string: "https://r1---sn-fixture.googlevideo.com/videoplayback?token=never-store-this")!

    @MainActor
    func testLivePublicYouTubeSourceWhenExplicitlyEnabled() async throws {
        guard ProcessInfo.processInfo.environment["AF_YOUTUBE_LIVE_PROBE"] == "1" else {
            throw XCTSkip("Live network probe disabled; deterministic tests do not contact YouTube.")
        }
        let sources = try await YouTubeSourceResolver.resolve("https://www.youtube.com/watch?v=aqz-KE-bpKQ")
        let audio = try XCTUnwrap(sources.choices.first(where: { !$0.hasVideo }))
        let video = try XCTUnwrap(sources.choices.first(where: { $0.hasVideo }))
        let preparedAudio = try await YouTubeSourceResolver.prepare(audio, expiresAt: sources.expiresAt)
        let preparedVideo = try await YouTubeSourceResolver.prepare(video, expiresAt: sources.expiresAt)
        XCTAssertFalse(preparedAudio.hasVideo); XCTAssertTrue(preparedVideo.hasVideo)
        XCTAssertTrue(preparedAudio.tracks.allSatisfy { $0.source.expiresAt > Date() })
    }

    func testYouTubeLinksRejectSpoofingAmbiguityAndPlaylistsWithoutVideo() throws {
        for link in ["https://youtu.be/aqz-KE-bpKQ", "https://www.youtube.com/watch?v=aqz-KE-bpKQ",
                     "https://m.youtube.com/shorts/aqz-KE-bpKQ", "https://music.youtube.com/watch?v=aqz-KE-bpKQ"] {
            XCTAssertEqual(try YouTubeLink.videoID(link), "aqz-KE-bpKQ")
        }
        for link in ["https://youtube.com.evil.example/watch?v=aqz-KE-bpKQ", "https://youtu.be/too-short",
                     "https://youtube.com/watch?v=aqz-KE-bpKQ&v=abcdefghijk", "https://youtube.com/playlist?list=test",
                     "javascript:alert(1)", "https://user:pass@youtube.com/watch?v=aqz-KE-bpKQ"] {
            XCTAssertThrowsError(try YouTubeLink.videoID(link))
        }
        XCTAssertNoThrow(try YouTubeLink.mediaURL(sourceURL))
        for link in ["https://googlevideo.com.evil.example/videoplayback", "https://r1.googlevideo.com/other",
                     "http://r1.googlevideo.com/videoplayback", "https://r1.googlevideo.com/videoplayback#fragment"] {
            XCTAssertThrowsError(try YouTubeLink.mediaURL(XCTUnwrap(URL(string: link))))
        }
    }

    @MainActor
    func testOriginalAudioCommitIsByteExactAndHistoryDoesNotStoreURLs() async throws {
        for ext in ["m4a", "webm"] {
            let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
            let config = URLSessionConfiguration.ephemeral; config.protocolClasses = [YouTubePendingProtocol.self]
            let store = YouTubeDownloadStore(directory: directory, configuration: config, observeApp: false)
            defer { store.invalidate(); try? FileManager.default.removeItem(at: directory) }
            let data = try fixture(ext)
            let plan = prepared(ext: ext, bytes: data.count)
            try store.start(plan)
            let id = try XCTUnwrap(store.jobs.first?.id)
            let incoming = directory.appendingPathComponent("incoming-" + ext)
            try data.write(to: incoming)
            let mime = ext == "m4a" ? "audio/mp4" : "audio/webm"
            let response = try XCTUnwrap(HTTPURLResponse(url: sourceURL, statusCode: 200, httpVersion: "HTTP/1.1",
                headerFields: ["Content-Type": mime, "Content-Length": String(data.count)]))
            store.receive(id: id, role: "audio", response: response, location: incoming)
            try await wait { store.jobs.first?.state == "saved" || store.jobs.first?.state == "failed" }
            XCTAssertEqual(store.jobs.first?.state, "saved")
            let output = try XCTUnwrap(store.output(id))
            XCTAssertEqual(try Data(contentsOf: output), data)
            let history = try String(contentsOf: directory.appendingPathComponent("history.json"), encoding: .utf8)
            XCTAssertFalse(history.contains("googlevideo")); XCTAssertFalse(history.contains("never-store-this"))
            store.forget(id)
            XCTAssertTrue(store.jobs.isEmpty)
            XCTAssertTrue(FileManager.default.fileExists(atPath: output.path), "Forgetting history must keep the exported source file.")
        }
    }

    @MainActor
    func testRejectedResponseExpiredCheckAndCancellationCannotReportSaved() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let config = URLSessionConfiguration.ephemeral; config.protocolClasses = [YouTubePendingProtocol.self]
        let store = YouTubeDownloadStore(directory: directory, configuration: config, observeApp: false)
        defer { store.invalidate(); try? FileManager.default.removeItem(at: directory) }
        let expired = prepared(ext: "m4a", bytes: 7, expires: Date().addingTimeInterval(-1))
        XCTAssertThrowsError(try store.start(expired)); XCTAssertTrue(store.jobs.isEmpty)
        try store.start(prepared(ext: "m4a", bytes: 7))
        let id = try XCTUnwrap(store.jobs.first?.id)
        let file = directory.appendingPathComponent("html")
        try Data("<html/>".utf8).write(to: file)
        let response = try XCTUnwrap(HTTPURLResponse(url: sourceURL, statusCode: 200, httpVersion: "HTTP/1.1",
            headerFields: ["Content-Type": "text/html", "Content-Length": "7"]))
        store.receive(id: id, role: "audio", response: response, location: file)
        XCTAssertEqual(store.jobs.first?.state, "failed"); XCTAssertNil(store.output(id))
        try store.start(prepared(ext: "m4a", bytes: 7))
        let cancelled = try XCTUnwrap(store.jobs.first?.id)
        store.cancel(cancelled)
        XCTAssertEqual(store.jobs.first?.state, "cancelled"); XCTAssertNil(store.output(cancelled))
        store.receive(id: cancelled, role: "audio", response: response, location: file)
        XCTAssertEqual(store.jobs.first?.state, "cancelled")
    }

    func testNativeMergeProducesBothTracksAndRejectsNonMedia() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let video = directory.appendingPathComponent("video.mp4"), audio = directory.appendingPathComponent("audio.m4a")
        let output = directory.appendingPathComponent("combined.mp4")
        try fixture("video").write(to: video); try fixture("m4a").write(to: audio)
        try await YouTubeAssembler.merge(video: video, audio: audio, destination: output)
        let asset = AVURLAsset(url: output)
        let videos = try await asset.loadTracks(withMediaType: .video)
        let audios = try await asset.loadTracks(withMediaType: .audio)
        XCTAssertEqual(videos.count, 1); XCTAssertEqual(audios.count, 1)
        let duration = try await asset.load(.duration).seconds
        XCTAssertEqual(duration, 1, accuracy: 0.1)
        let invalid = directory.appendingPathComponent("invalid")
        try Data("not-media".utf8).write(to: invalid)
        do { try await YouTubeAssembler.validate(invalid, hasVideo: false); XCTFail("Invalid media accepted") } catch {}
    }

    func testWebMInspectorRejectsTruncatedAndVideoTrackData() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let url = directory.appendingPathComponent("audio.webm")
        let data = try fixture("webm")
        try data.write(to: url); XCTAssertNoThrow(try YouTubeWebMAudio.validate(url))
        try data.prefix(30).write(to: url); XCTAssertThrowsError(try YouTubeWebMAudio.validate(url))
        var wrong = data
        if let range = wrong.range(of: Data("A_OPUS".utf8)) { wrong.replaceSubrange(range, with: Data("V_VP09".utf8)) }
        try wrong.write(to: url); XCTAssertThrowsError(try YouTubeWebMAudio.validate(url))
    }

    @MainActor
    private func wait(_ condition: () -> Bool) async throws {
        for _ in 0..<200 {
            if condition() { return }
            try await Task.sleep(nanoseconds: 50_000_000)
        }
        XCTFail("Native file completion timed out")
        throw YouTubeDownloadError.interrupted
    }
    private func prepared(ext: String, bytes: Int, expires: Date = Date().addingTimeInterval(30)) -> YouTubePreparedDownload {
        .init(label: "Audio fixture", tracks: [.init(role: "audio",
            source: .init(url: sourceURL, fileExtension: ext, bytes: Int64(bytes), expiresAt: expires))],
              outputExtension: ext, hasVideo: false, expiresAt: expires)
    }

    // Generated locally from black frames and silence with FFmpeg; no external media.
    // 64x64 H.264 / 1 second, AAC mono / 1 second, Opus mono / 1 second.
    private func fixture(_ name: String) throws -> Data {
        let encoded: String
        switch name {
        case "video": encoded = "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"
        case "m4a": encoded = "AAAAHGZ0eXBNNEEgAAACAE00QSBpc29taXNvMgAAAAhmcmVlAAAAzW1kYXTeAgBMYXZjNjIuMjkuMTAxAAIwQA4BGCAHARggBwEYIAcBGCAHARggBwEYIAcBGCAHARggBwEYIAcBGCAHARggBwEYIAcBGCAHARggBwEYIAcBGCAHARggBwEYIAcBGCAHARggBwEYIAcBGCAHARggBwEYIAcBGCAHARggBwEYIAcBGCAHARggBwEYIAcBGCAHARggBwEYIAcBGCAHARggBwEYIAcBGCAHARggBwEYIAcBGCAHARggBwEYIAcBGCAHARggBwAAA69tb292AAAAbG12aGQAAAAAAAAAAAAAAAAAAAPoAAAD6AABAAABAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACAAAC2XRyYWsAAABcdGtoZAAAAAMAAAAAAAAAAAAAAAEAAAAAAAAD6AAAAAAAAAAAAAAAAQEAAAAAAQAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAACRlZHRzAAAAHGVsc3QAAAAAAAAAAQAAA+gAAAQAAAEAAAAAAlFtZGlhAAAAIG1kaGQAAAAAAAAAAAAAAAAAAKxEAACwRFXEAAAAAAAtaGRscgAAAAAAAAAAc291bgAAAAAAAAAAAAAAAFNvdW5kSGFuZGxlcgAAAAH8bWluZgAAABBzbWhkAAAAAAAAAAAAAAAkZGluZgAAABxkcmVmAAAAAAAAAAEAAAAMdXJsIAAAAAEAAAHAc3RibAAAAGpzdHNkAAAAAAAAAAEAAABabXA0YQAAAAAAAAABAAAAAAAAAAAAAQAQAAAAAKxEAAAAAAA2ZXNkcwAAAAADgICAJQABAASAgIAXQBUAAAAAAfQAAAAGBAWAgIAFEghW5QAGgICAAQIAAAAgc3R0cwAAAAAAAAACAAAALAAABAAAAAABAAAARAAAABxzdHNjAAAAAAAAAAEAAAABAAAALQAAAAEAAADIc3RzegAAAAAAAAAAAAAALQAAABUAAAAEAAAABAAAAAQAAAAEAAAABAAAAAQAAAAEAAAABAAAAAQAAAAEAAAABAAAAAQAAAAEAAAABAAAAAQAAAAEAAAABAAAAAQAAAAEAAAABAAAAAQAAAAEAAAABAAAAAQAAAAEAAAABAAAAAQAAAAEAAAABAAAAAQAAAAEAAAABAAAAAQAAAAEAAAABAAAAAQAAAAEAAAABAAAAAQAAAAEAAAABAAAAAQAAAAEAAAABAAAABRzdGNvAAAAAAAAAAEAAAAsAAAAGnNncGQBAAAAcm9sbAAAAAIAAAAB//8AAAAcc2JncAAAAAByb2xsAAAAAQAAAC0AAAABAAAAYnVkdGEAAABabWV0YQAAAAAAAAAhaGRscgAAAAAAAAAAbWRpcmFwcGwAAAAAAAAAAAAAAAAtaWxzdAAAACWpdG9vAAAAHWRhdGEAAAABAAAAAExhdmY2Mi4xMy4xMDE="
        case "webm": encoded = "GkXfo59ChoEBQveBAULygQRC84EIQoKEd2VibUKHgQRChYECGFOAZwEAAAAAAAO6EU2bdLpNu4tTq4QVSalmU6yBoU27i1OrhBZUrmtTrIHYTbuMU6uEElTDZ1OsggFCTbuMU6uEHFO7a1OsggOk7AEAAAAAAABZAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAVSalmsirXsYMPQkBNgI1MYXZmNjIuMTMuMTAxV0GNTGF2ZjYyLjEzLjEwMUSJiECPgAAAAAAAFlSua+WuAQAAAAAAAFzXgQFzxYjIKVzDXclRI5yBACK1nIN1bmSIgQCGhkFfT1BVU1aqg2MuoFa7hATEtACDgQLhkZ+BAbWIQOdwAAAAAABiZIEQY6KTT3B1c0hlYWQBATgBgLsAAAAAABJUw2f9c3OgY8CAZ8iaRaOHRU5DT0RFUkSHjUxhdmY2Mi4xMy4xMDFzc9djwItjxYjIKVzDXclRI2fIokWjh0VOQ09ERVJEh5VMYXZjNjIuMjkuMTAxIGxpYm9wdXNnyKFFo4hEVVJBVElPTkSHkzAwOjAwOjAxLjAwODAwMDAwMAAfQ7Z1QdrngQCjh4EAAID4//6jh4EAFYD4//6jh4EAKYD4//6jh4EAPYD4//6jh4EAUYD4//6jh4EAZYD4//6jh4EAeYD4//6jh4EAjYD4//6jh4EAoYD4//6jh4EAtYD4//6jh4EAyYD4//6jh4EA3YD4//6jh4EA8YD4//6jh4EBBYD4//6jh4EBGYD4//6jh4EBLYD4//6jh4EBQYD4//6jh4EBVYD4//6jh4EBaYD4//6jh4EBfYD4//6jh4EBkYD4//6jh4EBpYD4//6jh4EBuYD4//6jh4EBzYD4//6jh4EB4YD4//6jh4EB9YD4//6jh4ECCYD4//6jh4ECHYD4//6jh4ECMYD4//6jh4ECRYD4//6jh4ECWYD4//6jh4ECbYD4//6jh4ECgYD4//6jh4EClYD4//6jh4ECqYD4//6jh4ECvYD4//6jh4EC0YD4//6jh4EC5YD4//6jh4EC+YD4//6jh4EDDYD4//6jh4EDIYD4//6jh4EDNYD4//6jh4EDSYD4//6jh4EDXYD4//6jh4EDcYD4//6jh4EDhYD4//6jh4EDmYD4//6jh4EDrYD4//6jh4EDwYD4//6jh4ED1YD4//6gk6GHgQPpAPj//puBB3WihADN/mAcU7trkbuPs4EAt4r3gQHxggHE8IED"
        default: throw YouTubeDownloadError.sourceChanged
        }
        return try XCTUnwrap(Data(base64Encoded: encoded))
    }
}
#endif
