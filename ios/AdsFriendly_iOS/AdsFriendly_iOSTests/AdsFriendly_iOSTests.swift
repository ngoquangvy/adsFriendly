//
//  AdsFriendly_iOSTests.swift
//  AdsFriendly_iOSTests
//
//  Created by Vy Ngo on 04/06/2026.
//

import XCTest
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

}
