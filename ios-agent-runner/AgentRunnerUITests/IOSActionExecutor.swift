import XCTest

// Structured failure codes (iOS.md): the runner reports these instead of claiming success.
struct ExecutionError: Error, CustomStringConvertible {
    enum Code: String {
        case invalidAction = "INVALID_MODEL_ACTION"
        case coordinateOutOfRange = "COORDINATE_OUT_OF_RANGE"
        case targetNotFound = "TARGET_NOT_FOUND"
        case targetAmbiguous = "TARGET_AMBIGUOUS"
        case unsupported = "UNSUPPORTED_ACTION"
        case appNotFound = "APP_NOT_FOUND"
    }

    let code: Code
    let message: String
    var description: String { "\(code.rawValue): \(message)" }
}

// iOS counterpart of AgentModule.executeAction: performs a backend AgentAction with
// public XCUIAutomation APIs only. Coordinates arrive as 0-1 fractions of the screen.
final class IOSActionExecutor {

    private let springboard = XCUIApplication(bundleIdentifier: KnownApps.springboard)
    private let observations: IOSObservationProvider

    static let longPressSeconds: TimeInterval = 0.6
    static let waitSeconds: TimeInterval = 1.5

    init(observations: IOSObservationProvider) {
        self.observations = observations
    }

    // Returns a short description of what was done; throws ExecutionError otherwise.
    @discardableResult
    func execute(_ action: AgentAction) throws -> String {
        switch action.action {
        case "tap":
            if let point = action.target?.point {
                try coordinate(point).tap()
                return "tapped (\(point.x), \(point.y))"
            }
            let label = action.target?.description ?? ""
            try element(labelled: label).tap()
            return "tapped \"\(label)\""

        case "long_press":
            guard let point = action.target?.point else {
                throw ExecutionError(code: .invalidAction, message: "long_press needs a point")
            }
            try coordinate(point).press(forDuration: Self.longPressSeconds)
            return "long-pressed (\(point.x), \(point.y))"

        case "type":
            guard let text = action.text, !text.isEmpty else {
                throw ExecutionError(code: .invalidAction, message: "type needs text")
            }
            guard let app = appShowingKeyboard() else {
                throw ExecutionError(code: .targetNotFound, message: "no focused text field (keyboard not shown)")
            }
            app.typeText(text)
            return "typed \(text.count) characters"

        case "swipe":
            return try swipe(action.direction ?? "")

        case "launch_app":
            guard let bundleID = action.package, KnownApps.all.contains(where: { $0.package == bundleID }) else {
                throw ExecutionError(code: .appNotFound, message: "unknown app \(action.package ?? "-")")
            }
            XCUIApplication(bundleIdentifier: bundleID).activate()
            observations.lastLaunchedBundleID = bundleID
            return "opened \(bundleID)"

        case "press_home":
            let previous = observations.foregroundBundleID()
            XCUIDevice.shared.press(.home)
            // An app reports itself as in front for a moment after Home; wait until it
            // has left, so the next observation reads the home screen, not the old app.
            if previous != KnownApps.springboard {
                let app = XCUIApplication(bundleIdentifier: previous)
                let deadline = Date().addingTimeInterval(3)
                while app.state == .runningForeground && Date() < deadline {
                    Thread.sleep(forTimeInterval: 0.1)
                }
            }
            return "pressed Home"

        case "press_back":
            return try goBack()

        case "wait":
            Thread.sleep(forTimeInterval: Self.waitSeconds)
            return "waited \(Self.waitSeconds)s"

        case "done":
            return "done"

        default:
            throw ExecutionError(code: .invalidAction, message: "unknown action \(action.action)")
        }
    }

    // MARK: - Helpers

    private func coordinate(_ point: ActionPoint) throws -> XCUICoordinate {
        guard point.x.isFinite, point.y.isFinite, (0...1).contains(point.x), (0...1).contains(point.y) else {
            throw ExecutionError(code: .coordinateOutOfRange, message: "point (\(point.x), \(point.y)) is outside 0-1")
        }
        // SpringBoard spans the whole screen, so its coordinate space is the screen's.
        return springboard.coordinate(withNormalizedOffset: CGVector(dx: point.x, dy: point.y))
    }

    private func foregroundApp() -> XCUIApplication {
        XCUIApplication(bundleIdentifier: observations.foregroundBundleID())
    }

    // The app that owns the focused text field: the app in front, the home screen, or
    // Spotlight (home-screen search runs in its own process). Checks keyboard focus,
    // not the on-screen keyboard — typing on the Mac's keyboard switches the simulator
    // to a hardware keyboard and hides the on-screen one.
    private func appShowingKeyboard() -> XCUIApplication? {
        let candidates = [observations.foregroundBundleID(), KnownApps.springboard, KnownApps.spotlight]
        let focused = NSPredicate(format: "hasKeyboardFocus == true")
        let deadline = Date().addingTimeInterval(2)
        repeat {
            for bundleID in candidates {
                let app = XCUIApplication(bundleIdentifier: bundleID)
                if app.keyboards.firstMatch.exists || app.descendants(matching: .any).matching(focused).firstMatch.exists {
                    return app
                }
            }
            Thread.sleep(forTimeInterval: 0.2)
        } while Date() < deadline
        return nil
    }

    // Semantic fallback when no point is given: exact label, and only if unique.
    private func element(labelled label: String) throws -> XCUIElement {
        guard !label.isEmpty else { throw ExecutionError(code: .invalidAction, message: "tap needs a point or a label") }
        let matches = foregroundApp().descendants(matching: .any).matching(NSPredicate(format: "label == %@", label))
        let hittable = matches.allElementsBoundByIndex.filter(\.isHittable)
        if hittable.isEmpty { throw ExecutionError(code: .targetNotFound, message: "no element labelled \"\(label)\"") }
        if hittable.count > 1 { throw ExecutionError(code: .targetAmbiguous, message: "\(hittable.count) elements labelled \"\(label)\"") }
        return hittable[0]
    }

    // Finger direction, like Android's dispatchSwipe: "up" moves content up (scrolls down).
    private func swipe(_ direction: String) throws -> String {
        let (from, to): (CGVector, CGVector)
        switch direction {
        case "up": (from, to) = (CGVector(dx: 0.5, dy: 0.75), CGVector(dx: 0.5, dy: 0.25))
        case "down": (from, to) = (CGVector(dx: 0.5, dy: 0.25), CGVector(dx: 0.5, dy: 0.75))
        case "left": (from, to) = (CGVector(dx: 0.8, dy: 0.5), CGVector(dx: 0.2, dy: 0.5))
        case "right": (from, to) = (CGVector(dx: 0.2, dy: 0.5), CGVector(dx: 0.8, dy: 0.5))
        default: throw ExecutionError(code: .invalidAction, message: "invalid swipe direction \"\(direction)\"")
        }
        let start = springboard.coordinate(withNormalizedOffset: from)
        let end = springboard.coordinate(withNormalizedOffset: to)
        start.press(forDuration: 0.05, thenDragTo: end, withVelocity: .fast, thenHoldForDuration: 0)
        return "swiped \(direction)"
    }

    // iOS has no system Back button. Use the screen's own back control (the leading
    // button of the navigation bar); never guess with an edge swipe.
    private func goBack() throws -> String {
        let app = foregroundApp()
        let back = app.navigationBars.firstMatch.buttons.firstMatch
        guard back.exists, back.isHittable else {
            throw ExecutionError(code: .unsupported, message: "no back button on this screen")
        }
        let label = back.label
        back.tap()
        return "tapped back button \"\(label)\""
    }
}
