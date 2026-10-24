#if !AF_PROTECTION_ONLY
import Foundation

struct MobileDownloadRecord: Codable {
    let id: String
    let filename: String
    var state: String
    var bytes: Int64
    var total: Int64?
    var reason: String?
}

// OS-owned background tasks hold request URLs. The app ledger stores only our
// IDs, generated filenames, sizes and reason codes, never source URLs or tokens.
final class MobileDownloadStore: NSObject, URLSessionDownloadDelegate, URLSessionTaskDelegate {
    static let identifier = "com.vyngo.AdsFriendly-iOS.media-downloads.v1"
    static let shared = MobileDownloadStore()
    private(set) var records: [MobileDownloadRecord] = []
    var backgroundCompletion: (() -> Void)?
    private var session: URLSession!
    private let directory: URL
    private let ledger: URL
    override private init() {
        directory = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0].appendingPathComponent("AdsFriendly", isDirectory: true)
        ledger = directory.appendingPathComponent("history.json")
        super.init()
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        if let data = try? Data(contentsOf: ledger), let saved = try? JSONDecoder().decode([MobileDownloadRecord].self, from: data) { records = Array(saved.prefix(50)) }
        let config = URLSessionConfiguration.background(withIdentifier: Self.identifier)
        config.httpShouldSetCookies = false
        config.httpMaximumConnectionsPerHost = 4
        config.timeoutIntervalForRequest = 30
        config.timeoutIntervalForResource = 86400
        session = URLSession(configuration: config, delegate: self, delegateQueue: .main)
        let recovering = Set(records.filter { $0.state == "downloading" }.map { $0.id })
        session.getAllTasks { [weak self] tasks in DispatchQueue.main.async {
            guard let self = self else { return }
            let running = Set(tasks.compactMap { $0.taskDescription })
            for i in self.records.indices where recovering.contains(self.records[i].id) && self.records[i].state == "downloading" && !running.contains(self.records[i].id) {
                self.records[i].state = "interrupted"; self.records[i].reason = "session_ended"
            }
            try? self.persist()
        } }
    }
    private func persist() throws { try JSONEncoder().encode(records).write(to: ledger, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication]) }
    func start(_ source: CheckedMobileSource) throws {
        guard source.expiresAt > Date() else { throw MobileSourceError.expired }
        _ = try MobileSourceURL.validate(source.url)
        guard records.count < 50 else { throw MobileSourceError.configuration }
        let id = UUID().uuidString
        let record = MobileDownloadRecord(id: id, filename: "Media-\(id.prefix(8)).\(source.fileExtension)", state: "downloading", bytes: 0, total: source.bytes)
        records.insert(record, at: 0)
        do { try persist() } catch { records.removeFirst(); throw error }
        let task = session.downloadTask(with: source.url); task.taskDescription = id; task.resume()
    }
    func cancel(_ id: String) {
        guard records.first(where: { $0.id == id })?.state == "downloading" else { return }
        session.getAllTasks { tasks in tasks.filter { $0.taskDescription == id }.forEach { $0.cancel() } }
        if let index = records.firstIndex(where: { $0.id == id }) { records[index].state = "cancelled"; try? persist() }
    }
    func forget(_ id: String) {
        guard records.first(where: { $0.id == id })?.state != "downloading" else { return }
        records.removeAll { $0.id == id }; try? persist()
    }
    func output(_ id: String) -> URL? {
        guard let record = records.first(where: { $0.id == id && $0.state == "saved" }), !record.filename.contains("/"), !record.filename.contains("..") else { return nil }
        let url = directory.appendingPathComponent(record.filename)
        return FileManager.default.fileExists(atPath: url.path) ? url : nil
    }
    func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didWriteData bytesWritten: Int64,
                    totalBytesWritten: Int64, totalBytesExpectedToWrite: Int64) {
        guard let index = records.firstIndex(where: { $0.id == downloadTask.taskDescription && $0.state == "downloading" }) else { return }
        records[index].bytes = totalBytesWritten
        if totalBytesExpectedToWrite > 0 { records[index].total = totalBytesExpectedToWrite }
    }
    func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didFinishDownloadingTo location: URL) {
        guard let index = records.firstIndex(where: { $0.id == downloadTask.taskDescription && $0.state == "downloading" }) else { return }
        do {
            guard let response = downloadTask.response as? HTTPURLResponse, (200..<300).contains(response.statusCode) else { throw MobileSourceError.network }
            let catalog = try MobileModuleCatalog.load()
            let expected = records[index].filename.components(separatedBy: ".").last ?? ""
            guard catalog.fileExtension(mime: response.mimeType ?? "", fallback: expected) == expected else { throw MobileSourceError.unsupported }
            let size = (try FileManager.default.attributesOfItem(atPath: location.path)[.size] as? NSNumber)?.int64Value ?? 0
            guard size > 0, records[index].total.map({ $0 <= 0 || $0 == size }) ?? true else { throw MobileSourceError.unsupported }
            try FileManager.default.moveItem(at: location, to: directory.appendingPathComponent(records[index].filename))
            records[index].bytes = size; records[index].state = "saved"; records[index].reason = nil
        } catch { records[index].state = "failed"; records[index].reason = "response_or_file_rejected" }
        try? persist()
    }
    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        guard let index = records.firstIndex(where: { $0.id == task.taskDescription && $0.state == "downloading" }), error != nil else { return }
        records[index].state = "failed"; records[index].reason = "network_or_session_error"; try? persist()
    }
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(request.url.flatMap { (try? MobileSourceURL.validate($0)) != nil ? request : nil })
    }
    func urlSessionDidFinishEvents(forBackgroundURLSession session: URLSession) {
        let callback = backgroundCompletion; backgroundCompletion = nil; callback?()
    }
}
#endif
