import Foundation

// Runner settings, read from the test environment. Pass them to xcodebuild with the
// TEST_RUNNER_ prefix, e.g. TEST_RUNNER_AGENT_BACKEND_URL=http://localhost:4000.
enum TestConfiguration {
    private static let env = ProcessInfo.processInfo.environment

    // The simulator shares the Mac's network, so the backend is on localhost.
    static var backendURL: URL {
        URL(string: env["AGENT_BACKEND_URL"] ?? "http://localhost:4000")!
    }

    // Where tests also write screenshots/JSON (they're always attached to the report).
    static var outputDir: URL? {
        env["AGENT_OUTPUT_DIR"].map { URL(fileURLWithPath: $0) }
    }

    // Screenshot width sent to the model, in pixels. 540 matches the Android app,
    // where MAI-UI grounding was measured; set 0 to send full resolution.
    static var screenshotMaxWidth: Int { int("AGENT_SCREENSHOT_MAX_WIDTH", default: 540) }

    // The task for AgentLoopTests, e.g. "Open Settings and open General".
    static var task: String? { env["AGENT_TASK"].flatMap { $0.isEmpty ? nil : $0 } }
    static var maxSteps: Int { int("AGENT_MAX_STEPS", default: 15) }
    static var timeoutSeconds: Int { int("AGENT_TIMEOUT_SECONDS", default: 180) }

    static var maxNodes: Int { int("AGENT_MAX_NODES", default: 400) }
    static var maxTextLength: Int { int("AGENT_MAX_TEXT_LENGTH", default: 200) }

    private static func int(_ key: String, default value: Int) -> Int {
        env[key].flatMap(Int.init) ?? value
    }
}
