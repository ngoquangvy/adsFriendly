#if !AF_PROTECTION_ONLY
import Foundation

struct CheckedMobileSource {
    let url: URL
    let fileExtension: String
    let bytes: Int64?
    let expiresAt: Date
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
    private var source: URL!
    init(catalog: MobileModuleCatalog) { self.catalog = catalog }
    func check(_ text: String, completion: @escaping (Result<CheckedMobileSource, Error>) -> Void) {
        do {
            source = try MobileSourceURL.parse(text)
            if MobileSourceURL.isYouTube(source) { throw MobileSourceError.resolverRequired }
            self.completion = completion
            let config = URLSessionConfiguration.ephemeral
            config.httpShouldSetCookies = false
            config.timeoutIntervalForRequest = 10
            config.timeoutIntervalForResource = 20
            session = URLSession(configuration: config, delegate: self, delegateQueue: .main)
            begin("HEAD")
        } catch { completion(.failure(error)) }
    }
    private func begin(_ method: String) {
        var request = URLRequest(url: source); request.httpMethod = method
        request.setValue("AdsFriendlyMobile/0.1", forHTTPHeaderField: "User-Agent")
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
        guard dataTask === task, let response = response as? HTTPURLResponse else { return }
        if [403, 405].contains(response.statusCode) && !retried {
            retried = true; begin("GET"); return
        }
        do {
            guard (200..<300).contains(response.statusCode) else { throw MobileSourceError.rejected(response.statusCode) }
            guard let url = response.url else { throw MobileSourceError.invalidURL }
            _ = try MobileSourceURL.validate(url)
            let mime = response.mimeType?.lowercased() ?? ""
            guard let ext = catalog.fileExtension(mime: mime, fallback: url.pathExtension.lowercased()) else { throw MobileSourceError.unsupported }
            var bytes: Int64? = response.expectedContentLength > 0 ? response.expectedContentLength : nil
            if response.statusCode == 206 {
                let range = response.value(forHTTPHeaderField: "Content-Range") ?? ""
                bytes = range.split(separator: "/").last.flatMap { Int64($0) }
            }
            finish(.success(CheckedMobileSource(url: url, fileExtension: ext, bytes: bytes, expiresAt: Date().addingTimeInterval(30))))
        } catch { finish(.failure(error)) }
    }
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        redirects += 1
        if redirects <= 3, let url = request.url, (try? MobileSourceURL.validate(url)) != nil { completionHandler(request) }
        else { completionHandler(nil); finish(.failure(MobileSourceError.invalidURL)) }
    }
    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        guard task === self.task, completion != nil, let error = error as NSError?, error.code != NSURLErrorCancelled else { return }
        finish(.failure(MobileSourceError.network))
    }
}
#endif
