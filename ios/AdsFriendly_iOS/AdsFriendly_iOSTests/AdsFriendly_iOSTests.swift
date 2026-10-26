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
