//
//  AdsFriendly_iOSTests.swift
//  AdsFriendly_iOSTests
//
//  Created by Vy Ngo on 04/06/2026.
//

import XCTest
import UIKit
import WebKit
@testable import AdsFriendly_iOS

#if !AF_PROTECTION_ONLY
// All probe integration requests stay inside this URLProtocol fixture.
private final class MobileProbeFixtureProtocol: URLProtocol {
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        guard let url = request.url else { return }
        guard request.value(forHTTPHeaderField: "Accept-Encoding") == "identity",
              request.value(forHTTPHeaderField: "Cookie") == nil else {
            client?.urlProtocol(self, didFailWithError: URLError(.badServerResponse)); return
        }
        var status = 200
        var headers = ["Content-Type": "audio/mpeg", "Content-Length": "7"]
        switch url.lastPathComponent {
        case "fallback.mp3", "wrongrange.mp3":
            if request.httpMethod == "HEAD" { status = 405 }
            else if request.httpMethod == "GET", request.value(forHTTPHeaderField: "Range") == "bytes=0-0" {
                status = 206
                headers["Content-Range"] = url.lastPathComponent == "wrongrange.mp3" ? "bytes 1-1/7" : "bytes 0-0/7"
                headers["Content-Length"] = "1"
            } else { status = 400 }
        case "html.mp3": headers["Content-Type"] = "text/html"
        case "missing.mp3": status = 404
        case "unknown.mp4": headers = ["Content-Type": "video/mp4"]
        default: status = 404
        }
        guard let response = HTTPURLResponse(url: url, statusCode: status, httpVersion: "HTTP/1.1", headerFields: headers) else { return }
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}
#endif

final class AdsFriendly_iOSTests: XCTestCase {

    override func setUpWithError() throws {
        // Put setup code here. This method is called before the invocation of each test method in the class.
    }

    override func tearDownWithError() throws {
        // Put teardown code here. This method is called after the invocation of each test method in the class.
    }

    func testExample() throws {
        // This is an example of a functional test case.
        // Use XCTAssert and related functions to verify your tests produce the correct results.
        // Any test you write for XCTest can be annotated as throws and async.
        // Mark your test throws to produce an unexpected failure when your test encounters an uncaught error.
        // Mark your test async to allow awaiting for asynchronous code to complete. Check the results with assertions afterwards.
    }

    #if !AF_PROTECTION_ONLY
    func testMobileCatalogAndPublicSourceValidation() throws {
        let catalog = try MobileModuleCatalog.load()
        XCTAssertTrue(catalog.includes("media"))
        XCTAssertEqual(catalog.fileExtension(mime: "audio/mpeg", fallback: ""), "mp3")
        XCTAssertNil(catalog.fileExtension(mime: "text/html", fallback: "mp4"))
        XCTAssertNil(catalog.fileExtension(mime: "application/vnd.apple.mpegurl", fallback: "mp4"))
        for value in ["http://media.example/file.mp3", "https://user:pass@media.example/file.mp3",
                      "https://127.0.0.1/file.mp3", "https://[::1]/file.mp3", "https://router.local/file.mp3",
                      "https://router.local./file.mp3", "https://media.example:8443/file.mp3",
                      "https://media.example/one.mp3 https://other.example/two.mp3", "https://media.example/\nfile.mp3"] {
            XCTAssertThrowsError(try MobileSourceURL.parse(value), value)
        }
        let signed = try MobileSourceURL.parse(" https://media.example/play?token=abc%20def\n")
        XCTAssertEqual(signed.query, "token=abc%20def")
        XCTAssertTrue(MobileSourceURL.isYouTube(try MobileSourceURL.parse("https://youtu.be/abc")))
        let noMedia = MobileModuleCatalog(schemaVersion: 1,
            modules: [.init(id: "protection", title: "Protection", capabilities: [])], directFormats: [])
        try noMedia.validate()
        XCTAssertFalse(noMedia.includes("media"))
        let broken = MobileModuleCatalog(schemaVersion: 2, modules: catalog.modules, directFormats: catalog.directFormats)
        XCTAssertThrowsError(try broken.validate())
    }

