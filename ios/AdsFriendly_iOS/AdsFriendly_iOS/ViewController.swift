//
//  ViewController.swift
//  AdsFriendly_iOS
//
//  Created by Vy Ngo on 04/06/2026.
//

import UIKit
import WebKit

class ViewController: UIViewController, WKNavigationDelegate, WKScriptMessageHandler {

    @IBOutlet var webView: WKWebView!

    override func viewDidLoad() {
        super.viewDidLoad()

        self.webView.navigationDelegate = self
        self.webView.scrollView.isScrollEnabled = true

        self.webView.configuration.userContentController.add(self, name: "controller")

        self.webView.loadFileURL(Bundle.main.url(forResource: "Main", withExtension: "html")!, allowingReadAccessTo: Bundle.main.resourceURL!)

        // Optional native media composition leaves the DNS/Safari bridge independent.
        webView.autoresizingMask = []
        webView.translatesAutoresizingMaskIntoConstraints = false
        var bottom = view.safeAreaLayoutGuide.bottomAnchor
        #if !AF_PROTECTION_ONLY
        if let catalog = try? MobileModuleCatalog.load(), catalog.includes("media") {
            let button = UIButton(type: .system)
            button.setTitle("Media Tools · Downloads", for: .normal)
            button.accessibilityIdentifier = "media-downloads"
            button.titleLabel?.font = .preferredFont(forTextStyle: .headline)
            button.backgroundColor = .secondarySystemBackground
            button.layer.cornerRadius = 12
            button.addTarget(self, action: #selector(openMedia), for: .touchUpInside)
            button.translatesAutoresizingMaskIntoConstraints = false
            view.addSubview(button)
            NSLayoutConstraint.activate([
                button.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor, constant: 16),
                button.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor, constant: -16),
                button.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor, constant: -8),
                button.heightAnchor.constraint(greaterThanOrEqualToConstant: 48)
            ])
            bottom = button.topAnchor
        }
        #endif
        NSLayoutConstraint.activate([
            webView.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            webView.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor),
            webView.bottomAnchor.constraint(equalTo: bottom, constant: -8)
        ])
    }

    #if !AF_PROTECTION_ONLY
    @objc private func openMedia() {
        guard presentedViewController == nil,
              let catalog = try? MobileModuleCatalog.load(), catalog.includes("media") else { return }
        present(UINavigationController(rootViewController: MobileDownloadsViewController(catalog: catalog)), animated: true)
    }
    #endif

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        // Override point for customization.
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.frameInfo.isMainFrame,
              let source = message.frameInfo.request.url, source.isFileURL,
              source.standardizedFileURL.path.hasPrefix(Bundle.main.bundleURL.standardizedFileURL.path + "/"),
              let request = message.body as? [String: Any],
              let action = request["action"] as? String else { return }
        if action == "dnsGuide" {
            UIApplication.shared.open(URL(string: "https://adguard-dns.io/en/public-dns.html")!)
            return
        }
        guard action == "exportDNSProfile", request["consent"] as? Bool == true else {
            reply("error", "Confirm the DNS privacy notice before exporting."); return
        }
        do {
            let data = try DNSProfile.make(endpoint: request["endpoint"] as? String ?? "")
            let file = FileManager.default.temporaryDirectory.appendingPathComponent("AdsFriendly-DNS.mobileconfig")
            try data.write(to: file, options: .atomic)
            let share = UIActivityViewController(activityItems: [file], applicationActivities: nil)
            if let popover = share.popoverPresentationController {
                popover.sourceView = webView
                popover.sourceRect = CGRect(x: webView.bounds.midX, y: webView.bounds.midY, width: 1, height: 1)
            }
            share.completionWithItemsHandler = { [weak self] _, completed, _, error in
                self?.reply(error == nil ? "ready" : "error",
                    error == nil ? (completed
                      ? "Profile exported, not activated. Open it from Mail or Files, then install in Settings > General > VPN & Device Management."
                      : "Export cancelled. No DNS settings were changed.")
                    : "Could not export the DNS profile. No DNS settings were changed.")
            }
            present(share, animated: true)
        } catch { reply("error", error.localizedDescription) }
    }

    private func reply(_ kind: String, _ message: String) {
        guard let data = try? JSONSerialization.data(withJSONObject: ["kind": kind, "message": message]),
              let json = String(data: data, encoding: .utf8) else { return }
        webView.evaluateJavaScript("window.handleDNSResult(" + json + ")", completionHandler: nil)
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        let url = navigationAction.request.url
        let local = url?.isFileURL == true &&
            url!.standardizedFileURL.path.hasPrefix(Bundle.main.bundleURL.standardizedFileURL.path + "/")
        decisionHandler(local ? .allow : .cancel)
    }
}

enum DNSProfile {
    static let defaultEndpoint = "https://dns.adguard-dns.com/dns-query"
    static func make(endpoint: String) throws -> Data {
        let input = endpoint.trimmingCharacters(in: .whitespacesAndNewlines)
        guard input.count <= 2048, !input.isEmpty,
              input.rangeOfCharacter(from: .controlCharacters) == nil,
              let parts = URLComponents(string: input), parts.scheme?.lowercased() == "https",
              let host = parts.host, !host.isEmpty,
              parts.user == nil, parts.password == nil, parts.fragment == nil,
              let url = parts.url else {
            throw NSError(domain: "AdsFriendlyDNS", code: 1, userInfo: [
                NSLocalizedDescriptionKey: "Enter a valid HTTPS DNS endpoint without credentials or a fragment."
            ])
        }
        let dns: [String: Any] = [
            "PayloadType": "com.apple.dnsSettings.managed", "PayloadVersion": 1,
            "PayloadIdentifier": "com.vyngo.adsfriendly.dns.settings",
            "PayloadUUID": "7E321C37-1F89-4FA7-A71B-D9F0A0C505E2",
            "PayloadDisplayName": "AdsFriendly DNS — " + host,
            "DNSSettings": ["DNSProtocol": "HTTPS", "ServerURL": url.absoluteString]
        ]
        let profile: [String: Any] = [
            "PayloadType": "Configuration", "PayloadVersion": 1,
            "PayloadIdentifier": "com.vyngo.adsfriendly.dns",
            "PayloadUUID": "90A33F95-C766-4AAC-84DF-748FE49868D0",
            "PayloadDisplayName": "AdsFriendly DNS",
            "PayloadDescription": "DNS queries are sent to " + host +
              ". Domain filtering depends on that resolver. This profile cannot block URL paths and does not install a certificate or VPN.",
            "PayloadRemovalDisallowed": false, "PayloadContent": [dns]
        ]
        return try PropertyListSerialization.data(fromPropertyList: profile, format: .xml, options: 0)
    }
}
