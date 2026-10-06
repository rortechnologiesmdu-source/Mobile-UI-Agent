import UIKit
import XCTest

// iOS counterpart of MobileUseAccessibilityService's perception side: screenshot,
// UI hierarchy and foreground app, normalized to the shared Observation format.
final class IOSObservationProvider {

    private let springboard = XCUIApplication(bundleIdentifier: KnownApps.springboard)
    // Checked first when looking for the foreground app (usually the app just opened).
    var lastLaunchedBundleID: String?

    func capture() throws -> Observation {
        let bundleID = foregroundBundleID()
        let screen = springboard.frame.size
        let (nodes, omitted) = try uiTree(of: XCUIApplication(bundleIdentifier: bundleID), screen: screen)
        return Observation(
            platform: "ios",
            currentApp: bundleID,
            accessibilityTree: nodes,
            omittedNodes: omitted,
            screenshotBase64: screenshotBase64(),
            screenWidth: screen.width,
            screenHeight: screen.height
        )
    }

    // XCUITest has no "current app" API, so ask the known apps which one is in front;
    // none means the home screen (SpringBoard).
    func foregroundBundleID() -> String {
        // The MobileUse Agent app itself is left out: once the runner has brought it to
        // the front (after each task), XCUITest keeps reporting it as in front even after
        // Home. The agent never acts inside it, and every task starts by pressing Home.
        var candidates = KnownApps.all.map(\.package) + [KnownApps.spotlight]
        if let last = lastLaunchedBundleID {
            candidates.removeAll { $0 == last }
            candidates.insert(last, at: 0)
        }
        for bundleID in candidates where XCUIApplication(bundleIdentifier: bundleID).state == .runningForeground {
            return bundleID
        }
        return KnownApps.springboard
    }

    // MARK: - UI hierarchy

    // One snapshot call returns the whole tree. Keeps on-screen nodes that carry text
    // or can be interacted with, in depth-first order, up to maxNodes.
    func uiTree(of app: XCUIApplication, screen: CGSize) throws -> ([AccessibilityNode], Int) {
        let root = try app.snapshot()
        let visible = CGRect(origin: .zero, size: screen)
        var nodes: [AccessibilityNode] = []
        var omitted = 0

        func walk(_ element: XCUIElementSnapshot) {
            let frame = element.frame
            let onScreen = frame.width > 0 && frame.height > 0 && visible.intersects(frame)
            let text = Self.clip(element.label.isEmpty ? (element.value as? String ?? "") : element.label)
            let value = Self.clip(element.value as? String ?? "")
            let interactive = Self.interactiveTypes.contains(element.elementType)
            let scrollable = Self.scrollableTypes.contains(element.elementType)

            if onScreen && (!text.isEmpty || interactive || scrollable) {
                if nodes.count < TestConfiguration.maxNodes {
                    nodes.append(AccessibilityNode(
                        text: text,
                        // Android's second label slot: the value when it adds information.
                        contentDescription: value != text ? value : "",
                        className: Self.typeName(element.elementType),
                        clickable: interactive && element.isEnabled,
                        scrollable: scrollable,
                        bounds: NodeBounds(left: frame.minX, top: frame.minY, right: frame.maxX, bottom: frame.maxY)
                    ))
                } else {
                    omitted += 1
                }
            }
            element.children.forEach(walk)
        }
        walk(root)
        return (nodes, omitted)
    }

    private static let interactiveTypes: Set<XCUIElement.ElementType> = [
        .button, .cell, .link, .textField, .secureTextField, .searchField, .textView, .switch,
        .toggle, .tab, .icon, .key, .menuItem, .segmentedControl, .slider, .stepper, .picker,
    ]
    private static let scrollableTypes: Set<XCUIElement.ElementType> = [
        .scrollView, .table, .collectionView, .webView,
    ]

    private static func typeName(_ type: XCUIElement.ElementType) -> String {
        switch type {
        case .button: return "Button"
        case .cell: return "Cell"
        case .staticText: return "StaticText"
        case .textField: return "TextField"
        case .secureTextField: return "SecureTextField"
        case .searchField: return "SearchField"
        case .textView: return "TextView"
        case .switch: return "Switch"
        case .toggle: return "Toggle"
        case .link: return "Link"
        case .image: return "Image"
        case .icon: return "Icon"
        case .tab: return "Tab"
        case .tabBar: return "TabBar"
        case .navigationBar: return "NavigationBar"
        case .toolbar: return "Toolbar"
        case .table: return "Table"
        case .collectionView: return "CollectionView"
        case .scrollView: return "ScrollView"
        case .webView: return "WebView"
        case .key: return "Key"
        case .keyboard: return "Keyboard"
        case .menuItem: return "MenuItem"
        case .segmentedControl: return "SegmentedControl"
        case .slider: return "Slider"
        case .alert: return "Alert"
        case .sheet: return "Sheet"
        case .other: return "Other"
        default: return "Element\(type.rawValue)"
        }
    }

    private static func clip(_ text: String) -> String {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.count > TestConfiguration.maxTextLength
            ? String(trimmed.prefix(TestConfiguration.maxTextLength))
            : trimmed
    }

    // MARK: - Screenshot

    // JPEG, downscaled to screenshotMaxWidth pixels (aspect ratio kept). The model only
    // needs fractions of the screen, so the image size doesn't affect coordinates.
    func screenshotBase64() -> String {
        let image = XCUIScreen.main.screenshot().image
        let pixelWidth = image.size.width * image.scale
        let maxWidth = CGFloat(TestConfiguration.screenshotMaxWidth)
        let width = maxWidth > 0 ? min(maxWidth, pixelWidth) : pixelWidth
        let size = CGSize(width: width, height: (width * image.size.height / image.size.width).rounded())
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        let resized = UIGraphicsImageRenderer(size: size, format: format).image { _ in
            image.draw(in: CGRect(origin: .zero, size: size))
        }
        return (resized.jpegData(compressionQuality: 0.6) ?? Data()).base64EncodedString()
    }
}
