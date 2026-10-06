import Foundation

// State behind the agent screen: queue a task, follow it until it ends, keep history.
@MainActor
final class AgentStore: ObservableObject {
    @Published var goal = ""
    @Published private(set) var current: AgentRun?
    @Published private(set) var history: [AgentRun] = []
    @Published private(set) var runnerConnected = false
    @Published private(set) var errorText: String?

    private let api = AgentAPI.shared
    private var following: Task<Void, Never>?

    var isActive: Bool { current?.isActive ?? false }

    func run() {
        let goal = goal.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !goal.isEmpty, !isActive else { return }
        errorText = nil
        Task {
            do {
                let id = try await api.queueRun(goal: goal)
                follow(runId: id)
            } catch {
                errorText = "Couldn't reach the backend at \(api.baseURL.absoluteString). Is it running?"
            }
        }
    }

    func stop() {
        guard let id = current?.id else { return }
        Task { try? await api.stop(id: id) }
    }

    // Polls the run once a second until it ends. While the runner operates other
    // apps this app is in the background and polling pauses; it catches up when the
    // runner brings the app back.
    private func follow(runId: String) {
        following?.cancel()
        following = Task {
            while !Task.isCancelled {
                if let run = try? await api.run(id: runId) {
                    current = run
                    if !run.isActive { break }
                }
                try? await Task.sleep(for: .seconds(1))
            }
            await refreshHistory()
        }
    }

    func refreshHistory() async {
        if let runs = try? await api.recentRuns() { history = runs }
    }

    // Keeps "runner connected" and the history fresh while the screen is shown.
    func watchStatus() async {
        await refreshHistory()
        while !Task.isCancelled {
            runnerConnected = await api.runnerConnected()
            try? await Task.sleep(for: .seconds(3))
        }
    }
}
