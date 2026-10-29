#if !AF_PROTECTION_ONLY
import Foundation

struct CheckedMobileSource {
    let url: URL
    let fileExtension: String
    let bytes: Int64?
    let expiresAt: Date
    var filename: String? = nil
    var acceptsRanges = false
    var rangeValidator: String? = nil
}

// Header evidence is shared by preflight and final-file validation.
// A successful HEAD alone must never mark a transfer as saved.
enum MobileMediaResponse {
    static func metadata(_ response: HTTPURLResponse, catalog: MobileModuleCatalog,
                         rangeProbe: Bool = false) throws -> (String, Int64?) {
        guard response.statusCode == 200 || (rangeProbe && response.statusCode == 206) else {
            throw MobileSourceError.rejected(response.statusCode)
        }
        guard let url = response.url else { throw MobileSourceError.invalidURL }
        _ = try MobileSourceURL.validate(url)
        let encoding = response.value(forHTTPHeaderField: "Content-Encoding")?.lowercased() ?? "identity"
        guard encoding == "identity",
              let ext = catalog.fileExtension(mime: response.mimeType?.lowercased() ?? "",
                                              fallback: url.pathExtension.lowercased()) else {
            throw MobileSourceError.unsupported
        }
        var bytes: Int64? = response.expectedContentLength > 0 ? response.expectedContentLength : nil
        if response.statusCode == 206 {
            let range = response.value(forHTTPHeaderField: "Content-Range") ?? ""
            guard range.range(of: "^bytes 0-0/[1-9][0-9]*$", options: .regularExpression) != nil,
                  let total = range.split(separator: "/").last.flatMap({ Int64($0) }), total > 0 else {
                throw MobileSourceError.unsupported
            }
            bytes = total
        } else if response.value(forHTTPHeaderField: "Content-Length") == "0" {
            throw MobileSourceError.unsupported
        }
        return (ext, bytes)
    }
    static func validateFile(_ response: HTTPURLResponse, expectedExtension: String,
                             checkedBytes: Int64?, actualBytes: Int64,
                             catalog: MobileModuleCatalog) throws {
        let (ext, responseBytes) = try metadata(response, catalog: catalog)
        guard ext == expectedExtension, actualBytes > 0,
              checkedBytes.map({ $0 == actualBytes }) ?? true,
              responseBytes.map({ $0 == actualBytes }) ?? true else { throw MobileSourceError.unsupported }
    }
}

// Response-header-only fallback; cancelling before body avoids buffering a
// whole video if a server ignores Range. No page JS, cookies or keys are read.
final class MobileSourceProbe: NSObject, URLSessionDataDelegate, URLSessionTaskDelegate {
    private var session: URLSession!
    private var task: URLSessionDataTask?
    private let catalog: MobileModuleCatalog
    private var completion: ((Result<CheckedMobileSource, Error>) -> Void)?
    private var retried = false
    private var redirects = 0
    private var verifyingRange = false
    private var headBytes: Int64?
    private var headFilename: String?
    private var headValidator: String?
    private var headSource: CheckedMobileSource?
    private var source: URL!
    private let configuration: URLSessionConfiguration
    init(catalog: MobileModuleCatalog, configuration: URLSessionConfiguration = .ephemeral) {
        self.catalog = catalog
        self.configuration = configuration
    }
    func check(_ text: String, completion: @escaping (Result<CheckedMobileSource, Error>) -> Void) {
        cancel()
        retried = false; redirects = 0; verifyingRange = false; headBytes = nil; headFilename = nil; headValidator = nil; headSource = nil
        do {
            try catalog.validate()
            guard catalog.includes("media") else { throw MobileSourceError.configuration }
            source = try MobileSourceURL.parse(text)
            if MobileSourceURL.isYouTube(source) { throw MobileSourceError.resolverRequired }
            self.completion = completion
            let config = configuration
            config.httpShouldSetCookies = false
            config.httpCookieStorage = nil
            config.urlCredentialStorage = nil
            config.urlCache = nil
            config.timeoutIntervalForRequest = 10
            config.timeoutIntervalForResource = 20
            session = URLSession(configuration: config, delegate: self, delegateQueue: .main)
            begin("HEAD")
        } catch { completion(.failure(error)) }
    }
    private func begin(_ method: String) {
        redirects = 0
        var request = URLRequest(url: source); request.httpMethod = method
        request.setValue("AdsFriendlyMobile/0.1", forHTTPHeaderField: "User-Agent")
        request.setValue("identity", forHTTPHeaderField: "Accept-Encoding")
        if method == "GET" { request.setValue("bytes=0-0", forHTTPHeaderField: "Range") }
        task = session.dataTask(with: request); task?.resume()
    }
    func cancel() { completion = nil; task?.cancel(); session?.invalidateAndCancel() }
    private func finish(_ value: Result<CheckedMobileSource, Error>) {
        let callback = completion; completion = nil; task?.cancel(); session.invalidateAndCancel(); callback?(value)
    }
    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse,
                    completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
        completionHandler(.cancel)
        guard dataTask === task, session === self.session, completion != nil else { return }
        guard let response = response as? HTTPURLResponse else { finish(.failure(MobileSourceError.unsupported)); return }
        if verifyingRange, response.statusCode >= 400, let head = headSource { finish(.success(head)); return }
        if [403, 405].contains(response.statusCode) && !retried {
            retried = true; begin("GET"); return
        }
        do {
            guard let url = response.url else { throw MobileSourceError.invalidURL }
            let (ext, bytes) = try MobileMediaResponse.metadata(response, catalog: catalog, rangeProbe: retried || verifyingRange)
            if !retried && !verifyingRange, let bytes = bytes, bytes >= MobileRangeTransfer.minimumBytes,
               response.value(forHTTPHeaderField: "Accept-Ranges")?.lowercased() == "bytes" || url.host?.hasSuffix(".googlevideo.com") == true {
                headBytes = bytes; headFilename = MobileMediaName.sourceName(response, ext: ext); headValidator = MobileRangeTransfer.validator(response)
                headSource = .init(url: url, fileExtension: ext, bytes: bytes, expiresAt: Date().addingTimeInterval(30), filename: headFilename, rangeValidator: headValidator)
                verifyingRange = true; begin("GET"); return
            }
            if let expected = headBytes, let actual = bytes, expected != actual { throw MobileSourceError.unsupported }
            finish(.success(CheckedMobileSource(url: url, fileExtension: ext, bytes: bytes ?? headBytes, expiresAt: Date().addingTimeInterval(30), filename: headFilename ?? MobileMediaName.sourceName(response, ext: ext), acceptsRanges: response.statusCode == 206, rangeValidator: MobileRangeTransfer.validator(response) ?? headValidator)))
        } catch { finish(.failure(error)) }
    }
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        guard task === self.task, session === self.session, completion != nil else { completionHandler(nil); return }
        redirects += 1
        if redirects <= 3, let url = request.url, (try? MobileSourceURL.validate(url)) != nil { completionHandler(request) }
        else { completionHandler(nil); finish(.failure(MobileSourceError.invalidURL)) }
    }
    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        guard task === self.task, completion != nil, let error = error as NSError?, error.code != NSURLErrorCancelled else { return }
        if verifyingRange, let head = headSource { finish(.success(head)); return }
        finish(.failure(MobileSourceError.network))
    }
}
#endif
