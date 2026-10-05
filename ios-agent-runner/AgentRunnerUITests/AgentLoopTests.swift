import XCTest

// Phase 6 (iOS.md): run a whole task on the simulator with MAI-UI.
//
//   TEST_RUNNER_AGENT_TASK="Open Settings and open General" \
//   xcodebuild test -project AgentRunner.xcodeproj -scheme AgentRunner \
//     -destination 'platform=iOS Simulator,name=iPhone 18 Pro' \
//     -only-testing:AgentRunnerUITests/AgentLoopTests -collect-test-diagnostics never
//
// Skipped when no AGENT_TASK is given. Starts from the home screen.
final class AgentLoopTests: XCTestCase {

    func testRunTask() throws {
        let task = try XCTUnwrap(TestConfiguration.task)
        let backend = BackendClient()
        try XCTSkipUnless(backend.isReachable(), "Backend not reachable at \(backend.baseURL)")

        XCUIDevice.shared.press(.home)
        Thread.sleep(forTimeInterval: 1)

        let observations = IOSObservationProvider()
        let agent = IOSAgentController(
            backend: backend,
            observations: observations,
            executor: IOSActionExecutor(observations: observations),
            maxSteps: TestConfiguration.maxSteps,
            timeout: TimeInterval(TestConfiguration.timeoutSeconds)
        )

        let started = Date()
        let outcome = try agent.run(goal: task)
        let seconds = Int(Date().timeIntervalSince(started))
        saveArtifact(XCUIScreen.main.screenshot(), name: "final-screen")
        saveArtifact(json: [
            "task": task,
            "run_id": agent.runId ?? "",
            "seconds": seconds,
            "outcome": "\(outcome)",
            "steps": agent.steps.map { ["step": $0.number, "app": $0.app, "action": $0.action, "detail": $0.detail, "decide_ms": $0.decideMs] },
        ], name: "run-summary")
        print("[AGENT] outcome after \(agent.steps.count) steps, \(seconds)s: \(outcome)")

        guard case .done = outcome else {
            return XCTFail("Task did not finish: \(outcome)")
        }
    }

    override func setUpWithError() throws {
        try XCTSkipIf(TestConfiguration.task == nil, "Set TEST_RUNNER_AGENT_TASK to run a task")
    }
}
