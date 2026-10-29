#if !AF_PROTECTION_ONLY
import Foundation
import UIKit
import QuickLook

enum MobileMediaName {
    static func stem(_ title: String?, fallback: String) -> String {
        var text = String((title ?? "").prefix(512)).precomposedStringWithCanonicalMapping
        if text.contains("://") { text = "" } // Never persist a signed URL as a title.
        let forbidden = CharacterSet.controlCharacters.union(CharacterSet(charactersIn: "/\\:*?\"<>|\u{202a}\u{202b}\u{202c}\u{202d}\u{202e}\u{2066}\u{2067}\u{2068}\u{2069}"))
        text = text.components(separatedBy: forbidden).joined(separator: " ")
            .split(whereSeparator: { $0.isWhitespace }).joined(separator: " ")
            .trimmingCharacters(in: CharacterSet(charactersIn: ". "))
        while text.contains("..") { text = text.replacingOccurrences(of: "..", with: ".") }
        while text.utf8.count > 150 { text.removeLast() }
        return text.isEmpty ? fallback : text
    }
    static func filename(_ title: String?, ext: String, fallback: String) -> String {
        var value = stem(title, fallback: fallback)
        if value.lowercased().hasSuffix("." + ext.lowercased()) { value.removeLast(ext.count + 1) }
        return stem(value, fallback: fallback) + "." + ext
    }
    static func isSafe(_ filename: String) -> Bool {
        !filename.isEmpty && filename.utf8.count <= 180 && !filename.hasPrefix(".") &&
            filename.rangeOfCharacter(from: .controlCharacters) == nil &&
            !filename.contains("/") && !filename.contains("\\") && !filename.contains(":") &&
            !filename.contains("..")
    }
    static func sourceName(_ response: HTTPURLResponse, ext: String) -> String {
        let header = response.value(forHTTPHeaderField: "Content-Disposition") ?? ""
        func capture(_ pattern: String) -> String? {
            guard header.utf8.count <= 4096, let re = try? NSRegularExpression(pattern: pattern, options: .caseInsensitive),
                  let match = re.firstMatch(in: header, range: NSRange(header.startIndex..., in: header)),
                  let range = Range(match.range(at: 1), in: header) else { return nil }
            return String(header[range])
        }
        let encoded = capture("(?:^|;)\\s*filename\\*\\s*=\\s*UTF-8''([^;\\r\\n]+)")?.trimmingCharacters(in: .whitespaces).removingPercentEncoding
        let plain = capture("(?:^|;)\\s*filename\\s*=\\s*\"([^\"\\r\\n]+)\"") ?? capture("(?:^|;)\\s*filename\\s*=\\s*([^;\\r\\n]+)")
        let path = response.url?.pathExtension.lowercased() == ext ? response.url?.lastPathComponent : nil
        let hint = encoded ?? plain ?? path
        return filename(hint, ext: ext, fallback: response.mimeType?.hasPrefix("video/") == true ? "Video" : "Audio")
    }
}

enum MobileTransferPolicy {
    static let connectionsPerHost = 4
    static func configure(_ config: URLSessionConfiguration) {
        config.httpShouldSetCookies = false; config.httpCookieStorage = nil
        config.urlCredentialStorage = nil; config.urlCache = nil
        config.httpMaximumConnectionsPerHost = connectionsPerHost
        config.isDiscretionary = false
        config.waitsForConnectivity = true
        config.timeoutIntervalForRequest = 30; config.timeoutIntervalForResource = 86400
    }
    static func isFinished(_ state: String) -> Bool { ["saved", "failed", "cancelled", "interrupted"].contains(state) }
    static func stateName(_ state: String) -> String {
        ["downloading": "Đang tải", "waiting": "Mở app để hoàn tất", "finishing": "Đang kiểm tra và ghép",
         "saved": "Đã lưu · Chạm để mở", "cancelled": "Đã hủy", "interrupted": "Đã gián đoạn", "failed": "Tải chưa hoàn tất"][state] ?? state
    }
}

