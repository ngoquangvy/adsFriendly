#if !AF_PROTECTION_ONLY
import UIKit

final class MobileDownloadsViewController: MobileDownloadScreen {
    private let catalog: MobileModuleCatalog
    private let store: MobileDownloadStore
    private let probeConfiguration: URLSessionConfiguration?
    private var probe: MobileSourceProbe?
    private var checked: CheckedMobileSource?
    private var generation = 0
    private var signature = ""
    private var active: [MobileDownloadRecord] { store.records.filter { !MobileTransferPolicy.isFinished($0.state) } }
    private var history: [MobileDownloadRecord] { store.records.filter { MobileTransferPolicy.isFinished($0.state) } }
    init(catalog: MobileModuleCatalog, store: MobileDownloadStore = .shared, configuration: URLSessionConfiguration? = nil) {
        self.catalog = catalog; self.store = store; self.probeConfiguration = configuration; super.init()
    }
    required init?(coder: NSCoder) { fatalError("Use init(catalog:)") }
    override func viewDidLoad() {
        title = "Tải nhạc & video"
        hint = "Dùng link HTTPS trỏ trực tiếp tới file nhạc hoặc video."
        inputHint = "https://…/ten-bai-hat.mp3"
        super.viewDidLoad()
        input.accessibilityIdentifier = "media-source"; analyze.accessibilityIdentifier = "media-check"; notice.accessibilityIdentifier = "media-status"
    }
    override func cancelAnalysis() { generation += 1; probe?.cancel(); checked = nil }
    override func beginAnalysis() {
        cancelAnalysis(); let current = generation; setBusy(true); setNotice("Đang kiểm tra file từ liên kết…")
        probe = MobileSourceProbe(catalog: catalog, configuration: probeConfiguration ?? .ephemeral)
        probe?.check(input.text ?? "") { [weak self] result in
            guard let self = self, self.generation == current else { return }
            self.setBusy(false)
            switch result {
            case .success(let value): self.checked = value; self.setNotice("Đã tìm thấy file. Chọn Tải xuống bên dưới.")
            case .failure(let error): self.setNotice((error as? MobileSourceError)?.localizedDescription ?? MobileSourceError.network.localizedDescription)
            }
            self.tableView.reloadData()
        }
    }
    override func clearHistory() {
        do { try store.clearHistory(); setNotice("Đã xóa lịch sử. File đã lưu và lượt đang tải được giữ nguyên."); refreshDownloads() }
        catch { setNotice("Không lưu được thay đổi lịch sử. Kiểm tra dung lượng rồi thử lại.") }
    }
    override func refreshDownloads() {
        store.finishReadyJobs()
        setHistoryAvailable(!history.isEmpty)
        let next = store.records.map { $0.id + $0.state }.joined(separator: "|")
        if next != signature { signature = next; tableView.reloadData(); return }
        for path in tableView.indexPathsForVisibleRows ?? [] where path.section > 0 {
            if let cell = tableView.cellForRow(at: path) as? MobileTransferCell, let row = record(at: path) { configure(cell, row: row) }
        }
    }
    override func numberOfSections(in tableView: UITableView) -> Int { 3 }
    override func tableView(_ tableView: UITableView, titleForHeaderInSection section: Int) -> String? {
        ["3. Chọn file để tải", "Đang tải · \(active.count)", "Lịch sử · \(history.count)"][section]
    }
    override func tableView(_ tableView: UITableView, titleForFooterInSection section: Int) -> String? {
        section == 2 ? "Chạm file đã lưu để mở. Nút ⋯ có Lưu vào Tệp và Xóa lịch sử." : nil
    }
    override func tableView(_ tableView: UITableView, numberOfRowsInSection section: Int) -> Int {
        section == 0 ? 1 : max(1, section == 1 ? active.count : history.count)
    }
    private func record(at path: IndexPath) -> MobileDownloadRecord? {
        let rows = path.section == 1 ? active : history
        return rows.indices.contains(path.row) ? rows[path.row] : nil
    }
    override func tableView(_ tableView: UITableView, cellForRowAt path: IndexPath) -> UITableViewCell {
        if path.section == 0 {
            guard let source = checked else { return emptyCell("Dán link và bấm Phân tích. File tìm được sẽ hiện ở đây.") }
            let cell = UITableViewCell(style: .subtitle, reuseIdentifier: nil)
            cell.textLabel?.text = source.filename ?? "File \(source.fileExtension.uppercased())"
            cell.textLabel?.numberOfLines = 2; cell.detailTextLabel?.numberOfLines = 0
            let size = source.bytes.map { ByteCountFormatter.string(fromByteCount: $0, countStyle: .file) } ?? "Chưa rõ dung lượng"
            cell.detailTextLabel?.text = "\(source.fileExtension.uppercased()) · \(size) · Tải xuống"
            cell.accessoryView = UIImageView(image: UIImage(systemName: "arrow.down.circle.fill")); cell.accessoryView?.tintColor = .systemBlue
            cell.accessibilityIdentifier = "media-confirm"; return cell
        }
        guard let row = record(at: path) else { return emptyCell(path.section == 1 ? "Chưa có lượt tải đang chạy." : "Chưa có lịch sử tải.") }
        let cell = tableView.dequeueReusableCell(withIdentifier: "transfer", for: path) as! MobileTransferCell
        configure(cell, row: row); return cell
    }
    private func configure(_ cell: MobileTransferCell, row: MobileDownloadRecord) {
        let running = row.state == "downloading"
        var detail = MobileTransferPolicy.stateName(row.state)
        if running { detail += "\n" + meter.detail(id: row.id, bytes: row.bytes, total: row.total) }
        else if ["failed", "interrupted"].contains(row.state) { detail += " · Phân tích lại link để thử lại." }
        else if row.state == "saved" { detail += " · " + ByteCountFormatter.string(fromByteCount: row.bytes, countStyle: .file) }
        var actions: [UIAction] = []
        if !MobileTransferPolicy.isFinished(row.state) {
            actions.append(UIAction(title: "Hủy tải", image: UIImage(systemName: "xmark.circle"), attributes: .destructive) { [weak self] _ in self?.store.cancel(row.id); self?.tableView.reloadData(); self?.refreshDownloads() })
        } else {
            if let url = store.output(row.id) { actions.append(UIAction(title: "Lưu vào Tệp", image: UIImage(systemName: "square.and.arrow.up")) { [weak self] _ in self?.exportFile(url) }) }
            actions.append(UIAction(title: "Xóa khỏi lịch sử", image: UIImage(systemName: "clock.badge.xmark"), attributes: .destructive) { [weak self] _ in
                guard let self = self else { return }
                do { try self.store.forget(row.id); self.tableView.reloadData(); self.refreshDownloads() } catch { self.setNotice("Không lưu được thay đổi lịch sử.") }
            })
        }
        cell.configure(title: row.filename, subtitle: detail, bytes: row.bytes, total: row.total, active: running, menu: UIMenu(children: actions))
    }
    override func tableView(_ tableView: UITableView, didSelectRowAt path: IndexPath) {
        tableView.deselectRow(at: path, animated: true)
        if path.section > 0 { if let row = record(at: path), let url = store.output(row.id) { openFile(url) }; return }
        guard let source = checked else { return }
        let current = generation
        let alert = UIAlertController(title: "Tải \(source.filename ?? "file gốc")?", message: "Giữ nguyên định dạng nguồn. Khi tải xong, chọn Lưu vào Tệp để sử dụng ngoài app.", preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "Hủy", style: .cancel))
        alert.addAction(UIAlertAction(title: "Tải xuống", style: .default) { [weak self] _ in
            guard let self = self, self.generation == current else { return }
            do { try self.store.start(source); self.cancelAnalysis(); self.setNotice("Đang tải. Bạn có thể xem tiến độ ở mục Đang tải."); self.tableView.reloadData(); self.refreshDownloads() }
            catch { self.setNotice((error as? MobileSourceError)?.localizedDescription ?? "Không bắt đầu được lượt tải. Kiểm tra dung lượng và thử lại.") }
        }); present(alert, animated: true)
    }
}
#endif
