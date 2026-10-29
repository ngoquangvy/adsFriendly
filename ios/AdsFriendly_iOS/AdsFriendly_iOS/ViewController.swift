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
    private var dnsDelivery: DNSProfileDelivery?
    private var dnsBackgroundTask: UIBackgroundTaskIdentifier = .invalid

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
            #if AF_YOUTUBE
            if catalog.includes("youtube") {
                let youtube = UIButton(type: .system)
                youtube.setTitle("YouTube · Video / Audio (test)", for: .normal)
                youtube.accessibilityIdentifier = "youtube-downloads"
                youtube.backgroundColor = .secondarySystemBackground
                youtube.layer.cornerRadius = 12
                youtube.addTarget(self, action: #selector(openYouTube), for: .touchUpInside)
                youtube.translatesAutoresizingMaskIntoConstraints = false
                view.addSubview(youtube)
                NSLayoutConstraint.activate([
                    youtube.leadingAnchor.constraint(equalTo: button.leadingAnchor),
                    youtube.trailingAnchor.constraint(equalTo: button.trailingAnchor),
                    youtube.bottomAnchor.constraint(equalTo: button.topAnchor, constant: -8),
                    youtube.heightAnchor.constraint(greaterThanOrEqualToConstant: 48)
                ])
                bottom = youtube.topAnchor
            }
            #endif
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

    #if AF_YOUTUBE && !AF_PROTECTION_ONLY
    @objc private func openYouTube() {
        guard presentedViewController == nil,
              let catalog = try? MobileModuleCatalog.load(), catalog.includes("youtube") else { return }
        present(UINavigationController(rootViewController: YouTubeDownloadsViewController()), animated: true)
    }
    #endif

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        let endpoint = UserDefaults.standard.string(forKey: "dns.customEndpointDraft") ?? DNSProfile.defaultEndpoint
        guard let data = try? JSONSerialization.data(withJSONObject: ["endpoint": endpoint]),
              let json = String(data: data, encoding: .utf8) else { return }
        webView.evaluateJavaScript("window.handleDNSPreferences && window.handleDNSPreferences(" + json + ")", completionHandler: nil)
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
        guard ["installDefaultDNSProfile", "installCustomDNSProfile", "exportDNSProfile"].contains(action),
              request["consent"] as? Bool == true else {
            reply("error", "Tích ô đồng ý trước khi xuất file DNS."); return
        }
        do {
            let data: Data
            if action == "installDefaultDNSProfile" { data = try DNSProfile.bundledDefault() }
            else {
                let endpoint = request["endpoint"] as? String ?? ""
                data = try DNSProfile.make(endpoint: endpoint)
                UserDefaults.standard.set(endpoint.trimmingCharacters(in: .whitespacesAndNewlines), forKey: "dns.customEndpointDraft")
            }
            if action != "exportDNSProfile" { deliverDNSProfile(data); return }
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
                      ? "Đã xuất file, DNS chưa được bật. Mở file từ Mail hoặc Tệp, rồi vào Cài đặt → Đã tải về hồ sơ → Cài đặt. Có thể xem/gỡ tại Cài đặt chung → VPN & Quản lý thiết bị."
                      : "Đã hủy xuất file. DNS hệ thống chưa thay đổi.")
                    : "Không xuất được file. DNS hệ thống chưa thay đổi.")
            }
            present(share, animated: true)
        } catch { reply("error", error.localizedDescription) }
    }

    private func deliverDNSProfile(_ data: Data) {
        dnsDelivery?.stop()
        let delivery = DNSProfileDelivery()
        dnsDelivery = delivery
        dnsBackgroundTask = UIApplication.shared.beginBackgroundTask(withName: "DNS profile handoff") { [weak self, weak delivery] in
            guard let self = self, let delivery = delivery, self.dnsDelivery === delivery else { return }
            delivery.stop()
        }
        delivery.start(data: data, ready: { [weak self, weak delivery] result in
            guard let self = self, let delivery = delivery, self.dnsDelivery === delivery else { return }
            switch result {
            case .success(let url):
                UIApplication.shared.open(url, options: [:]) { [weak self, weak delivery] opened in
                    guard let self = self, let delivery = delivery, self.dnsDelivery === delivery else { return }
                    if !opened {
                        delivery.stop()
                        self.reply("error", "Không mở được trình duyệt. Dùng Xuất file dự phòng trong DNS riêng.")
                    } else {
                        self.reply("ready", "Đã mở trình duyệt để nhận profile. Cho phép tải, rồi vào Cài đặt → Đã tải về hồ sơ → Cài đặt. App chưa xác nhận DNS đã bật.")
                    }
                }
            case .failure:
                self.reply("error", "Không chuẩn bị được profile cho trình duyệt. Thử lại hoặc dùng Xuất file dự phòng.")
            }
        }, completion: { [weak self, weak delivery] served in
            guard let self = self, let delivery = delivery, self.dnsDelivery === delivery else { return }
            if self.dnsBackgroundTask != .invalid {
                UIApplication.shared.endBackgroundTask(self.dnsBackgroundTask)
                self.dnsBackgroundTask = .invalid
            }
            self.dnsDelivery = nil
            self.reply(served ? "ready" : "error", served
                ? "Đã chuyển file tới trình duyệt, chưa xác nhận DNS đã bật. Hoàn tất cài trong Cài đặt; bật/tắt cũng thực hiện tại đó."
                : "Lượt nhận profile đã kết thúc. Nếu chưa nhận được, bấm Cài DNS lần nữa hoặc dùng Xuất file dự phòng.")
        })
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
    static func bundledDefault() throws -> Data {
        guard let url = Bundle.main.url(forResource: "AdsFriendly-Default-DNS", withExtension: "mobileconfig") else {
            throw NSError(domain: "AdsFriendlyDNS", code: 2, userInfo: [NSLocalizedDescriptionKey: "Thiếu profile DNS mặc định. Cài lại app từ bản build đã kiểm tra."])
        }
        let data = try Data(contentsOf: url)
        let actual = try PropertyListSerialization.propertyList(from: data, options: [], format: nil) as? NSDictionary
        let expected = try PropertyListSerialization.propertyList(from: make(endpoint: defaultEndpoint), options: [], format: nil) as? NSDictionary
        guard let actual = actual, let expected = expected, actual == expected else {
            throw NSError(domain: "AdsFriendlyDNS", code: 3, userInfo: [NSLocalizedDescriptionKey: "Profile mặc định không khớp. Dùng bản build đã kiểm tra."])
        }
        return data
    }
    static func make(endpoint: String) throws -> Data {
        let input = endpoint.trimmingCharacters(in: .whitespacesAndNewlines)
        guard input.count <= 2048, input.utf8.count <= 8192, !input.isEmpty,
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
