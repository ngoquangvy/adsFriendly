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
              modules.allSatisfy({ ["protection", "media", "youtube"].contains($0.id) }),
              Set(directFormats.map { $0.extension }).count == directFormats.count,
              directFormats.allSatisfy({ format in
                  format.extension.range(of: "^[a-z0-9]{2,5}$", options: .regularExpression) != nil &&
                  !format.mime.isEmpty && format.mime.allSatisfy { $0.hasPrefix("audio/") || $0.hasPrefix("video/") }
              }), includes("media") || directFormats.isEmpty else { throw MobileSourceError.configuration }
        if includes("media") {
            guard modules.first(where: { $0.id == "media" })?.capabilities.contains("media.direct.original") == true,
                  !directFormats.isEmpty else { throw MobileSourceError.configuration }
        }
        if includes("youtube") {
            #if AF_YOUTUBE && !AF_PROTECTION_ONLY
            guard includes("media"), modules.first(where: { $0.id == "youtube" })?.capabilities.contains("media.youtube.download") == true else { throw MobileSourceError.configuration }
            #else
            throw MobileSourceError.configuration
            #endif
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
        case .configuration: return "Chưa tải được cấu hình tải file. Đóng màn hình và thử lại."
        case .invalidURL: return "Dán một link HTTPS công khai, không chứa tài khoản hay địa chỉ mạng nội bộ."
        case .resolverRequired:
            #if AF_YOUTUBE
            return "Đây là link YouTube. Quay lại và chọn Tải từ YouTube để chọn âm thanh hoặc video."
            #else
            return "Link YouTube cần bản YouTube thử nghiệm riêng. Bản cơ bản này tải link file nhạc/video HTTPS trực tiếp."
            #endif
        case .rejected(let status): return "Máy chủ từ chối yêu cầu (HTTP \(status)). Hãy kiểm tra link hoặc thử lại sau."
        case .unsupported: return "Link chưa trỏ tới file nhạc/video được hỗ trợ. Trang phát, playlist hoặc nội dung DRM cần bộ phân tích riêng."
        case .expired: return "Nguồn kiểm tra đã hết hạn. Bấm Phân tích link lại trước khi tải."
        case .network: return "Chưa kiểm tra được nguồn. Kiểm tra mạng hoặc thử link file công khai khác."
        case .historyFull: return "Lịch sử đã đủ 50 mục. Xóa lịch sử các lượt đã kết thúc để tải tiếp; file được giữ lại."
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
