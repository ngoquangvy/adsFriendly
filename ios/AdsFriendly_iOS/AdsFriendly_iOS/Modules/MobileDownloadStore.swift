#if !AF_PROTECTION_ONLY
import Foundation
import UIKit

struct MobileDownloadRecord: Codable {
    let id: String
    let filename: String
    var state: String
    var bytes: Int64
    var total: Int64?
    var reason: String?
    var folder: String? = nil
    var parts: [MobileRangePart]? = nil
    var rangeValidator: String? = nil
}

// OS tasks own request URLs; the private ledger contains only file/transfer facts.
final class MobileDownloadStore: NSObject, URLSessionDownloadDelegate, URLSessionTaskDelegate {
    static let identifier = "com.vyngo.AdsFriendly-iOS.media-downloads.v1"
    static let shared = MobileDownloadStore()
    private(set) var records: [MobileDownloadRecord] = []
    var backgroundCompletion: (() -> Void)?
    private var session: URLSession!
    private let directory: URL, ledger: URL
    private let rangeMinimum: Int64
    private var finishes: [String: Task<Void, Never>] = [:]
    private var observer: NSObjectProtocol?
    init(directory: URL? = nil, configuration: URLSessionConfiguration? = nil, rangeMinimum: Int64 = MobileRangeTransfer.minimumBytes) {
        self.directory = directory ?? FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0].appendingPathComponent("AdsFriendly", isDirectory: true)
        ledger = self.directory.appendingPathComponent("history.json"); self.rangeMinimum = rangeMinimum
        super.init()
        try? FileManager.default.createDirectory(at: self.directory, withIntermediateDirectories: true)
        if let data = try? Data(contentsOf: ledger), let saved = try? JSONDecoder().decode([MobileDownloadRecord].self, from: data) {
            var seen = Set<String>()
            records = Array(saved.filter { record in
                UUID(uuidString: record.id) != nil && seen.insert(record.id).inserted && MobileMediaName.isSafe(record.filename) &&
                (record.folder == nil || record.folder == record.id) &&
                ["downloading", "waiting", "finishing", "cancelled", "interrupted", "saved", "failed"].contains(record.state) &&
                record.bytes >= 0 && record.bytes < Int64.max / 4 && (record.total.map { $0 > 0 && $0 < Int64.max / 4 } ?? true) &&
                (record.parts.map { MobileRangeTransfer.validPlan($0, total: record.total) } ?? true)
            }.prefix(50))
            for index in records.indices where records[index].state == "finishing" { records[index].state = "waiting" }
        }
        let config = configuration ?? URLSessionConfiguration.background(withIdentifier: Self.identifier)
        MobileTransferPolicy.configure(config)
        session = URLSession(configuration: config, delegate: self, delegateQueue: .main)
        let recovering = Set(records.filter { $0.state == "downloading" }.map { $0.id })
        session.getAllTasks { [weak self] tasks in DispatchQueue.main.async {
            guard let self = self else { return }
            for task in tasks where !self.records.contains(where: { $0.state == "downloading" && self.descriptions($0).contains(task.taskDescription ?? "") }) { task.cancel() }
            let running = Set(tasks.compactMap { $0.taskDescription })
            for index in self.records.indices where recovering.contains(self.records[index].id) && self.records[index].state == "downloading" {
                if self.records[index].parts?.allSatisfy({ $0.received }) == true { self.records[index].state = "waiting" }
                else if !self.descriptions(self.records[index]).isSubset(of: running) {
                    self.records[index].state = "interrupted"; self.records[index].reason = "session_ended"; self.cancelTasks(self.records[index].id)
                }
            }
            try? self.persist(); self.finishReadyJobs()
        } }
        observer = NotificationCenter.default.addObserver(forName: UIApplication.didBecomeActiveNotification, object: nil, queue: .main) { [weak self] _ in self?.finishReadyJobs() }
    }
    private func descriptions(_ record: MobileDownloadRecord) -> Set<String> {
        if let parts = record.parts { return Set(parts.indices.filter { !parts[$0].received }.map { record.id + "|" + String($0) }) }
        return [record.id]
    }
    private func persist() throws { try JSONEncoder().encode(records).write(to: ledger, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication]) }
    private func fileURL(_ record: MobileDownloadRecord) -> URL { (record.folder.map { directory.appendingPathComponent($0, isDirectory: true) } ?? directory).appendingPathComponent(record.filename) }
    private func partURL(_ id: String, _ part: Int) -> URL { directory.appendingPathComponent("\(id)-\(part).range") }
    private func cleanup(_ id: String) { for index in 0..<3 { try? FileManager.default.removeItem(at: partURL(id, index)) } }
    func start(_ source: CheckedMobileSource) throws {
        guard source.expiresAt > Date() else { throw MobileSourceError.expired }
        _ = try MobileSourceURL.validate(source.url)
        let catalog = try MobileModuleCatalog.load()
        guard catalog.includes("media"), catalog.directFormats.contains(where: { $0.extension == source.fileExtension }), source.bytes.map({ $0 > 0 && $0 < Int64.max / 4 }) ?? true else { throw MobileSourceError.unsupported }
        guard records.count < 50 else { throw MobileSourceError.historyFull }
        let id = UUID().uuidString, parts = MobileRangeTransfer.plan(source, minimum: rangeMinimum)
        let record = MobileDownloadRecord(id: id, filename: MobileMediaName.filename(source.filename, ext: source.fileExtension, fallback: "Media"), state: "downloading", bytes: 0, total: source.bytes, folder: id, parts: parts, rangeValidator: source.rangeValidator)
        records.insert(record, at: 0)
        do { try persist() } catch { records.removeFirst(); throw error }
        for index in 0..<(parts?.count ?? 1) {
            let task = session.downloadTask(with: MobileRangeTransfer.request(url: source.url, part: parts?[index], validator: source.rangeValidator))
            task.taskDescription = parts == nil ? id : id + "|" + String(index)
            task.priority = URLSessionTask.highPriority; task.resume()
        }
    }
    private func cancelTasks(_ id: String) { session.getAllTasks { tasks in tasks.filter { $0.taskDescription == id || $0.taskDescription?.hasPrefix(id + "|") == true }.forEach { $0.cancel() } } }
    func cancel(_ id: String) {
        guard let index = records.firstIndex(where: { $0.id == id && !MobileTransferPolicy.isFinished($0.state) }) else { return }
        records[index].state = "cancelled"; finishes.removeValue(forKey: id)?.cancel(); cancelTasks(id); cleanup(id); try? persist()
    }
    func forget(_ id: String) throws {
        guard records.contains(where: { $0.id == id && MobileTransferPolicy.isFinished($0.state) }) else { return }
        let previous = records; records.removeAll { $0.id == id }
        do { try persist() } catch { records = previous; throw error }; cleanup(id)
    }
    func clearHistory() throws {
        let previous = records, finished = records.filter { MobileTransferPolicy.isFinished($0.state) }
        records.removeAll { MobileTransferPolicy.isFinished($0.state) }
        do { try persist() } catch { records = previous; throw error }
        finished.forEach { cleanup($0.id) }
    }
    func output(_ id: String) -> URL? {
        guard let record = records.first(where: { $0.id == id && $0.state == "saved" }), MobileMediaName.isSafe(record.filename) else { return nil }
        let url = fileURL(record); return FileManager.default.fileExists(atPath: url.path) ? url : nil
    }
    func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didWriteData bytesWritten: Int64, totalBytesWritten: Int64, totalBytesExpectedToWrite: Int64) {
        let identity = (downloadTask.taskDescription ?? "").split(separator: "|").map(String.init)
        guard let id = identity.first, let index = records.firstIndex(where: { $0.id == id && $0.state == "downloading" }) else { return }
        if identity.count == 2, let part = Int(identity[1]), records[index].parts?.indices.contains(part) == true {
            records[index].parts?[part].bytes = min(max(0, totalBytesWritten), records[index].parts?[part].length ?? 0)
            records[index].bytes = records[index].parts?.reduce(0) { $0 + $1.bytes } ?? 0
        } else if identity.count == 1 { records[index].bytes = min(max(0, totalBytesWritten), Int64.max / 4) }
    }
    func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didFinishDownloadingTo location: URL) {
        let identity = (downloadTask.taskDescription ?? "").split(separator: "|").map(String.init)
        guard let id = identity.first, let response = downloadTask.response as? HTTPURLResponse else { return }
        receive(id: id, response: response, location: location, part: identity.count == 2 ? Int(identity[1]) : nil)
    }
    func receive(id: String, response: HTTPURLResponse, location: URL, part: Int? = nil) {
        guard let index = records.firstIndex(where: { $0.id == id && $0.state == "downloading" }) else { return }
        do {
            let catalog = try MobileModuleCatalog.load(), ext = (records[index].filename as NSString).pathExtension
            let size = (try FileManager.default.attributesOfItem(atPath: location.path)[.size] as? NSNumber)?.int64Value ?? 0
            if let parts = records[index].parts, response.statusCode != 200 {
                guard let part = part, parts.indices.contains(part), !parts[part].received, let total = records[index].total else { return }
                try MobileRangeTransfer.validate(response, part: parts[part], total: total, ext: ext, actual: size, validator: records[index].rangeValidator, catalog: catalog)
                try FileManager.default.moveItem(at: location, to: partURL(id, part))
                records[index].parts?[part].received = true; records[index].parts?[part].bytes = size
                records[index].bytes = records[index].parts?.reduce(0) { $0 + $1.bytes } ?? 0
                if records[index].parts?.allSatisfy({ $0.received }) == true { records[index].state = "waiting" }
                try persist(); finishReadyJobs(); return
            }
            // If a server stops honoring Range, accept one validated complete file
            // and cancel siblings. Never concatenate HTTP 200 bodies as fragments.
            try MobileMediaResponse.validateFile(response, expectedExtension: ext, checkedBytes: records[index].total, actualBytes: size, catalog: catalog)
            let destination = fileURL(records[index]); try FileManager.default.createDirectory(at: destination.deletingLastPathComponent(), withIntermediateDirectories: true)
            try FileManager.default.moveItem(at: location, to: destination)
            records[index].state = "saved"; records[index].bytes = size; records[index].total = size; records[index].parts = nil; records[index].reason = nil
            do { try persist() } catch { try? FileManager.default.removeItem(at: destination); throw error }
            cancelTasks(id); cleanup(id)
        } catch {
            records[index].state = "failed"; records[index].reason = "response_or_file_rejected"; cancelTasks(id); cleanup(id); try? persist()
        }
    }
    func finishReadyJobs() {
        guard UIApplication.shared.applicationState == .active else { return }
        for record in records where record.state == "waiting" && finishes[record.id] == nil {
            guard let parts = record.parts, let index = records.firstIndex(where: { $0.id == record.id }) else { continue }
            records[index].state = "finishing"; try? persist()
            finishes[record.id] = Task { @MainActor [weak self] in
                guard let self = self else { return }; let destination = self.fileURL(record)
                do {
                    try FileManager.default.createDirectory(at: destination.deletingLastPathComponent(), withIntermediateDirectories: true)
                    try await MobileRangeTransfer.join(files: parts.indices.map { self.partURL(record.id, $0) }, parts: parts, destination: destination)
                    try Task.checkCancellation()
                    guard let current = self.records.firstIndex(where: { $0.id == record.id && $0.state == "finishing" }) else { throw CancellationError() }
                    self.records[current].state = "saved"; self.records[current].bytes = record.total ?? record.bytes; self.records[current].reason = nil
                    do { try self.persist() } catch { self.records[current].state = "finishing"; throw error }
                    self.cleanup(record.id)
                } catch {
                    try? FileManager.default.removeItem(at: destination)
                    if let current = self.records.firstIndex(where: { $0.id == record.id && $0.state == "finishing" }) { self.records[current].state = "failed"; self.records[current].reason = "assembly_or_storage_error"; try? self.persist() }
                }
                self.finishes[record.id] = nil
            }
        }
    }
    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        let id = task.taskDescription?.split(separator: "|").first.map(String.init)
        guard error != nil, let index = records.firstIndex(where: { $0.id == id && $0.state == "downloading" }) else { return }
        records[index].state = "failed"; records[index].reason = "network_or_session_error"; cancelTasks(records[index].id); try? persist()
    }
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(request.url.flatMap { (try? MobileSourceURL.validate($0)) != nil ? request : nil })
    }
    func urlSessionDidFinishEvents(forBackgroundURLSession session: URLSession) { let callback = backgroundCompletion; backgroundCompletion = nil; callback?() }
    func invalidate() { if let observer = observer { NotificationCenter.default.removeObserver(observer) }; finishes.values.forEach { $0.cancel() }; session.invalidateAndCancel() }
}
#endif
