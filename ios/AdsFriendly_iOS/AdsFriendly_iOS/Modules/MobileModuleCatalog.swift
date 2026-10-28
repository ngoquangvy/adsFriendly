import Foundation

struct MobileModuleCatalog: Decodable {
    struct Module: Decodable { let id: String; let title: String; let capabilities: [String] }
    struct Format: Decodable { let `extension`: String; let mime: [String] }
    let schemaVersion: Int
    let modules: [Module]
    let directFormats: [Format]
    static func load() throws -> MobileModuleCatalog {
        guard let url = Bundle.main.url(forResource: "mobile-modules", withExtension: "json") else { throw MobileSourceError.configuration }
        let value = try JSONDecoder().decode(Self.self, from: Data(contentsOf: url))
        try value.validate()
        return value
    }
    func validate() throws {
        guard schemaVersion == 1, Set(modules.map { $0.id }).count == modules.count,
              modules.contains(where: { $0.id == "protection" }),
              modules.allSatisfy({ ["protection", "media"].contains($0.id) }),
              Set(directFormats.map { $0.extension }).count == directFormats.count,
              directFormats.allSatisfy({ format in
                  format.extension.range(of: "^[a-z0-9]{2,5}$", options: .regularExpression) != nil &&
                  !format.mime.isEmpty && format.mime.allSatisfy { $0.hasPrefix("audio/") || $0.hasPrefix("video/") }
              }), includes("media") || directFormats.isEmpty else { throw MobileSourceError.configuration }
        if includes("media") {
            guard modules.first(where: { $0.id == "media" })?.capabilities.contains("media.direct.original") == true,
                  !directFormats.isEmpty else { throw MobileSourceError.configuration }
        }
    }
    func includes(_ id: String) -> Bool { modules.contains { $0.id == id } }
    func fileExtension(mime: String, fallback: String) -> String? {
        if let format = directFormats.first(where: { $0.mime.contains(mime) }) { return format.extension }
        guard mime.isEmpty || mime == "application/octet-stream" else { return nil }
        return directFormats.first { $0.extension == fallback }?.extension
    }
}

enum MobileSourceError: LocalizedError {
    case configuration, invalidURL, resolverRequired, rejected(Int), unsupported, expired, network, historyFull
    var errorDescription: String? {
        switch self {
        case .configuration: return "Media module configuration is unavailable. Safari protection is unchanged."
        case .invalidURL: return "Paste one public HTTPS link without embedded credentials or a local address."
        case .resolverRequired: return "YouTube page detected. A mobile YouTube resolver is not available yet; this is not a direct media file."
        case .rejected(let status): return "Source rejected the request (HTTP \(status)). Browser sessions are not copied."
        case .unsupported: return "Not a supported direct audio/video file. Player pages, playlists and DRM require a separate resolver."
        case .expired: return "The source check expired. Check again before downloading."
        case .network: return "Source check failed. Check your network or the source's browser-session requirements."
        case .historyFull: return "Download history is full (50 items). Forget a finished item before starting another. Files are kept."
        }
    }
}

enum MobileSourceURL {
    static func parse(_ text: String) throws -> URL {
        let input = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !input.isEmpty, input.utf8.count <= 16384,
              input.rangeOfCharacter(from: .whitespacesAndNewlines.union(.controlCharacters)) == nil,
              let url = URL(string: input) else { throw MobileSourceError.invalidURL }
        return try validate(url)
    }
    static func validate(_ url: URL) throws -> URL {
        guard url.absoluteString.utf8.count <= 16384,
              url.scheme?.lowercased() == "https", let host = url.host?.lowercased(),
              !host.hasSuffix("."), host.contains("."),
              url.user == nil, url.password == nil, url.port == nil || url.port == 443,
              !host.hasSuffix(".local"), !host.hasSuffix(".localhost"), !host.hasSuffix(".internal"), !host.contains(":"),
              host.range(of: "^[0-9.]+$", options: .regularExpression) == nil else { throw MobileSourceError.invalidURL }
        return url
    }
    static func isYouTube(_ url: URL) -> Bool {
        let host = url.host?.lowercased() ?? ""
        return host == "youtu.be" || host == "youtube.com" || host.hasSuffix(".youtube.com")
    }
}
