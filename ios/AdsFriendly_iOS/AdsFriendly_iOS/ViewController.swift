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
        self.webView.scrollView.isScrollEnabled = false

        self.webView.configuration.userContentController.add(self, name: "controller")

        self.webView.loadFileURL(Bundle.main.url(forResource: "Main", withExtension: "html")!, allowingReadAccessTo: Bundle.main.resourceURL!)

        // Composition is optional. Missing/broken media configuration must never
        // prevent the existing Safari protection onboarding from loading.
        #if !AF_PROTECTION_ONLY
        if let catalog = try? MobileModuleCatalog.load(), catalog.includes("media") {
            let button = UIButton(type: .system)
            button.setTitle("Media Tools · Downloads", for: .normal)
            button.backgroundColor = .secondarySystemBackground
            button.layer.cornerRadius = 12
            button.addTarget(self, action: #selector(openMedia), for: .touchUpInside)
            button.translatesAutoresizingMaskIntoConstraints = false
            view.addSubview(button)
            NSLayoutConstraint.activate([
                button.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor, constant: 24),
                button.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor, constant: -24),
                button.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor, constant: -12),
                button.heightAnchor.constraint(equalToConstant: 48)
            ])
        }
        #endif
    }

    #if !AF_PROTECTION_ONLY
    @objc private func openMedia() {
        guard let catalog = try? MobileModuleCatalog.load(), catalog.includes("media") else { return }
        present(UINavigationController(rootViewController: MobileDownloadsViewController(catalog: catalog)), animated: true)
    }
    #endif

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        // Override point for customization.
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        // Override point for customization.
    }

}