    func testMobileResponseRejectsChangedPartialEmptyAndNonMediaFiles() throws {
        let catalog = try MobileModuleCatalog.load()
        let url = try XCTUnwrap(URL(string: "https://media.example/audio.mp3"))
        func response(_ status: Int = 200, _ headers: [String: String] = ["Content-Type": "audio/mpeg", "Content-Length": "7"]) throws -> HTTPURLResponse {
            try XCTUnwrap(HTTPURLResponse(url: url, statusCode: status, httpVersion: "HTTP/1.1", headerFields: headers))
        }
        let valid = try response()
        XCTAssertNoThrow(try MobileMediaResponse.validateFile(valid, expectedExtension: "mp3", checkedBytes: 7, actualBytes: 7, catalog: catalog))
        for size in [Int64(0), 1, 8] {
            XCTAssertThrowsError(try MobileMediaResponse.validateFile(valid, expectedExtension: "mp3", checkedBytes: 7, actualBytes: size, catalog: catalog))
        }
        XCTAssertThrowsError(try MobileMediaResponse.validateFile(valid, expectedExtension: "mp4", checkedBytes: 7, actualBytes: 7, catalog: catalog))
        let changed = try response(200, ["Content-Type": "audio/mpeg", "Content-Length": "8"])
        XCTAssertThrowsError(try MobileMediaResponse.validateFile(changed, expectedExtension: "mp3", checkedBytes: 7, actualBytes: 8, catalog: catalog))
        for (status, headers) in [
            (200, ["Content-Type": "text/html"]), (200, ["Content-Type": "audio/mpeg", "Content-Length": "0"]),
            (200, ["Content-Type": "audio/mpeg", "Content-Encoding": "gzip"]), (403, ["Content-Type": "audio/mpeg"]),
            (206, ["Content-Type": "audio/mpeg", "Content-Range": "bytes 0-0/7"])
        ] {
            XCTAssertThrowsError(try MobileMediaResponse.metadata(response(status, headers), catalog: catalog))
        }
        let partial = try response(206, ["Content-Type": "audio/mpeg", "Content-Range": "bytes 0-0/7", "Content-Length": "1"])
        XCTAssertEqual(try MobileMediaResponse.metadata(partial, catalog: catalog, rangeProbe: true).1, 7)
        let badRange = try response(206, ["Content-Type": "audio/mpeg", "Content-Range": "bytes 1-1/7"])
        XCTAssertThrowsError(try MobileMediaResponse.metadata(badRange, catalog: catalog, rangeProbe: true))
        let unknown = try response(200, ["Content-Type": "audio/mpeg"])
        XCTAssertNil(try MobileMediaResponse.metadata(unknown, catalog: catalog).1)
        XCTAssertNoThrow(try MobileMediaResponse.validateFile(unknown, expectedExtension: "mp3", checkedBytes: nil, actualBytes: 7, catalog: catalog))
    }

    @MainActor
    func testMobileProbeUsesBoundedHeadFallbackAndCanBeReused() async throws {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [MobileProbeFixtureProtocol.self]
        let probe = MobileSourceProbe(catalog: try MobileModuleCatalog.load(), configuration: configuration)
        func check(_ path: String) async -> Result<CheckedMobileSource, Error> {
            await withCheckedContinuation { continuation in
                probe.check("https://fixture.adsfriendly.test/" + path) { continuation.resume(returning: $0) }
            }
        }
        let first = try await check("fallback.mp3").get()
        XCTAssertEqual(first.fileExtension, "mp3")
        XCTAssertEqual(first.bytes, 7)
        XCTAssertGreaterThan(first.expiresAt, Date())
        let second = try await check("fallback.mp3").get()
        XCTAssertEqual(second.bytes, 7, "A reused probe must reset fallback state.")
        for path in ["html.mp3", "missing.mp3", "wrongrange.mp3"] {
            if case .success = await check(path) { XCTFail("Unsupported response accepted: " + path) }
        }
        let unknown = try await check("unknown.mp4").get()
        XCTAssertNil(unknown.bytes)
        probe.cancel()
    }

