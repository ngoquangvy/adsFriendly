#if AF_YOUTUBE && !AF_PROTECTION_ONLY
import Foundation
import UIKit

struct YouTubeJob: Codable {
    struct Track: Codable {
        let role: String
        let fileExtension: String
        let expectedBytes: Int64?
        var bytes: Int64 = 0
        var received = false
        var parts: [MobileRangePart]? = nil
        var rangeValidator: String? = nil
    }
    let id: String
    let label: String
    let outputExtension: String
    let hasVideo: Bool
    var state: String
    var tracks: [Track]
    var reason: String?
    var sourceTitle: String? = nil
    var downloadName: String? = nil
    var filename: String { downloadName ?? "YouTube-\(id).\(outputExtension)" }
    var bytes: Int64 { tracks.reduce(0) { $0 + $1.bytes } }
    var total: Int64? {
        guard tracks.allSatisfy({ $0.expectedBytes != nil }) else { return nil }
        return tracks.reduce(0) { $0 + ($1.expectedBytes ?? 0) }
    }
}

// This session, ledger and staging directory belong exclusively to the test edition.
// URLs/tokens stay in URLSession tasks and memory, never in our history JSON.
final class YouTubeDownloadStore: NSObject, URLSessionDownloadDelegate, URLSessionTaskDelegate {
    static let identifier = "com.vyngo.AdsFriendly-iOS.youtube-downloads.v1"
    static let shared = YouTubeDownloadStore()
    private(set) var jobs: [YouTubeJob] = []
    var backgroundCompletion: (() -> Void)?
    private var session: URLSession!
    private let directory: URL
    private let ledger: URL
    private var activeFinishes: [String: Task<Void, Never>] = [:]
    private var observer: NSObjectProtocol?
    private let rangeMinimum: Int64