struct MobileTransferMeter {
    private var samples: [String: (Int64, TimeInterval, Double)] = [:]
    mutating func detail(id: String, bytes: Int64, total: Int64?, now: TimeInterval = ProcessInfo.processInfo.systemUptime) -> String {
        let previous = samples[id]
        var speed = previous?.2 ?? 0
        if let previous = previous, now - previous.1 >= 0.5, bytes >= previous.0 {
            let current = Double(bytes - previous.0) / (now - previous.1)
            speed = previous.2 == 0 ? current : previous.2 * 0.4 + current * 0.6
        }
        if previous == nil || now - previous!.1 >= 0.5 { samples[id] = (bytes, now, speed) }
        let size = ByteCountFormatter.string(fromByteCount: bytes, countStyle: .file)
        let progress = total.flatMap { $0 > 0 ? " / " + ByteCountFormatter.string(fromByteCount: $0, countStyle: .file) + " · \(Int(min(100, max(0, Double(bytes) / Double($0) * 100))))%" : nil } ?? ""
        let rate = speed > 1 ? " · " + ByteCountFormatter.string(fromByteCount: Int64(min(speed, Double(Int64.max / 4))), countStyle: .file) + "/s" : ""
        return size + progress + rate
    }
}

final class MobileTransferCell: UITableViewCell {
    let name = UILabel(), detail = UILabel(), progress = UIProgressView(progressViewStyle: .default)
    let actions = UIButton(type: .system)
    override init(style: UITableViewCell.CellStyle, reuseIdentifier: String?) {
        super.init(style: style, reuseIdentifier: reuseIdentifier)
        name.font = .preferredFont(forTextStyle: .headline); name.numberOfLines = 2
        detail.font = .preferredFont(forTextStyle: .caption1); detail.textColor = .secondaryLabel; detail.numberOfLines = 0
        [name, detail].forEach { $0.adjustsFontForContentSizeCategory = true }
        let stack = UIStackView(arrangedSubviews: [name, detail, progress]); stack.axis = .vertical; stack.spacing = 6
        stack.translatesAutoresizingMaskIntoConstraints = false; contentView.addSubview(stack)
        actions.setImage(UIImage(systemName: "ellipsis.circle"), for: .normal)
        actions.accessibilityLabel = "Tùy chọn lượt tải"; actions.showsMenuAsPrimaryAction = true
        actions.frame = CGRect(x: 0, y: 0, width: 44, height: 44); accessoryView = actions
        NSLayoutConstraint.activate([stack.topAnchor.constraint(equalTo: contentView.topAnchor, constant: 14), stack.bottomAnchor.constraint(equalTo: contentView.bottomAnchor, constant: -14), stack.leadingAnchor.constraint(equalTo: contentView.leadingAnchor, constant: 16), stack.trailingAnchor.constraint(equalTo: contentView.trailingAnchor, constant: -8)])
    }
    required init?(coder: NSCoder) { fatalError("Use init(style:reuseIdentifier:)") }
    func configure(title: String, subtitle: String, bytes: Int64, total: Int64?, active: Bool, menu: UIMenu) {
        name.text = title; detail.text = subtitle; actions.menu = menu
        progress.isHidden = !active || total == nil
        progress.progress = total.map { $0 > 0 ? Float(min(1, max(0, Double(bytes) / Double($0)))) : 0 } ?? 0
    }
}

