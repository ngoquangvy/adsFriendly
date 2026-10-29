import Foundation
import Network

// A short-lived, loopback-only handoff to the browser. No remote hosting or
// Network Extension entitlement is required to deliver the profile file.
final class DNSProfileDelivery {
    enum DeliveryError: LocalizedError, Equatable {
        case unavailable, expired
        var errorDescription: String? {
            switch self {
            case .unavailable: return "Không mở được đường nhận profile. Bạn có thể dùng Xuất file dự phòng."
            case .expired: return "Đường nhận profile đã hết hạn. Quay lại app và bấm Cài DNS lần nữa."
            }
        }
    }
    private var listener: NWListener?
    private var connections: [ObjectIdentifier: NWConnection] = [:]
    private var timer: DispatchWorkItem?
    private var ready: ((Result<URL, Error>) -> Void)?
    private var completion: ((Bool) -> Void)?
    private var data = Data()
    private var served = false
    private var responses = 0
    private var stopped = true
    private var port: UInt16 = 0
    private let lifetime: TimeInterval
    private let path = "/" + UUID().uuidString + "/" + UUID().uuidString + "/AdsFriendly-DNS.mobileconfig"
    init(lifetime: TimeInterval = 25) { self.lifetime = lifetime }

    // Call/start/callbacks on the main queue, including Network events.
    func start(data: Data, ready: @escaping (Result<URL, Error>) -> Void,
               completion: @escaping (Bool) -> Void) {
        precondition(Thread.isMainThread)
        stop()
        guard !data.isEmpty, data.count <= 65_536 else {
            ready(.failure(DeliveryError.unavailable)); completion(false); return
        }
        self.data = data; self.ready = ready; self.completion = completion
        served = false; responses = 0; stopped = false
        do {
            let parameters = NWParameters.tcp
            parameters.requiredLocalEndpoint = .hostPort(host: .ipv4(.loopback), port: .any)
            parameters.requiredInterfaceType = .loopback
            let listener = try NWListener(using: parameters)
            listener.newConnectionLimit = 8
            self.listener = listener
            listener.newConnectionHandler = { [weak self] connection in self?.accept(connection) }
            listener.stateUpdateHandler = { [weak self] state in
                guard let self = self, !self.stopped else { return }
                if case .ready = state, let port = self.listener?.port {
                    self.port = port.rawValue
                    let callback = self.ready; self.ready = nil
                    callback?(.success(URL(string: "http://127.0.0.1:\(self.port)\(self.path)")!))
                } else if case .failed = state {
                    let callback = self.ready; self.ready = nil
                    self.stop(); callback?(.failure(DeliveryError.unavailable))
                }
            }
            let expiry = DispatchWorkItem { [weak self] in
                guard let self = self else { return }
                let callback = self.ready; self.ready = nil
                self.stop(); callback?(.failure(DeliveryError.expired))
            }
            timer = expiry
            DispatchQueue.main.asyncAfter(deadline: .now() + lifetime, execute: expiry)
            listener.start(queue: .main)
        } catch { stop(); ready(.failure(DeliveryError.unavailable)) }
    }
    func stop() {
        precondition(Thread.isMainThread)
        guard !stopped else { return }
        stopped = true
        timer?.cancel(); timer = nil
        listener?.cancel(); listener = nil
        let active = Array(connections.values)
        connections.removeAll()
        for connection in active { connection.cancel() }
        data.removeAll(); ready = nil
        let callback = completion; completion = nil; callback?(served)
    }
    private func accept(_ connection: NWConnection) {
        guard !stopped else { connection.cancel(); return }
        let id = ObjectIdentifier(connection)
        connections[id] = connection
        connection.stateUpdateHandler = { [weak self, weak connection] state in
            guard let self = self, let connection = connection else { return }
            if case .ready = state { self.receive(connection, buffer: Data()) }
            else if case .failed = state { connection.cancel(); self.connections[id] = nil }
            else if case .cancelled = state { self.connections[id] = nil }
        }
        connection.start(queue: .main)
        DispatchQueue.main.asyncAfter(deadline: .now() + 5) { [weak connection] in connection?.cancel() }
    }
    private func receive(_ connection: NWConnection, buffer: Data) {
        guard !stopped else { connection.cancel(); return }
        connection.receive(minimumIncompleteLength: 1, maximumLength: max(1, 8192 - buffer.count)) { [weak self, weak connection] chunk, _, complete, error in
            guard let self = self, let connection = connection, !self.stopped else { return }
            var request = buffer
            if let chunk = chunk { request.append(chunk) }
            if let end = request.range(of: Data("\r\n\r\n".utf8)) {
                let headers = String(data: request[..<end.upperBound], encoding: .utf8) ?? ""
                let allowed = Self.allows(headers, path: self.path, port: self.port)
                let head = headers.hasPrefix("HEAD ")
                if allowed, head || self.responses < 3 {
                    if !head { self.responses += 1 }
                    self.respond(connection, status: "200 OK", body: self.data, profile: true, head: head)
                } else { self.respond(connection, status: "404 Not Found", body: Data(), profile: false) }
            } else if request.count >= 8192 || complete || error != nil {
                self.respond(connection, status: "400 Bad Request", body: Data(), profile: false)
            } else { self.receive(connection, buffer: request) }
        }
    }
    static func allows(_ header: String, path: String, port: UInt16) -> Bool {
        let lines = header.components(separatedBy: "\r\n")
        guard let first = lines.first,
              ["GET \(path) HTTP/1.1", "GET \(path) HTTP/1.0", "HEAD \(path) HTTP/1.1", "HEAD \(path) HTTP/1.0"].contains(first) else { return false }
        let hosts = lines.dropFirst().filter { $0.lowercased().hasPrefix("host:") }
        guard hosts.count == 1,
              hosts[0].dropFirst(5).trimmingCharacters(in: .whitespaces) == "127.0.0.1:\(port)" else { return false }
        return !lines.contains { line in
            let lower = line.lowercased()
            return lower.hasPrefix("transfer-encoding:") ||
                (lower.hasPrefix("content-length:") && lower.dropFirst(15).trimmingCharacters(in: .whitespaces) != "0")
        }
    }
    private func respond(_ connection: NWConnection, status: String, body: Data, profile: Bool, head: Bool = false) {
        let mime = profile ? "application/x-apple-aspen-config" : "text/plain"
        let disposition = profile ? "Content-Disposition: attachment; filename=\"AdsFriendly-DNS.mobileconfig\"\r\n" : ""
        var response = Data(("HTTP/1.1 \(status)\r\nContent-Type: \(mime)\r\nContent-Length: \(body.count)\r\n" +
            disposition + "Cache-Control: no-store\r\nPragma: no-cache\r\nX-Content-Type-Options: nosniff\r\nConnection: close\r\n\r\n").utf8)
        if !head { response.append(body) }
        connection.send(content: response, contentContext: .finalMessage, isComplete: true, completion: .contentProcessed { [weak self, weak connection] error in
            connection?.cancel()
            if profile && !head && error == nil { self?.served = true }
            // Keep the bounded window open: Safari may inspect MIME, ask for
            // approval, then retry GET. A successful transfer is not installation.
        })
    }
}
