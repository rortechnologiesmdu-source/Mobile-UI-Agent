import SwiftUI

// MobileUse Agent for iOS: type a task, and the iOS runner (XCUITest on the Mac,
// started by serve.sh) carries it out on this simulator with MAI-UI, through the
// same Node backend as the Android app. This app never drives other apps itself —
// iOS doesn't allow that; it queues tasks and shows their progress.
@main
struct AgentRunnerHostApp: App {
    var body: some Scene {
        WindowGroup {
            AgentView()
        }
    }
}
