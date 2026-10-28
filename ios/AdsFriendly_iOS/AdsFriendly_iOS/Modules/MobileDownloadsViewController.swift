#if !AF_PROTECTION_ONLY
import UIKit
import QuickLook

final class MobileDownloadsViewController: UIViewController, UITableViewDataSource, UITableViewDelegate, QLPreviewControllerDataSource {
    private let catalog: MobileModuleCatalog
    private let store = MobileDownloadStore.shared
    private let input = UITextField()
    private let message = UILabel()
    private let check = UIButton(type: .system)
    private let download = UIButton(type: .system)
    private let table = UITableView()
    private var probe: MobileSourceProbe?
    private var checked: CheckedMobileSource?
    private var timer: Timer?
    private var generation = 0
    private var signature = ""
    private var previewURL: URL?
    init(catalog: MobileModuleCatalog) { self.catalog = catalog; super.init(nibName: nil, bundle: nil) }
    required init?(coder: NSCoder) { fatalError("Use the module factory") }
    override func viewDidLoad() {
        super.viewDidLoad(); title = "Media Tools"; view.backgroundColor = .systemBackground
        navigationItem.leftBarButtonItem = UIBarButtonItem(barButtonSystemItem: .close, target: self, action: #selector(close))
        input.placeholder = "HTTPS media URL"; input.keyboardType = .URL; input.autocorrectionType = .no; input.autocapitalizationType = .none
        input.accessibilityIdentifier = "media-source"
        input.borderStyle = .roundedRect; input.addTarget(self, action: #selector(edited), for: .editingChanged)
        message.numberOfLines = 0; message.font = .preferredFont(forTextStyle: .footnote)
        message.text = "Original direct audio/video only. Browser sessions are not copied. YouTube pages and playlists need a future mobile resolver."
        check.setTitle("Check source", for: .normal); check.addTarget(self, action: #selector(checkSource), for: .touchUpInside)
        download.setTitle("Download original", for: .normal); download.isEnabled = false; download.addTarget(self, action: #selector(confirm), for: .touchUpInside)
        check.accessibilityIdentifier = "media-check"
        download.accessibilityIdentifier = "media-confirm"
        message.accessibilityIdentifier = "media-status"
        let paste = UIButton(type: .system); paste.setTitle("Paste link", for: .normal); paste.addTarget(self, action: #selector(pasteLink), for: .touchUpInside)
        let stack = UIStackView(arrangedSubviews: [input, paste, message, check, download]); stack.axis = .vertical; stack.spacing = 8
        stack.translatesAutoresizingMaskIntoConstraints = false; table.translatesAutoresizingMaskIntoConstraints = false
        [input, paste, check, download].forEach { $0.heightAnchor.constraint(greaterThanOrEqualToConstant: 44).isActive = true }
        table.dataSource = self; table.delegate = self; table.rowHeight = UITableView.automaticDimension; table.estimatedRowHeight = 72
        view.addSubview(stack); view.addSubview(table)
        NSLayoutConstraint.activate([stack.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 12), stack.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 16), stack.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -16), table.topAnchor.constraint(equalTo: stack.bottomAnchor, constant: 12), table.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor), table.leadingAnchor.constraint(equalTo: view.leadingAnchor), table.trailingAnchor.constraint(equalTo: view.trailingAnchor)])
    }
    override func viewWillAppear(_ animated: Bool) { super.viewWillAppear(animated); refresh(); timer = Timer.scheduledTimer(withTimeInterval: 3, repeats: true) { [weak self] _ in self?.refresh() } }
    override func viewWillDisappear(_ animated: Bool) { super.viewWillDisappear(animated); timer?.invalidate(); timer = nil; edited() }
    @objc private func close() { dismiss(animated: true) }
    @objc private func edited() { generation += 1; probe?.cancel(); checked = nil; download.isEnabled = false; check.isEnabled = true }
    @objc private func pasteLink() { input.text = UIPasteboard.general.string; edited() }
    @objc private func checkSource() {
        view.endEditing(true)
        edited(); let epoch = generation; check.isEnabled = false; message.text = "Checking response metadata…"
        probe = MobileSourceProbe(catalog: catalog)
        probe?.check(input.text ?? "") { [weak self] result in
            guard let self = self, self.generation == epoch else { return }
            self.check.isEnabled = true
            switch result {
            case .success(let value): self.checked = value; self.download.isEnabled = true; self.message.text = "\(value.url.host ?? "") · \(value.fileExtension.uppercased()) · \(Self.size(value.bytes))\nCheck expires in 30 seconds. Playback compatibility is not guaranteed by metadata."
            case .failure(let error): self.message.text = (error as? MobileSourceError)?.localizedDescription ?? MobileSourceError.network.localizedDescription
            }
        }
    }
    @objc private func confirm() {
        guard let source = checked else { return }; let epoch = generation
        let alert = UIAlertController(title: "Download original file?", message: "The app will save this media file privately. Use Share to export it to Files. URLs may expire during transfer.", preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "Cancel", style: .cancel))
        alert.addAction(UIAlertAction(title: "Download", style: .default) { [weak self] _ in
            guard let self = self, self.generation == epoch else { return }
            do { try self.store.start(source); self.edited(); self.message.text = "Background transfer started."; self.refresh() }
            catch { self.message.text = (error as? MobileSourceError)?.localizedDescription ?? "Could not start or save this download. Check storage and try again." }
        }); present(alert, animated: true)
    }
    private static func size(_ bytes: Int64?) -> String { bytes.map { ByteCountFormatter.string(fromByteCount: $0, countStyle: .file) } ?? "Size unavailable" }
    private func refresh() {
        let next = store.records.map { $0.id + $0.state }.joined(separator: "|")
        if signature != next { signature = next; table.reloadData() }
        else { for index in table.indexPathsForVisibleRows ?? [] { if let cell = table.cellForRow(at: index) { configure(cell, at: index) } } }
    }
    func tableView(_ tableView: UITableView, numberOfRowsInSection section: Int) -> Int { store.records.count }
    func tableView(_ tableView: UITableView, cellForRowAt indexPath: IndexPath) -> UITableViewCell { let cell = UITableViewCell(style: .subtitle, reuseIdentifier: nil); configure(cell, at: indexPath); return cell }
    private func configure(_ cell: UITableViewCell, at index: IndexPath) {
        let row = store.records[index.row]; cell.textLabel?.text = row.filename; cell.textLabel?.numberOfLines = 2
        let percent = row.total.flatMap { $0 > 0 ? "\(Int(min(100, max(0, Double(row.bytes) / Double($0) * 100))))% · " : nil } ?? ""
        cell.detailTextLabel?.text = "\(row.state) · \(row.state == "downloading" ? percent : "")\(Self.size(row.bytes))"; cell.detailTextLabel?.numberOfLines = 2
        if row.state == "failed" || row.state == "interrupted" {
            cell.detailTextLabel?.text = "\(row.state) · \(row.reason == "session_ended" ? "Transfer ended; check the source to retry." : "Response, storage or network error; check the source to retry.")"
        }
        cell.accessoryType = row.state == "saved" ? .disclosureIndicator : .none
    }
    func tableView(_ tableView: UITableView, didSelectRowAt indexPath: IndexPath) {
        guard let url = store.output(store.records[indexPath.row].id) else { return }
        previewURL = url; let controller = QLPreviewController(); controller.dataSource = self; present(controller, animated: true)
    }
    func tableView(_ tableView: UITableView, trailingSwipeActionsConfigurationForRowAt indexPath: IndexPath) -> UISwipeActionsConfiguration? {
        let row = store.records[indexPath.row]
        if row.state == "downloading" { return UISwipeActionsConfiguration(actions: [UIContextualAction(style: .destructive, title: "Cancel") { [weak self] _, _, done in self?.store.cancel(row.id); self?.refresh(); done(true) }]) }
        var actions = [UIContextualAction(style: .normal, title: "Forget") { [weak self] _, _, done in self?.store.forget(row.id); self?.refresh(); done(true) }]
        if let url = store.output(row.id) { actions.insert(UIContextualAction(style: .normal, title: "Share") { [weak self] _, _, done in self?.present(UIDocumentPickerViewController(forExporting: [url], asCopy: true), animated: true); done(true) }, at: 0) }
        return UISwipeActionsConfiguration(actions: actions)
    }
    func numberOfPreviewItems(in controller: QLPreviewController) -> Int { previewURL == nil ? 0 : 1 }
    func previewController(_ controller: QLPreviewController, previewItemAt index: Int) -> QLPreviewItem { previewURL! as NSURL }
}
#endif