// Shared native presentation only. Each module still owns its resolver, ledger and session.
class MobileDownloadScreen: UITableViewController, QLPreviewControllerDataSource {
    let input = UITextField(), notice = UILabel(), analyze = UIButton(type: .system)
    let extras = UIStackView()
    private let header = UIView(), form = UIStackView(), clear = UIButton(type: .system)
    private var preview: URL?, timer: Timer?
    var meter = MobileTransferMeter()
    var hint = "Dán link rồi bấm Phân tích để chọn file tải."
    var inputHint = "Dán liên kết HTTPS"
    init() { super.init(style: .insetGrouped) }
    required init?(coder: NSCoder) { fatalError("Use init()") }
    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .systemGroupedBackground
        navigationItem.leftBarButtonItem = UIBarButtonItem(barButtonSystemItem: .close, target: self, action: #selector(closeScreen))
        clear.setImage(UIImage(systemName: "clock.badge.xmark"), for: .normal)
        clear.accessibilityLabel = "Xóa lịch sử tải"; clear.accessibilityIdentifier = "downloads-clear-history"
        clear.addTarget(self, action: #selector(clearTapped), for: .touchUpInside)
        navigationItem.rightBarButtonItem = UIBarButtonItem(customView: clear)
        clear.widthAnchor.constraint(equalToConstant: 44).isActive = true; clear.heightAnchor.constraint(equalToConstant: 44).isActive = true
        let step = UILabel(); step.text = "1. Dán liên kết"; step.font = .preferredFont(forTextStyle: .headline)
        input.placeholder = inputHint; input.keyboardType = .URL; input.borderStyle = .roundedRect
        input.autocapitalizationType = .none; input.autocorrectionType = .no; input.clearButtonMode = .whileEditing
        input.returnKeyType = .go; input.addTarget(self, action: #selector(inputChanged), for: .editingChanged)
        input.addTarget(self, action: #selector(analyzeTapped), for: .editingDidEndOnExit)
        let paste = UIButton(type: .system); paste.configuration = .tinted(); paste.setTitle("Dán", for: .normal)
        paste.addTarget(self, action: #selector(pasteTapped), for: .touchUpInside)
        paste.accessibilityIdentifier = "downloads-paste"
        let entry = UIStackView(arrangedSubviews: [input, paste]); entry.spacing = 8
        input.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        input.setContentHuggingPriority(.defaultLow, for: .horizontal)
        paste.widthAnchor.constraint(equalToConstant: 56).isActive = true
        paste.setContentHuggingPriority(.required, for: .horizontal)
        analyze.configuration = .filled(); analyze.setTitle("2. Phân tích link", for: .normal)
        analyze.addTarget(self, action: #selector(analyzeTapped), for: .touchUpInside); analyze.isEnabled = false
        notice.text = hint; notice.numberOfLines = 0; notice.textColor = .secondaryLabel
        notice.font = .preferredFont(forTextStyle: .footnote); notice.adjustsFontForContentSizeCategory = true
        extras.axis = .vertical; extras.spacing = 8
        [step, entry, analyze, notice, extras].forEach { form.addArrangedSubview($0) }
        form.axis = .vertical; form.spacing = 12; form.isLayoutMarginsRelativeArrangement = true
        form.directionalLayoutMargins = .init(top: 16, leading: 16, bottom: 16, trailing: 16)
        form.backgroundColor = .secondarySystemGroupedBackground; form.layer.cornerRadius = 16
        form.translatesAutoresizingMaskIntoConstraints = false; header.addSubview(form)
        NSLayoutConstraint.activate([form.topAnchor.constraint(equalTo: header.topAnchor, constant: 8), form.leadingAnchor.constraint(equalTo: header.leadingAnchor, constant: 16), form.trailingAnchor.constraint(equalTo: header.trailingAnchor, constant: -16), form.bottomAnchor.constraint(equalTo: header.bottomAnchor, constant: -8)])
        [input, paste, analyze].forEach { $0.heightAnchor.constraint(greaterThanOrEqualToConstant: 48).isActive = true }
        tableView.tableHeaderView = header; tableView.keyboardDismissMode = .interactive
        tableView.rowHeight = UITableView.automaticDimension; tableView.estimatedRowHeight = 92
        tableView.register(MobileTransferCell.self, forCellReuseIdentifier: "transfer")
    }
    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        let width = tableView.bounds.width
        let height = header.systemLayoutSizeFitting(CGSize(width: width, height: 0), withHorizontalFittingPriority: .required, verticalFittingPriority: .fittingSizeLevel).height
        if abs(header.frame.height - height) > 1 || header.frame.width != width { header.frame = CGRect(x: 0, y: 0, width: width, height: height); tableView.tableHeaderView = header }
    }
    override func viewWillAppear(_ animated: Bool) {
        super.viewWillAppear(animated); refreshDownloads()
        timer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in self?.refreshDownloads() }
    }
    override func viewWillDisappear(_ animated: Bool) {
        super.viewWillDisappear(animated); timer?.invalidate(); timer = nil; stopCue(); cancelAnalysis(); setBusy(false)
    }
    deinit { timer?.invalidate() }
    @objc private func closeScreen() { dismiss(animated: true) }
    @objc private func inputChanged() {
        cancelAnalysis(); setBusy(false); notice.text = input.text?.isEmpty == false ? "Bấm Phân tích link để xem các lựa chọn tải." : hint
        stopCue(); tableView.reloadData(); view.setNeedsLayout()
    }
    @objc private func pasteTapped() {
        input.text = UIPasteboard.general.string; inputChanged()
        guard analyze.isEnabled else { return }
        if !UIAccessibility.isReduceMotionEnabled {
            let animation = CABasicAnimation(keyPath: "opacity"); animation.fromValue = 1; animation.toValue = 0.55
            animation.duration = 0.55; animation.autoreverses = true; animation.repeatCount = 3
            analyze.layer.add(animation, forKey: "next-step")
        }
        UIAccessibility.post(notification: .announcement, argument: "Đã dán liên kết. Bấm Phân tích link để tiếp tục.")
    }
    @objc private func analyzeTapped() { guard analyze.isEnabled else { return }; stopCue(); view.endEditing(true); beginAnalysis() }
    private func stopCue() { analyze.layer.removeAnimation(forKey: "next-step") }
    func setBusy(_ busy: Bool, title: String = "Đang phân tích…") {
        analyze.isEnabled = !busy && !(input.text ?? "").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        var config = analyze.configuration; config?.showsActivityIndicator = busy; config?.title = busy ? title : "2. Phân tích link"; analyze.configuration = config
        view.setNeedsLayout()
    }
    func setNotice(_ text: String) { notice.text = text; view.setNeedsLayout() }
    func setHistoryAvailable(_ available: Bool) { clear.isEnabled = available }
    @objc private func clearTapped() {
        let alert = UIAlertController(title: "Xóa lịch sử tải?", message: "Xóa các mục đã kết thúc. Lượt đang tải và file đã lưu được giữ nguyên. Hãy lưu file cần dùng ra Tệp trước khi xóa lịch sử.", preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "Giữ lại", style: .cancel))
        alert.addAction(UIAlertAction(title: "Xóa lịch sử", style: .destructive) { [weak self] _ in self?.clearHistory() })
        present(alert, animated: true)
    }
    func emptyCell(_ text: String) -> UITableViewCell {
        let cell = UITableViewCell(style: .default, reuseIdentifier: nil); cell.textLabel?.text = text
        cell.textLabel?.numberOfLines = 0; cell.textLabel?.font = .preferredFont(forTextStyle: .subheadline)
        cell.textLabel?.textColor = .secondaryLabel; cell.selectionStyle = .none; return cell
    }
    func openFile(_ url: URL) {
        if url.pathExtension.lowercased() == "webm" || !QLPreviewController.canPreview(url as NSURL) {
            let alert = UIAlertController(title: "Xuất file để mở", message: "Trình xem trên iPhone chưa hỗ trợ định dạng này. Lưu ra Tệp hoặc mở bằng trình phát phù hợp.", preferredStyle: .alert)
            alert.addAction(UIAlertAction(title: "Đóng", style: .cancel)); alert.addAction(UIAlertAction(title: "Lưu vào Tệp", style: .default) { [weak self] _ in self?.exportFile(url) }); present(alert, animated: true); return
        }
        preview = url; let controller = QLPreviewController(); controller.dataSource = self; present(controller, animated: true)
    }
    func exportFile(_ url: URL) { present(UIDocumentPickerViewController(forExporting: [url], asCopy: true), animated: true) }
    func numberOfPreviewItems(in controller: QLPreviewController) -> Int { preview == nil ? 0 : 1 }
    func previewController(_ controller: QLPreviewController, previewItemAt index: Int) -> QLPreviewItem { preview! as NSURL }
    func beginAnalysis() {}
    func cancelAnalysis() {}
    func refreshDownloads() {}
    func clearHistory() {}
}
#endif