    @MainActor
    func testMobileCompositionKeepsDNSOnboardingAccessible() throws {
        let root = ViewController()
        let web = WKWebView()
        root.view = UIView(frame: CGRect(x: 0, y: 0, width: 320, height: 640))
        root.view.addSubview(web)
        root.webView = web
        root.viewDidLoad()
        root.view.layoutIfNeeded()
        let entry = try XCTUnwrap(root.view.subviews.compactMap { $0 as? UIButton }.first { $0.accessibilityIdentifier == "media-downloads" })
        XCTAssertGreaterThanOrEqual(entry.frame.height, 48)
        XCTAssertLessThanOrEqual(web.frame.maxY, entry.frame.minY)
        XCTAssertGreaterThan(web.frame.height, 200)
        let media = MobileDownloadsViewController(catalog: try MobileModuleCatalog.load())
        media.loadViewIfNeeded()
        let all = descendants(media.view)
        let download = try XCTUnwrap(all.compactMap { $0 as? UIButton }.first { $0.accessibilityIdentifier == "media-confirm" })
        XCTAssertFalse(download.isEnabled, "Opening Media Tools must not start or authorize a download.")
        let html = try String(contentsOf: XCTUnwrap(Bundle.main.url(forResource: "Main", withExtension: "html")), encoding: .utf8)
        XCTAssertTrue(html.contains("export-dns"))
    }

    @MainActor
    private func descendants(_ view: UIView) -> [UIView] {
        view.subviews.flatMap { [$0] + descendants($0) }
    }
    #endif

    func testDNSProfileOnlyContainsRemovableEncryptedDNS() throws {
        let data = try DNSProfile.make(endpoint: DNSProfile.defaultEndpoint)
        let profile = try XCTUnwrap(PropertyListSerialization.propertyList(from: data, options: [], format: nil) as? [String: Any])
        XCTAssertEqual(profile["PayloadType"] as? String, "Configuration")
        XCTAssertEqual(profile["PayloadRemovalDisallowed"] as? Bool, false)
        let content = try XCTUnwrap(profile["PayloadContent"] as? [[String: Any]])
        XCTAssertEqual(content.count, 1)
        XCTAssertEqual(content[0]["PayloadType"] as? String, "com.apple.dnsSettings.managed")
        XCTAssertNil(content[0]["ProhibitDisablement"])
        let dns = try XCTUnwrap(content[0]["DNSSettings"] as? [String: String])
        XCTAssertEqual(dns["DNSProtocol"], "HTTPS")
        XCTAssertEqual(dns["ServerURL"], DNSProfile.defaultEndpoint)
        XCTAssertNil(profile["PayloadCertificateFileName"])
    }

    func testDNSProfileRejectsInsecureOrCredentialBearingEndpoints() {
        for endpoint in ["", "http://dns.example/query", "https://user:secret@dns.example/query",
                         "https://dns.example/query#fragment", "javascript:alert(1)", "https://",
                         "https://dns.example/query\nmalicious"] {
            XCTAssertThrowsError(try DNSProfile.make(endpoint: endpoint), endpoint)
        }
    }

    func testDNSProfileKeepsCustomProviderAndStableReplacementIdentity() throws {
        let endpoint = "https://dns.example/dns-query?profile=test&filter=ads"
        let first = try DNSProfile.make(endpoint: endpoint)
        let second = try DNSProfile.make(endpoint: endpoint)
        let a = try XCTUnwrap(PropertyListSerialization.propertyList(from: first, options: [], format: nil) as? NSDictionary)
        let b = try XCTUnwrap(PropertyListSerialization.propertyList(from: second, options: [], format: nil) as? NSDictionary)
        XCTAssertEqual(a, b)
        let content = try XCTUnwrap(a["PayloadContent"] as? [[String: Any]])
        let dns = try XCTUnwrap(content[0]["DNSSettings"] as? [String: String])
        XCTAssertEqual(dns["ServerURL"], endpoint)
    }

    func testPerformanceExample() throws {
        // This is an example of a performance test case.
        self.measure {
            // Put the code you want to measure the time of here.
        }
    }

