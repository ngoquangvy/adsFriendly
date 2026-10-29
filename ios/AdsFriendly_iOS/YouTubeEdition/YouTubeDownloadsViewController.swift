#if AF_YOUTUBE && !AF_PROTECTION_ONLY
import UIKit

final class YouTubeDownloadsViewController: MobileDownloadScreen {
    private let store: YouTubeDownloadStore
    private let resolver: (String) async throws -> YouTubeSources
    private let kind = UISegmentedControl(items: ["Âm thanh", "Video"])
    private let originals = UIButton(type: .system)
    private var sources: YouTubeSources?
    private var showOriginals = false
    private var work: Task<Void, Never>?
    private var epoch = 0
    private var signature = ""
    private var active: [YouTubeJob] { store.jobs.filter { !MobileTransferPolicy.isFinished($0.state) } }
    private var history: [YouTubeJob] { store.jobs.filter { MobileTransferPolicy.isFinished($0.state) } }
    private var displayedChoices: [YouTubeChoice] {
        sources?.choicesForDisplay(includeOriginals: showOriginals).filter { $0.hasVideo == (kind.selectedSegmentIndex == 1) } ?? []
    }
    init(store: YouTubeDownloadStore = .shared, resolver: @escaping (String) async throws -> YouTubeSources = YouTubeSourceResolver.resolve) { self.store = store; self.resolver = resolver; super.init() }
    required init?(coder: NSCoder) { fatalError("Use init()") }
    override func viewDidLoad() {
        title = "Tải từ YouTube"
        hint = "Dán link YouTube để chọn nhạc M4A hoặc video MP4."
        inputHint = "Link video, Shorts hoặc YouTube Music"
        super.viewDidLoad()
        input.accessibilityIdentifier = "youtube-source"; analyze.accessibilityIdentifier = "youtube-check"; notice.accessibilityIdentifier = "youtube-status"
        kind.selectedSegmentIndex = 0; kind.isHidden = true
        kind.accessibilityIdentifier = "youtube-media-kind"
        kind.addTarget(self, action: #selector(selectionChanged), for: .valueChanged)
        originals.isHidden = true; originals.configuration = .plain(); originals.setTitle("Định dạng khác · WebM", for: .normal)
        originals.accessibilityIdentifier = "youtube-originals"
        originals.addTarget(self, action: #selector(toggleOriginals), for: .touchUpInside)
        extras.addArrangedSubview(kind); extras.addArrangedSubview(originals)
        for control in [kind as UIView, originals] {
            let height = control.heightAnchor.constraint(greaterThanOrEqualToConstant: 44); height.priority = .defaultHigh; height.isActive = true
        }
    }
    override func cancelAnalysis() {
        work?.cancel(); epoch += 1; sources = nil; showOriginals = false
        kind.isHidden = true; originals.isHidden = true; originals.setTitle("Định dạng khác · WebM", for: .normal)
    }
    @objc private func toggleOriginals() {
        showOriginals.toggle(); originals.setTitle(showOriginals ? "Ẩn định dạng WebM" : "Định dạng khác · WebM", for: .normal)
        tableView.reloadData(); view.setNeedsLayout()
    }
    @objc private func selectionChanged() {
        originals.isHidden = kind.selectedSegmentIndex == 1 || sources?.hasOriginalFormats != true
        tableView.reloadData(); view.setNeedsLayout()
    }
    override func beginAnalysis() {
        cancelAnalysis(); let current = epoch, text = input.text ?? ""
        setBusy(true); setNotice("Đang tìm tiêu đề và nguồn tải trên YouTube…")
        work = Task { @MainActor [weak self] in
            do {
                guard let resolver = self?.resolver else { return }
                let result = try await resolver(text)
                guard let self = self, self.epoch == current, !Task.isCancelled else { return }
                self.sources = result; self.setBusy(false)
                let hasAAC = result.choices.contains { !$0.hasVideo && $0.isIPhoneCompatible }
                self.kind.isHidden = false
                self.kind.selectedSegmentIndex = !hasAAC && result.choices.contains(where: { $0.hasVideo }) ? 1 : 0
                self.setNotice((result.title ?? "Đã tìm thấy nguồn") + (hasAAC ? "\nChọn âm thanh hoặc video, rồi chạm nguồn để tải." : "\nChưa tìm thấy âm thanh M4A riêng. Bạn có thể thử lại; WebM cần trình phát hỗ trợ."))
                self.selectionChanged(); self.tableView.reloadData()
            } catch {
                guard let self = self, self.epoch == current, !Task.isCancelled else { return }
                self.setBusy(false); self.setNotice(self.message(for: error))
            }
        }
    }
    private func message(for error: Error) -> String {
        (error as? YouTubeResolutionFailure)?.localizedDescription ?? (error as? YouTubeDownloadError)?.localizedDescription ?? (error as? MobileSourceError)?.localizedDescription ?? YouTubeDownloadError.unavailable.localizedDescription
    }
    override func clearHistory() {
        do { try store.clearHistory(); setNotice("Đã xóa lịch sử. File đã lưu và lượt đang tải được giữ nguyên."); tableView.reloadData(); refreshDownloads() }
        catch { setNotice(YouTubeDownloadError.storage.localizedDescription) }
    }
    override func refreshDownloads() {
        store.finishReadyJobs(); setHistoryAvailable(!history.isEmpty)
        let next = store.jobs.map { $0.id + $0.state }.joined(separator: "|")
        if next != signature { signature = next; tableView.reloadData(); return }
        for path in tableView.indexPathsForVisibleRows ?? [] where path.section > 0 {
            if let cell = tableView.cellForRow(at: path) as? MobileTransferCell, let row = job(at: path) { configure(cell, row: row) }
        }
    }
    override func numberOfSections(in tableView: UITableView) -> Int { 3 }
    override func tableView(_ tableView: UITableView, titleForHeaderInSection section: Int) -> String? {
        if section == 0 { return sources == nil ? nil : "3. Chọn nguồn để tải" }
        if section == 1 { return active.isEmpty ? nil : "Đang tải · \(active.count)" }
        return history.isEmpty ? "Lịch sử" : "Lịch sử · \(history.count)"
    }
    override func tableView(_ tableView: UITableView, titleForFooterInSection section: Int) -> String? {
        section == 2 && !history.isEmpty ? "Chạm file đã lưu để mở. Nút ⋯ có Lưu vào Tệp và Xóa lịch sử." : nil
    }
    override func tableView(_ tableView: UITableView, numberOfRowsInSection section: Int) -> Int {
        section == 0 ? (sources == nil ? 0 : max(1, displayedChoices.count)) : section == 1 ? active.count : max(1, history.count)
    }
    private func job(at path: IndexPath) -> YouTubeJob? {
        let rows = path.section == 1 ? active : history
        return rows.indices.contains(path.row) ? rows[path.row] : nil
    }
    override func tableView(_ tableView: UITableView, cellForRowAt path: IndexPath) -> UITableViewCell {
        if path.section == 0 {
            guard displayedChoices.indices.contains(path.row) else { return emptyCell(sources == nil ? "Phân tích link để xem các lựa chọn tải." : "Chưa tìm thấy nguồn cho lựa chọn này.") }
            let choice = displayedChoices[path.row], cell = UITableViewCell(style: .subtitle, reuseIdentifier: nil)
            cell.textLabel?.text = choice.label; cell.textLabel?.numberOfLines = 2
            cell.detailTextLabel?.text = choice.isIPhoneCompatible ? (choice.hasVideo ? "MP4 phát trên iPhone · Giữ nguyên chất lượng nguồn" : "AAC tốt nhất tìm được · Phát trên iPhone") : "WebM gốc · Cần trình phát hỗ trợ riêng"
            cell.detailTextLabel?.numberOfLines = 0
            cell.accessoryView = UIImageView(image: UIImage(systemName: "arrow.down.circle.fill")); cell.accessoryView?.tintColor = .systemBlue
            cell.accessibilityIdentifier = "youtube-choice-" + choice.id; return cell
        }
        guard let row = job(at: path) else { return emptyCell(path.section == 1 ? "Chưa có lượt tải đang chạy." : "Chưa có lịch sử tải.") }
        let cell = tableView.dequeueReusableCell(withIdentifier: "transfer", for: path) as! MobileTransferCell
        configure(cell, row: row); return cell
    }
    private func configure(_ cell: MobileTransferCell, row: YouTubeJob) {
        let running = row.state == "downloading", finished = MobileTransferPolicy.isFinished(row.state)
        var detail = row.outputExtension.uppercased() + " · " + MobileTransferPolicy.stateName(row.state)
        if running { detail += "\n" + meter.detail(id: row.id, bytes: row.bytes, total: row.total) }
        if row.state == "failed" { detail += " · Phân tích lại link để thử lại." }
        if row.state == "saved", row.outputExtension == "webm" { detail += " · Cần trình phát WebM" }
        var actions: [UIAction] = []
        if !finished {
            actions.append(UIAction(title: "Hủy tải", image: UIImage(systemName: "xmark.circle"), attributes: .destructive) { [weak self] _ in self?.store.cancel(row.id); self?.refreshDownloads() })
        } else {
            if let url = store.output(row.id) { actions.append(UIAction(title: "Lưu vào Tệp", image: UIImage(systemName: "square.and.arrow.up")) { [weak self] _ in self?.exportFile(url) }) }
            actions.append(UIAction(title: "Xóa khỏi lịch sử", image: UIImage(systemName: "clock.badge.xmark"), attributes: .destructive) { [weak self] _ in
                guard let self = self else { return }
                do { try self.store.forget(row.id); self.refreshDownloads() } catch { self.setNotice(YouTubeDownloadError.storage.localizedDescription) }
            })
        }
        cell.configure(title: row.sourceTitle ?? row.filename, subtitle: detail, bytes: row.bytes, total: row.total, active: running, menu: UIMenu(children: actions))
    }
    override func tableView(_ tableView: UITableView, didSelectRowAt path: IndexPath) {
        tableView.deselectRow(at: path, animated: true)
        if path.section > 0 { if let row = job(at: path), let url = store.output(row.id) { openFile(url) }; return }
        guard analyze.isEnabled, let sources = sources, displayedChoices.indices.contains(path.row) else { return }
        let current = epoch, choice = displayedChoices[path.row]
        setBusy(true, title: "Đang kiểm tra nguồn…"); setNotice("Đang kiểm tra dung lượng và nguồn đã chọn…")
        work = Task { @MainActor [weak self] in
            do {
                let prepared = try await YouTubeSourceResolver.prepare(choice, expiresAt: sources.expiresAt)
                guard let self = self, self.epoch == current, !Task.isCancelled else { return }
                self.setBusy(false)
                let bytes = prepared.tracks.reduce(Int64(0)) { $0 + ($1.source.bytes ?? 0) }
                let size = prepared.tracks.allSatisfy { $0.source.bytes != nil } ? ByteCountFormatter.string(fromByteCount: bytes, countStyle: .file) : "Chưa rõ dung lượng"
                let playback = !choice.isIPhoneCompatible ? "WebM có thể không phát bằng trình xem mặc định trên iPhone." : choice.hasVideo ? "Video và audio tải song song. Giữ app mở lúc ghép." : "Giữ nguồn AAC tốt nhất tìm được trong file M4A."
                let alert = UIAlertController(title: "Tải \(choice.hasVideo ? "video" : "âm thanh")?", message: "\(sources.title ?? "YouTube")\n\(choice.label) · \(size)\n\(playback)", preferredStyle: .alert)
                alert.addAction(UIAlertAction(title: "Hủy", style: .cancel) { [weak self] _ in self?.setNotice("Chọn nguồn khác hoặc phân tích link mới.") })
                alert.addAction(UIAlertAction(title: choice.isIPhoneCompatible ? "Tải xuống" : "Tải WebM gốc", style: .default) { [weak self] _ in
                    guard let self = self, self.epoch == current else { return }
                    do { try self.store.start(prepared); self.setNotice("Đã bắt đầu tải. Tiến độ hiển thị ở mục Đang tải."); self.refreshDownloads() }
                    catch { self.setNotice(self.message(for: error)) }
                }); self.present(alert, animated: true)
            } catch {
                guard let self = self, self.epoch == current, !Task.isCancelled else { return }
                self.setBusy(false); self.setNotice(self.message(for: error))
            }
        }
    }
}
#endif
