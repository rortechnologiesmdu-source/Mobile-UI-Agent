import Foundation

// The app's side of the Node backend's Agent 2 API. The app only queues tasks and
// reads their progress; the iOS runner (XCUITest on the Mac) executes them.
struct AgentAPI {
    let baseURL: URL

    // The simulator shares the Mac's network, so the backend is on localhost.
    // serve.sh passes AGENT_BACKEND_URL when it launches the app.
    static let shared = AgentAPI(
        baseURL: URL(string: ProcessInfo.processInfo.environment["AGENT_BACKEND_URL"] ?? "http://localhost:4000")!
    )

    func queueRun(goal: String) async throws -> String {
        struct Body: Encodable {
            let goal: String
            let apps = KnownApps.all
            let platform = "ios"
            let queued = true
        }
        struct Created: Decodable { let runId: String }
        let created: Created = try await send("POST", "/api/agent2/runs", body: Body(goal: goal))
        return created.runId
    }

    func run(id: String) async throws -> AgentRun {
        struct Response: Decodable { let run: AgentRun }
        let response: Response = try await send("GET", "/api/agent2/runs/\(id)")
        return response.run
    }

    func recentRuns() async throws -> [AgentRun] {
        struct Response: Decodable { let runs: [AgentRun] }
        let response: Response = try await send("GET", "/api/agent2/runs?platform=ios")
        return response.runs
    }

    func stop(id: String) async throws {
        struct Body: Encodable { let reason = "Stopped by you." }
        struct Stopped: Decodable { let status: String }
        let _: Stopped = try await send("POST", "/api/agent2/runs/\(id)/stop", body: Body())
    }

    func runnerConnected() async -> Bool {
        struct Response: Decodable { let connected: Bool }
        let response: Response? = try? await send("GET", "/api/agent2/runner?platform=ios")
        return response?.connected ?? false
    }

    private func send<T: Decodable>(_ method: String, _ path: String, body: (some Encodable)? = Optional<String>.none) async throws -> T {
        var request = URLRequest(url: URL(string: path, relativeTo: baseURL)!, timeoutInterval: 15)
        request.httpMethod = method
        if let body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONEncoder().encode(body)
        }
        let (data, response) = try await URLSession.shared.data(for: request)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(status) else {
            throw URLError(.badServerResponse, userInfo: [NSLocalizedDescriptionKey: "Backend answered HTTP \(status)"])
        }
        return try JSONDecoder().decode(T.self, from: data)
    }
}
