import XCTest

// Serve mode: tasks typed in the MobileUse Agent app on the simulator are queued on
// the backend; this runner claims each one, runs it with IOSAgentController and
// brings the app back to the front. Started by serve.sh; runs until stopped.
final class AgentServeTests: XCTestCase {

    private let app = XCUIApplication() // MobileUse Agent (AgentRunnerHost)
    private let backend = BackendClient()

    override func setUpWithError() throws {
        continueAfterFailure = true
        try XCTSkipUnless(backend.isReachable(), "Backend not reachable at \(backend.baseURL)")
    }

    func testServe() throws {
        try XCTSkipUnless(TestConfiguration.serve, "Started by serve.sh (TEST_RUNNER_AGENT_SERVE=1)")
        launchApp()
        let until = Date().addingTimeInterval(TimeInterval(TestConfiguration.serveMinutes * 60))
        print("[SERVE] Ready. Type a task in the MobileUse Agent app on the simulator.")
        var handled = 0
        while Date() < until {
            let claimed: (runId: String, goal: String)?
            do {
                claimed = try backend.claimRun()
            } catch {
                print("[SERVE] Backend not reachable, retrying: \(error)")
                Thread.sleep(forTimeInterval: 3)
                continue
            }
            guard let claimed else {
                Thread.sleep(forTimeInterval: 1)
                continue
            }
            handled += 1
            print("[SERVE] Task \(handled): \"\(claimed.goal)\"")
            let outcome = execute(claimed)
            print("[SERVE] Result: \(outcome)")
        }
        print("[SERVE] Stopping after \(TestConfiguration.serveMinutes) minutes (\(handled) tasks).")
    }

    // The whole flow, automated: type a task in the app, tap Run, claim and run it,
    // and check the app shows the result.
    func testAppEndToEnd() throws {
        launchApp()
        let goal = "Open Settings and open General"
        // A multi-line SwiftUI TextField can surface as a text view; match by identifier.
        let field = app.descendants(matching: .any)["goalField"].firstMatch
        XCTAssertTrue(field.waitForExistence(timeout: 10), "no task field in the app")
        field.tap()
        field.typeText(goal)
        app.buttons["runButton"].tap()
        XCTAssertTrue(app.staticTexts["Waiting for the iOS runner…"].waitForExistence(timeout: 10),
                      "app did not show the queued task")

        var claimed: (runId: String, goal: String)?
        let deadline = Date().addingTimeInterval(15)
        while claimed == nil && Date() < deadline {
            claimed = try backend.claimRun()
            if claimed == nil { Thread.sleep(forTimeInterval: 0.5) }
        }
        let run = try XCTUnwrap(claimed, "the queued task never reached the runner")
        XCTAssertEqual(run.goal, goal)

        let outcome = execute(run)
        print("[E2E] outcome: \(outcome)")
        guard case .done = outcome else { return XCTFail("task did not finish: \(outcome)") }

        let result = app.staticTexts["resultText"]
        XCTAssertTrue(result.waitForExistence(timeout: 15), "app did not show the result")
        print("[E2E] app shows: \(result.label)")
        saveArtifact(XCUIScreen.main.screenshot(), name: "app-after-run")
    }

    private func launchApp() {
        app.launchEnvironment["AGENT_BACKEND_URL"] = backend.baseURL.absoluteString
        app.launch()
    }

    private func execute(_ claimed: (runId: String, goal: String)) -> IOSAgentController.Outcome {
        // Start every task from the home screen, as run-task.sh does. On the agent
        // screen the model sees the task text itself (e.g. "Open Settings") and taps it.
        // The app's own state can't be used to wait here (it stays "in front" after
        // activate()); the switch to the home screen takes about 1.3 s.
        XCUIDevice.shared.press(.home)
        Thread.sleep(forTimeInterval: 1.5)

        let observations = IOSObservationProvider()
        let agent = IOSAgentController(
            backend: backend,
            observations: observations,
            executor: IOSActionExecutor(observations: observations),
            maxSteps: TestConfiguration.maxSteps,
            timeout: TimeInterval(TestConfiguration.timeoutSeconds)
        )
        let outcome: IOSAgentController.Outcome
        do {
            outcome = try agent.execute(runId: claimed.runId, goal: claimed.goal)
        } catch {
            try? backend.stop(runId: claimed.runId, reason: "Stopped: TEST_RUNNER_ERROR: \(error)")
            outcome = .failed("Stopped: TEST_RUNNER_ERROR: \(error)")
        }
        // Back to the agent screen to show the result, like the Android app does.
        app.activate()
        return outcome
    }
}
