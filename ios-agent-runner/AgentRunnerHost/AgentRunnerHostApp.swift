import SwiftUI

// Host app for the AgentRunnerUITests bundle. Xcode UI tests need a host app to
// attach to; the agent itself drives other apps (Settings, Safari, ...) from the
// test bundle via XCUIAutomation, so this app only shows a status screen.
@main
struct AgentRunnerHostApp: App {
    var body: some Scene {
        WindowGroup {
            VStack(spacing: 12) {
                Text("MobileUse iOS Agent Runner")
                    .font(.title2.bold())
                Text("Started by Xcode UI tests. The agent operates other apps from the test runner.")
                    .multilineTextAlignment(.center)
                    .foregroundStyle(.secondary)
            }
            .padding()
        }
    }
}
