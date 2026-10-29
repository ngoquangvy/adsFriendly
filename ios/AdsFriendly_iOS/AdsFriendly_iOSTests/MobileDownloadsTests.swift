#if !AF_PROTECTION_ONLY
import XCTest
import UIKit
@testable import AdsFriendly_iOS

private final class PendingMediaProtocol: URLProtocol {
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {}
    override func stopLoading() {}
}

@MainActor
final class DownloadPreviewHost {
    let window: UIWindow
    let navigation: UINavigationController
    private let previous: UIWindow?
    init(_ controller: UIViewController, width: CGFloat) {
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        previous = scenes.flatMap { $0.windows }.first { $0.isKeyWindow }
        if let scene = previous?.windowScene ?? scenes.first { window = UIWindow(windowScene: scene) }
        else { window = UIWindow(frame: .zero) }
        navigation = UINavigationController(rootViewController: controller)
        window.frame = CGRect(x: 0, y: 0, width: width, height: 844)
        window.rootViewController = navigation; window.makeKeyAndVisible(); navigation.view.layoutIfNeeded()
    }
    func resize(_ width: CGFloat) { window.frame = CGRect(x: 0, y: 0, width: width, height: 844); navigation.view.setNeedsLayout(); navigation.view.layoutIfNeeded() }
    func close() { window.isHidden = true; window.rootViewController = nil; previous?.makeKeyAndVisible() }
}

