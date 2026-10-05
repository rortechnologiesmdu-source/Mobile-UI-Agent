import XCTest

// Phase 2 proof of concept (iOS.md): no model, no backend. Verifies the three things
// the agent depends on, using only public XCTest/XCUIAutomation APIs:
//   1. screenshots of another app (Settings),
//   2. reading that app's UI hierarchy,
//   3. tapping an element and seeing the screen change,
// plus the normalized-coordinate mapping the executor will use.
//
// Results are saved with saveArtifact (see Artifacts.swift).
final class RunnerPOCTests: XCTestCase {

    private let settings = XCUIApplication(bundleIdentifier: "com.apple.Preferences")
    private let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")

    override func setUp() {
        continueAfterFailure = false
    }

    // iOS.md suggests Settings -> Wi-Fi, but the simulator's Settings has no Wi-Fi row
    // (no Wi-Fi hardware), so the POC uses General, which every device has.
    func testSettingsGeneralTap() throws {
        settings.terminate()
        settings.launch()
        XCTAssertTrue(settings.wait(for: .runningForeground, timeout: 10), "Settings did not come to the foreground")

        let before = XCUIScreen.main.screenshot()
        saveArtifact(before, name: "1-settings")

        // UI hierarchy: one snapshot call returns the whole tree at once.
        let tree = try settings.snapshot()
        var labelled: [[String: Any]] = []
        let total = flatten(tree, into: &labelled)
        print("[POC] Settings tree: \(total) nodes, \(labelled.count) with a label")
        saveArtifact(json: ["total_nodes": total, "labelled_nodes": labelled], name: "1-settings-tree")

        let general = settings.staticTexts["General"].firstMatch
        XCTAssertTrue(general.waitForExistence(timeout: 5), "No 'General' element in Settings")
        print("[POC] General element frame (points): \(general.frame), hittable: \(general.isHittable)")
        general.tap()

        // The screen changed if a navigation bar titled General appears.
        let opened = settings.navigationBars["General"].waitForExistence(timeout: 5)
        saveArtifact(XCUIScreen.main.screenshot(), name: "2-after-general-tap")
        XCTAssertTrue(opened, "Tapping General did not open the General screen")
        print("[POC] General screen opened: \(opened)")
    }

    // Normalized (0-1) screen coordinates must land where expected: the executor will
    // receive points as fractions of the screen from the backend.
    func testCoordinateMapping() throws {
        let screen = springboard.frame.size
        let shot = XCUIScreen.main.screenshot()
        let image = shot.image
        print("[POC] Screen (points): \(screen), screenshot: \(image.size) @\(image.scale)x")

        var results: [[String: Any]] = []
        let checks: [(Double, Double)] = [(0, 0), (1, 0), (0, 1), (1, 1), (0.5, 0.5)]
        for (x, y) in checks {
            let point = springboard.coordinate(withNormalizedOffset: CGVector(dx: x, dy: y)).screenPoint
            let expected = CGPoint(x: x * screen.width, y: y * screen.height)
            let ok = abs(point.x - expected.x) < 1 && abs(point.y - expected.y) < 1
            print("[POC] (\(x), \(y)) -> \(point) expected \(expected) \(ok ? "OK" : "MISMATCH")")
            results.append(["normalized": [x, y], "screen_point": [point.x, point.y], "ok": ok])
            XCTAssertTrue(ok, "Coordinate (\(x), \(y)) mapped to \(point), expected \(expected)")
        }
        saveArtifact(json: [
            "screen_points": [screen.width, screen.height],
            "screenshot_points": [image.size.width, image.size.height],
            "screenshot_scale": image.scale,
            "checks": results,
        ], name: "coordinate-mapping")
    }

    // MARK: - Helpers

    // Depth-first walk; keeps nodes that carry a label/identifier/value.
    @discardableResult
    private func flatten(_ node: XCUIElementSnapshot, into out: inout [[String: Any]]) -> Int {
        let text = node.label.isEmpty ? (node.value as? String ?? "") : node.label
        if !text.isEmpty || !node.identifier.isEmpty {
            out.append([
                "type": node.elementType.rawValue,
                "label": node.label,
                "identifier": node.identifier,
                "value": node.value as? String ?? "",
                "enabled": node.isEnabled,
                "frame": [node.frame.minX, node.frame.minY, node.frame.width, node.frame.height],
            ])
        }
        var count = 1
        for child in node.children { count += flatten(child, into: &out) }
        return count
    }
}