    init(directory: URL? = nil, configuration: URLSessionConfiguration? = nil, observeApp: Bool = true, rangeMinimum: Int64 = MobileRangeTransfer.minimumBytes) {
        self.rangeMinimum = rangeMinimum
        self.directory = directory ?? FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("AdsFriendlyYouTube", isDirectory: true)
        ledger = self.directory.appendingPathComponent("history.json")
        super.init()
        try? FileManager.default.createDirectory(at: self.directory, withIntermediateDirectories: true)
        if let data = try? Data(contentsOf: ledger), let saved = try? JSONDecoder().decode([YouTubeJob].self, from: data) {
            var seen = Set<String>()
            jobs = Array(saved.filter { job in
                UUID(uuidString: job.id) != nil && seen.insert(job.id).inserted &&
                ["mp4", "m4a", "webm"].contains(job.outputExtension) && job.label.count <= 120 &&
                (job.sourceTitle.map { $0.utf8.count <= 150 && !$0.contains("://") } ?? true) &&
                (job.downloadName.map { MobileMediaName.isSafe($0) && ($0 as NSString).pathExtension == job.outputExtension } ?? true) &&
                (1...2).contains(job.tracks.count) &&
                Set(job.tracks.map { $0.role }).count == job.tracks.count &&
                job.tracks.allSatisfy { track in
                    ["video", "audio", "combined"].contains(track.role) && ["mp4", "m4a", "webm"].contains(track.fileExtension) &&
                    track.bytes >= 0 && track.bytes < Int64.max / 4 &&
                    (track.expectedBytes.map { $0 > 0 && $0 < Int64.max / 4 } ?? true) &&
                    (track.parts.map { MobileRangeTransfer.validPlan($0, total: track.expectedBytes) } ?? true)
                } &&
                ["downloading", "waiting", "finishing", "saved", "failed", "cancelled"].contains(job.state)
            }.prefix(50))
            for index in jobs.indices where jobs[index].state == "finishing" { jobs[index].state = "waiting" }
        }
        let config = configuration ?? URLSessionConfiguration.background(withIdentifier: Self.identifier)
        MobileTransferPolicy.configure(config)
        session = URLSession(configuration: config, delegate: self, delegateQueue: .main)
        let recovering = Set(jobs.filter { $0.state == "downloading" }.map { $0.id })
        session.getAllTasks { [weak self] tasks in DispatchQueue.main.async {
            guard let self = self else { return }
            for task in tasks where !self.jobs.contains(where: { $0.state == "downloading" && self.descriptions($0).contains(task.taskDescription ?? "") }) { task.cancel() }
            let running = Set(tasks.compactMap { $0.taskDescription })
            for index in self.jobs.indices where recovering.contains(self.jobs[index].id) && self.jobs[index].state == "downloading" {
                if self.jobs[index].tracks.allSatisfy({ $0.received }) { self.jobs[index].state = "waiting" }
                else if !self.descriptions(self.jobs[index]).isSubset(of: running) {
                    self.fail(self.jobs[index].id, reason: "session_ended")
                }
            }
            try? self.persist()
            self.finishReadyJobs()
        } }
        if observeApp {
            observer = NotificationCenter.default.addObserver(forName: UIApplication.didBecomeActiveNotification,
                object: nil, queue: .main) { [weak self] _ in self?.finishReadyJobs() }
        }
    }
    private func persist() throws {
        try JSONEncoder().encode(jobs).write(to: ledger, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    }
    private func trackFile(_ id: String, _ role: String) -> URL {
        let ext = jobs.first(where: { $0.id == id })?.tracks.first(where: { $0.role == role })?.fileExtension ?? "part"
        // AVFoundation uses the suffix as well as media headers for local assets.
        return directory.appendingPathComponent("\(id)-\(role).staging.\(ext)")
    }
    func start(_ prepared: YouTubePreparedDownload) throws {
        guard prepared.expiresAt > Date(), prepared.tracks.allSatisfy({ $0.source.expiresAt > Date() }) else { throw YouTubeDownloadError.expired }
        guard jobs.count < 50 else { throw YouTubeDownloadError.full }
        let roles = prepared.tracks.map { $0.role }
        guard (prepared.hasVideo && prepared.outputExtension == "mp4" &&
               (roles == ["combined"] || roles == ["video", "audio"])) ||
              (!prepared.hasVideo && ["m4a", "webm"].contains(prepared.outputExtension) && roles == ["audio"]) else { throw YouTubeDownloadError.sourceChanged }
        for track in prepared.tracks {
            _ = try YouTubeLink.mediaURL(track.source.url)
            guard track.source.fileExtension == (track.role == "audio" ? (prepared.hasVideo ? "m4a" : prepared.outputExtension) : "mp4"),
                  track.source.bytes.map({ $0 > 0 && $0 < Int64.max / 4 }) ?? true else { throw YouTubeDownloadError.sourceChanged }
        }
        let id = UUID().uuidString
        let record = YouTubeJob(id: id, label: String(prepared.label.prefix(120)), outputExtension: prepared.outputExtension,
            hasVideo: prepared.hasVideo, state: "downloading",
            tracks: prepared.tracks.map { .init(role: $0.role, fileExtension: $0.source.fileExtension, expectedBytes: $0.source.bytes, parts: MobileRangeTransfer.plan($0.source, minimum: rangeMinimum), rangeValidator: $0.source.rangeValidator) },
            sourceTitle: MobileMediaName.stem(prepared.sourceTitle, fallback: "YouTube"),
            downloadName: MobileMediaName.filename(prepared.sourceTitle, ext: prepared.outputExtension, fallback: "YouTube"))
        jobs.insert(record, at: 0)
        do { try persist() } catch { jobs.removeFirst(); throw YouTubeDownloadError.storage }
        for (index, track) in prepared.tracks.enumerated() {
            let parts = record.tracks[index].parts
            for part in 0..<(parts?.count ?? 1) {
                let request = MobileRangeTransfer.request(url: track.source.url, part: parts?[part], validator: track.source.rangeValidator)
                let task = session.downloadTask(with: request)
                task.taskDescription = id + "|" + track.role + (parts == nil ? "" : "|" + String(part))
                task.priority = URLSessionTask.highPriority; task.resume()
            }
        }
    }
    private func descriptions(_ job: YouTubeJob) -> Set<String> {
        Set(job.tracks.filter { !$0.received }.flatMap { track -> [String] in
            let prefix = job.id + "|" + track.role
            if let parts = track.parts { return parts.indices.filter { !parts[$0].received }.map { prefix + "|" + String($0) } }
            return [prefix]
        })
    }
    private func partFile(_ id: String, _ role: String, _ part: Int) -> URL { directory.appendingPathComponent("\(id)-\(role)-\(part).range") }
    private func fail(_ id: String, reason: String) {
        guard let index = jobs.firstIndex(where: { $0.id == id }), !["saved", "cancelled"].contains(jobs[index].state) else { return }
        jobs[index].state = "failed"; jobs[index].reason = reason
        cancelTasks(id); try? persist()
    }
    private func cancelTasks(_ id: String) {
        session.getAllTasks { tasks in tasks.filter { $0.taskDescription?.hasPrefix(id + "|") == true }.forEach { $0.cancel() } }
    }
    func cancel(_ id: String) {
        guard let index = jobs.firstIndex(where: { $0.id == id && ["downloading", "waiting", "finishing"].contains($0.state) }) else { return }
        jobs[index].state = "cancelled"
        activeFinishes.removeValue(forKey: id)?.cancel()
        cancelTasks(id); try? persist()
        cleanupTracks(id)
    }
    func forget(_ id: String) throws {
        guard let index = jobs.firstIndex(where: { $0.id == id && ["saved", "failed", "cancelled"].contains($0.state) }) else { return }
        let previous = jobs; cleanupTracks(id); jobs.remove(at: index)
        do { try persist() } catch { jobs = previous; throw YouTubeDownloadError.storage }
    }
    func clearHistory() throws {
        let previous = jobs
        let finished = jobs.filter { MobileTransferPolicy.isFinished($0.state) }
        jobs.removeAll { MobileTransferPolicy.isFinished($0.state) }
        do { try persist() } catch { jobs = previous; throw YouTubeDownloadError.storage }
        for job in finished {
            for track in job.tracks {
                try? FileManager.default.removeItem(at: directory.appendingPathComponent("\(job.id)-\(track.role).staging.\(track.fileExtension)"))
                for part in 0..<3 { try? FileManager.default.removeItem(at: partFile(job.id, track.role, part)) }
            }
        }
    }
    private func fileURL(_ job: YouTubeJob) -> URL {
        let folder = job.downloadName == nil ? directory : directory.appendingPathComponent(job.id, isDirectory: true)
        return folder.appendingPathComponent(job.filename)
    }
    private func cleanupTracks(_ id: String) {
        for role in ["video", "audio", "combined"] {
            try? FileManager.default.removeItem(at: trackFile(id, role))
            for part in 0..<3 { try? FileManager.default.removeItem(at: partFile(id, role, part)) }
        }
    }
    func output(_ id: String) -> URL? {
        guard let job = jobs.first(where: { $0.id == id && $0.state == "saved" }) else { return nil }
        let file = fileURL(job)
        return FileManager.default.fileExists(atPath: file.path) ? file : nil
    }
    private func taskIdentity(_ task: URLSessionTask) -> (String, String, Int?)? {
        let parts = (task.taskDescription ?? "").split(separator: "|").map(String.init)
        guard parts.count == 2 || parts.count == 3 else { return nil }
        if parts.count == 3 { guard let part = Int(parts[2]), (0..<3).contains(part) else { return nil }; return (parts[0], parts[1], part) }
        return (parts[0], parts[1], nil)
    }
    func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didWriteData bytesWritten: Int64,
                    totalBytesWritten: Int64, totalBytesExpectedToWrite: Int64) {
        guard let (id, role, part) = taskIdentity(downloadTask), let index = jobs.firstIndex(where: { $0.id == id && $0.state == "downloading" }),
              let track = jobs[index].tracks.firstIndex(where: { $0.role == role && !$0.received }) else { return }
        if let part = part, jobs[index].tracks[track].parts?.indices.contains(part) == true {
            jobs[index].tracks[track].parts?[part].bytes = min(max(0, totalBytesWritten), jobs[index].tracks[track].parts?[part].length ?? 0)
            jobs[index].tracks[track].bytes = jobs[index].tracks[track].parts?.reduce(0) { $0 + $1.bytes } ?? 0
        } else if part == nil { jobs[index].tracks[track].bytes = min(max(0, totalBytesWritten), Int64.max / 4) }
    }
    func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didFinishDownloadingTo location: URL) {
        guard let (id, role, part) = taskIdentity(downloadTask), let response = downloadTask.response as? HTTPURLResponse else { return }
        receive(id: id, role: role, response: response, location: location, part: part)
    }
    func receive(id: String, role: String, response: HTTPURLResponse, location: URL, part: Int? = nil) {
        guard let index = jobs.firstIndex(where: { $0.id == id && $0.state == "downloading" }),
              let track = jobs[index].tracks.firstIndex(where: { $0.role == role && !$0.received }) else { return }
        do {
            guard let url = response.url else { throw YouTubeDownloadError.sourceChanged }
            _ = try YouTubeLink.mediaURL(url)
            let size = (try FileManager.default.attributesOfItem(atPath: location.path)[.size] as? NSNumber)?.int64Value ?? 0
            if let parts = jobs[index].tracks[track].parts, response.statusCode != 200 {
                guard let part = part, parts.indices.contains(part), !parts[part].received, let total = jobs[index].tracks[track].expectedBytes else { return }
                try MobileRangeTransfer.validate(response, part: parts[part], total: total, ext: jobs[index].tracks[track].fileExtension,
                    actual: size, validator: jobs[index].tracks[track].rangeValidator, catalog: MobileModuleCatalog.load())
                try FileManager.default.moveItem(at: location, to: partFile(id, role, part))
                jobs[index].tracks[track].parts?[part].received = true; jobs[index].tracks[track].parts?[part].bytes = size
                jobs[index].tracks[track].bytes = jobs[index].tracks[track].parts?.reduce(0) { $0 + $1.bytes } ?? 0
                jobs[index].tracks[track].received = jobs[index].tracks[track].parts?.allSatisfy { $0.received } == true
            } else {
                try MobileMediaResponse.validateFile(response, expectedExtension: jobs[index].tracks[track].fileExtension,
                    checkedBytes: jobs[index].tracks[track].expectedBytes, actualBytes: size, catalog: MobileModuleCatalog.load())
                try FileManager.default.moveItem(at: location, to: trackFile(id, role))
                jobs[index].tracks[track].parts = nil
                jobs[index].tracks[track].bytes = size; jobs[index].tracks[track].received = true
                session.getAllTasks { tasks in tasks.filter { $0.taskDescription?.hasPrefix(id + "|" + role + "|") == true }.forEach { $0.cancel() } }
            }
            if jobs[index].tracks.allSatisfy({ $0.received }) { jobs[index].state = "waiting" }
            try persist(); finishReadyJobs()
        } catch { fail(id, reason: "response_or_storage_error") }
    }
    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        guard error != nil, let (id, role, _) = taskIdentity(task), jobs.contains(where: { $0.id == id && $0.state == "downloading" && $0.tracks.contains(where: { $0.role == role && !$0.received }) }) else { return }
        fail(id, reason: "network_error")
    }
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(request.url.flatMap { (try? YouTubeLink.mediaURL($0)) != nil ? request : nil })
    }
    func urlSessionDidFinishEvents(forBackgroundURLSession session: URLSession) {
        let callback = backgroundCompletion; backgroundCompletion = nil; callback?()
    }
    func finishReadyJobs() {
        guard UIApplication.shared.applicationState == .active else { return }
        for job in jobs where job.state == "waiting" && activeFinishes[job.id] == nil {
            guard let index = jobs.firstIndex(where: { $0.id == job.id }) else { continue }
            jobs[index].state = "finishing"; try? persist()
            activeFinishes[job.id] = Task { @MainActor [weak self] in
                guard let self = self else { return }
                let destination = self.fileURL(job)
                // A previous interrupted export may have left only an uncommitted file.
                try? FileManager.default.removeItem(at: destination)
                do {
                    try FileManager.default.createDirectory(at: destination.deletingLastPathComponent(), withIntermediateDirectories: true)
                    for track in job.tracks {
                        if let parts = track.parts {
                            try await MobileRangeTransfer.join(files: parts.indices.map { self.partFile(job.id, track.role, $0) }, parts: parts, destination: self.trackFile(job.id, track.role))
                        }
                    }
                    if job.tracks.count == 2 {
                        try await YouTubeAssembler.merge(video: self.trackFile(job.id, "video"),
                            audio: self.trackFile(job.id, "audio"), destination: destination)
                    } else {
                        let source = self.trackFile(job.id, job.tracks[0].role)
                        if job.outputExtension == "webm" { try YouTubeWebMAudio.validate(source) }
                        else { try await YouTubeAssembler.validate(source, hasVideo: job.hasVideo) }
                        try Task.checkCancellation()
                        try await Task.detached(priority: .utility) {
                            try FileManager.default.copyItem(at: source, to: destination)
                        }.value
                    }
                    try Task.checkCancellation()
                    guard let current = self.jobs.firstIndex(where: { $0.id == job.id && $0.state == "finishing" }) else { throw CancellationError() }
                    self.jobs[current].state = "saved"; self.jobs[current].reason = nil
                    do { try self.persist() } catch {
                        self.jobs[current].state = "failed"; self.jobs[current].reason = "storage_error"
                        throw YouTubeDownloadError.storage
                    }
                    self.cleanupTracks(job.id)
                } catch {
                    try? FileManager.default.removeItem(at: destination)
                    self.fail(job.id, reason: "assembly_or_storage_error")
                }
                self.activeFinishes[job.id] = nil
            }
        }
    }
    // Explicit teardown for isolated stores/tests; the app keeps its singleton session alive.
    func invalidate() {
        if let observer = observer { NotificationCenter.default.removeObserver(observer) }
        activeFinishes.values.forEach { $0.cancel() }; activeFinishes.removeAll()
        session.invalidateAndCancel()
    }
}
#endif
