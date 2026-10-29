#if AF_YOUTUBE && !AF_PROTECTION_ONLY
import Foundation
import AVFoundation

enum YouTubeAssembler {
    static func validate(_ url: URL, hasVideo: Bool) async throws {
        let asset = AVURLAsset(url: url)
        let duration = try await asset.load(.duration).seconds
        let audio = try await asset.loadTracks(withMediaType: .audio)
        let video = try await asset.loadTracks(withMediaType: .video)
        guard duration.isFinite, duration > 0, !audio.isEmpty,
              !hasVideo || !video.isEmpty else { throw YouTubeDownloadError.sourceChanged }
    }

    static func merge(video: URL, audio: URL, destination: URL) async throws {
        let videoAsset = AVURLAsset(url: video), audioAsset = AVURLAsset(url: audio)
        guard let videoTrack = try await videoAsset.loadTracks(withMediaType: .video).first,
              let audioTrack = try await audioAsset.loadTracks(withMediaType: .audio).first else { throw YouTubeDownloadError.sourceChanged }
        let videoDuration = try await videoAsset.load(.duration)
        let audioDuration = try await audioAsset.load(.duration)
        guard videoDuration.seconds.isFinite, audioDuration.seconds.isFinite,
              videoDuration.seconds > 0, audioDuration.seconds > 0,
              abs(videoDuration.seconds - audioDuration.seconds) <= max(2, videoDuration.seconds * 0.02) else {
            throw YouTubeDownloadError.sourceChanged
        }
        let duration = CMTimeMinimum(videoDuration, audioDuration)
        let composition = AVMutableComposition()
        guard let videoOutput = composition.addMutableTrack(withMediaType: .video, preferredTrackID: kCMPersistentTrackID_Invalid),
              let audioOutput = composition.addMutableTrack(withMediaType: .audio, preferredTrackID: kCMPersistentTrackID_Invalid) else {
            throw YouTubeDownloadError.sourceChanged
        }
        try videoOutput.insertTimeRange(CMTimeRange(start: .zero, duration: duration), of: videoTrack, at: .zero)
        videoOutput.preferredTransform = try await videoTrack.load(.preferredTransform)
        try audioOutput.insertTimeRange(CMTimeRange(start: .zero, duration: duration), of: audioTrack, at: .zero)
        guard let exporter = AVAssetExportSession(asset: composition, presetName: AVAssetExportPresetPassthrough) else {
            throw YouTubeDownloadError.sourceChanged
        }
        exporter.outputURL = destination
        exporter.outputFileType = .mp4
        try await withTaskCancellationHandler(operation: {
            await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
                exporter.exportAsynchronously { continuation.resume() }
            }
            try Task.checkCancellation()
            guard exporter.status == .completed else { throw YouTubeDownloadError.sourceChanged }
            try await validate(destination, hasVideo: true)
        }, onCancel: { exporter.cancelExport() })
    }
}

// Bounded EBML inspection for original Opus audio. AVFoundation cannot reliably
// decode standalone WebM on every supported iPhone, so do not transcode it or
// pretend it is M4A. Validate the declared audio-only tracks and cluster bounds.
enum YouTubeWebMAudio {
    private struct Element { let id: UInt64; let start: Int; let end: Int; let declaredEnd: UInt64? }
    private static func element(_ data: [UInt8], at position: inout Int, limit: Int) throws -> Element {
        func vint(keepMarker: Bool) throws -> (UInt64, Bool) {
            guard position < limit else { throw YouTubeDownloadError.sourceChanged }
            let first = data[position]
            var width = 1, mask: UInt8 = 0x80
            while width <= 8 && first & mask == 0 { width += 1; mask >>= 1 }
            guard width <= (keepMarker ? 4 : 8), position + width <= limit else { throw YouTubeDownloadError.sourceChanged }
            var value = UInt64(keepMarker ? first : first & (mask - 1))
            for offset in 1..<width { value = value << 8 | UInt64(data[position + offset]) }
            position += width
            return (value, !keepMarker && value == (UInt64(1) << (7 * width)) - 1)
        }
        let (id, _) = try vint(keepMarker: true)
        let (size, unknown) = try vint(keepMarker: false)
        let end = unknown ? nil : UInt64(position) + size
        return .init(id: id, start: position, end: end.map { Int(min($0, UInt64(limit))) } ?? limit, declaredEnd: end)
    }
    static func validate(_ url: URL) throws {
        let handle = try FileHandle(forReadingFrom: url); defer { try? handle.close() }
        let fileSize = (try FileManager.default.attributesOfItem(atPath: url.path)[.size] as? NSNumber)?.uint64Value ?? 0
        let bytes = [UInt8](try handle.read(upToCount: 2 * 1024 * 1024) ?? Data())
        var position = 0
        let header = try element(bytes, at: &position, limit: bytes.count)
        guard header.id == 0x1A45DFA3, let headerEnd = header.declaredEnd, headerEnd <= UInt64(bytes.count) else { throw YouTubeDownloadError.sourceChanged }
        var webm = false
        while position < header.end {
            let child = try element(bytes, at: &position, limit: header.end)
            guard child.declaredEnd.map({ $0 <= UInt64(header.end) }) == true else { throw YouTubeDownloadError.sourceChanged }
            if child.id == 0x4282 { webm = String(bytes: bytes[child.start..<child.end], encoding: .utf8) == "webm" }
            position = child.end
        }
        guard webm else { throw YouTubeDownloadError.sourceChanged }
        let segment = try element(bytes, at: &position, limit: bytes.count)
        guard segment.id == 0x18538067, segment.declaredEnd.map({ $0 <= fileSize }) ?? true else { throw YouTubeDownloadError.sourceChanged }
        var audio = false, cluster = false
        while position < segment.end {
            let child = try element(bytes, at: &position, limit: segment.end)
            guard child.declaredEnd.map({ $0 <= fileSize }) ?? true else { throw YouTubeDownloadError.sourceChanged }
            if child.id == 0x1654AE6B {
                guard child.declaredEnd.map({ $0 <= UInt64(bytes.count) }) == true else { throw YouTubeDownloadError.sourceChanged }
                while position < child.end {
                    let entry = try element(bytes, at: &position, limit: child.end)
                    guard entry.declaredEnd.map({ $0 <= UInt64(child.end) }) == true else { throw YouTubeDownloadError.sourceChanged }
                    if entry.id == 0xAE {
                        var type: UInt64 = 0, codec = ""
                        while position < entry.end {
                            let field = try element(bytes, at: &position, limit: entry.end)
                            guard field.declaredEnd.map({ $0 <= UInt64(entry.end) }) == true else { throw YouTubeDownloadError.sourceChanged }
                            if field.id == 0x83 { type = bytes[field.start..<field.end].reduce(0) { $0 << 8 | UInt64($1) } }
                            if field.id == 0x86 { codec = String(bytes: bytes[field.start..<field.end], encoding: .utf8) ?? "" }
                            position = field.end
                        }
                        guard type == 2, codec == "A_OPUS" else { throw YouTubeDownloadError.sourceChanged }
                        audio = true
                    }
                    position = entry.end
                }
            }
            if child.id == 0x1F43B675 {
                guard UInt64(child.start) + 1 < fileSize else { throw YouTubeDownloadError.sourceChanged }
                cluster = true
            }
            position = child.end
            if audio && cluster { return }
        }
        throw YouTubeDownloadError.sourceChanged
    }
}
#endif
