import Foundation

// Wire format shared with the Android app and the backend (/api/agent2): the iOS
// runner sends the same observation shape and receives the same AgentAction, so the
// backend, MAI-UI server and safety checks don't need a separate iOS path.

struct NodeBounds: Codable, Equatable {
    let left: Double
    let top: Double
    let right: Double
    let bottom: Double
}

// Mirrors the Android accessibility node (MobileUseAccessibilityService.walk()).
// Bounds are in points, the same unit as Observation.screenWidth/screenHeight.
struct AccessibilityNode: Codable, Equatable {
    let text: String
    let contentDescription: String
    let className: String
    let clickable: Bool
    let scrollable: Bool
    let bounds: NodeBounds
}

struct Observation: Codable {
    let platform: String
    let currentApp: String
    let accessibilityTree: [AccessibilityNode]
    // Nodes left out by the size limits (TestConfiguration.maxNodes).
    let omittedNodes: Int
    let screenshotBase64: String
    let screenWidth: Double
    let screenHeight: Double
}

// What the backend calls "apps": the label MAI-UI may "open", and its bundle ID.
struct InstalledApp: Codable {
    let label: String
    let package: String
}

struct ActionPoint: Codable {
    let x: Double
    let y: Double
}

struct ActionTarget: Codable {
    let description: String?
    let point: ActionPoint?
}

// AgentAction from the backend: tap, long_press, type, swipe, launch_app,
// press_back, press_home, wait, done.
struct AgentAction: Codable {
    let action: String
    let target: ActionTarget?
    let text: String?
    let direction: String?
    let package: String?
    let result: String?
}

struct StepResponse: Codable {
    let action: AgentAction
    let stepNumber: Int
    let status: String
    let resultText: String?
    // Set when the action would send something or call someone; needs user approval.
    let confirm: String?
}
