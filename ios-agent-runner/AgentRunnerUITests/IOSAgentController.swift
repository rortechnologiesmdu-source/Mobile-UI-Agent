import Foundation

// The observe -> decide -> act loop for iOS, mirroring AgentScreen.runLoop on Android:
// observation to the Node backend (which owns run state, history and safety checks),
// AgentAction back, executed with XCUIAutomation, then observe again.
final class IOSAgentController {

    enum Outcome: Equatable {
        case done(String)
        case stopped(String)
        case failed(String)
    }

    struct Step {
        let number: Int
        let app: String
        let action: String
        let detail: String
        let decideMs: Int
    }

    private let backend: BackendClient
    private let observations: IOSObservationProvider
    private let executor: IOSActionExecutor
    private let maxSteps: Int
    private let timeout: TimeInterval
    // Same as Android's STEP_DELAY_MS: lets the screen settle before the next look.
    private let settleSeconds: TimeInterval = 0.8

    private(set) var steps: [Step] = []
    private(set) var runId: String?

    init(backend: BackendClient, observations: IOSObservationProvider, executor: IOSActionExecutor,
         maxSteps: Int, timeout: TimeInterval) {
        self.backend = backend
        self.observations = observations
        self.executor = executor
        self.maxSteps = maxSteps
        self.timeout = timeout
    }

    // Creates the run itself (Terminal: run-task.sh).
    func run(goal: String) throws -> Outcome {
        try execute(runId: backend.startRun(goal: goal, apps: KnownApps.all), goal: goal)
    }

    // Runs a run that already exists (one the MobileUse Agent app queued).
    func execute(runId: String, goal: String) throws -> Outcome {
        self.runId = runId
        let deadline = Date().addingTimeInterval(timeout)
        print("[AGENT] run \(runId): \"\(goal)\"")

        for number in 1...maxSteps {
            if Date() > deadline {
                return stop(runId, .stopped("Stopped: timed out after \(Int(timeout))s."))
            }

            let observation = try observations.capture()
            let started = Date()
            let response: StepResponse
            do {
                response = try backend.step(runId: runId, observation: observation)
            } catch let error as BackendError where error.statusCode == 409 {
                // The run is no longer running: the user tapped Stop in the app.
                return .stopped("Stopped by you.")
            } catch {
                return stop(runId, .failed("Stopped: NETWORK_ERROR or MODEL_ERROR: \(error)"))
            }
            let decideMs = Int(Date().timeIntervalSince(started) * 1000)
            let action = response.action

            // The backend wants the user to approve a send/call. There's nobody to ask
            // here, so never perform it.
            if let confirm = response.confirm {
                record(number, observation, action, "not performed (needs confirmation)", decideMs)
                return stop(runId, .stopped("Stopped before a send/call that needs your confirmation (\(confirm)). Nothing was sent."))
            }

            if action.action == "done" || response.status != "running" {
                record(number, observation, action, response.status, decideMs)
                let result = action.action == "done" ? (action.result ?? "") : (response.resultText ?? response.status)
                return action.action == "done" ? .done(result) : .stopped(result)
            }

            do {
                let detail = try executor.execute(action)
                record(number, observation, action, detail, decideMs)
            } catch {
                record(number, observation, action, "failed: \(error)", decideMs)
                return stop(runId, .failed("Stopped: \(error)"))
            }
            Thread.sleep(forTimeInterval: settleSeconds)
        }
        return stop(runId, .stopped("Stopped: reached the \(maxSteps)-step limit without finishing."))
    }

    private func record(_ number: Int, _ observation: Observation, _ action: AgentAction, _ detail: String, _ decideMs: Int) {
        let step = Step(number: number, app: observation.currentApp, action: action.summary, detail: detail, decideMs: decideMs)
        steps.append(step)
        print("[AGENT] step \(number) [\(step.app)] \(step.action) -> \(detail) (decide \(decideMs)ms)")
    }

    // Ends the run on the backend with the reason, unless it already ended there.
    private func stop(_ runId: String, _ outcome: Outcome) -> Outcome {
        switch outcome {
        case .stopped(let reason), .failed(let reason):
            try? backend.stop(runId: runId, reason: reason)
            print("[AGENT] \(reason)")
        case .done:
            break
        }
        return outcome
    }
}
