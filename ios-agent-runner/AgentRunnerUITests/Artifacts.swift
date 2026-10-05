import XCTest

// Test artifacts: always attached to the test report, and also written as files
// when AGENT_OUTPUT_DIR is set.
extension XCTestCase {
    func saveArtifact(_ shot: XCUIScreenshot, name: String) {
        let attachment = XCTAttachment(screenshot: shot)
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
        writeArtifact(shot.pngRepresentation, name: "\(name).png")
    }

    func saveArtifact(jsonData data: Data, name: String) {
        let attachment = XCTAttachment(data: data, uniformTypeIdentifier: "public.json")
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
        writeArtifact(data, name: "\(name).json")
    }

    func saveArtifact(json object: [String: Any], name: String) {
        guard let data = try? JSONSerialization.data(withJSONObject: object, options: [.prettyPrinted, .sortedKeys]) else { return }
        saveArtifact(jsonData: data, name: name)
    }

    private func writeArtifact(_ data: Data, name: String) {
        guard let dir = TestConfiguration.outputDir else { return }
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        try? data.write(to: dir.appendingPathComponent(name))
    }
}
