#if !AF_PROTECTION_ONLY
import Foundation

struct MobileRangePart: Codable {
    let offset: Int64
    let length: Int64
    var bytes: Int64 = 0
    var received = false
    var header: String { "bytes=\(offset)-\(offset + length - 1)" }
}

enum MobileRangeTransfer {
    static let minimumBytes: Int64 = 2 * 1024 * 1024
    static func plan(_ source: CheckedMobileSource, minimum: Int64 = minimumBytes) -> [MobileRangePart]? {
        guard source.acceptsRanges, let total = source.bytes, total >= max(3, minimum), total < Int64.max / 4,
              source.rangeValidator != nil || source.url.host?.lowercased().hasSuffix(".googlevideo.com") == true else { return nil }
        let size = total / 3
        return [.init(offset: 0, length: size), .init(offset: size, length: size), .init(offset: size * 2, length: total - size * 2)]
    }
    static func validPlan(_ parts: [MobileRangePart], total: Int64?) -> Bool {
        guard parts.count == 3, let total = total, total > 0, total < Int64.max / 4 else { return false }
        var offset: Int64 = 0
        for part in parts {
            guard part.offset == offset, part.length > 0, part.length <= total - offset,
                  part.bytes >= 0, part.bytes <= part.length,
                  !part.received || part.bytes == part.length else { return false }
            offset += part.length
        }
        return offset == total
    }
    static func validator(_ response: HTTPURLResponse) -> String? {
        if let value = response.value(forHTTPHeaderField: "ETag"), !value.hasPrefix("W/"),
           value.hasPrefix("\""), value.hasSuffix("\""), value.utf8.count <= 256,
           value.rangeOfCharacter(from: .controlCharacters) == nil { return value }
        if let value = response.value(forHTTPHeaderField: "Last-Modified"), value.utf8.count <= 256,
           value.rangeOfCharacter(from: .controlCharacters) == nil, !value.isEmpty { return value }
        return nil
    }
    static func request(url: URL, part: MobileRangePart?, validator: String?) -> URLRequest {
        var request = URLRequest(url: url)
        request.setValue("AdsFriendlyMobile/0.1", forHTTPHeaderField: "User-Agent")
        request.setValue("identity", forHTTPHeaderField: "Accept-Encoding")
        if let part = part {
            request.setValue(part.header, forHTTPHeaderField: "Range")
            if let validator = validator, validator.utf8.count <= 256, validator.rangeOfCharacter(from: .controlCharacters) == nil {
                request.setValue(validator, forHTTPHeaderField: "If-Range")
            }
        }
        return request
    }
    static func validate(_ response: HTTPURLResponse, part: MobileRangePart, total: Int64, ext: String,
                         actual: Int64, validator: String?, catalog: MobileModuleCatalog) throws {
        guard let url = response.url else { throw MobileSourceError.invalidURL }
        _ = try MobileSourceURL.validate(url)
        guard response.statusCode == 206,
              response.value(forHTTPHeaderField: "Content-Range") == "bytes \(part.offset)-\(part.offset + part.length - 1)/\(total)",
              actual == part.length,
              response.expectedContentLength < 0 || response.expectedContentLength == part.length,
              (response.value(forHTTPHeaderField: "Content-Encoding")?.lowercased() ?? "identity") == "identity",
              catalog.fileExtension(mime: response.mimeType?.lowercased() ?? "", fallback: url.pathExtension.lowercased()) == ext else { throw MobileSourceError.unsupported }
        if let expected = validator,
           let actual = response.value(forHTTPHeaderField: expected.hasPrefix("\"") ? "ETag" : "Last-Modified"),
           expected != actual { throw MobileSourceError.unsupported }
    }
    static func join(files: [URL], parts: [MobileRangePart], destination: URL) async throws {
        let work = Task.detached(priority: .userInitiated) {
            guard let last = parts.last, last.offset >= 0, last.offset < Int64.max / 4,
                  last.length > 0, last.length < Int64.max / 4,
                  validPlan(parts, total: last.offset + last.length), files.count == parts.count,
                  parts.allSatisfy({ $0.received }) else { throw MobileSourceError.unsupported }
            let temporary = destination.appendingPathExtension("joining")
            try? FileManager.default.removeItem(at: temporary)
            guard FileManager.default.createFile(atPath: temporary.path, contents: nil) else { throw MobileSourceError.network }
            do {
                let output = try FileHandle(forWritingTo: temporary)
                do {
                    for (file, part) in zip(files, parts) {
                        let input = try FileHandle(forReadingFrom: file)
                        defer { try? input.close() }
                        var copied: Int64 = 0
                        while let data = try input.read(upToCount: 1024 * 1024), !data.isEmpty {
                            try Task.checkCancellation()
                            copied += Int64(data.count)
                            guard copied <= part.length else { throw MobileSourceError.unsupported }
                            try output.write(contentsOf: data)
                        }
                        guard copied == part.length else { throw MobileSourceError.unsupported }
                    }
                    try output.close()
                } catch { try? output.close(); throw error }
                try Task.checkCancellation()
                try? FileManager.default.removeItem(at: destination)
                try FileManager.default.moveItem(at: temporary, to: destination)
            } catch { try? FileManager.default.removeItem(at: temporary); throw error }
        }
        try await withTaskCancellationHandler(operation: { try await work.value }, onCancel: { work.cancel() })
    }
}
#endif
