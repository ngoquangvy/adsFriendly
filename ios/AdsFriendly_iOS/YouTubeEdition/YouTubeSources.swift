#if AF_YOUTUBE && !AF_PROTECTION_ONLY
import Foundation
import YouTubeKit

struct YouTubeResolutionFailure: LocalizedError {
    let code: String
    var errorDescription: String? { YouTubeDownloadError.unavailable.localizedDescription + " (Mã: " + code + ")" }
}

enum YouTubeDownloadError: LocalizedError {
    case invalidLink, unavailable, expired, full, sourceChanged, storage, interrupted
    var errorDescription: String? {
        switch self {
        case .invalidLink: return "Dán một link video YouTube HTTPS hợp lệ (watch, youtu.be hoặc Shorts)."
        case .unavailable: return "Chưa lấy được nguồn YouTube phù hợp. Video có thể yêu cầu đăng nhập, là phát trực tiếp, bị giới hạn hoặc YouTube đã đổi cơ chế. Hãy thử lại; app không gửi link tới máy chủ phân tích bên thứ ba."
        case .expired: return "Nguồn đã hết hạn. Phân tích lại link trước khi tải."
        case .full: return "Lịch sử đã đủ 50 mục. Xóa một mục đã kết thúc để tải tiếp; file được giữ lại."
        case .sourceChanged: return "Nguồn hoặc phản hồi tải đã thay đổi. Không lưu thành file hoàn tất; hãy phân tích lại."
        case .storage: return "Không lưu được dữ liệu. Kiểm tra dung lượng trống rồi thử lại."
        case .interrupted: return "Lượt tải đã kết thúc khi app đóng. Phân tích lại link để tải lại."
        }
    }
}

enum YouTubeLink {
    static func videoID(_ input: String) throws -> String {
        let url = try MobileSourceURL.parse(input)
        let host = url.host?.lowercased() ?? ""
        let path = url.pathComponents.filter { $0 != "/" }
        var id: String?
        if host == "youtu.be", path.count == 1 { id = path.first }
        else if ["youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com"].contains(host) {
            if url.path == "/watch" {
                let values = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?.filter { $0.name == "v" } ?? []
                if values.count == 1 { id = values[0].value }
            } else if path.count == 2, ["shorts", "embed", "live"].contains(path[0]) { id = path[1] }
        }
        guard let value = id, value.range(of: "^[A-Za-z0-9_-]{11}$", options: .regularExpression) != nil else { throw YouTubeDownloadError.invalidLink }
        return value
    }
    static func mediaURL(_ url: URL) throws -> URL {
        _ = try MobileSourceURL.validate(url)
        guard let host = url.host?.lowercased(), host.hasSuffix(".googlevideo.com"),
              url.path == "/videoplayback", url.fragment == nil else { throw YouTubeDownloadError.sourceChanged }
        return url
    }
}

struct YouTubeTrack {
    let role: String
    let url: URL
    let fileExtension: String
}
struct YouTubeChoice {
    let id: String
    let label: String
    let tracks: [YouTubeTrack]
    let outputExtension: String
    let hasVideo: Bool
}
struct YouTubeSources {
    let videoID: String
    let choices: [YouTubeChoice]
    let expiresAt: Date
}
struct YouTubePreparedTrack {
    let role: String
    let source: CheckedMobileSource
}
struct YouTubePreparedDownload {
    let label: String
    let tracks: [YouTubePreparedTrack]
    let outputExtension: String
    let hasVideo: Bool
    let expiresAt: Date
}

struct YouTubeAudioCandidate {
    let url: URL
    let fileExtension: String
    let bitrate: Int?
    static func bestPerFormat(_ candidates: [YouTubeAudioCandidate]) -> [YouTubeAudioCandidate] {
        let sorted = candidates.sorted {
            let a = max($0.bitrate ?? 0, 0), b = max($1.bitrate ?? 0, 0)
            if a != b { return a > b }
            return $0.fileExtension == "m4a" && $1.fileExtension != "m4a"
        }
        var seen = Set<String>()
        return sorted.filter { ["m4a", "webm"].contains($0.fileExtension) && seen.insert($0.fileExtension).inserted }
    }
}