final class MobileDownloadsTests: XCTestCase {
    private let url = URL(string: "https://media.example/song.mp3?token=private")!
    private func configuration() -> URLSessionConfiguration {
        let config = URLSessionConfiguration.ephemeral; config.protocolClasses = [PendingMediaProtocol.self]; return config
    }
    private func source(_ title: String = "Bài hát mùa thu.mp3", ranges: Bool = true) -> CheckedMobileSource {
        .init(url: url, fileExtension: "mp3", bytes: 10, expiresAt: Date().addingTimeInterval(30), filename: title, acceptsRanges: ranges, rangeValidator: "\"v1\"")
    }
    private func response(_ status: Int, size: Int, range: String? = nil) throws -> HTTPURLResponse {
        var headers = ["Content-Type": "audio/mpeg", "Content-Length": String(size), "ETag": "\"v1\""]
        headers["Content-Range"] = range
        return try XCTUnwrap(HTTPURLResponse(url: url, statusCode: status, httpVersion: "HTTP/1.1", headerFields: headers))
    }
    func testReadableNamesPreserveUnicodeAndRejectPathsTokensAndOverlongTitles() throws {
        XCTAssertEqual(MobileMediaName.filename("Bài hát mùa thu", ext: "m4a", fallback: "Audio"), "Bài hát mùa thu.m4a")
        XCTAssertEqual(MobileMediaName.filename("Song.M4A", ext: "m4a", fallback: "Audio"), "Song.m4a")
        for text in ["../../x\\y:*?", String(repeating: "Nhạc 🎧", count: 100), "https://host/file?token=secret", "a\u{202e}b\n.mp3"] {
            let name = MobileMediaName.filename(text, ext: "mp3", fallback: "Audio")
            XCTAssertTrue(MobileMediaName.isSafe(name), name); XCTAssertLessThanOrEqual(name.utf8.count, 180)
            XCTAssertFalse(name.contains("secret"))
        }
        let header = try XCTUnwrap(HTTPURLResponse(url: url, statusCode: 200, httpVersion: nil, headerFields: ["Content-Disposition": "attachment; filename=plain.mp3; filename*=UTF-8''B%C3%A0i%20h%C3%A1t.mp3"]))
        XCTAssertEqual(MobileMediaName.sourceName(header, ext: "mp3"), "Bài hát.mp3")
        XCTAssertFalse(MobileMediaName.isSafe("../history.json")); XCTAssertFalse(MobileMediaName.isSafe("C:\\x.mp3"))
    }
    func testRangePlansAreBoundedContiguousAndRequireVerifiedSupport() throws {
        XCTAssertNil(MobileRangeTransfer.plan(source())) // Small files stay single-stream.
        XCTAssertNil(MobileRangeTransfer.plan(source(ranges: false), minimum: 3))
        let parts = try XCTUnwrap(MobileRangeTransfer.plan(source(), minimum: 3))
        XCTAssertEqual(parts.map { $0.header }, ["bytes=0-2", "bytes=3-5", "bytes=6-9"])
        XCTAssertTrue(MobileRangeTransfer.validPlan(parts, total: 10))
        XCTAssertFalse(MobileRangeTransfer.validPlan(parts, total: 11))
        var unknown = source(); unknown.rangeValidator = nil
        XCTAssertNil(MobileRangeTransfer.plan(unknown, minimum: 3), "Mutable origins need If-Range evidence")
        let request = MobileRangeTransfer.request(url: url, part: parts[0], validator: "\"v1\"")
        XCTAssertEqual(request.value(forHTTPHeaderField: "If-Range"), "\"v1\"")
        let catalog = try MobileModuleCatalog.load()
        XCTAssertNoThrow(try MobileRangeTransfer.validate(response(206, size: 3, range: "bytes 0-2/10"), part: parts[0], total: 10, ext: "mp3", actual: 3, validator: "\"v1\"", catalog: catalog))
        for bad in [try response(200, size: 3), try response(206, size: 3, range: "bytes 1-3/10"), try response(206, size: 3, range: "bytes 0-2/11")] {
            XCTAssertThrowsError(try MobileRangeTransfer.validate(bad, part: parts[0], total: 10, ext: "mp3", actual: 3, validator: "\"v1\"", catalog: catalog))
        }
    }
    @MainActor
    func testOutOfOrderRangeDownloadsSaveExactFileAndBulkHistoryKeepsActiveAndFiles() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let store = MobileDownloadStore(directory: directory, configuration: configuration(), rangeMinimum: 3)
        defer { store.invalidate(); try? FileManager.default.removeItem(at: directory) }
        try store.start(source()); let row = try XCTUnwrap(store.records.first)
        let data = Data("0123456789".utf8), parts = try XCTUnwrap(row.parts)
        for index in [2, 0, 1] {
            let part = parts[index], incoming = directory.appendingPathComponent("incoming-\(index)")
            try data.subdata(in: Int(part.offset)..<Int(part.offset + part.length)).write(to: incoming)
            store.receive(id: row.id, response: try response(206, size: Int(part.length), range: "bytes \(part.offset)-\(part.offset + part.length - 1)/10"), location: incoming, part: index)
        }
        for _ in 0..<100 where store.records.first?.state != "saved" { try await Task.sleep(nanoseconds: 50_000_000) }
        XCTAssertEqual(store.records.first?.state, "saved")
        let output = try XCTUnwrap(store.output(row.id))
        XCTAssertEqual(output.lastPathComponent, "Bài hát mùa thu.mp3"); XCTAssertEqual(try Data(contentsOf: output), data)
        try store.start(source("Bài hát mùa thu.mp3", ranges: false))
        let active = try XCTUnwrap(store.records.first?.id)
        try store.clearHistory()
        XCTAssertEqual(store.records.map { $0.id }, [active]); XCTAssertTrue(FileManager.default.fileExists(atPath: output.path))
        let history = try String(contentsOf: directory.appendingPathComponent("history.json"), encoding: .utf8)
        XCTAssertFalse(history.contains("token=")); XCTAssertFalse(history.contains("media.example"))
        store.cancel(active); try store.clearHistory(); XCTAssertTrue(store.records.isEmpty)
    }
    @MainActor
    func testReceivedRangePartsRecoverAfterAppRestart() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let id = UUID().uuidString, data = Data("0123456789".utf8)
        var parts = try XCTUnwrap(MobileRangeTransfer.plan(source(), minimum: 3))
        for index in parts.indices {
            parts[index].bytes = parts[index].length; parts[index].received = true
            try data.subdata(in: Int(parts[index].offset)..<Int(parts[index].offset + parts[index].length)).write(to: directory.appendingPathComponent("\(id)-\(index).range"))
        }
        let record = MobileDownloadRecord(id: id, filename: "Khôi phục.mp3", state: "finishing", bytes: 10, total: 10, folder: id, parts: parts)
        try JSONEncoder().encode([record]).write(to: directory.appendingPathComponent("history.json"))
        let store = MobileDownloadStore(directory: directory, configuration: configuration())
        defer { store.invalidate(); try? FileManager.default.removeItem(at: directory) }
        for _ in 0..<100 where store.records.first?.state != "saved" { try await Task.sleep(nanoseconds: 50_000_000) }
        XCTAssertEqual(store.records.first?.state, "saved")
        XCTAssertEqual(try Data(contentsOf: XCTUnwrap(store.output(id))), data)
    }
    @MainActor
    func testIgnoredRangeUsesOneValidatedFullResponseAndBadRangeCannotSave() throws {
        for ignored in [true, false] {
            let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
            let store = MobileDownloadStore(directory: directory, configuration: configuration(), rangeMinimum: 3)
            defer { store.invalidate(); try? FileManager.default.removeItem(at: directory) }
            try store.start(source()); let id = try XCTUnwrap(store.records.first?.id)
            let incoming = directory.appendingPathComponent("incoming")
            try Data((ignored ? "0123456789" : "bad").utf8).write(to: incoming)
            store.receive(id: id, response: try response(ignored ? 200 : 206, size: ignored ? 10 : 3, range: ignored ? nil : "bytes 1-3/10"), location: incoming, part: 0)
            XCTAssertEqual(store.records.first?.state, ignored ? "saved" : "failed")
            XCTAssertEqual(store.output(id) != nil, ignored)
            if ignored { XCTAssertNil(store.records.first?.parts) }
        }
    }
    @MainActor
    func testLegacyHistoryStillOpensAndFailedHistoryWriteRollsBack() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let ledger = directory.appendingPathComponent("history.json"), file = directory.appendingPathComponent("Media-12345678.mp3")
        let id = UUID().uuidString
        let old = "[{\"id\":\"\(id)\",\"filename\":\"Media-12345678.mp3\",\"state\":\"saved\",\"bytes\":10,\"total\":10}]"
        try Data(old.utf8).write(to: ledger); try Data("0123456789".utf8).write(to: file)
        let store = MobileDownloadStore(directory: directory, configuration: configuration())
        defer { store.invalidate(); try? FileManager.default.removeItem(at: directory) }
        XCTAssertEqual(store.output(id), file)
        try FileManager.default.removeItem(at: ledger); try FileManager.default.createDirectory(at: ledger, withIntermediateDirectories: true)
        XCTAssertThrowsError(try store.clearHistory()); XCTAssertEqual(store.records.count, 1); XCTAssertEqual(store.output(id), file)
    }
    @MainActor
    func testDownloadFormShowsNextActionWithoutStartingAnyTransfer() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let store = MobileDownloadStore(directory: directory, configuration: configuration())
        defer { store.invalidate(); try? FileManager.default.removeItem(at: directory) }
        let controller = MobileDownloadsViewController(catalog: try MobileModuleCatalog.load(), store: store)
        let host = DownloadPreviewHost(controller, width: 390); defer { host.close() }
        let navigation = host.navigation
        XCTAssertFalse(controller.analyze.isEnabled)
        UIPasteboard.general.string = url.absoluteString
        let paste = try XCTUnwrap(find(controller.view, id: "downloads-paste") as? UIButton)
        paste.sendActions(for: .touchUpInside); controller.view.layoutIfNeeded()
        XCTAssertEqual(controller.input.text, url.absoluteString); XCTAssertTrue(controller.analyze.isEnabled); XCTAssertTrue(store.records.isEmpty)
        if !UIAccessibility.isReduceMotionEnabled { XCTAssertEqual(controller.analyze.layer.animation(forKey: "next-step")?.repeatCount, 3) }
        XCTAssertGreaterThanOrEqual(controller.analyze.bounds.height, 48)
        let pasteFrame = paste.convert(paste.bounds, to: controller.view)
        XCTAssertGreaterThanOrEqual(pasteFrame.width, 44); XCTAssertLessThanOrEqual(pasteFrame.maxX, controller.view.bounds.width - 16)
        let image = UIGraphicsImageRenderer(bounds: navigation.view.bounds).image { navigation.view.layer.render(in: $0.cgContext) }
        let attachment = XCTAttachment(image: image); attachment.name = "Direct-download-390"; attachment.lifetime = .keepAlways; add(attachment)
        controller.input.text = ""; controller.input.sendActions(for: .editingChanged); XCTAssertFalse(controller.analyze.isEnabled)
    }
    @MainActor private func find(_ view: UIView, id: String) -> UIView? {
        if view.accessibilityIdentifier == id { return view }
        for child in view.subviews { if let found = find(child, id: id) { return found } }; return nil
    }
}
#endif
