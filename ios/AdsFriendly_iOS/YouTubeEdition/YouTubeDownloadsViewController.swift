#if AF_YOUTUBE && !AF_PROTECTION_ONLY
import UIKit
import QuickLook

final class YouTubeDownloadsViewController: UIViewController, UITableViewDataSource, UITableViewDelegate, QLPreviewControllerDataSource {
    private let input = UITextField()
    private let status = UILabel()
    private let check = UIButton(type: .system)
    private let table = UITableView(frame: .zero, style: .insetGrouped)
    private let store = YouTubeDownloadStore.shared
    private var sources: YouTubeSources?
    private var work: Task<Void, Never>?
    private var epoch = 0
    private var timer: Timer?
    private var preview: URL?
    override func viewDidLoad() {
        super.viewDidLoad()
        title = "YouTube · Bản thử nghiệm"
        view.backgroundColor = .systemBackground
        navigationItem.leftBarButtonItem = UIBarButtonItem(barButtonSystemItem: .close, target: self, action: #selector(close))
        input.placeholder = "https://www.youtube.com/watch?v=…"
        input.keyboardType = .URL; input.borderStyle = .roundedRect
        input.autocorrectionType = .no; input.autocapitalizationType = .none
        input.accessibilityIdentifier = "youtube-source"
        input.addTarget(self, action: #selector(edited), for: .editingChanged)
        let paste = UIButton(type: .system)
        paste.setTitle("Dán link", for: .normal); paste.addTarget(self, action: #selector(pasteLink), for: .touchUpInside)
        check.setTitle("Phân tích video / audio", for: .normal)
        check.accessibilityIdentifier = "youtube-check"
        check.addTarget(self, action: #selector(resolve), for: .touchUpInside)
        status.numberOfLines = 0; status.font = .preferredFont(forTextStyle: .footnote)
        status.adjustsFontForContentSizeCategory = true; status.accessibilityIdentifier = "youtube-status"
        status.text = "Chọn Video MP4 hoặc Audio gốc. Audio ưu tiên bitrate cao nhất tìm được; WebM/Opus có thể không xem trước được trên iPhone nhưng vẫn xuất file được. Không đổi sang MP3."
        let stack = UIStackView(arrangedSubviews: [input, paste, check, status])
        stack.axis = .vertical; stack.spacing = 8; stack.translatesAutoresizingMaskIntoConstraints = false
        [input, paste, check].forEach { $0.heightAnchor.constraint(greaterThanOrEqualToConstant: 44).isActive = true }
        table.dataSource = self; table.delegate = self
        table.rowHeight = UITableView.automaticDimension; table.estimatedRowHeight = 70
        table.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(stack); view.addSubview(table)
        NSLayoutConstraint.activate([
            stack.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 8),
            stack.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor, constant: 16),
            stack.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor, constant: -16),
            table.topAnchor.constraint(equalTo: stack.bottomAnchor, constant: 8),
            table.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor),
            table.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor),
            table.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor)
        ])
    }
    override func viewWillAppear(_ animated: Bool) {
        super.viewWillAppear(animated); store.finishReadyJobs(); table.reloadData()
        timer = Timer.scheduledTimer(withTimeInterval: 2, repeats: true) { [weak self] _ in self?.refreshRows() }
    }
    override func viewWillDisappear(_ animated: Bool) {
        super.viewWillDisappear(animated); timer?.invalidate(); timer = nil
        work?.cancel(); epoch += 1; check.isEnabled = true
    }
    @objc private func close() { dismiss(animated: true) }
    @objc private func pasteLink() { input.text = UIPasteboard.general.string; edited() }
    @objc private func edited() {
        work?.cancel(); epoch += 1; sources = nil; check.isEnabled = true; table.reloadData()
    }
    @objc private func resolve() {
        view.endEditing(true); edited()
        let current = epoch, text = input.text ?? ""
        check.isEnabled = false; status.text = "Đang phân tích trên máy… Bạn có thể đóng màn hình để hủy."
        work = Task { @MainActor [weak self] in
            do {
                let result = try await YouTubeSourceResolver.resolve(text)
                guard let self = self, self.epoch == current, !Task.isCancelled else { return }
                self.sources = result; self.check.isEnabled = true
                self.status.text = "Đã thấy \(result.choices.count) lựa chọn cho video \(result.videoID). Chọn một mục bên dưới; chưa bắt đầu tải."
                self.table.reloadData()
            } catch {
                guard let self = self, self.epoch == current, !Task.isCancelled else { return }
                self.check.isEnabled = true
                self.status.text = (error as? YouTubeDownloadError)?.localizedDescription ?? YouTubeDownloadError.unavailable.localizedDescription
            }
        }
    }
    func numberOfSections(in tableView: UITableView) -> Int { 2 }
    func tableView(_ tableView: UITableView, titleForHeaderInSection section: Int) -> String? {
        section == 0 ? "Chọn nguồn · chưa tải" : "Lượt tải của bản YouTube"
    }
    func tableView(_ tableView: UITableView, numberOfRowsInSection section: Int) -> Int {
        section == 0 ? (sources?.choices.count ?? 0) : store.jobs.count
    }
    func tableView(_ tableView: UITableView, cellForRowAt indexPath: IndexPath) -> UITableViewCell {
        let cell = UITableViewCell(style: .subtitle, reuseIdentifier: nil)
        cell.textLabel?.numberOfLines = 2; cell.detailTextLabel?.numberOfLines = 0
        if indexPath.section == 0, let choice = sources?.choices[indexPath.row] {
            cell.textLabel?.text = choice.label
            cell.detailTextLabel?.text = choice.tracks.count == 2 ? "Tải hai track và ghép trên iPhone, giữ nguyên codec." : "Tải nguồn gốc, giữ nguyên định dạng."
            cell.accessoryType = .disclosureIndicator
        } else { configure(cell, row: store.jobs[indexPath.row]) }
        return cell
    }
    private func configure(_ cell: UITableViewCell, row: YouTubeJob) {
        cell.textLabel?.text = row.label
        let names = ["downloading": "Đang tải", "waiting": "Mở app để hoàn tất", "finishing": "Đang kiểm tra / ghép file",
                     "saved": "Đã lưu", "failed": "Không hoàn tất", "cancelled": "Đã hủy"]
        var detail = names[row.state] ?? row.state
        if row.state == "downloading" {
            let progress = row.total.map { "\(Int(min(100, max(0, Double(row.bytes) / Double($0) * 100))))% · " } ?? ""
            detail += " · " + progress + ByteCountFormatter.string(fromByteCount: row.bytes, countStyle: .file)
        } else if row.state == "failed" {
            detail += row.reason == "session_ended" ? " · App/phiên tải đã kết thúc; phân tích lại link để thử lại." : " · Nguồn, mạng, dung lượng hoặc bước ghép không đạt. Phân tích lại link để thử lại."
        }
        cell.detailTextLabel?.text = detail
        cell.accessoryType = row.state == "saved" ? .disclosureIndicator : .none
    }
    private func refreshRows() {
        if table.numberOfRows(inSection: 1) != store.jobs.count { table.reloadData(); return }
        for path in table.indexPathsForVisibleRows ?? [] where path.section == 1 {
            if let cell = table.cellForRow(at: path), path.row < store.jobs.count { configure(cell, row: store.jobs[path.row]) }
        }
    }
    func tableView(_ tableView: UITableView, didSelectRowAt indexPath: IndexPath) {
        table.deselectRow(at: indexPath, animated: true)
        if indexPath.section == 1 {
            guard indexPath.row < store.jobs.count, let url = store.output(store.jobs[indexPath.row].id) else { return }
            preview = url; let controller = QLPreviewController(); controller.dataSource = self; present(controller, animated: true)
            return
        }
        guard work == nil || check.isEnabled, let sources = sources, indexPath.row < sources.choices.count else { return }
        let current = epoch, choice = sources.choices[indexPath.row]
        check.isEnabled = false; status.text = "Đang kiểm tra phản hồi của nguồn đã chọn…"
        work = Task { @MainActor [weak self] in
            do {
                let prepared = try await YouTubeSourceResolver.prepare(choice, expiresAt: sources.expiresAt)
                guard let self = self, self.epoch == current, !Task.isCancelled else { return }
                self.check.isEnabled = true
                let known = prepared.tracks.allSatisfy { $0.source.bytes != nil }
                let bytes = prepared.tracks.reduce(Int64(0)) { $0 + ($1.source.bytes ?? 0) }
                let size = known ? ByteCountFormatter.string(fromByteCount: bytes, countStyle: .file) : "Chưa biết tổng dung lượng"
                let alert = UIAlertController(title: choice.label, message: "\(size). Tải nguồn gốc; bitrate là thông số nguồn khai báo, không phải thước đo chất lượng tuyệt đối giữa codec. Video MP4 dùng AAC phù hợp iPhone; giữ app mở lúc ghép. Dùng Chia sẻ để lưu ra Tệp.", preferredStyle: .alert)
                alert.addAction(UIAlertAction(title: "Hủy", style: .cancel))
                alert.addAction(UIAlertAction(title: "Tải", style: .default) { [weak self] _ in
                    guard let self = self, self.epoch == current else { return }
                    do {
                        try self.store.start(prepared)
                        self.status.text = "Đã bắt đầu tải. Mạng chạy nền; mở app để hoàn tất kiểm tra/ghép."
                        self.table.reloadData()
                    } catch { self.status.text = (error as? YouTubeDownloadError)?.localizedDescription ?? YouTubeDownloadError.storage.localizedDescription }
                })
                self.present(alert, animated: true)
            } catch {
                guard let self = self, self.epoch == current, !Task.isCancelled else { return }
                self.check.isEnabled = true
                self.status.text = (error as? YouTubeDownloadError)?.localizedDescription ?? (error as? MobileSourceError)?.localizedDescription ?? YouTubeDownloadError.unavailable.localizedDescription
            }
        }
    }
    func tableView(_ tableView: UITableView, trailingSwipeActionsConfigurationForRowAt path: IndexPath) -> UISwipeActionsConfiguration? {
        guard path.section == 1, path.row < store.jobs.count else { return nil }
        let row = store.jobs[path.row]
        if ["downloading", "waiting", "finishing"].contains(row.state) {
            return UISwipeActionsConfiguration(actions: [.init(style: .destructive, title: "Hủy") { [weak self] _, _, done in self?.store.cancel(row.id); self?.table.reloadData(); done(true) }])
        }
        var actions = [UIContextualAction(style: .normal, title: "Xóa lịch sử") { [weak self] _, _, done in self?.store.forget(row.id); self?.table.reloadData(); done(true) }]
        if let url = store.output(row.id) {
            actions.insert(.init(style: .normal, title: "Chia sẻ") { [weak self] _, _, done in
                self?.present(UIDocumentPickerViewController(forExporting: [url], asCopy: true), animated: true); done(true)
            }, at: 0)
        }
        return UISwipeActionsConfiguration(actions: actions)
    }
    func numberOfPreviewItems(in controller: QLPreviewController) -> Int { preview == nil ? 0 : 1 }
    func previewController(_ controller: QLPreviewController, previewItemAt index: Int) -> QLPreviewItem { preview! as NSURL }
}
#endif
