import SwiftUI

// The agent screen: type a task, Run/Stop, follow the steps, see the result.
struct AgentView: View {
    @StateObject private var store = AgentStore()

    var body: some View {
        NavigationStack {
            List {
                Section {
                    RunnerStatus(connected: store.runnerConnected)
                    TextField("What should the agent do?", text: $store.goal, axis: .vertical)
                        .lineLimit(2...4)
                        .accessibilityIdentifier("goalField")
                        .disabled(store.isActive)
                    if store.isActive {
                        Button("Stop", role: .destructive) { store.stop() }
                            .accessibilityIdentifier("stopButton")
                    } else {
                        Button("Run Agent") { store.run() }
                            .accessibilityIdentifier("runButton")
                            .disabled(store.goal.trimmingCharacters(in: .whitespaces).isEmpty)
                    }
                    if let error = store.errorText {
                        Text(error).foregroundStyle(.red)
                    }
                } footer: {
                    Text("The agent will switch to other apps while it works.")
                }

                if let run = store.current {
                    Section("Current task") {
                        CurrentRun(run: run)
                    }
                }

                Section("History") {
                    if store.history.isEmpty {
                        Text("No runs yet.").foregroundStyle(.secondary)
                    }
                    ForEach(store.history) { run in
                        VStack(alignment: .leading, spacing: 2) {
                            Text(run.goal).font(.subheadline.weight(.semibold))
                            Text("\(run.status) · \(run.steps.count) step\(run.steps.count == 1 ? "" : "s")")
                                .font(.caption).foregroundStyle(.secondary)
                            if let result = run.resultText, !result.isEmpty {
                                Text(result).font(.caption)
                            }
                        }
                    }
                }
            }
            .navigationTitle("MobileUse Agent")
            .task { await store.watchStatus() }
            .refreshable { await store.refreshHistory() }
        }
    }
}

private struct RunnerStatus: View {
    let connected: Bool

    var body: some View {
        Label(
            connected ? "iOS runner connected" : "iOS runner not running – start ./serve.sh on the Mac",
            systemImage: connected ? "checkmark.circle.fill" : "exclamationmark.triangle.fill"
        )
        .foregroundStyle(connected ? .green : .orange)
        .font(.subheadline)
    }
}

private struct CurrentRun: View {
    let run: AgentRun

    var body: some View {
        Text(run.goal).font(.headline)
        switch run.status {
        case "queued":
            HStack { ProgressView(); Text("Waiting for the iOS runner…") }
        case "running":
            HStack {
                ProgressView()
                Text(run.steps.last?.action.map { "Step \(run.steps.count): \($0.summary)" } ?? "Starting…")
            }
        default:
            Text(run.resultText ?? run.status)
                .foregroundStyle(run.status == "done" ? .green : .red)
                .accessibilityIdentifier("resultText")
        }
        ForEach(Array(run.steps.enumerated()), id: \.offset) { index, step in
            VStack(alignment: .leading, spacing: 2) {
                Text("\(index + 1). \(step.action?.summary ?? "-")").font(.caption.monospaced())
                if let reason = step.reason, !reason.isEmpty {
                    Text(reason.replacingOccurrences(of: "Thought: ", with: ""))
                        .font(.caption2).foregroundStyle(.secondary).lineLimit(2)
                }
            }
        }
    }
}
