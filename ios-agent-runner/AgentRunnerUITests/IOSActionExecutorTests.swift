import XCTest

// Phase 5 (iOS.md): each executor action on the simulator, verified by the screen
// actually changing. Uses Settings and the home screen only (harmless).
final class IOSActionExecutorTests: XCTestCase {

    private let settings = XCUIApplication(bundleIdentifier: "com.apple.Preferences")
    private let springboard = XCUIApplication(bundleIdentifier: KnownApps.springboard)
    private let observations = IOSObservationProvider()
    private lazy var executor = IOSActionExecutor(observations: observations)

    override func setUp() {
        continueAfterFailure = false
    }

    // Settings reopens on the screen it was last on (a sub-page, or an open search),
    // so bring it back to its main list before each test.
    private func openSettings() {
        settings.terminate()
        settings.launch()
        observations.lastLaunchedBundleID = "com.apple.Preferences"
        XCTAssertTrue(settings.wait(for: .runningForeground, timeout: 10))
        for _ in 0..<5 {
            if settings.staticTexts["Accessibility"].isHittable { return }
            let closeSearch = settings.buttons["close"].firstMatch
            let back = settings.navigationBars.firstMatch.buttons.firstMatch
            if closeSearch.exists && closeSearch.isHittable {
                closeSearch.tap()
            } else if back.exists && back.isHittable {
                back.tap()
            } else {
                break
            }
        }
        XCTAssertTrue(settings.staticTexts["Accessibility"].waitForExistence(timeout: 5), "Settings main list not shown")
        // Let any back-navigation animation finish, so element frames are final.
        Thread.sleep(forTimeInterval: 1.0)
    }

    private func action(_ name: String, point: (Double, Double)? = nil, text: String? = nil,
                        direction: String? = nil, package: String? = nil) -> AgentAction {
        AgentAction(
            action: name,
            target: point.map { ActionTarget(description: "", point: ActionPoint(x: $0.0, y: $0.1)) },
            text: text, direction: direction, package: package, result: nil
        )
    }

    // A 0-1 point at an element's centre, the way the backend sends taps.
    private func center(of element: XCUIElement) -> (Double, Double) {
        let screen = springboard.frame.size
        return (Double(element.frame.midX / screen.width), Double(element.frame.midY / screen.height))
    }

    func testTapAndBack() throws {
        openSettings()
        let general = settings.staticTexts["General"].firstMatch
        XCTAssertTrue(general.waitForExistence(timeout: 5))
        let point = center(of: general)
        print("[EXEC] General frame \(general.frame), point \(point)")
        print("[EXEC] " + (try executor.execute(action("tap", point: point))))
        saveArtifact(XCUIScreen.main.screenshot(), name: "after-tap-general")
        XCTAssertTrue(settings.navigationBars["General"].waitForExistence(timeout: 5), "tap did not open General")

        print("[EXEC] " + (try executor.execute(action("press_back"))))
        XCTAssertTrue(settings.staticTexts["Accessibility"].waitForExistence(timeout: 5), "back did not return to Settings")
    }

    func testSwipeScrolls() throws {
        openSettings()
        let before = try observations.capture().accessibilityTree.map(\.text)
        print("[EXEC] " + (try executor.execute(action("swipe", direction: "up"))))
        Thread.sleep(forTimeInterval: 1)
        let after = try observations.capture().accessibilityTree.map(\.text)
        let newLabels = Set(after).subtracting(before).filter { !$0.isEmpty }
        print("[EXEC] labels revealed by swipe up: \(newLabels.sorted().prefix(8))")
        XCTAssertFalse(newLabels.isEmpty, "swipe up did not scroll")
    }

    func testTapFieldAndType() throws {
        openSettings()
        let search = settings.searchFields.firstMatch
        XCTAssertTrue(search.waitForExistence(timeout: 5), "no search field in Settings")
        print("[EXEC] " + (try executor.execute(action("tap", point: center(of: search)))))
        print("[EXEC] " + (try executor.execute(action("type", text: "Gen"))))
        let value = search.value as? String ?? ""
        print("[EXEC] search field now: \"\(value)\"")
        XCTAssertTrue(value.contains("Gen"), "typed text not in the search field")
    }

    func testLaunchAppAndHome() throws {
        print("[EXEC] " + (try executor.execute(action("launch_app", package: "com.apple.mobilesafari"))))
        XCTAssertTrue(XCUIApplication(bundleIdentifier: "com.apple.mobilesafari").wait(for: .runningForeground, timeout: 10))
        XCTAssertEqual(observations.foregroundBundleID(), "com.apple.mobilesafari")

        print("[EXEC] " + (try executor.execute(action("press_home"))))
        XCTAssertTrue(XCUIApplication(bundleIdentifier: "com.apple.mobilesafari").wait(for: .runningBackground, timeout: 5))
        XCTAssertEqual(observations.foregroundBundleID(), KnownApps.springboard)
    }

    // Long-pressing a Dock icon opens its context menu. Reads the home screen's own
    // tree (not "whichever app is in front") so another app can't fake a pass.
    func testLongPressShowsMenu() throws {
        XCUIDevice.shared.press(.home)
        Thread.sleep(forTimeInterval: 0.8)
        let safari = springboard.icons["Safari"].firstMatch
        XCTAssertTrue(safari.waitForExistence(timeout: 5) && safari.isHittable, "no tappable Safari icon in the Dock")
        let screen = springboard.frame.size
        let before = Set(try observations.uiTree(of: springboard, screen: screen).0.map(\.text))
        print("[EXEC] " + (try executor.execute(action("long_press", point: center(of: safari)))))
        Thread.sleep(forTimeInterval: 1)
        saveArtifact(XCUIScreen.main.screenshot(), name: "after-long-press")
        let after = Set(try observations.uiTree(of: springboard, screen: screen).0.map(\.text))
        let menu = after.subtracting(before).filter { !$0.isEmpty }
        print("[EXEC] long press revealed on the home screen: \(menu.sorted())")
        XCUIDevice.shared.press(.home) // dismiss the menu
        XCTAssertFalse(menu.isEmpty, "long press did not open a menu")
    }

    func testWaitAndDone() throws {
        let started = Date()
        print("[EXEC] " + (try executor.execute(action("wait"))))
        XCTAssertGreaterThanOrEqual(Date().timeIntervalSince(started), IOSActionExecutor.waitSeconds - 0.1)
        XCTAssertEqual(try executor.execute(action("done")), "done")
    }

    // Failures are reported, never silently treated as success.
    func testRejectsUnsafeOrUnsupported() throws {
        XCUIDevice.shared.press(.home)
        XCTAssertTrue(springboard.wait(for: .runningForeground, timeout: 5))
        Thread.sleep(forTimeInterval: 0.6)
        let cases: [(AgentAction, ExecutionError.Code)] = [
            (action("tap", point: (1.4, 0.2)), .coordinateOutOfRange),
            (action("swipe", direction: "sideways"), .invalidAction),
            (action("launch_app", package: "com.example.unknown"), .appNotFound),
            (action("press_back"), .unsupported),
            (action("type", text: "x"), .targetNotFound),
            (action("fly"), .invalidAction),
        ]
        for (bad, expected) in cases {
            XCTAssertThrowsError(try executor.execute(bad)) { error in
                let code = (error as? ExecutionError)?.code
                print("[EXEC] \(bad.action) -> \(error)")
                XCTAssertEqual(code, expected, "\(bad.action) should fail with \(expected.rawValue)")
            }
        }
    }
}