    @MainActor
    func testWebKitBlockDefaultAllowAcrossLongDOM() async throws {
        let window = try XCTUnwrap(UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }.flatMap { $0.windows }.first { $0.isKeyWindow })
        let plugins = try XCTUnwrap(Bundle.main.builtInPlugInsURL)
        let resources = plugins.appendingPathComponent("AdsFriendly_iOS Extension.appex")
        let files = ["utils/shared.js", "utils/config.js", "utils/helpers.js", "content/dom-rules.js",
                     "content/ui.js", "content/popup-blocker.js", "content/banner-detector.js"]
        let seed = """
        window.testData={appSettings:{enabled:true},blacklist:['||fixture.adsfriendly.test^'],whitelist:[],userCustomRules:{},userElementExceptions:{}};
        const testChanges=[];
        window.testChange=(key,value)=>{testData[key]=value;testChanges.forEach(fn=>fn({[key]:{newValue:value}},'local'));};
        window.chrome={storage:{local:{get(keys,cb){cb(testData);}},onChanged:{addListener(fn){testChanges.push(fn);}}},
          runtime:{lastError:null,onMessage:{addListener(){}},sendMessage(m,cb){cb?.(m.action==='get_popup_rules'?{allowed:{},blocked:{}}:{status:'saved'});}}};
        """
        let scripts = try files.map { try String(contentsOf: resources.appendingPathComponent($0), encoding: .utf8) }.joined(separator: "\n")
        let configuration = WKWebViewConfiguration()
        configuration.userContentController.addUserScript(WKUserScript(source: seed + "\n" + scripts,
            injectionTime: .atDocumentStart, forMainFrameOnly: true))
        let web = WKWebView(frame: CGRect(x: 0, y: 0, width: 390, height: 844), configuration: configuration)
        window.addSubview(web)
        defer { web.stopLoading(); web.removeFromSuperview() }
        let filler = String(repeating: "<span></span>", count: 2600)
        let html = """
        <!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">
        <body><nav id="navigation">Menu</nav><div id="login"><form><input type="password"></form></div>
        \(filler)
        <a id="unknown-linked" href="https://unknown-sponsor.test/placement" style="display:block;width:320px;height:70px;background:gold"></a>
        <div id="css-slot" class="ad-slot" style="width:320px;height:70px;background:gold">Advertisement</div>
        <div id="click-layer" style="position:fixed;inset:0;width:100vw;height:100vh;opacity:0;pointer-events:auto;z-index:99990"></div>
        </body>
        """
        web.loadSimulatedRequest(URLRequest(url: URL(string: "https://fixture.adsfriendly.test/")!), responseHTML: html)
        try await waitForWebKit(web, "typeof AF_DOM !== 'undefined' && typeof AF_bannerScanStatus !== 'undefined'")
        try await waitForWebKit(web, "['unknown-linked','css-slot','click-layer'].every(id=>getComputedStyle(document.getElementById(id)).display==='none')")
        let navigationVisible = try await web.evaluateJavaScript("getComputedStyle(document.getElementById('navigation')).display!=='none' && getComputedStyle(document.getElementById('login')).display!=='none'")
        XCTAssertEqual(navigationVisible as? Bool, true)
        _ = try await web.evaluateJavaScript("testChange('blacklist',[]);true")
        try await waitForWebKit(web, "['unknown-linked','css-slot','click-layer'].every(id=>getComputedStyle(document.getElementById(id)).display!=='none')")
        _ = try await web.evaluateJavaScript("testChange('whitelist',['fixture.adsfriendly.test']);true")
        try await waitForWebKit(web, "getCurrentSitePolicy()==='allow' && AF_DOM.state().hiddenCount===0")
    }

    @MainActor
    private func waitForWebKit(_ web: WKWebView, _ condition: String) async throws {
        for _ in 0..<300 {
            if let result = try? await web.evaluateJavaScript(condition), result as? Bool == true { return }
            try await Task.sleep(nanoseconds: 50_000_000)
        }
        let details = try? await web.evaluateJavaScript("JSON.stringify({visibility:document.visibilityState,scan:typeof AF_bannerScanStatus==='function'?AF_bannerScanStatus():null})")
        XCTFail("WebKit condition timed out: \(condition); \(String(describing: details))")
        throw NSError(domain: "AdsFriendlyWebKitTests", code: 1)
    }

}
