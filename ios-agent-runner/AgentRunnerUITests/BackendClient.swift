import Foundation

struct BackendError: Error, CustomStringConvertible {
    let description: String
}

// Talks to the Node backend's Agent 2 endpoints — the same ones the Android app
// uses (mobile/src/api/client.ts). Synchronous, since the runner loop is sequential.
final class BackendClient {
    let baseURL: URL

    init(baseURL: URL = TestConfiguration.backendURL) {
        self.baseURL = baseURL
    }

    func isReachable() -> Bool {
        struct Health: Decodable { let ok: Bool }
        return (try? send("GET", "/api/health", timeout: 5) as Health)?.ok == true
    }

    func startRun(goal: String, apps: [InstalledApp]) throws -> String {
        struct Body: Encodable { let goal: String; let apps: [InstalledApp] }
        struct Started: Decodable { let runId: String }
        let started: Started = try send("POST", "/api/agent2/runs", body: Body(goal: goal, apps: apps))
        return started.runId
    }

    // Covers a MAI-UI decision (incl. its screenshot-only retry).
    func step(runId: String, observation: Observation) throws -> StepResponse {
        try send("POST", "/api/agent2/runs/\(runId)/step", body: observation, timeout: 150)
    }

    func stop(runId: String, reason: String) throws {
        struct Body: Encodable { let reason: String }
        struct Stopped: Decodable { let status: String }
        let _: Stopped = try send("POST", "/api/agent2/runs/\(runId)/stop", body: Body(reason: reason))
    }

    private func send<T: Decodable>(
        _ method: String,
        _ path: String,
        body: (some Encodable)? = Optional<String>.none,
        timeout: TimeInterval = 30
    ) throws -> T {
        var request = URLRequest(url: baseURL.appendingPathComponent(path), timeoutInterval: timeout)
        request.httpMethod = method
        if let body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONEncoder().encode(body)
        }

        var result: Result<(Data, HTTPURLResponse), Error>?
        let done = DispatchSemaphore(value: 0)
        URLSession.shared.dataTask(with: request) { data, response, error in
            if let error {
                result = .failure(error)
            } else if let http = response as? HTTPURLResponse {
                result = .success((data ?? Data(), http))
            } else {
                result = .failure(BackendError(description: "no HTTP response"))
            }
            done.signal()
        }.resume()
        done.wait()

        let (data, response) = try result!.get()
        guard (200..<300).contains(response.statusCode) else {
            let message = String(data: data, encoding: .utf8) ?? ""
            throw BackendError(description: "\(method) \(path) failed: HTTP \(response.statusCode) \(message)")
        }
        return try JSONDecoder().decode(T.self, from: data)
    }
}
