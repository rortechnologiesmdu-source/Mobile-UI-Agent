import XCTest

// Phase 3 (iOS.md): normalized iOS observations, and their round trip through the
// Node backend and MAI-UI. Nothing here executes the returned action.
final class ObservationTests: XCTestCase {

    private let settings = XCUIApplication(bundleIdentifier: "com.apple.Preferences")
    private let provider = IOSObservationProvider()

    override func setUp() {
        continueAfterFailure = false
    }

    // The observation has the shape the backend expects, for an app and the home screen.
    func testObservationShape() throws {
        settings.terminate()
        settings.launch()
        provider.lastLaunchedBundleID = "com.apple.Preferences"
        XCTAssertTrue(settings.wait(for: .runningForeground, timeout: 10))

        let started = Date()
        let observation = try provider.capture()
        let captureMs = Int(Date().timeIntervalSince(started) * 1000)
        report(observation, name: "settings", captureMs: captureMs)

        XCTAssertEqual(observation.platform, "ios")
        XCTAssertEqual(observation.currentApp, "com.apple.Preferences")
        XCTAssertGreaterThan(observation.screenWidth, 0)
        XCTAssertGreaterThan(observation.accessibilityTree.count, 5)
        XCTAssertFalse(observation.screenshotBase64.isEmpty)
        let general = try XCTUnwrap(observation.accessibilityTree.first { $0.text == "General" }, "no General node")
        XCTAssertTrue(general.bounds.right <= observation.screenWidth && general.bounds.bottom <= observation.screenHeight,
                      "General node is outside the screen: \(general.bounds)")

        XCUIDevice.shared.press(.home)
        // An app's state lags the Home press by the closing animation.
        let homeStarted = Date()
        let backgrounded = settings.wait(for: .runningBackground, timeout: 5)
        print("[OBS] Settings state after Home: \(settings.state.rawValue) (background=\(backgrounded)) after \(Int(Date().timeIntervalSince(homeStarted) * 1000))ms")
        let home = try provider.capture()
        report(home, name: "home", captureMs: nil)
        XCTAssertEqual(home.currentApp, KnownApps.springboard, "home screen not detected")
        // The Dock is on every home-screen page; app icons depend on the page shown.
        XCTAssertTrue(home.accessibilityTree.contains { $0.text == "Safari" }, "no Safari icon in the Dock")
    }

    // One real step through the backend: observation -> Node -> MAI-UI -> AgentAction.
    // The run is stopped right after; the action is only checked, never executed.
    func testBackendDryRun() throws {
        let backend = BackendClient()
        try XCTSkipUnless(backend.isReachable(), "Backend not reachable at \(backend.baseURL)")

        settings.terminate()
        settings.launch()
        provider.lastLaunchedBundleID = "com.apple.Preferences"
        XCTAssertTrue(settings.wait(for: .runningForeground, timeout: 10))
        let observation = try provider.capture()

        let goal = "Open General settings"
        let runId = try backend.startRun(goal: goal, apps: KnownApps.all)
        defer { try? backend.stop(runId: runId, reason: "iOS dry run (action not executed)") }

        let started = Date()
        let step = try backend.step(runId: runId, observation: observation)
        let latencyMs = Int(Date().timeIntervalSince(started) * 1000)
        let action = step.action
        print("[DRYRUN] goal=\"\(goal)\" run=\(runId) latency=\(latencyMs)ms status=\(step.status)")
        print("[DRYRUN] action=\(action.action) point=\(String(describing: action.target?.point)) package=\(action.package ?? "-") text=\(action.text ?? "-")")

        var landsOn = "-"
        if let point = action.target?.point {
            XCTAssertTrue((0...1).contains(point.x) && (0...1).contains(point.y), "point outside 0-1: \(point)")
            let x = point.x * observation.screenWidth
            let y = point.y * observation.screenHeight
            landsOn = observation.accessibilityTree
                .filter { !$0.text.isEmpty && x >= $0.bounds.left && x <= $0.bounds.right && y >= $0.bounds.top && y <= $0.bounds.bottom }
                .min { ($0.bounds.right - $0.bounds.left) * ($0.bounds.bottom - $0.bounds.top) < ($1.bounds.right - $1.bounds.left) * ($1.bounds.bottom - $1.bounds.top) }?
                .text ?? "(no labelled element)"
            print("[DRYRUN] tap would land on: \(landsOn) at (\(Int(x)), \(Int(y))) points")
        }
        saveArtifact(json: [
            "goal": goal,
            "run_id": runId,
            "latency_ms": latencyMs,
            "status": step.status,
            "action": action.action,
            "point": action.target?.point.map { [$0.x, $0.y] } ?? [],
            "lands_on": landsOn,
        ], name: "dry-run")

        let known = ["tap", "long_press", "type", "swipe", "launch_app", "press_back", "press_home", "wait", "done"]
        XCTAssertTrue(known.contains(action.action), "unknown action \(action.action)")
    }

    private func report(_ observation: Observation, name: String, captureMs: Int?) {
        let nodes = observation.accessibilityTree
        let screenshotKB = observation.screenshotBase64.count * 3 / 4 / 1024
        print("[OBS] \(name): app=\(observation.currentApp) nodes=\(nodes.count) omitted=\(observation.omittedNodes) "
              + "screen=\(Int(observation.screenWidth))x\(Int(observation.screenHeight))pt screenshot=\(screenshotKB)KB"
              + (captureMs.map { " capture=\($0)ms" } ?? ""))
        print("[OBS] \(name) labels: " + nodes.map(\.text).filter { !$0.isEmpty }.prefix(25).joined(separator: " | "))

        // Observation without the screenshot, for inspection.
        let stripped = Observation(
            platform: observation.platform,
            currentApp: observation.currentApp,
            accessibilityTree: nodes,
            omittedNodes: observation.omittedNodes,
            screenshotBase64: "<\(screenshotKB) KB jpeg>",
            screenWidth: observation.screenWidth,
            screenHeight: observation.screenHeight
        )
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        if let data = try? encoder.encode(stripped) { saveArtifact(jsonData: data, name: "observation-\(name)") }
    }
}
