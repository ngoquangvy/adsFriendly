import Foundation
import YouTubeKit

@main struct ProviderProbe {
    static func main() async {
        do {
            var request = URLRequest(url: URL(string: "https://youtube.com/watch?v=aqz-KE-bpKQ&bpctr=9999999999&has_verified=1")!)
            request.setValue("Mozilla/5.0", forHTTPHeaderField: "User-Agent")
            request.httpShouldHandleCookies = false
            let (body, response) = try await URLSession.shared.data(for: request)
            let text = String(data: body, encoding: .utf8) ?? ""
            print("WATCH status=\((response as? HTTPURLResponse)?.statusCode ?? 0) player=\(text.contains("ytInitialPlayerResponse")) bot=\(text.contains("confirm you’re not a bot") || text.contains("confirm you're not a bot"))")
            let streams = try await YouTube(videoID: "aqz-KE-bpKQ", useOAuth: false, allowOAuthCache: false, methods: [.local]).streams
            print("EXTRACT streams=\(streams.count) audio=\(streams.filter { $0.includesAudioTrack && !$0.includesVideoTrack }.count) video=\(streams.filter { $0.includesVideoTrack }.count)")
            guard !streams.isEmpty else { exit(1) }
        } catch let error as YouTubeKitError {
            print("PROVIDER_ERROR=" + error.rawValue); exit(1)
        } catch let error as URLError {
            print("NETWORK_ERROR=" + String(error.code.rawValue)); exit(1)
        } catch let error as SignatureSolverError {
            switch error {
            case .contextCreationFailed: print("SOLVER_ERROR=context")
            case .resourceNotFound: print("SOLVER_ERROR=resource")
            case .evaluationFailed: print("SOLVER_ERROR=evaluation")
            case .resultConversionFailed: print("SOLVER_ERROR=result")
            case .encodingFailed: print("SOLVER_ERROR=encoding")
            case .jsonDecodingFailed: print("SOLVER_ERROR=json")
            case .solverError(let type, let message):
                let markers = ["signature", "nsig", "regex", "player", "function", "token"].filter { message.lowercased().contains($0) }
                print("SOLVER_ERROR=solver type=\(["sig", "n"].contains(type) ? type : "other") markers=\(markers.joined(separator: ","))")
            }
            exit(1)
        } catch { print("PROVIDER_ERROR=other"); exit(1) }
    }
}