enum YouTubeSourceResolver {
    static func resolve(_ text: String) async throws -> YouTubeSources {
        let id = try YouTubeLink.videoID(text)
        // Explicitly local: never enable the dependency's remote fallback.
        let video = YouTube(videoID: id, useOAuth: false, allowOAuthCache: false, methods: [.local])
        let streams: [YouTubeKit.Stream]
        do { streams = try await video.streams } catch {
            let code: String
            if let provider = error as? YouTubeKitError { code = "YT_" + provider.rawValue }
            else if let network = error as? URLError { code = "NETWORK_" + String(network.code.rawValue) }
            else if let solver = error as? SignatureSolverError {
                switch solver {
                case .contextCreationFailed: code = "JS_CONTEXT"
                case .resourceNotFound: code = "JS_RESOURCE"
                case .evaluationFailed: code = "JS_EVALUATION"
                case .resultConversionFailed: code = "JS_RESULT"
                case .encodingFailed: code = "JS_ENCODING"
                case .jsonDecodingFailed: code = "JS_JSON"
                case .solverError: code = "JS_SOLVER"
                }
            } else { code = "EXTRACTOR_OTHER" }
            throw YouTubeResolutionFailure(code: code)
        }
        try Task.checkCancellation()
        func reportedBitrate(_ stream: YouTubeKit.Stream) -> Int {
            let average = stream.averageBitrate ?? 0
            return average > 0 ? average : max(stream.bitrate ?? 0, 0)
        }
        let valid = streams.filter { (try? YouTubeLink.mediaURL($0.url)) != nil }
        let compatible = valid.filter { $0.isNativelyPlayable }
        let allAudio = valid.filter { !$0.includesVideoTrack && $0.includesAudioTrack &&
            (($0.fileExtension == .m4a && $0.audioCodec == AudioCodec.BaseCodec.mp4a) ||
             ($0.fileExtension == .webm && $0.audioCodec == AudioCodec.BaseCodec.opus)) }
            .sorted { reportedBitrate($0) > reportedBitrate($1) }
        let audios = compatible.filter { !$0.includesVideoTrack && $0.includesAudioTrack &&
            $0.fileExtension == .m4a && $0.audioCodec == AudioCodec.BaseCodec.mp4a }
            .sorted { reportedBitrate($0) > reportedBitrate($1) }
        var choices: [YouTubeChoice] = []
        let audioChoices = YouTubeAudioCandidate.bestPerFormat(allAudio.map {
            .init(url: $0.url, fileExtension: $0.fileExtension == .m4a ? "m4a" : "webm",
                  bitrate: reportedBitrate($0) > 0 ? reportedBitrate($0) : nil)
        })
        for audio in audioChoices {
            let ext = audio.fileExtension
            let known = (audio.bitrate ?? 0) > 0
            let bitrate = known ? " · \((audio.bitrate ?? 0) / 1000) kbps" : " · chưa biết bitrate"
            let best = choices.isEmpty && known ? " · bitrate cao nhất tìm được" : ""
            let format = ext == "m4a" ? "M4A / AAC" : "WebM / Opus"
            choices.append(.init(id: "audio-\(ext)", label: "Audio · \(format)\(bitrate)\(best)",
                tracks: [.init(role: "audio", url: audio.url, fileExtension: ext)], outputExtension: ext, hasVideo: false))
        }
        var resolutions = Set<Int>()
        let videos = compatible.filter { $0.includesVideoTrack && $0.fileExtension == .mp4 &&
            $0.videoCodec == VideoCodec.BaseCodec.avc1 &&
            (!$0.includesAudioTrack || $0.audioCodec == AudioCodec.BaseCodec.mp4a) }
            .sorted {
                if $0.videoResolution != $1.videoResolution { return ($0.videoResolution ?? 0) > ($1.videoResolution ?? 0) }
                if $0.includesAudioTrack != $1.includesAudioTrack { return !$0.includesAudioTrack }
                return ($0.bitrate ?? 0) > ($1.bitrate ?? 0)
            }
        for stream in videos {
            guard let resolution = stream.videoResolution, resolution > 0,
                  !resolutions.contains(resolution), stream.includesAudioTrack || !audios.isEmpty else { continue }
            var tracks = [YouTubeTrack(role: audios.isEmpty ? "combined" : "video", url: stream.url, fileExtension: "mp4")]
            if let audio = audios.first {
                tracks.append(.init(role: "audio", url: audio.url, fileExtension: "m4a"))
            }
            resolutions.insert(resolution)
            choices.append(.init(id: "video-\(resolution)", label: "Video \(resolution)p · MP4 + audio AAC tốt nhất",
                                 tracks: tracks, outputExtension: "mp4", hasVideo: true))
            if resolutions.count == 8 { break }
        }
        guard !choices.isEmpty else { throw YouTubeDownloadError.unavailable }
        return .init(videoID: id, choices: choices, expiresAt: Date().addingTimeInterval(180))
    }

    @MainActor
    static func prepare(_ choice: YouTubeChoice, expiresAt: Date) async throws -> YouTubePreparedDownload {
        guard expiresAt > Date() else { throw YouTubeDownloadError.expired }
        let catalog = try MobileModuleCatalog.load()
        var tracks: [YouTubePreparedTrack] = []
        for track in choice.tracks {
            try Task.checkCancellation()
            let url = try YouTubeLink.mediaURL(track.url)
            let checked = try await YouTubeProbeAwaiter(catalog: catalog).check(url)
            try Task.checkCancellation()
            _ = try YouTubeLink.mediaURL(checked.url)
            guard checked.fileExtension == track.fileExtension else { throw YouTubeDownloadError.sourceChanged }
            tracks.append(.init(role: track.role, source: checked))
        }
        guard let deadline = tracks.map({ $0.source.expiresAt }).min(), deadline > Date() else { throw YouTubeDownloadError.expired }
        return .init(label: choice.label, tracks: tracks, outputExtension: choice.outputExtension,
                     hasVideo: choice.hasVideo, expiresAt: deadline)
    }
}

@MainActor
private final class YouTubeProbeAwaiter {
    private let probe: MobileSourceProbe
    private var continuation: CheckedContinuation<CheckedMobileSource, Error>?
    private var cancelled = false
    init(catalog: MobileModuleCatalog) { probe = MobileSourceProbe(catalog: catalog) }
    func check(_ url: URL) async throws -> CheckedMobileSource {
        try await withTaskCancellationHandler(operation: {
            try await withCheckedThrowingContinuation { continuation in
                guard !cancelled, !Task.isCancelled else { continuation.resume(throwing: CancellationError()); return }
                self.continuation = continuation
                probe.check(url.absoluteString) { [weak self] result in self?.finish(result) }
            }
        }, onCancel: { Task { @MainActor in self.cancel() } })
    }
    private func finish(_ value: Result<CheckedMobileSource, Error>) {
        let pending = continuation; continuation = nil; pending?.resume(with: value)
    }
    private func cancel() {
        cancelled = true; probe.cancel(); finish(.failure(CancellationError()))
    }
}
#endif
